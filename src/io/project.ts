// プロジェクトファイル（JSON）の保存形式と検証。04_DESIGN.md §3.9。
// 読み込みは、まず解析と検証を行い、成功したときだけ呼び出し側で現在の曲と入れ替える。
import { ChordBlock, MixerState, Note, Song, TIME_SIGNATURES, Track, ensureIdAbove, newId } from "../model/types";
import { BaseValue, ValueModifier } from "../model/time";
import { SnapKey, SNAP_OPTIONS } from "../model/snap";
import { CHORD_TYPES, ChordType, Key, PATTERNS, PatternKind } from "../theory/theory";

export const PROJECT_FORMAT = "midi-composer-project";
/** 2: コードブロックを追加（版1のファイルもそのまま開ける） */
export const PROJECT_VERSION = 2;
export const PROJECT_EXTENSION = ".mcproj.json";

export interface ProjectSettings {
  key: Key;
  showScale: boolean;
  /** スケール音のみモード（新しく置く・動かす音をスケールの音に限る。置いた音符は変えない） */
  scaleLock: boolean;
  inputBase: BaseValue;
  inputMod: ValueModifier;
  snapKey: SnapKey;
  snapEnabled: boolean;
  loop: { start: number; end: number } | null;
  loopEnabled: boolean;
}

export interface ProjectData {
  song: Song;
  mixer: MixerState;
  settings: ProjectSettings;
}

export function defaultSettings(): ProjectSettings {
  return {
    key: { tonic: 0, mode: "major" },
    showScale: true,
    scaleLock: false,
    inputBase: "quarter",
    inputMod: "none",
    snapKey: "sixteenth",
    snapEnabled: true,
    loop: null,
    loopEnabled: false,
  };
}

export function serializeProject(p: ProjectData): string {
  const doc = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    song: {
      tempo: p.song.tempo,
      timeSig: p.song.timeSig,
      tracks: p.song.tracks.map((t) => ({
        id: t.id,
        name: t.name,
        kind: t.kind,
        program: t.program,
        volume: t.volume,
        notes: t.notes.map((n) => ({ pitch: n.pitch, start: n.start, length: n.length, velocity: n.velocity })),
        // ブロックは音符を「音符の並び順の番号」で指す（音符のIDは読み込むたびに振り直すため）
        blocks: (() => {
          const index = new Map(t.notes.map((n, i) => [n.id, i]));
          return (t.blocks ?? []).map((b) => ({
            root: b.root,
            type: b.type,
            octave: b.octave,
            inversion: b.inversion,
            pattern: b.pattern,
            step: b.step,
            velocity: b.velocity,
            start: b.start,
            length: b.length,
            notes: b.noteIds.map((id) => index.get(id)).filter((x) => x !== undefined),
            generated: b.generated.map((g) => ({ note: index.get(g.id) ?? -1, pitch: g.pitch, start: g.start, length: g.length, velocity: g.velocity })),
          }));
        })(),
      })),
    },
    mixer: p.mixer,
    settings: p.settings,
  };
  return JSON.stringify(doc, null, 1);
}

export type ParseResult = { ok: true; data: ProjectData } | { ok: false; message: string };

class FormatError extends Error {}

function req(cond: unknown, what: string): asserts cond {
  if (!cond) throw new FormatError(what);
}
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseProject(text: string): ParseResult {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, message: "このファイルは開けません（形式が違うか、壊れています）。編集中の曲はそのままです。" };
  }
  if (!isObj(doc) || doc.format !== PROJECT_FORMAT) {
    return { ok: false, message: "このアプリのプロジェクトファイルではありません。編集中の曲はそのままです。" };
  }
  if (!isInt(doc.version) || doc.version > PROJECT_VERSION) {
    return {
      ok: false,
      message: `新しい版のアプリで作られたファイルのため開けません（ファイルの版: ${String(doc.version)}、対応: ${PROJECT_VERSION}まで）。編集中の曲はそのままです。`,
    };
  }
  try {
    return { ok: true, data: readDoc(doc) };
  } catch (e) {
    const detail = e instanceof FormatError ? `（${e.message}）` : "";
    return { ok: false, message: `このファイルは壊れているため開けません${detail}。編集中の曲はそのままです。` };
  }
}

