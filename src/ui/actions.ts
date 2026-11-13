// 画面からの操作。曲データを変える操作は commit() を通し、取り消し履歴に1回分として記録する。
import { BlockParams, MixerState, Song, TimeSignature, TrackKind } from "../model/types";
import {
  NoteDraft,
  addTrack,
  canAddTrack,
  changeTimeSignature,
  clampPitchDelta,
  clipboardFromNotes,
  clipboardFromRange,
  convertBoundaryForTs,
  countSamePitchOverlaps,
  deleteNotes,
  deleteTrack,
  duplicateRange,
  findTrack,
  moveNotes,
  notesInRange,
  paste,
  quantizeNotes,
  stepNoteLengths,
  songEnd,
} from "../model/edit";
import { pushHistory, redo, undo } from "../model/history";
import { Grid, SNAP_OPTIONS, effectiveGrid, snapTicks } from "../model/snap";
import { barLength, beatLength, noteValueTicks } from "../model/time";
import { ChordType, PROGRESSIONS, chordName, maxInversion, progressionChords, stepInScale, voiceChord } from "../theory/theory";
import {
  blockEnd,
  blocksOf,
  blocksOverlapping,
  deleteBlock,
  dissolveBlock,
  fitGap,
  splitSlot,
  generateDrafts,
  isEdited,
  moveBlock,
  placeBlock,
  placeBlocks,
  regenerateBlock,
} from "../model/chordBlocks";
import { engine } from "../audio/engine";
import { Player } from "../audio/player";
import { assignChannels } from "../model/instruments";
import { AppState, emitPlayhead, getState, setState, toast } from "./store";

// ---- 基本 ----

export function activeTrack(s: AppState = getState()) {
  return findTrack(s.song, s.activeTrackId);
}

/** 吸着の設定どおりの間隔。Alt を押している間は null（吸着しない） */
export function snapGrid(alt = false, s: AppState = getState()): Grid {
  if (alt || !s.settings.snapEnabled) return null;
  return snapTicks(s.settings.snapKey, s.song.timeSig);
}

/** 入力する音符の基本の長さ（付点は除く。三連は含む）。吸着をこれより細かくするかの判定に使う */
export function inputUnit(s: AppState = getState()): number {
  return noteValueTicks(s.settings.inputBase, s.settings.inputMod === "triplet" ? "triplet" : "none");
}

/**
 * ピアノロールで音符を置く・動かす・伸ばすときの吸着の間隔。
 * 入力する音符が吸着の間隔より短いとき（例: 吸着は十六分、入力は三十二分）は、入力する音符の長さごとに細かくする。
 */
export function currentGrid(alt = false, s: AppState = getState()): Grid {
  return effectiveGrid(snapGrid(alt, s), inputUnit(s));
}

export function inputLength(s: AppState = getState()): number {
  return noteValueTicks(s.settings.inputBase, s.settings.inputMod);
}

/** 曲データを変更し、変更前の曲を取り消し履歴に記録する */
export function commit(song: Song, extra: Partial<AppState> = {}) {
  const s = getState();
  if (song === s.song) {
    if (Object.keys(extra).length) setState(extra);
    return;
  }
  setState({ song, history: pushHistory(s.history, s.song), ...extra });
}

function validSelection(song: Song, sel: Set<number>, trackId: number): Set<number> {
  const t = findTrack(song, trackId);
  if (!t) return new Set();
  const ids = new Set(t.notes.map((n) => n.id));
  return new Set([...sel].filter((id) => ids.has(id)));
}

export function undoAction() {
  const s = getState();
  const r = undo(s.history, s.song);
  if (!r) return toast("取り消せる操作はありません");
  if (s.playing === "audition") stopPlayback();
  const active = findTrack(r.song, s.activeTrackId) ? s.activeTrackId : (r.song.tracks[0]?.id ?? -1);
  setState({
    song: r.song,
    history: r.history,
    activeTrackId: active,
    selection: validSelection(r.song, s.selection, active),
    selectedBlockId: r.song.tracks.some((t) => blocksOf(t).some((b) => b.id === s.selectedBlockId)) ? s.selectedBlockId : null,
  });
}

