// 曲データを変更する操作。すべて純粋関数で、新しい Song を返す（元の Song は変更しない）。
// 音符を変えるのは、ここにある「対象を明示した編集」だけ（INV-01）。
import {
  MAX_DRUM_TRACKS,
  MAX_MELODIC_TRACKS,
  MIN_NOTE_LENGTH,
  Note,
  Song,
  TimeRange,
  TimeSignature,
  Track,
  TrackKind,
  clampInt,
  newId,
} from "./types";
import { barLength, beatLength } from "./time";
import { stepLength } from "./snap";
import { copyBlocksForDuplicate, followMovedNotes, mapBlocks, pruneBlocks } from "./chordBlocks";

export type NoteDraft = Omit<Note, "id">;

export function findTrack(song: Song, trackId: number): Track | undefined {
  return song.tracks.find((t) => t.id === trackId);
}

function mapTrack(song: Song, trackId: number, fn: (t: Track) => Track): Song {
  return { ...song, tracks: song.tracks.map((t) => (t.id === trackId ? fn(t) : t)) };
}

function sortNotes(notes: Note[]): Note[] {
  return notes.slice().sort((a, b) => a.start - b.start || a.pitch - b.pitch || a.id - b.id);
}

function normalizeDraft(d: NoteDraft): NoteDraft {
  return {
    pitch: clampInt(d.pitch, 0, 127),
    start: Math.max(0, Math.round(d.start)),
    length: Math.max(MIN_NOTE_LENGTH, Math.round(d.length)),
    velocity: clampInt(d.velocity, 1, 127),
  };
}

// ---- 音符 ----

export function addNotes(song: Song, trackId: number, drafts: NoteDraft[]): { song: Song; ids: number[] } {
  const ids: number[] = [];
  const added = drafts.map((d) => {
    const n: Note = { id: newId(), ...normalizeDraft(d) };
    ids.push(n.id);
    return n;
  });
  return { song: mapTrack(song, trackId, (t) => ({ ...t, notes: sortNotes([...t.notes, ...added]) })), ids };
}

export function deleteNotes(song: Song, ids: Set<number>): Song {
  if (ids.size === 0) return song;
  return {
    ...song,
    tracks: song.tracks.map((t) =>
      t.notes.some((n) => ids.has(n.id)) ? pruneBlocks({ ...t, notes: t.notes.filter((n) => !ids.has(n.id)) }) : t,
    ),
  };
}

/** 音高の移動量を、選択した全音符が 0〜127 に収まるよう全体で制限する */
export function clampPitchDelta(notes: Note[], dPitch: number): number {
  if (notes.length === 0) return 0;
  const lo = Math.min(...notes.map((n) => n.pitch));
  const hi = Math.max(...notes.map((n) => n.pitch));
  return Math.max(-lo, Math.min(127 - hi, dPitch));
}

export function moveNotes(song: Song, trackId: number, ids: Set<number>, dTick: number, dPitch: number): Song {
  if (dTick === 0 && dPitch === 0) return song;
  return mapTrack(song, trackId, (t) =>
    followMovedNotes(
      {
        ...t,
        notes: sortNotes(t.notes.map((n) => (ids.has(n.id) ? { ...n, start: n.start + dTick, pitch: n.pitch + dPitch } : n))),
      },
      ids,
      dTick,
    ),
  );
}

/** 長さの変化量を選択中の全音符に加える。最小長を下回る音符は最小長で止める。 */
export function resizeNotes(song: Song, trackId: number, ids: Set<number>, dLength: number): Song {
  if (dLength === 0) return song;
  return mapTrack(song, trackId, (t) => ({
    ...t,
    notes: t.notes.map((n) =>
      ids.has(n.id) ? { ...n, length: Math.max(MIN_NOTE_LENGTH, n.length + dLength) } : n,
    ),
  }));
}

/** Shift+←→: 選んだ音符の長さを1段階ずつ変える（規則は snap.ts の stepLength） */
export function stepNoteLengths(song: Song, trackId: number, ids: Set<number>, step: number, dir: 1 | -1): Song {
  return mapTrack(song, trackId, (t) => ({
    ...t,
    notes: t.notes.map((n) => (ids.has(n.id) ? { ...n, length: stepLength(n.length, step, dir) } : n)),
  }));
}

