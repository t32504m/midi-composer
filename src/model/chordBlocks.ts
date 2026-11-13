// コードブロックの操作。04_DESIGN.md §3.13。
// ブロックは「音符のまとまり＋コード名と作り方」。音符は通常の音符として Track.notes にある。
// 音符を作り直すのは、ユーザーがそのブロックに対して明示的に操作したときだけ。
// 曲全体の設定（スケール・補助パネル）の変更では、ブロックも音符も変わらない。
import { BlockParams, ChordBlock, MIN_NOTE_LENGTH, Note, Song, Track, clampInt, newId } from "./types";
import { renderPattern, voiceChord } from "../theory/theory";

export const MIN_BLOCK_LENGTH = 240;

export function blocksOf(t: Track): ChordBlock[] {
  return t.blocks ?? [];
}

export function blockEnd(b: ChordBlock): number {
  return b.start + b.length;
}

export function blockParams(b: ChordBlock): BlockParams {
  const { root, type, octave, inversion, pattern, step, velocity } = b;
  return { root, type, octave, inversion, pattern, step, velocity };
}

/** ブロックの作り方から音符の下書きを作る */
export function generateDrafts(p: BlockParams, start: number, length: number) {
  return renderPattern(voiceChord({ root: p.root, type: p.type }, p.octave, p.inversion), start, length, p.pattern, p.step, p.velocity);
}

function makeBlock(p: BlockParams, start: number, length: number): { block: ChordBlock; notes: Note[] } {
  const notes: Note[] = generateDrafts(p, start, length).map((d) => ({
    id: newId(),
    pitch: clampInt(d.pitch, 0, 127),
    start: Math.max(0, Math.round(d.start)),
    length: Math.max(MIN_NOTE_LENGTH, Math.round(d.length)),
    velocity: clampInt(d.velocity, 1, 127),
  }));
  const block: ChordBlock = {
    id: newId(),
    ...p,
    start,
    length,
    noteIds: notes.map((n) => n.id),
    generated: notes.map((n) => ({ ...n })),
  };
  return { block, notes };
}

function sortNotes(notes: Note[]): Note[] {
  return notes.slice().sort((a, b) => a.start - b.start || a.pitch - b.pitch || a.id - b.id);
}

function withTrack(song: Song, trackId: number, fn: (t: Track) => Track): Song {
  return { ...song, tracks: song.tracks.map((t) => (t.id === trackId ? fn(t) : t)) };
}

function sortBlocks(blocks: ChordBlock[]): ChordBlock[] {
  return blocks.slice().sort((a, b) => a.start - b.start);
}

/** 作ったときから音符が変わっていれば true（手直しあり） */
export function isEdited(t: Track, b: ChordBlock): boolean {
  const byId = new Map(t.notes.map((n) => [n.id, n]));
  for (const g of b.generated) {
    const n = byId.get(g.id);
    if (!n || n.pitch !== g.pitch || n.start !== g.start || n.length !== g.length || n.velocity !== g.velocity) return true;
  }
  return false;
}

/** [start, end) を空けるときに作り直し・削除の対象になるブロック */
export function blocksOverlapping(t: Track, start: number, end: number, exceptId?: number): ChordBlock[] {
  return blocksOf(t).filter((b) => b.id !== exceptId && b.start < end && blockEnd(b) > start);
}

/**
 * [start, end) と重なるブロックを空ける。範囲に完全に入るブロックは音符ごと消し、
 * はみ出すブロックは残る部分だけに作り直す（同じコード・弾き方）。ブロックでない音符は変えない。
 */
function clearRange(t: Track, start: number, end: number, exceptId?: number): Track {
  let notes = t.notes;
  const blocks: ChordBlock[] = [];
  for (const b of blocksOf(t)) {
    if (b.id === exceptId || b.start >= end || blockEnd(b) <= start) {
      blocks.push(b);
      continue;
    }
    const remove = new Set(b.noteIds);
    notes = notes.filter((n) => !remove.has(n.id));
    const parts: [number, number][] = [];
    if (b.start < start) parts.push([b.start, start]);
    if (blockEnd(b) > end) parts.push([end, blockEnd(b)]);
    for (const [s0, s1] of parts) {
      if (s1 - s0 < MIN_NOTE_LENGTH) continue;
      const r = makeBlock(blockParams(b), s0, s1 - s0);
      notes = [...notes, ...r.notes];
      blocks.push(r.block);
    }
  }
  return { ...t, notes: sortNotes(notes), blocks: sortBlocks(blocks) };
}