export function redoAction() {
  const s = getState();
  const r = redo(s.history, s.song);
  if (!r) return toast("やり直せる操作はありません");
  const active = findTrack(r.song, s.activeTrackId) ? s.activeTrackId : (r.song.tracks[0]?.id ?? -1);
  setState({
    song: r.song,
    history: r.history,
    activeTrackId: active,
    selection: validSelection(r.song, s.selection, active),
    selectedBlockId: r.song.tracks.some((t) => blocksOf(t).some((b) => b.id === s.selectedBlockId)) ? s.selectedBlockId : null,
  });
}

export function updateSettings(patch: Partial<AppState["settings"]>) {
  setState((s) => ({ settings: { ...s.settings, ...patch }, settingsDirty: true }));
  // 再生中にループを変えたら、今の位置から新しいループで再生し直す
  if (("loop" in patch || "loopEnabled" in patch) && getState().playing === "song") {
    startSong(playbackPosition(), getState().playStartTick);
  }
}

/** 上部の「⟲ループ」。範囲を選んでいればその範囲を、なければ前回のループ範囲を繰り返す */
export function setLoopEnabled(on: boolean) {
  const s = getState();
  if (!on) return updateSettings({ loopEnabled: false });
  const loop = s.range ? { start: s.range.start, end: s.range.end } : s.settings.loop;
  if (!loop) return toast("全体表示で範囲を選んでから「⟲ループ」を押してください");
  updateSettings({ loop, loopEnabled: true });
}

export function setMixer(trackId: number, patch: Partial<{ mute: boolean; solo: boolean }>) {
  setState((s) => {
    const cur = s.mixer[trackId] ?? { mute: false, solo: false };
    const mixer: MixerState = { ...s.mixer, [trackId]: { ...cur, ...patch } };
    return { mixer, settingsDirty: true };
  });
}

// ---- 再生 ----

const player = new Player({
  getSong: () => getState().song,
  getMixer: () => getState().mixer,
  getMetronome: () => getState().metronome,
});
player.onEnded = () => {
  const s = getState();
  if (s.playing === "song") setState({ playing: "none", playhead: s.playStartTick });
  else setState({ playing: "none" });
  emitPlayhead(getState().playhead);
};

let raf = 0;
function animate() {
  if (!player.playing) {
    raf = 0;
    return;
  }
  const tick = player.positionTick();
  emitPlayhead(tick);
  const s = getState();
  if (s.playing === "song") followPlayhead(tick);
  raf = requestAnimationFrame(animate);
}

/** 再生位置が画面の外に出たら、表示をめくる */
let viewWidthTicks = 0;
export function setViewWidthTicks(w: number) {
  viewWidthTicks = w;
}
function followPlayhead(tick: number) {
  const s = getState();
  if (viewWidthTicks <= 0) return;
  if (tick < s.scrollX || tick > s.scrollX + viewWidthTicks * 0.95) {
    setState({ scrollX: Math.max(0, tick - viewWidthTicks * 0.05) });
  }
}

export async function togglePlay() {
  const s = getState();
  if (s.playing !== "none") return stopPlayback();
  if (!(await engine.ensureStarted())) return;
  startSong(getState().playhead, getState().playhead);
}

/** 曲を from から再生する。停止すると playStartTick に戻る */
function startSong(from: number, playStartTick: number) {
  const st = getState();
  let start = Math.max(0, Math.round(from));
  const loop = st.settings.loopEnabled && st.settings.loop ? st.settings.loop : null;
  if (loop && (start < loop.start || start >= loop.end)) start = loop.start;
  const end = Math.max(songEnd(st.song), start + barLength(st.song.timeSig));
  player.start({ startTick: start, endTick: end, loop });
  setState({ playing: "song", playStartTick });
  if (!raf) raf = requestAnimationFrame(animate);
}

/** 現在の再生位置（tick）。再生していなければ再生位置の指定値 */
export function playbackPosition(): number {
  return player.playing ? player.positionTick() : getState().playhead;
}