/**
 * クオンタイズ: 選んだ音符の開始位置を、それぞれ最も近いグリッドに合わせる（長さは変えない）。
 * 明示的な編集としてだけ使う。吸着の設定変更などで自動的には行わない（SNAP-02）。
 */
export function quantizeNotes(song: Song, trackId: number, ids: Set<number>, grid: number): { song: Song; changed: number } {
  let changed = 0;
  const s = mapTrack(song, trackId, (t) => ({
    ...t,
    notes: sortNotes(
      t.notes.map((n) => {
        if (!ids.has(n.id)) return n;
        const start = Math.max(0, Math.round(n.start / grid) * grid);
        if (start === n.start) return n;
        changed++;
        return { ...n, start };
      }),
    ),
  }));
  return { song: changed ? s : song, changed };
}

export function setNoteLength(song: Song, trackId: number, id: number, length: number): Song {
  return mapTrack(song, trackId, (t) => ({
    ...t,
    notes: t.notes.map((n) => (n.id === id ? { ...n, length: Math.max(MIN_NOTE_LENGTH, Math.round(length)) } : n)),
  }));
}

export function setVelocity(song: Song, ids: Set<number>, velocity: number): Song {
  const v = clampInt(velocity, 1, 127);
  return {
    ...song,
    tracks: song.tracks.map((t) =>
      t.notes.some((n) => ids.has(n.id))
        ? { ...t, notes: t.notes.map((n) => (ids.has(n.id) ? { ...n, velocity: v } : n)) }
        : t,
    ),
  };
}

/** 強さに同じ差を加える（複数選択でのドラッグ） */
export function shiftVelocity(song: Song, ids: Set<number>, delta: number): Song {
  if (delta === 0) return song;
  return {
    ...song,
    tracks: song.tracks.map((t) =>
      t.notes.some((n) => ids.has(n.id))
        ? {
            ...t,
            notes: t.notes.map((n) => (ids.has(n.id) ? { ...n, velocity: clampInt(n.velocity + delta, 1, 127) } : n)),
          }
        : t,
    ),
  };
}

// ---- 範囲・コピー ----

/** 範囲に含まれる音符: 開始位置が範囲の開始以上、終了未満 */
export function notesInRange(track: Track, range: TimeRange): Note[] {
  return track.notes.filter((n) => n.start >= range.start && n.start < range.end);
}

/** 範囲より前から始まり、範囲の中まで鳴っている音符（含まれない音符） */
export function notesEnteringRange(track: Track, range: TimeRange): Note[] {
  return track.notes.filter((n) => n.start < range.start && n.start + n.length > range.start);
}

export interface ClipboardData {
  /** 元のトラックごとの音符（開始位置は base からの相対位置） */
  items: { trackId: number; notes: NoteDraft[] }[];
  /** 複製の間隔 */
  span: number;
}

export function clipboardFromRange(song: Song, trackIds: number[], range: TimeRange): ClipboardData {
  return {
    items: trackIds.map((id) => {
      const t = findTrack(song, id);
      const notes = t ? notesInRange(t, range) : [];
      return { trackId: id, notes: notes.map((n) => ({ ...strip(n), start: n.start - range.start })) };
    }),
    span: range.end - range.start,
  };
}

export function clipboardFromNotes(song: Song, ids: Set<number>): ClipboardData | null {
  const all: { trackId: number; note: Note }[] = [];
  for (const t of song.tracks) for (const n of t.notes) if (ids.has(n.id)) all.push({ trackId: t.id, note: n });
  if (all.length === 0) return null;
  const base = Math.min(...all.map((a) => a.note.start));
  const end = Math.max(...all.map((a) => a.note.start + a.note.length));
  const byTrack = new Map<number, NoteDraft[]>();
  for (const a of all) {
    const list = byTrack.get(a.trackId) ?? [];
    list.push({ ...strip(a.note), start: a.note.start - base });
    byTrack.set(a.trackId, list);
  }
  return { items: [...byTrack].map(([trackId, notes]) => ({ trackId, notes })), span: end - base };
}