function readDoc(doc: Record<string, unknown>): ProjectData {
  const s = doc.song;
  req(isObj(s), "曲データがありません");
  req(isNum(s.tempo) && s.tempo >= 20 && s.tempo <= 300, "テンポの値が不正です");
  const ts = s.timeSig;
  req(isObj(ts), "拍子がありません");
  const timeSig = TIME_SIGNATURES.find((t) => t.numerator === ts.numerator && t.denominator === ts.denominator);
  req(timeSig, "対応していない拍子です");
  req(Array.isArray(s.tracks), "トラックがありません");
  let maxId = 0;
  const rawBlockLists: unknown[][] = [];
  const tracks: Track[] = s.tracks.map((t: unknown, i: number) => {
    req(isObj(t), `トラック${i + 1}が不正です`);
    req(isInt(t.id) && t.id > 0, `トラック${i + 1}のIDが不正です`);
    req(typeof t.name === "string", `トラック${i + 1}の名前が不正です`);
    req(t.kind === "melodic" || t.kind === "drum", `トラック${i + 1}の種類が不正です`);
    req(isInt(t.program) && t.program >= 0 && t.program <= 127, `トラック${i + 1}の音色が不正です`);
    req(isInt(t.volume) && t.volume >= 0 && t.volume <= 127, `トラック${i + 1}の音量が不正です`);
    req(Array.isArray(t.notes), `トラック${i + 1}の音符が不正です`);
    maxId = Math.max(maxId, t.id);
    const notes: Note[] = t.notes.map((n: unknown, j: number) => {
      req(isObj(n), `トラック${i + 1}の音符${j + 1}が不正です`);
      req(isInt(n.pitch) && n.pitch >= 0 && n.pitch <= 127, `音符の音高が不正です（トラック${i + 1}）`);
      req(isInt(n.start) && n.start >= 0, `音符の位置が不正です（トラック${i + 1}）`);
      req(isInt(n.length) && n.length >= 1, `音符の長さが不正です（トラック${i + 1}）`);
      req(isInt(n.velocity) && n.velocity >= 1 && n.velocity <= 127, `音符の強さが不正です（トラック${i + 1}）`);
      return { id: 0, pitch: n.pitch, start: n.start, length: n.length, velocity: n.velocity };
    });
    const rawBlocks = t.blocks === undefined ? [] : t.blocks;
    req(Array.isArray(rawBlocks), `トラック${i + 1}のコードブロックが不正です`);
    rawBlockLists.push(rawBlocks);
    return { id: t.id, name: t.name, kind: t.kind, program: t.program, volume: t.volume, notes };
  });
  req(new Set(tracks.map((t) => t.id)).size === tracks.length, "トラックIDが重複しています");
  req(tracks.filter((t) => t.kind === "drum").length <= 1, "ドラムトラックが2つ以上あります");
  req(tracks.filter((t) => t.kind === "melodic").length <= 15, "旋律トラックが15を超えています");
  ensureIdAbove(maxId);
  for (const t of tracks) for (const n of t.notes) n.id = newId();
  tracks.forEach((t, i) => {
    const blocks = rawBlockLists[i].map((b: unknown, j: number) => readBlock(b, t, `トラック${i + 1}のコードブロック${j + 1}`));
    if (blocks.length) t.blocks = blocks.filter((b) => b.noteIds.length > 0).sort((a, b) => a.start - b.start);
  });

  const mixer: MixerState = {};
  if (isObj(doc.mixer)) {
    for (const t of tracks) {
      const m = doc.mixer[String(t.id)];
      if (isObj(m)) mixer[t.id] = { mute: m.mute === true, solo: m.solo === true };
    }
  }

  const settings = defaultSettings();
  const st = doc.settings;
  if (isObj(st)) {
    if (isObj(st.key) && isInt(st.key.tonic) && st.key.tonic >= 0 && st.key.tonic < 12 && (st.key.mode === "major" || st.key.mode === "minor"))
      settings.key = { tonic: st.key.tonic, mode: st.key.mode };
    if (typeof st.showScale === "boolean") settings.showScale = st.showScale;
    if (typeof st.scaleLock === "boolean") settings.scaleLock = st.scaleLock;
    if (["whole", "half", "quarter", "eighth", "sixteenth", "thirtysecond"].includes(st.inputBase as string))
      settings.inputBase = st.inputBase as BaseValue;
    if (["none", "dotted", "triplet"].includes(st.inputMod as string)) settings.inputMod = st.inputMod as ValueModifier;
    if (SNAP_OPTIONS.some((o) => o.key === st.snapKey)) settings.snapKey = st.snapKey as SnapKey;
    if (typeof st.snapEnabled === "boolean") settings.snapEnabled = st.snapEnabled;
    if (isObj(st.loop) && isInt(st.loop.start) && isInt(st.loop.end) && st.loop.start >= 0 && st.loop.end > st.loop.start)
      settings.loop = { start: st.loop.start, end: st.loop.end };
    if (typeof st.loopEnabled === "boolean") settings.loopEnabled = st.loopEnabled && settings.loop !== null;
  }

  return { song: { tempo: s.tempo, timeSig: { ...timeSig }, tracks }, mixer, settings };
}

function readBlock(b: unknown, t: Track, where: string): ChordBlock {
  req(isObj(b), `${where}が不正です`);
  req(isInt(b.root) && b.root >= 0 && b.root < 12, `${where}の根音が不正です`);
  req(CHORD_TYPES.some((c) => c.type === b.type), `${where}のコードの種類が不正です`);
  req(isInt(b.octave) && b.octave >= 0 && b.octave <= 8, `${where}の音域が不正です`);
  req(isInt(b.inversion) && b.inversion >= 0 && b.inversion <= 3, `${where}の転回形が不正です`);
  req(PATTERNS.some((p) => p.kind === b.pattern), `${where}の弾き方が不正です`);
  req(isInt(b.step) && b.step > 0, `${where}の細かさが不正です`);
  req(isInt(b.velocity) && b.velocity >= 1 && b.velocity <= 127, `${where}の強さが不正です`);
  req(isInt(b.start) && b.start >= 0 && isInt(b.length) && b.length > 0, `${where}の位置が不正です`);
  req(Array.isArray(b.notes) && Array.isArray(b.generated), `${where}の音符が不正です`);
  const idOf = (i: unknown) => (isInt(i) && i >= 0 && i < t.notes.length ? t.notes[i].id : undefined);
  const noteIds = b.notes.map(idOf).filter((x): x is number => x !== undefined);
  const generated = b.generated
    .filter(isObj)
    .map((g) => ({ id: idOf(g.note) ?? -1, pitch: Number(g.pitch), start: Number(g.start), length: Number(g.length), velocity: Number(g.velocity) }));
  return {
    id: newId(),
    root: b.root,
    type: b.type as ChordType,
    octave: b.octave,
    inversion: b.inversion,
    pattern: b.pattern as PatternKind,
    step: b.step,
    velocity: b.velocity,
    start: b.start,
    length: b.length,
    noteIds,
    generated,
  };
}