export function stopPlayback() {
  const s = getState();
  player.stop();
  if (s.playing === "song") setState({ playing: "none", playhead: s.playStartTick });
  else if (s.playing !== "none") setState({ playing: "none" });
  emitPlayhead(getState().playhead);
}

export function setPlayhead(tick: number) {
  const s = getState();
  if (s.playing !== "none") stopPlayback();
  setState({ playhead: Math.max(0, Math.round(tick)) });
  emitPlayhead(getState().playhead);
}

/** 1音・和音を短く鳴らす */
export function previewPitches(trackId: number, pitches: number[], velocity = 100, duration = 0.35) {
  const s = getState();
  void engine.ensureStarted().then((ok) => {
    if (!ok) return;
    engine.syncChannels(s.song);
    const ch = assignChannels(s.song).get(trackId);
    if (ch !== undefined) engine.preview(ch, pitches, velocity, duration);
  });
}

// ---- 作曲補助のプレビュー（挿入予定の音符） ----

export interface AssistPlan {
  trackId: number;
  notes: NoteDraft[];
  start: number;
  end: number;
  overlaps: number;
}

export function insertionStart(s: AppState = getState()): number {
  return s.range ? s.range.start : s.playhead;
}

export function chordChangeTicks(s: AppState = getState()): number {
  const bl = barLength(s.song.timeSig);
  return s.assist.changeEvery === "halfBar" ? bl / 2 : s.assist.changeEvery === "twoBars" ? bl * 2 : bl;
}

export function currentProgression(s: AppState = getState()) {
  const list = PROGRESSIONS.filter((p) => p.mode === s.settings.key.mode);
  return list.find((p) => p.id === s.assist.progressionId) ?? list[0];
}

/** 補助パネルの設定から、挿入予定のコードブロックを作る。曲データは変えない。 */
export function assistBlockItems(s: AppState = getState()): { params: BlockParams; start: number; length: number }[] {
  const a = s.assist;
  const start = insertionStart(s);
  if (a.tab === "chord") {
    const len = s.range ? s.range.end - s.range.start : inputLength(s);
    return [{ params: { ...paramsFromAssist(s, { root: a.chordRoot, type: a.chordType }), pattern: "sustain" }, start, length: len }];
  }
  const chords = progressionChords(currentProgression(s), s.settings.key);
  const every = chordChangeTicks(s);
  return chords.map((c, i) => ({ params: paramsFromAssist(s, c), start: start + i * every, length: every }));
}

/** 補助パネルの弾き方・音域などから、ブロックの作り方を作る */
export function paramsFromAssist(s: AppState, chord: { root: number; type: ChordType }): BlockParams {
  const a = s.assist;
  return {
    root: chord.root,
    type: chord.type,
    octave: a.octave,
    inversion: Math.min(a.inversion, maxInversion(chord.type)),
    pattern: a.pattern,
    step: a.step,
    velocity: a.velocity,
  };
}

/** 補助パネルの設定から、挿入予定の音符を作る。曲データは変えない。 */
export function assistPlan(s: AppState = getState()): AssistPlan | null {
  if (!s.assist.open || s.assist.tab === "scale") return null;
  const track = activeTrack(s);
  if (!track || track.kind === "drum") return null;
  const items = assistBlockItems(s);
  const notes: NoteDraft[] = items.flatMap((it) => generateDrafts(it.params, it.start, it.length));
  const start = items[0]?.start ?? insertionStart(s);
  const last = items[items.length - 1];
  const end = last ? last.start + last.length : start;
  return { trackId: track.id, notes, start, end, overlaps: countSamePitchOverlaps(track.notes, notes) };
}

export function setAssist(patch: Partial<AppState["assist"]>) {
  if (getState().playing === "audition") stopPlayback();
  setState((s) => ({ assist: { ...s.assist, ...patch } }));
}

export async function auditionPlan() {
  const s = getState();
  if (s.playing !== "none") stopPlayback();
  const plan = assistPlan(getState());
  if (!plan) return;
  if (!(await engine.ensureStarted())) return;
  const st = getState();
  player.start({
    startTick: plan.start,
    endTick: plan.end,
    loop: null,
    extra: [{ trackId: plan.trackId, notes: plan.notes }],
    onlyTrackIds: st.assist.includeOthers ? undefined : new Set<number>(),
  });
  setState({ playing: "audition" });
  if (!raf) raf = requestAnimationFrame(animate);
}

