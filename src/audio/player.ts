// 再生のスケジューラー。音楽上の位置（tick）を、テンポに従って AudioContext の時刻へ変換し、
// 少し先まで発音を予約する（先読み方式）。描画のフレームは発音時刻に使わない（NF-02）。
import { MixerState, PPQ, Song } from "../model/types";
import { NoteDraft } from "../model/edit";
import { assignChannels } from "../model/instruments";
import { resolveOverlaps } from "../model/overlap";
import { audibleTrackIds } from "../model/mixer";
import { barLength, beatLength } from "../model/time";
import { METRONOME_CHANNEL, engine } from "./engine";

interface Ev {
  start: number;
  end: number;
  pitch: number;
  velocity: number;
  ch: number;
}

interface Segment {
  time0: number;
  tick0: number;
  time1: number; // この区間が終わる時刻（Infinity なら未定）
  secPerTick: number;
}

export interface PlayOptions {
  startTick: number;
  /** ここで止める（ループしない場合） */
  endTick: number;
  loop: { start: number; end: number } | null;
  /** 曲データに含めない追加の音符（試聴用のプレビュー） */
  extra?: { trackId: number; notes: NoteDraft[] }[];
  /** 指定すると、このトラックだけを鳴らす */
  onlyTrackIds?: Set<number>;
}

export interface PlayerHost {
  getSong(): Song;
  getMixer(): MixerState;
  getMetronome(): boolean;
}

const INTERVAL_MS = 25;
const LOOKAHEAD_VISIBLE = 0.12;
const LOOKAHEAD_HIDDEN = 1.0;

export class Player {
  playing = false;
  private opts: PlayOptions | null = null;
  private timer: number | null = null;
  private segments: Segment[] = [];
  private scheduledTick = 0;
  private sounding: { ch: number; pitch: number; offTime: number }[] = [];
  private cacheKey: unknown[] = [];
  private events: Ev[] = [];
  private tempo = 120;
  private endTime = Infinity;
  onEnded: (() => void) | null = null;

  constructor(private host: PlayerHost) {}

  start(opts: PlayOptions) {
    if (this.playing) this.stop();
    if (!engine.ready) return;
    const song = this.host.getSong();
    engine.syncChannels(song);
    this.opts = opts;
    this.tempo = song.tempo;
    this.sounding = [];
    this.cacheKey = [];
    this.endTime = Infinity;
    const t0 = engine.earliest() + 0.05;
    this.segments = [{ time0: t0, tick0: opts.startTick, time1: Infinity, secPerTick: this.spt() }];
    this.scheduledTick = opts.startTick;
    this.playing = true;
    this.pump();
    this.timer = window.setInterval(() => this.pump(), INTERVAL_MS);
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    const was = this.playing;
    this.playing = false;
    this.opts = null;
    this.sounding = [];
    if (was) engine.stopAll();
  }

  /** 画面に表示する再生位置（tick） */
  positionTick(): number {
    const now = engine.now();
    const segs = this.segments;
    if (segs.length === 0) return 0;
    if (now < segs[0].time0) return segs[0].tick0;
    for (const s of segs) if (now >= s.time0 && now < s.time1) return s.tick0 + (now - s.time0) / s.secPerTick;
    const last = segs[segs.length - 1];
    return last.tick0 + (Math.min(now, last.time1) - last.time0) / last.secPerTick;
  }

  private spt(): number {
    return 60 / (this.tempo * PPQ);
  }

  private current(): Segment {
    return this.segments[this.segments.length - 1];
  }

  private timeOf(tick: number): number {
    const s = this.current();
    return s.time0 + (tick - s.tick0) * s.secPerTick;
  }

  private rebuildEvents(song: Song, mixer: MixerState) {
    const o = this.opts!;
    const key = [song, mixer, o.extra, o.onlyTrackIds];
    if (key.every((k, i) => k === this.cacheKey[i])) return;
    this.cacheKey = key;
    const channels = assignChannels(song);
    const audible = o.onlyTrackIds ?? audibleTrackIds(song, mixer);
    const evs: Ev[] = [];
    for (const t of song.tracks) {
      const ch = channels.get(t.id);
      if (ch === undefined) continue;
      const extra = o.extra?.find((e) => e.trackId === t.id);
      if (!audible.has(t.id) && !extra) continue;
      const base = audible.has(t.id) ? t.notes : [];
      const notes = extra ? [...base, ...extra.notes.map((n, i) => ({ ...n, id: -1 - i }))] : base;
      for (const n of resolveOverlaps(notes)) evs.push({ start: n.start, end: n.end, pitch: n.pitch, velocity: n.velocity, ch });
    }
    evs.sort((a, b) => a.start - b.start);
    this.events = evs;
  }