/** ブロックを置く。重なる既存のブロックは、その部分だけ置き換える。 */
export function placeBlock(
  song: Song,
  trackId: number,
  p: BlockParams,
  start: number,
  length: number,
): { song: Song; blockId: number } {
  const len = Math.max(MIN_BLOCK_LENGTH, Math.round(length));
  const st = Math.max(0, Math.round(start));
  let blockId = -1;
  const s = withTrack(song, trackId, (t) => {
    const cleared = clearRange(t, st, st + len);
    const r = makeBlock(p, st, len);
    blockId = r.block.id;
    return { ...cleared, notes: sortNotes([...cleared.notes, ...r.notes]), blocks: sortBlocks([...blocksOf(cleared), r.block]) };
  });
  return { song: s, blockId };
}

/** 複数のブロックをまとめて置く（進行の挿入など） */
export function placeBlocks(
  song: Song,
  trackId: number,
  items: { params: BlockParams; start: number; length: number }[],
): { song: Song; blockIds: number[]; noteIds: number[] } {
  let s = song;
  const blockIds: number[] = [];
  for (const it of items) {
    const r = placeBlock(s, trackId, it.params, it.start, it.length);
    s = r.song;
    blockIds.push(r.blockId);
  }
  const t = s.tracks.find((x) => x.id === trackId);
  const noteIds = blocksOf(t!).filter((b) => blockIds.includes(b.id)).flatMap((b) => b.noteIds);
  return { song: s, blockIds, noteIds };
}

/** ブロックの作り方・位置・長さを変えて作り直す（手直しは消える） */
export function regenerateBlock(
  song: Song,
  trackId: number,
  blockId: number,
  patch: Partial<BlockParams> & { start?: number; length?: number },
): { song: Song; blockId: number } {
  const t = song.tracks.find((x) => x.id === trackId);
  const b = t && blocksOf(t).find((x) => x.id === blockId);
  if (!t || !b) return { song, blockId };
  const removed = deleteBlock(song, trackId, blockId);
  const { start = b.start, length = b.length, ...params } = patch;
  return placeBlock(removed, trackId, { ...blockParams(b), ...params }, start, length);
}

/** ブロックを時間方向に動かす。音符は作り直さずに動かすので、手直しも保たれる。動かした先の他のブロックは置き換わる。 */
export function moveBlock(song: Song, trackId: number, blockId: number, dTick: number): Song {
  return withTrack(song, trackId, (t) => {
    const b = blocksOf(t).find((x) => x.id === blockId);
    if (!b || dTick === 0) return t;
    const d = Math.max(-b.start, dTick);
    const cleared = clearRange(t, b.start + d, blockEnd(b) + d, b.id);
    const ids = new Set(b.noteIds);
    const notes = cleared.notes.map((n) => (ids.has(n.id) ? { ...n, start: n.start + d } : n));
    const moved: ChordBlock = { ...b, start: b.start + d, generated: b.generated.map((g) => ({ ...g, start: g.start + d })) };
    return { ...cleared, notes: sortNotes(notes), blocks: sortBlocks(blocksOf(cleared).map((x) => (x.id === b.id ? moved : x))) };
  });
}

/** ブロックと、その音符を消す */
export function deleteBlock(song: Song, trackId: number, blockId: number): Song {
  return withTrack(song, trackId, (t) => {
    const b = blocksOf(t).find((x) => x.id === blockId);
    if (!b) return t;
    const ids = new Set(b.noteIds);
    return { ...t, notes: t.notes.filter((n) => !ids.has(n.id)), blocks: blocksOf(t).filter((x) => x.id !== blockId) };
  });
}

/** ブロックを解除する（コード名を外し、音符はふつうの音符として残す） */
export function dissolveBlock(song: Song, trackId: number, blockId: number): Song {
  return withTrack(song, trackId, (t) => ({ ...t, blocks: blocksOf(t).filter((x) => x.id !== blockId) }));
}

/** 音符が消えたブロックを整理する（音符が1つも残っていないブロックは消す） */
export function pruneBlocks(t: Track): Track {
  if (!t.blocks || t.blocks.length === 0) return t;
  const ids = new Set(t.notes.map((n) => n.id));
  const blocks = t.blocks
    .map((b) => (b.noteIds.every((id) => ids.has(id)) ? b : { ...b, noteIds: b.noteIds.filter((id) => ids.has(id)) }))
    .filter((b) => b.noteIds.length > 0);
  return blocks.length === t.blocks.length && blocks.every((b, i) => b === t.blocks![i]) ? t : { ...t, blocks };
}