/** 補助パネルの「挿入」。コードごとにコードブロックとして置く（音符は通常の音符） */
export function insertPlan() {
  const plan = assistPlan();
  if (!plan || plan.notes.length === 0) return;
  if (getState().playing === "audition") stopPlayback();
  const items = assistBlockItems();
  confirmIfEdited(
    plan.trackId,
    items.map((it): [number, number] => [it.start, it.start + it.length]),
    undefined,
    () => {
      const r = placeBlocks(getState().song, plan.trackId, items);
      commit(r.song, { selection: new Set(r.noteIds), selectedBlockId: null });
      toast(`${r.noteIds.length}音（${items.length}コード）を挿入しました（取り消し: Ctrl+Z）`);
    },
  );
}

// ---- コードブロック（04_DESIGN.md §3.13） ----

export function findBlock(s: AppState, blockId: number | null) {
  if (blockId === null) return null;
  for (const t of s.song.tracks) {
    const b = blocksOf(t).find((x) => x.id === blockId);
    if (b) return { track: t, block: b };
  }
  return null;
}

/**
 * 作り直し・削除の対象に、ピアノロールで手直ししたブロックがあれば、確認してから実行する。
 * ranges は空ける範囲、selfId は作り直す（または動かす）本人。
 */
function confirmIfEdited(
  trackId: number,
  ranges: [number, number][],
  selfId: number | undefined,
  apply: () => void,
  selfRegenerates = false,
) {
  const t = findTrack(getState().song, trackId);
  if (!t) return;
  const edited = new Set<number>();
  for (const [a, b] of ranges) for (const blk of blocksOverlapping(t, a, b, selfId)) if (isEdited(t, blk)) edited.add(blk.id);
  if (selfRegenerates && selfId !== undefined) {
    const me = blocksOf(t).find((x) => x.id === selfId);
    if (me && isEdited(t, me)) edited.add(me.id);
  }
  if (edited.size === 0) return apply();
  const names = blocksOf(t)
    .filter((b) => edited.has(b.id))
    .map((b) => chordName(b))
    .join("、");
  setState({
    dialog: {
      kind: "confirm",
      title: "手直しした音符があるブロックを作り直します",
      lines: [
        `次のブロックの音符を、ピアノロールで手直ししています: ${names}`,
        "作り直すと、そのブロックの手直しは消えます（取り消し Ctrl+Z で戻せます）。",
        "手直しを残したいときは、先にそのブロックを「解除」して、ふつうの音符にしてください。",
      ],
      okLabel: "作り直す",
      onOk: () => {
        setState({ dialog: null });
        apply();
      },
    },
  });
}

/** 置く長さの単位（tick） */
export function placeUnit(s: AppState = getState()): number {
  const bl = barLength(s.song.timeSig);
  return s.blockPlaceLength === "half" ? bl / 2 : s.blockPlaceLength === "twoBars" ? bl * 2 : bl;
}

/** 置く位置と長さ。「ブロックに合わせる」でブロックの上なら、そのブロックを返す */
export function dropTarget(
  s: AppState,
  trackId: number,
  tick: number,
): { start: number; length: number; replaceId: number | null; splitId?: number } {
  const t = findTrack(s.song, trackId);
  const under = t ? blocksOf(t).find((b) => tick >= b.start && tick < blockEnd(b)) : undefined;
  const beat = beatLength(s.song.timeSig);
  if (s.blockPlaceLength === "fit" && under) {
    // ブロックの途中の拍なら、そこから後ろだけに置く（前は元のコードのまま）。最初の拍ならブロック全体を置き換え
    const split = splitSlot(under, tick, beat);
    if (split) return { ...split, replaceId: null, splitId: under.id };
    return { start: under.start, length: under.length, replaceId: under.id };
  }
  if (s.blockPlaceLength === "fit" && t) {
    // 空いている部分に合わせる（ドロップした拍から、次のブロックか小節の終わりまで）
    const gap = fitGap(t, tick, barLength(s.song.timeSig), beat);
    if (gap) return { ...gap, replaceId: null };
  }
  const unit = placeUnit(s);
  return { start: Math.max(0, Math.floor(tick / unit) * unit), length: unit, replaceId: null };
}