  private pump() {
    if (!this.playing || !this.opts) return;
    const o = this.opts;
    const song = this.host.getSong();
    const now = engine.now();
    if (now >= this.endTime) {
      this.stop();
      this.onEnded?.();
      return;
    }
    engine.syncChannels(song);
    this.rebuildEvents(song, this.host.getMixer());
    // テンポが変わったら、まだ予約していない位置から新しい区間にする
    if (song.tempo !== this.tempo) {
      const t = this.timeOf(this.scheduledTick);
      this.current().time1 = t;
      this.tempo = song.tempo;
      this.segments.push({ time0: t, tick0: this.scheduledTick, time1: Infinity, secPerTick: this.spt() });
    }
    const horizon = now + (document.hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD_VISIBLE);
    let guard = 0;
    while (this.endTime === Infinity && this.timeOf(this.scheduledTick) < horizon && guard++ < 64) {
      const cur = this.current();
      const horizonTick = cur.tick0 + (horizon - cur.time0) / cur.secPerTick;
      const stopAt = o.loop ? o.loop.end : o.endTick;
      const segEnd = Math.min(Math.ceil(horizonTick), stopAt);
      this.scheduleRange(this.scheduledTick, segEnd, song);
      this.scheduledTick = segEnd;
      if (segEnd >= stopAt) {
        const tEnd = this.timeOf(stopAt);
        this.cutSounding(tEnd);
        if (o.loop) {
          // ループの開始より前に始まった音符は鳴らさない
          cur.time1 = tEnd;
          this.segments.push({ time0: tEnd, tick0: o.loop.start, time1: Infinity, secPerTick: this.spt() });
          if (this.segments.length > 8) this.segments.splice(0, this.segments.length - 8);
          this.scheduledTick = o.loop.start;
        } else {
          cur.time1 = tEnd;
          this.endTime = tEnd + 0.05;
        }
      }
    }
    // ノートオフの予約
    const keep: typeof this.sounding = [];
    for (const s of this.sounding) {
      if (s.offTime < horizon) engine.noteOff(s.ch, s.pitch, s.offTime);
      else keep.push(s);
    }
    this.sounding = keep;
  }

  /** 開始位置が [from, to) の音符とメトロノームを予約する */
  private scheduleRange(from: number, to: number, song: Song) {
    if (to <= from) return;
    const evs = this.events;
    let lo = 0;
    let hi = evs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (evs[mid].start < from) lo = mid + 1;
      else hi = mid;
    }
    const loopEnd = this.opts?.loop?.end ?? Infinity;
    const endTick = this.opts?.loop ? loopEnd : (this.opts?.endTick ?? Infinity);
    for (let i = lo; i < evs.length && evs[i].start < to; i++) {
      const e = evs[i];
      const on = this.timeOf(e.start);
      const off = this.timeOf(Math.min(e.end, endTick));
      engine.noteOn(e.ch, e.pitch, e.velocity, on);
      this.sounding.push({ ch: e.ch, pitch: e.pitch, offTime: off });
    }
    if (this.host.getMetronome()) {
      const bl = barLength(song.timeSig);
      const bt = beatLength(song.timeSig);
      for (let t = Math.ceil(from / bt) * bt; t < to; t += bt) {
        const head = t % bl === 0;
        const on = this.timeOf(t);
        const p = head ? 76 : 77;
        engine.noteOn(METRONOME_CHANNEL, p, head ? 110 : 80, on);
        engine.noteOff(METRONOME_CHANNEL, p, on + 0.05);
      }
    }
  }

  /** ループの終わりや停止位置で、鳴っている音を止める */
  private cutSounding(t: number) {
    for (const s of this.sounding) engine.noteOff(s.ch, s.pitch, Math.min(s.offTime, t));
    this.sounding = [];
  }
}