/**
 * 音符を動かしたときのブロックの扱い。ブロックの音符がすべて一緒に動いたら、ブロックの位置も動かす。
 * 音の高さが変わった場合は「手直しあり」になる（コード名と音が合わなくなるため）。
 */
export function followMovedNotes(t: Track, ids: Set<number>, dTick: number): Track {
  if (!t.blocks || t.blocks.length === 0 || dTick === 0) return t;
  const exists = new Set(t.notes.map((n) => n.id));
  return {
    ...t,
    blocks: sortBlocks(
      t.blocks.map((b) => {
        const live = b.noteIds.filter((id) => exists.has(id));
        if (live.length === 0 || !live.every((id) => ids.has(id))) return b;
        return { ...b, start: b.start + dTick, generated: b.generated.map((g) => ({ ...g, start: g.start + dTick })) };
      }),
    ),
  };
}

/** 位置の変換関数で、ブロックの位置と記録を変換する（拍子の変更用） */
export function mapBlocks(t: Track, mapStart: (tick: number) => number): Track {
  if (!t.blocks || t.blocks.length === 0) return t;
  return {
    ...t,
    blocks: sortBlocks(
      t.blocks.map((b) => ({ ...b, start: mapStart(b.start), generated: b.generated.map((g) => ({ ...g, start: mapStart(g.start) })) })),
    ),
  };
}

/** 範囲の複製で、範囲に収まるブロックも複製する。idMap は元の音符ID→複製した音符ID */
export function copyBlocksForDuplicate(t: Track, range: { start: number; end: number }, offset: number, idMap: Map<number, number>): ChordBlock[] {
  return blocksOf(t)
    .filter((b) => b.start >= range.start && blockEnd(b) <= range.end)
    .map((b) => ({
      ...b,
      id: newId(),
      start: b.start + offset,
      noteIds: b.noteIds.map((id) => idMap.get(id)).filter((x): x is number => x !== undefined),
      generated: b.generated.filter((g) => idMap.has(g.id)).map((g) => ({ ...g, id: idMap.get(g.id)!, start: g.start + offset })),
    }))
    .filter((b) => b.noteIds.length > 0);
}

/** 「高く」「低く」: 転回形を1つずつ上下させ、端まで行ったらオクターブを変える */
export function raiseVoicing(p: BlockParams, dir: 1 | -1, maxInv: number): Pick<BlockParams, "octave" | "inversion"> {
  let { octave, inversion } = p;
  inversion += dir;
  if (inversion > maxInv) {
    inversion = 0;
    octave += 1;
  } else if (inversion < 0) {
    inversion = maxInv;
    octave -= 1;
  }
  return { octave: Math.max(0, Math.min(7, octave)), inversion };
}

/**
 * 空いている部分に合わせる: tick を含む空き（前後のブロックの間）に置く範囲を返す。
 * 始まりはドロップした拍（その拍が空きの途中なら、空きの始まり）。終わりは次のブロックか小節の終わり。
 * 小節の1拍目にドロップすれば、空いている小節全体に入る。tick がブロックの上なら null。
 */
export function fitGap(t: Track, tick: number, barLen: number, beatLen: number = barLen): { start: number; length: number } | null {
  const blocks = blocksOf(t);
  if (blocks.some((b) => tick >= b.start && tick < blockEnd(b))) return null;
  const barStart = Math.floor(tick / barLen) * barLen;
  const beatStart = Math.floor(tick / beatLen) * beatLen;
  const prevEnd = Math.max(0, ...blocks.filter((b) => blockEnd(b) <= tick).map(blockEnd));
  const nextStart = Math.min(Infinity, ...blocks.filter((b) => b.start > tick).map((b) => b.start));
  const start = Math.max(prevEnd, barStart, beatStart);
  const end = Math.min(nextStart, barStart + barLen);
  return end - start >= MIN_BLOCK_LENGTH ? { start, length: end - start } : null;
}

/**
 * ブロックの途中に置く範囲: ドロップした拍からそのブロックの終わりまで。前の部分は元のコードのまま短くなる。
 * ブロックの最初の拍にドロップした場合（または残りが短すぎる場合）は null（ブロック全体のコードを置き換える）。
 */
export function splitSlot(b: ChordBlock, tick: number, beatLen: number): { start: number; length: number } | null {
  const at = Math.floor(tick / beatLen) * beatLen;
  if (at <= b.start || blockEnd(b) - at < MIN_BLOCK_LENGTH) return null;
  return { start: at, length: blockEnd(b) - at };
}