/** コードを帯に置く（ドロップ・クリック）。「ブロックに合わせる」でブロックの上に置くと、そのブロックのコードだけを変える */
export function dropChord(trackId: number, chord: { root: number; type: ChordType }, tick: number) {
  const s = getState();
  const t = findTrack(s.song, trackId);
  if (!t || t.kind === "drum") return;
  if (s.playing === "audition") stopPlayback();
  const target = dropTarget(s, trackId, tick);
  if (target.replaceId !== null) {
    const under = blocksOf(t).find((b) => b.id === target.replaceId)!;
    confirmIfEdited(
      trackId,
      [],
      under.id,
      () => {
        const r = regenerateBlock(getState().song, trackId, under.id, {
          root: chord.root,
          type: chord.type,
          inversion: Math.min(under.inversion, maxInversion(chord.type)),
        });
        commit(r.song, { selectedBlockId: r.blockId, selection: new Set() });
        previewBlock(r.blockId);
      },
      true,
    );
    return;
  }
  const params = paramsFromAssist(s, chord);
  confirmIfEdited(trackId, [[target.start, target.start + target.length]], undefined, () => {
    const r = placeBlock(getState().song, trackId, params, target.start, target.length);
    commit(r.song, { selectedBlockId: r.blockId, selection: new Set() });
    previewBlock(r.blockId);
  });
}

/** ブロックの和音を短く鳴らす */
function previewBlock(blockId: number) {
  const f = findBlock(getState(), blockId);
  if (!f) return;
  const b = f.block;
  previewPitches(f.track.id, voiceChord({ root: b.root, type: b.type }, b.octave, b.inversion), b.velocity, 0.8);
}

/** ブロックを時間方向に動かす（音符は作り直さない） */
export function moveBlockAction(blockId: number, dTick: number) {
  const f = findBlock(getState(), blockId);
  if (!f || dTick === 0) return;
  const b = f.block;
  confirmIfEdited(f.track.id, [[b.start + dTick, blockEnd(b) + dTick]], b.id, () => {
    commit(moveBlock(getState().song, f.track.id, blockId, dTick), { selectedBlockId: blockId });
  });
}

/** ブロックの作り方・位置・長さを変えて作り直す */
export function updateBlockAction(blockId: number, patch: Partial<BlockParams> & { start?: number; length?: number }) {
  const f = findBlock(getState(), blockId);
  if (!f) return;
  const b = f.block;
  const start = patch.start ?? b.start;
  const end = start + (patch.length ?? b.length);
  confirmIfEdited(
    f.track.id,
    [[start, end]],
    b.id,
    () => {
      const r = regenerateBlock(getState().song, f.track.id, blockId, patch);
      commit(r.song, { selectedBlockId: r.blockId });
      const sound = ["root", "type", "octave", "inversion"].some((k) => k in patch);
      if (sound) previewBlock(r.blockId);
    },
    true,
  );
}

export function deleteBlockAction(blockId: number) {
  const f = findBlock(getState(), blockId);
  if (!f) return;
  commit(deleteBlock(getState().song, f.track.id, blockId), { selectedBlockId: null, selection: new Set() });
  toast(`ブロック「${chordName(f.block)}」と、その音符を削除しました（取り消し: Ctrl+Z）`);
}

export function dissolveBlockAction(blockId: number) {
  const f = findBlock(getState(), blockId);
  if (!f) return;
  commit(dissolveBlock(getState().song, f.track.id, blockId), { selectedBlockId: null, selection: new Set(f.block.noteIds) });
  toast("ブロックを解除しました。音符はふつうの音符として残っています");
}