function strip(n: Note): NoteDraft {
  return { pitch: n.pitch, start: n.start, length: n.length, velocity: n.velocity };
}

/**
 * 貼り付け。既存の音符は消さずに追加する。
 * 複数トラックのデータは同じトラックへ、1トラック分のデータは targetTrackId へ追加する。
 */
export function paste(
  song: Song,
  clip: ClipboardData,
  at: number,
  targetTrackId: number,
): { song: Song; ids: number[]; added: { trackId: number; notes: NoteDraft[] }[] } {
  const single = clip.items.length === 1;
  let s = song;
  const ids: number[] = [];
  const added: { trackId: number; notes: NoteDraft[] }[] = [];
  for (const item of clip.items) {
    const trackId = single ? targetTrackId : item.trackId;
    if (!findTrack(s, trackId) || item.notes.length === 0) continue;
    const drafts = item.notes.map((n) => ({ ...n, start: n.start + at }));
    const r = addNotes(s, trackId, drafts);
    s = r.song;
    ids.push(...r.ids);
    added.push({ trackId, notes: drafts });
  }
  return { song: s, ids, added };
}

/** 範囲の直後へ、範囲の長さの間隔で複製する。範囲は複製先へ移る。 */
export function duplicateRange(
  song: Song,
  trackIds: number[],
  range: TimeRange,
): { song: Song; ids: number[]; newRange: TimeRange } {
  const clip = clipboardFromRange(song, trackIds, range);
  let s = song;
  const ids: number[] = [];
  const len = range.end - range.start;
  for (const item of clip.items) {
    if (item.notes.length === 0) continue;
    const r = addNotes(
      s,
      item.trackId,
      item.notes.map((n) => ({ ...n, start: n.start + range.end })),
    );
    s = r.song;
    ids.push(...r.ids);
    // 範囲に収まるコードブロックも複製する（複製したブロックは独立）
    const orig = findTrack(song, item.trackId)!;
    const srcIds = notesInRange(orig, range).map((n) => n.id);
    const idMap = new Map(srcIds.map((id, i) => [id, r.ids[i]]));
    const copies = copyBlocksForDuplicate(orig, range, len, idMap);
    if (copies.length) s = mapTrack(s, item.trackId, (t) => ({ ...t, blocks: [...(t.blocks ?? []), ...copies].sort((a, b) => a.start - b.start) }));
  }
  return { song: s, ids, newRange: { start: range.end, end: range.end + len } };
}

/** 追加予定の音符のうち、同じトラックの同じ音高の既存音符と時間が重なるものの数 */
export function countSamePitchOverlaps(existing: Note[], added: NoteDraft[]): number {
  let count = 0;
  for (const a of added) {
    const aEnd = a.start + a.length;
    if (existing.some((e) => e.pitch === a.pitch && e.start < aEnd && a.start < e.start + e.length)) count++;
  }
  return count;
}

// ---- トラック ----

export const DEFAULT_PROGRAMS: Record<TrackKind, number> = { melodic: 0, drum: 0 };

export function canAddTrack(song: Song, kind: TrackKind): boolean {
  const n = song.tracks.filter((t) => t.kind === kind).length;
  return kind === "drum" ? n < MAX_DRUM_TRACKS : n < MAX_MELODIC_TRACKS;
}

export function addTrack(song: Song, kind: TrackKind, name?: string, program = 0): { song: Song; trackId: number } {
  if (!canAddTrack(song, kind)) return { song, trackId: -1 };
  const id = newId();
  const n = song.tracks.length + 1;
  const track: Track = {
    id,
    name: name ?? (kind === "drum" ? "ドラム" : `トラック${n}`),
    kind,
    program: kind === "drum" ? 0 : program,
    volume: 100,
    notes: [],
  };
  return { song: { ...song, tracks: [...song.tracks, track] }, trackId: id };
}

export function deleteTrack(song: Song, trackId: number): Song {
  return { ...song, tracks: song.tracks.filter((t) => t.id !== trackId) };
}

