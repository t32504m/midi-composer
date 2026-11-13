// 音源エンジン（SpessaSynth の WorkletSynthesizer）の初期化と、時刻指定の発音。
// 発音時刻はすべて AudioContext の時計で指定する（NF-02）。
//
// 注意: SpessaSynth の stopAll は、時刻指定で予約済みのイベントを消さない（v4.3 で確認）。
// そこで停止時は、出力を一時的に消音し、予約済みイベントがすべて処理された後の時刻に
// 全チャンネルへ「全音停止」（CC120・CC123）を予約してから消音を解く（PLAY-04）。
import { WorkletSynthesizer } from "spessasynth_lib";
import processorUrl from "spessasynth_lib/dist/spessasynth_processor.min.js?url";
import { Song } from "../model/types";
import { assignChannels, DRUM_CHANNEL } from "../model/instruments";

const SOUNDFONT_URL = `${import.meta.env.BASE_URL}soundfonts/GeneralUserGS.sf3`;
/** メトロノーム用に追加するチャンネル（17番目、0始まりで16） */
export const METRONOME_CHANNEL = 16;
const CHANNEL_COUNT = 17;

export type AudioState = "off" | "loading" | "ready" | "error";

export interface AudioStatus {
  state: AudioState;
  message: string;
  progress?: number;
}

type Listener = (s: AudioStatus) => void;

class AudioEngine {
  ctx: AudioContext | null = null;
  private synth: WorkletSynthesizer | null = null;
  private out: GainNode | null = null;
  private initPromise: Promise<boolean> | null = null;
  private listeners = new Set<Listener>();
  status: AudioStatus = { state: "off", message: "音声: 未開始（最初の操作で有効になります）" };
  /** この時刻までは消音中（停止後の後始末） */
  private clearUntil = 0;
  /** 予約したイベントの最も遅い時刻 */
  private maxScheduled = 0;
  private channelCache = new Map<number, string>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setStatus(s: AudioStatus) {
    this.status = s;
    for (const fn of this.listeners) fn(s);
  }

  get ready(): boolean {
    return this.status.state === "ready";
  }

  /** ブラウザの自動再生の制限のため、ユーザーの操作をきっかけに呼ぶ（PLAY-03） */
  ensureStarted(): Promise<boolean> {
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.init().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      this.setStatus({ state: "error", message: `音声: 準備に失敗しました（${msg}）` });
      this.initPromise = null;
      return false;
    });
    return this.initPromise;
  }

  private async init(): Promise<boolean> {
    this.setStatus({ state: "loading", message: "音声: 音色を読み込み中…", progress: 0 });
    const ctx = this.ctx ?? new AudioContext({ latencyHint: "interactive" });
    this.ctx = ctx;
    await ctx.resume();
    await ctx.audioWorklet.addModule(processorUrl);
    const synth = new WorkletSynthesizer(ctx);
    const out = ctx.createGain();
    synth.connect(out);
    out.connect(ctx.destination);
    const buf = await this.fetchWithProgress(SOUNDFONT_URL);
    await synth.soundBankManager.addSoundBank(buf, "main");
    await synth.isReady;
    while (synth.channelCount < CHANNEL_COUNT) synth.addNewChannel();
    synth.midiChannels[DRUM_CHANNEL]?.setDrums(true);
    synth.midiChannels[METRONOME_CHANNEL]?.setDrums(true);
    this.synth = synth;
    this.out = out;
    this.channelCache.clear();
    this.setStatus({ state: "ready", message: "音声: 準備完了" });
    return true;
  }

  private async fetchWithProgress(url: string): Promise<ArrayBuffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`音色ファイルを取得できません（${res.status}）`);
    const total = Number(res.headers.get("content-length")) || 0;
    if (!res.body || !total) return res.arrayBuffer();
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      this.setStatus({ state: "loading", message: `音声: 音色を読み込み中… ${Math.floor((got / total) * 100)}%`, progress: got / total });
    }
    const all = new Uint8Array(got);
    let off = 0;
    for (const c of chunks) {
      all.set(c, off);
      off += c.length;
    }
    return all.buffer;
  }

  now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** 新しく音を予約できる最も早い時刻 */
  earliest(): number {
    return Math.max(this.now() + 0.02, this.clearUntil + 0.01);
  }

  /** 各トラックのチャンネルに音色と音量を設定する（変わったときだけ送る） */
  syncChannels(song: Song) {
    const synth = this.synth;
    if (!synth) return;
    const channels = assignChannels(song);
    for (const t of song.tracks) {
      const ch = channels.get(t.id);
      if (ch === undefined) continue;
      const key = `${t.kind}:${t.program}:${t.volume}`;
      if (this.channelCache.get(ch) === key) continue;
      this.channelCache.set(ch, key);
      if (t.kind !== "drum") synth.programChange(ch, t.program);
      synth.controllerChange(ch, 7 as never, t.volume);
    }
  }

  noteOn(ch: number, pitch: number, velocity: number, time: number) {
    if (!this.synth) return;
    this.maxScheduled = Math.max(this.maxScheduled, time);
    this.synth.noteOn(ch, pitch, velocity, { time });
  }

  noteOff(ch: number, pitch: number, time: number) {
    if (!this.synth) return;
    this.maxScheduled = Math.max(this.maxScheduled, time);
    this.synth.noteOff(ch, pitch, { time });
  }

  /** 1音を短く鳴らす（音符を置いたとき、コードの試聴など） */
  preview(ch: number, pitches: number[], velocity: number, duration: number) {
    if (!this.ready) return;
    const t = this.earliest();
    for (const p of pitches) {
      this.noteOn(ch, p, velocity, t);
      this.noteOff(ch, p, t + duration);
    }
  }

  /** 鳴っている音と予約済みの音をすべて止める */
  stopAll() {
    const synth = this.synth;
    const ctx = this.ctx;
    const out = this.out;
    if (!synth || !ctx || !out) return;
    const t = ctx.currentTime;
    out.gain.cancelScheduledValues(t);
    out.gain.setValueAtTime(0, t);
    synth.stopAll(true);
    const clearAt = Math.max(t, this.maxScheduled) + 0.03;
    for (let ch = 0; ch < CHANNEL_COUNT; ch++) {
      synth.controllerChange(ch, 120 as never, 0, { time: clearAt });
      synth.controllerChange(ch, 123 as never, 0, { time: clearAt });
    }
    out.gain.setValueAtTime(1, clearAt + 0.03);
    this.clearUntil = clearAt + 0.03;
    this.maxScheduled = 0;
  }
}

export const engine = new AudioEngine();