/** ブロックの範囲を、他のトラックと一緒に試聴する */
export async function auditionBlock(blockId: number) {
  const f = findBlock(getState(), blockId);
  if (!f) return;
  if (getState().playing !== "none") stopPlayback();
  if (!(await engine.ensureStarted())) return;
  player.start({ startTick: f.block.start, endTick: blockEnd(f.block), loop: null });
  setState({ playing: "audition" });
  if (!raf) raf = requestAnimationFrame(animate);
}


// ---- 選択・コピー・複製・削除 ----

export function deleteSelectionOrRange() {
  const s = getState();
  if (s.selection.size > 0) {
    commit(deleteNotes(s.song, s.selection), { selection: new Set() });
    return;
  }
  if (s.range) {
    const ids = new Set<number>();
    for (const id of s.range.trackIds) {
      const t = findTrack(s.song, id);
      if (t) for (const n of notesInRange(t, s.range)) ids.add(n.id);
    }
    if (ids.size) commit(deleteNotes(s.song, ids));
  }
}

export function copyAction() {
  const s = getState();
  if (s.selection.size > 0) {
    const clip = clipboardFromNotes(s.song, s.selection);
    if (clip) {
      setState({ clipboard: clip });
      toast(`${s.selection.size}音をコピーしました`);
    }
  } else if (s.range) {
    const clip = clipboardFromRange(s.song, s.range.trackIds, s.range);
    setState({ clipboard: clip });
    toast("範囲をコピーしました（貼り付けは再生位置から）");
  }
}

export function pasteAction() {
  const s = getState();
  if (!s.clipboard) return toast("コピーしたものがありません");
  const r = paste(s.song, s.clipboard, s.playhead, s.activeTrackId);
  const overlaps = r.added.reduce((sum, a) => sum + countSamePitchOverlaps(findTrack(s.song, a.trackId)?.notes ?? [], a.notes), 0);
  commit(r.song, { selection: validSelection(r.song, new Set(r.ids), s.activeTrackId) });
  toast(`${r.ids.length}音を貼り付けました${overlaps ? `（同じ高さで重なる音: ${overlaps}）` : ""}`);
}

export function duplicateAction() {
  const s = getState();
  if (s.range) {
    const overlaps = rangeDuplicateOverlaps(s);
    const r = duplicateRange(s.song, s.range.trackIds, s.range);
    commit(r.song, { range: { ...r.newRange, trackIds: s.range.trackIds }, selection: new Set() });
    toast(`${r.ids.length}音を複製しました${overlaps ? `（同じ高さで重なる音: ${overlaps}）` : ""}`);
    return;
  }
  if (s.selection.size > 0) {
    const clip = clipboardFromNotes(s.song, s.selection);
    if (!clip) return;
    const base = Math.min(...[...s.selection].map((id) => activeTrack(s)?.notes.find((n) => n.id === id)?.start ?? Infinity));
    const r = paste(s.song, clip, base + clip.span, s.activeTrackId);
    commit(r.song, { selection: validSelection(r.song, new Set(r.ids), s.activeTrackId) });
    toast(`${r.ids.length}音を複製しました`);
  }
}

/** 範囲を複製したときに、同じ高さで重なる音の数 */
export function rangeDuplicateOverlaps(s: AppState): number {
  if (!s.range) return 0;
  let count = 0;
  const len = s.range.end - s.range.start;
  for (const id of s.range.trackIds) {
    const t = findTrack(s.song, id);
    if (!t) continue;
    const added = notesInRange(t, s.range).map((n) => ({ ...n, start: n.start + len }));
    count += countSamePitchOverlaps(t.notes, added);
  }
  return count;
}

export function selectAll() {
  const t = activeTrack();
  if (t) setState({ selection: new Set(t.notes.map((n) => n.id)) });
}