export function renameTrack(song: Song, trackId: number, name: string): Song {
  return mapTrack(song, trackId, (t) => ({ ...t, name }));
}

export function moveTrack(song: Song, from: number, to: number): Song {
  if (from === to || from < 0 || to < 0 || from >= song.tracks.length || to >= song.tracks.length) return song;
  const tracks = song.tracks.slice();
  const [t] = tracks.splice(from, 1);
  tracks.splice(to, 0, t);
  return { ...song, tracks };
}

export function setProgram(song: Song, trackId: number, program: number): Song {
  return mapTrack(song, trackId, (t) => ({ ...t, program: clampInt(program, 0, 127) }));
}

export function setTrackVolume(song: Song, trackId: number, volume: number): Song {
  return mapTrack(song, trackId, (t) => ({ ...t, volume: clampInt(volume, 0, 127) }));
}

/** テンポは再生速度だけを変える。音符の tick は変えない（INV-01）。 */
export function setTempo(song: Song, tempo: number): Song {
  return { ...song, tempo: Math.min(300, Math.max(20, Math.round(tempo))) };
}

// ---- 拍子の変更（04_DESIGN.md §3.12） ----

export type OverflowMode = "lastBeat" | "nextBar";

export interface TimeSigChangeResult {
  song: Song;
  /** 新しい小節に入らなかった音符の数（トラックID→数） */
  overflowByTrack: Map<number, number>;
  overflowIds: number[];
}

function mapStartForTs(t: number, L1: number, L2: number, B: number, mode: OverflowMode): { tick: number; overflow: boolean } {
  const b = Math.floor(t / L1);
  const o = t - b * L1;
  if (o < L2) return { tick: b * L2 + o, overflow: false };
  if (mode === "nextBar") return { tick: (b + 1) * L2 + (o - L2), overflow: true };
  // 同じ小節の最後の拍: 拍の長さ B ずつ前へずらし、小節に入る最初の位置にする（拍の中の位置は保つ）
  const n = Math.ceil((o - L2 + 1) / B);
  return { tick: b * L2 + (o - n * B), overflow: true };
}

/** 拍子を変え、全音符を小節・拍の位置を保って並べ直す。長さ・音高・強さは変えない。 */
export function changeTimeSignature(song: Song, ts: TimeSignature, mode: OverflowMode): TimeSigChangeResult {
  const L1 = barLength(song.timeSig);
  const L2 = barLength(ts);
  const B = beatLength(ts);
  const overflowByTrack = new Map<number, number>();
  const overflowIds: number[] = [];
  const tracks = song.tracks.map((t) => {
    let count = 0;
    const notes = t.notes.map((n) => {
      const m = mapStartForTs(n.start, L1, L2, B, mode);
      if (m.overflow) {
        count++;
        overflowIds.push(n.id);
      }
      return m.tick === n.start ? n : { ...n, start: m.tick };
    });
    if (count > 0) overflowByTrack.set(t.id, count);
    return mapBlocks({ ...t, notes: sortNotes(notes) }, (tick) => mapStartForTs(tick, L1, L2, B, mode).tick);
  });
  return { song: { ...song, timeSig: { ...ts }, tracks }, overflowByTrack, overflowIds };
}

/** 範囲の端を新しい拍子へ変換する。小節に入らない位置はその小節の終わりに合わせる。 */
export function convertBoundaryForTs(tick: number, from: TimeSignature, to: TimeSignature): number {
  const L1 = barLength(from);
  const L2 = barLength(to);
  const b = Math.floor(tick / L1);
  const o = tick - b * L1;
  return o < L2 ? b * L2 + o : (b + 1) * L2;
}

// ---- 曲の長さ ----

/** 最後の音符の終わりを小節の終わりに切り上げた位置。音符がなければ 0。 */
export function songEnd(song: Song): number {
  let end = 0;
  for (const t of song.tracks) for (const n of t.notes) end = Math.max(end, n.start + n.length);
  const bl = barLength(song.timeSig);
  return Math.ceil(end / bl) * bl;
}

export function allNoteIds(song: Song): number[] {
  return song.tracks.flatMap((t) => t.notes.map((n) => n.id));
}