export function nudgeSelection(dTick: number, dPitch: number) {
  const s = getState();
  const t = activeTrack(s);
  if (!t || s.selection.size === 0) return;
  const sel = t.notes.filter((n) => s.selection.has(n.id));
  const minStart = Math.min(...sel.map((n) => n.start));
  const dt = Math.max(-minStart, dTick);
  let want = dPitch;
  if (t.kind !== "drum" && s.settings.scaleLock && Math.abs(dPitch) === 1) {
    // スケール音のみモード: 半音ではなく、次のスケールの音へ
    const base = sel[0].pitch;
    const next = stepInScale(base, dPitch > 0 ? 1 : -1, s.settings.key);
    want = next === null ? 0 : next - base;
  }
  const dp = clampPitchDelta(sel, want);
  commit(moveNotes(s.song, t.id, s.selection, dt, dp));
  if (dp !== 0 && sel.length === 1) previewPitches(t.id, [sel[0].pitch + dp], sel[0].velocity);
}

/** Shift+←→: 選んだ音符の長さを、吸着の間隔ぶん伸ばす・縮める（吸着オフは 60 tick）。ドラムは長さ固定なので何もしない */
export function resizeSelection(dir: 1 | -1) {
  const s = getState();
  const t = activeTrack(s);
  if (!t || s.selection.size === 0) return;
  if (t.kind === "drum") return toast("ドラムの音符の長さは十六分音符で固定です");
  const g = currentGrid(false, s) ?? 60;
  commit(stepNoteLengths(s.song, t.id, s.selection, g, dir));
}

/** Q: 選んだ音符の開始位置を、吸着の間隔に合わせる（クオンタイズ） */
export function quantizeSelection() {
  const s = getState();
  const t = activeTrack(s);
  if (!t || s.selection.size === 0) return toast("クオンタイズする音符を選んでください");
  const g = snapGrid(false, s);
  if (!g) return toast("吸着が OFF のため、クオンタイズできません（吸着を ON にしてください）");
  const r = quantizeNotes(s.song, t.id, s.selection, g);
  if (r.changed === 0) return toast("選んだ音符は、すでに吸着の位置にあります");
  commit(r.song);
  const label = SNAP_OPTIONS.find((o) => o.key === s.settings.snapKey)?.label ?? "";
  toast(`${r.changed}音の位置を${label}に合わせました（取り消し: Ctrl+Z）`);
}

/**
 * Ctrl+L: ループを設定する。範囲を選んでいればその範囲、音符を選んでいればその音符を含む小節、
 * どちらもなければループのオン・オフを切り替える。
 */
export function loopShortcut() {
  const s = getState();
  if (s.range) {
    updateSettings({ loop: { start: s.range.start, end: s.range.end }, loopEnabled: true });
    return toast("選んだ範囲をループに設定しました");
  }
  const t = activeTrack(s);
  const sel = t ? t.notes.filter((n) => s.selection.has(n.id)) : [];
  if (sel.length > 0) {
    const bl = barLength(s.song.timeSig);
    const start = Math.floor(Math.min(...sel.map((n) => n.start)) / bl) * bl;
    const end = Math.max(start + bl, Math.ceil(Math.max(...sel.map((n) => n.start + n.length)) / bl) * bl);
    updateSettings({ loop: { start, end }, loopEnabled: true });
    return toast("選んだ音符を含む小節をループに設定しました");
  }
  if (s.settings.loop) {
    updateSettings({ loopEnabled: !s.settings.loopEnabled });
    return toast(getState().settings.loopEnabled ? "ループをオンにしました" : "ループをオフにしました");
  }
  toast("範囲か音符を選んでから Ctrl+L を押すと、ループを設定できます");
}

/** End: 曲の終わり（最後の音符が終わる小節の終わり）へ */
export function goToEnd() {
  setPlayhead(songEnd(getState().song));
}

// ---- トラック ----

export function addTrackAction(kind: TrackKind) {
  const s = getState();
  if (!canAddTrack(s.song, kind)) {
    toast(
      kind === "drum"
        ? "ドラムトラックは1つまでです（MIDIでドラムに使う10チャンネルが1つのため）"
        : "旋律トラックは15までです（MIDIのチャンネルが16のため）",
    );
    return;
  }
  const r = addTrack(s.song, kind);
  commit(r.song, { activeTrackId: r.trackId, selection: new Set() });
}

export function deleteTrackAction(trackId: number) {
  const s = getState();
  if (s.playing !== "none") stopPlayback();
  const t = findTrack(s.song, trackId);
  if (!t) return;
  const song = deleteTrack(s.song, trackId);
  const idx = s.song.tracks.findIndex((x) => x.id === trackId);
  const next = song.tracks[Math.min(idx, song.tracks.length - 1)]?.id ?? -1;
  const range = s.range ? { ...s.range, trackIds: s.range.trackIds.filter((id) => id !== trackId) } : null;
  commit(song, {
    activeTrackId: s.activeTrackId === trackId ? next : s.activeTrackId,
    selection: new Set(),
    range: range && range.trackIds.length ? range : null,
  });
  toast(`「${t.name}」を削除しました（取り消し: Ctrl+Z）`);
}

export function setActiveTrack(trackId: number) {
  const s = getState();
  if (s.activeTrackId === trackId) return;
  const t = findTrack(s.song, trackId);
  setState({ activeTrackId: trackId, selection: new Set(), selectedBlockId: null, editorMode: t?.kind === "drum" ? "roll" : s.editorMode });
}

// ---- 拍子の変更（§3.12） ----

export function requestTimeSig(to: TimeSignature) {
  const s = getState();
  const from = s.song.timeSig;
  if (from.numerator === to.numerator && from.denominator === to.denominator) return;
  if (s.playing !== "none") stopPlayback();
  const hasNotes = s.song.tracks.some((t) => t.notes.length > 0);
  const lastBeat = changeTimeSignature(s.song, to, "lastBeat");
  const nextBar = changeTimeSignature(s.song, to, "nextBar");
  if (!hasNotes) return applyTimeSig(lastBeat.song, from, to, []);
  const overlapsOf = (r: typeof lastBeat) => {
    const over = new Set(r.overflowIds);
    let c = 0;
    for (const t of r.song.tracks) {
      const moved = t.notes.filter((n) => over.has(n.id));
      if (moved.length) c += countSamePitchOverlaps(t.notes.filter((n) => !over.has(n.id)), moved);
    }
    return c;
  };
  setState({
    dialog: {
      kind: "timesig",
      to,
      mode: "lastBeat",
      results: { lastBeat, nextBar },
      overlaps: { lastBeat: overlapsOf(lastBeat), nextBar: overlapsOf(nextBar) },
    },
  });
}

export function confirmTimeSig() {
  const s = getState();
  const d = s.dialog;
  if (!d || d.kind !== "timesig") return;
  const r = d.results[d.mode];
  setState({ dialog: null });
  applyTimeSig(r.song, s.song.timeSig, d.to, r.overflowIds);
}

function applyTimeSig(song: Song, from: TimeSignature, to: TimeSignature, movedIds: number[]) {
  const s = getState();
  const conv = (t: number) => convertBoundaryForTs(t, from, to);
  const loop = s.settings.loop ? { start: conv(s.settings.loop.start), end: conv(s.settings.loop.end) } : null;
  const range = s.range ? { ...s.range, start: conv(s.range.start), end: conv(s.range.end) } : null;
  const active = findTrack(song, s.activeTrackId);
  const sel = new Set(movedIds.filter((id) => active?.notes.some((n) => n.id === id)));
  commit(song, {
    selection: sel,
    range: range && range.end > range.start ? range : null,
    playhead: conv(s.playhead),
    scrollX: conv(s.scrollX),
    settings: { ...s.settings, loop: loop && loop.end > loop.start ? loop : null },
  });
  toast(
    movedIds.length
      ? `拍子を変えました。小節に入らなかった${movedIds.length}音を移しました（選択中。取り消し: Ctrl+Z）`
      : "拍子を変えました。音符は小節・拍の位置を保って並べ直しました（取り消し: Ctrl+Z）",
  );
}

/** ダイアログ表示中は、変更後の曲をプレビューとして表示する */
export function displaySong(s: AppState): { song: Song; highlight: Set<number> } {
  const d = s.dialog;
  if (d && d.kind === "timesig") {
    const r = d.results[d.mode];
    return { song: r.song, highlight: new Set(r.overflowIds) };
  }
  return { song: s.song, highlight: new Set() };
}
