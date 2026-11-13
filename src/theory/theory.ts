// スケール・コード・進行・弾き方。すべて「目安」と「挿入する音符の生成」にだけ使う。
// 生成した音符は通常の音符として挿入し、生成元とは連動しない（INV-02）。
import type { NoteDraft } from "../model/edit";
import { pitchClassName } from "../model/pitch";

export type Mode = "major" | "minor";

export interface Key {
  tonic: number; // 0=C … 11=B
  mode: Mode;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10];

export function modeLabel(mode: Mode): string {
  return mode === "major" ? "メジャー（長調）" : "ナチュラルマイナー（短調）";
}

export function keyLabel(key: Key): string {
  return `${pitchClassName(key.tonic)} ${mode2short(key.mode)}`;
}
function mode2short(m: Mode): string {
  return m === "major" ? "メジャー" : "マイナー";
}

/** スケールの構成音（ピッチクラス 0〜11） */
export function scalePitchClasses(key: Key): number[] {
  return (key.mode === "major" ? MAJOR : NATURAL_MINOR).map((i) => (key.tonic + i) % 12);
}

export function inScale(pitch: number, key: Key): boolean {
  return scalePitchClasses(key).includes(pitch % 12);
}

/**
 * dir の向き（+1 で上、-1 で下）で、pitch から最も近いスケールの音。pitch 自身は含めない。
 * 見つからなければ null。
 */
export function stepInScale(pitch: number, dir: 1 | -1, key: Key): number | null {
  for (let p = pitch + dir; p >= 0 && p <= 127; p += dir) if (inScale(p, key)) return p;
  return null;
}

/** pitch がスケール外なら、dir の向きで最も近いスケールの音へ。スケール内ならそのまま */
export function snapToScale(pitch: number, dir: 1 | -1, key: Key): number {
  if (inScale(pitch, key)) return pitch;
  return stepInScale(pitch, dir, key) ?? stepInScale(pitch, dir === 1 ? -1 : 1, key) ?? pitch;
}

// ---- コード ----

export type ChordType = "maj" | "min" | "dim" | "aug" | "sus4" | "7" | "maj7" | "m7" | "m7b5";

export const CHORD_TYPES: { type: ChordType; label: string; suffix: string; intervals: number[] }[] = [
  { type: "maj", label: "メジャー", suffix: "", intervals: [0, 4, 7] },
  { type: "min", label: "マイナー", suffix: "m", intervals: [0, 3, 7] },
  { type: "dim", label: "ディミニッシュ", suffix: "dim", intervals: [0, 3, 6] },
  { type: "aug", label: "オーギュメント", suffix: "aug", intervals: [0, 4, 8] },
  { type: "sus4", label: "サスフォー", suffix: "sus4", intervals: [0, 5, 7] },
  { type: "7", label: "セブンス", suffix: "7", intervals: [0, 4, 7, 10] },
  { type: "maj7", label: "メジャーセブンス", suffix: "maj7", intervals: [0, 4, 7, 11] },
  { type: "m7", label: "マイナーセブンス", suffix: "m7", intervals: [0, 3, 7, 10] },
  { type: "m7b5", label: "マイナーセブンス・フラットファイブ", suffix: "m7♭5", intervals: [0, 3, 6, 10] },
];

export interface Chord {
  root: number; // ピッチクラス
  type: ChordType;
}

export function chordDef(type: ChordType) {
  return CHORD_TYPES.find((c) => c.type === type)!;
}

export function chordName(c: Chord): string {
  return pitchClassName(c.root) + chordDef(c.type).suffix;
}

const INTERVAL_NAMES: Record<number, string> = {
  0: "根音",
  3: "短3度",
  4: "長3度",
  5: "完全4度",
  6: "減5度",
  7: "完全5度",
  8: "増5度",
  10: "短7度",
  11: "長7度",
};
export function intervalName(semitones: number): string {
  return INTERVAL_NAMES[semitones] ?? `${semitones}半音`;
}

export function inversionLabel(inv: number): string {
  return ["基本形", "第1転回形", "第2転回形", "第3転回形"][inv] ?? "基本形";
}

export function maxInversion(type: ChordType): number {
  return chordDef(type).intervals.length - 1;
}

/**
 * コードの音を並べる。根音は指定オクターブ（C{octave}〜B{octave}）に置き、
 * 転回形では下の音から順に1オクターブ上へ移す。
 */
export function voiceChord(c: Chord, octave: number, inversion: number): number[] {
  const rootMidi = 12 * (octave + 1) + c.root;
  const tones = chordDef(c.type).intervals.map((i) => rootMidi + i);
  const inv = Math.min(inversion, tones.length - 1);
  for (let k = 0; k < inv; k++) tones.push(tones.shift()! + 12);
  return tones.filter((p) => p >= 0 && p <= 127);
}

// ---- ダイアトニックコード ----

export interface DiatonicChord {
  degree: number; // 0〜6
  roman: string;
  chord: Chord;
}

const MAJOR_DIATONIC: { roman: string; type: ChordType }[] = [
  { roman: "I", type: "maj" },
  { roman: "ii", type: "min" },
  { roman: "iii", type: "min" },
  { roman: "IV", type: "maj" },
  { roman: "V", type: "maj" },
  { roman: "vi", type: "min" },
  { roman: "vii°", type: "dim" },
];
const MINOR_DIATONIC: { roman: string; type: ChordType }[] = [
  { roman: "i", type: "min" },
  { roman: "ii°", type: "dim" },
  { roman: "III", type: "maj" },
  { roman: "iv", type: "min" },
  { roman: "v", type: "min" },
  { roman: "VI", type: "maj" },
  { roman: "VII", type: "maj" },
];

export function diatonicChords(key: Key): DiatonicChord[] {
  const scale = scalePitchClasses(key);
  const table = key.mode === "major" ? MAJOR_DIATONIC : MINOR_DIATONIC;
  return table.map((d, i) => ({ degree: i, roman: d.roman, chord: { root: scale[i], type: d.type } }));
}

// ---- 和声の働き（断定しない書き方にする） ----

const FUNCTION_HINTS_MAJOR: string[] = [
  "落ち着いた、安定した響き（トニック）として使われることが多いコードです。",
  "次のコード、特に V へ進む前の準備（サブドミナント）として使われることが多いコードです。",
  "トニックの代わりや、つなぎとして使われることがあります。働きは前後のコードによって変わります。",
  "トニックから離れて広がる響き（サブドミナント）として使われることが多いコードです。",
  "トニックへ戻りたくなる響き（ドミナント）として使われることが多いコードです。",
  "トニックの代わり（やや暗めの安定）として使われることが多いコードです。",
  "ドミナントに近い働きをすることがあります。単独では不安定に聞こえやすいコードです。",
];
const FUNCTION_HINTS_MINOR: string[] = [
  "短調の落ち着いた中心（トニック）として使われることが多いコードです。",
  "ドミナントへ進む前の準備（サブドミナント）として使われることがあります。",
  "平行調（長調）の中心にあたるコードで、明るさを加えるときに使われることがあります。",
  "サブドミナントとして使われることが多いコードです。",
  "ナチュラルマイナーの v は、トニックへ向かう力が弱めです。第7音を半音上げた V（メジャー）もよく使われます。",
  "サブドミナントやトニックの代わりとして使われることがあります。",
  "III や i へつながることが多いコードです。働きは前後のコードによって変わります。",
];

export function functionHint(key: Key, degree: number): string {
  const list = key.mode === "major" ? FUNCTION_HINTS_MAJOR : FUNCTION_HINTS_MINOR;
  return list[degree] ?? "";
}

export type FunctionShort = "T" | "SD" | "D";

export interface FunctionTag {
  short: FunctionShort;
  /** 例: 「ドミナント」「トニック（代理）」 */
  label: string;
}

const T = (label = "トニック"): FunctionTag => ({ short: "T", label });
const SD = (label = "サブドミナント"): FunctionTag => ({ short: "SD", label });
const D = (label = "ドミナント"): FunctionTag => ({ short: "D", label });

const TAGS_MAJOR: FunctionTag[] = [T(), SD(), T("トニック（代理）"), SD(), D(), T("トニック（代理）"), D("ドミナント（代理）")];
const TAGS_MINOR: FunctionTag[] = [
  T(),
  SD(),
  T("トニック（代理）"),
  SD(),
  D("ドミナント（弱め）"),
  SD("サブドミナント（トニック代理にも）"),
  D("ドミナント寄り（文脈による）"),
];

/**
 * このキーでの代表的な働き（目安）。キーが変われば同じコードでも働きは変わる。
 * ダイアトニックでないコードは null（短調の V メジャーだけはドミナントとして扱う）。
 */
export function functionTag(key: Key, c: Chord): FunctionTag | null {
  const tags = key.mode === "major" ? TAGS_MAJOR : TAGS_MINOR;
  const deg = diatonicDegree(key, c);
  if (deg >= 0) return tags[deg];
  // スケールの音だけでできる七の和音（例: Cメジャーの Dm7・G7）
  const sevenths: ChordType[] = key.mode === "major" ? ["maj7", "m7", "m7", "maj7", "7", "m7", "m7b5"] : ["m7", "m7b5", "maj7", "m7", "m7", "maj7", "7"];
  const deg7 = scalePitchClasses(key).indexOf(c.root);
  if (deg7 >= 0 && sevenths[deg7] === c.type) return tags[deg7];
  if (key.mode === "minor" && c.type === "maj" && c.root === (key.tonic + 7) % 12) return D("ドミナント（第7音を上げた和音）");
  if (key.mode === "minor" && c.type === "7" && c.root === (key.tonic + 7) % 12) return D("ドミナント（第7音を上げた和音）");
  return null;
}

export const FUNCTION_LABELS: Record<FunctionShort, { name: string; feel: string }> = {
  T: { name: "トニック", feel: "落ち着く・安定した響き" },
  SD: { name: "サブドミナント", feel: "広がる・次へ進む準備の響き" },
  D: { name: "ドミナント", feel: "トニックへ戻りたくなる響き" },
};

/** コードがキーのダイアトニックコードかどうか。そうでなければ -1 */
export function diatonicDegree(key: Key, c: Chord): number {
  return diatonicChords(key).findIndex((d) => d.chord.root === c.root && d.chord.type === c.type);
}

// ---- 進行 ----

export interface ProgressionStep {
  degree: number;
  type?: ChordType; // 指定がなければダイアトニックの種類
  roman: string;
}

export interface Progression {
  id: string;
  mode: Mode;
  label: string;
  steps: ProgressionStep[];
  note?: string;
}

export const PROGRESSIONS: Progression[] = [
  { id: "M1", mode: "major", label: "I–IV–V–I", steps: [s(0, "I"), s(3, "IV"), s(4, "V"), s(0, "I")] },
  { id: "M2", mode: "major", label: "I–V–vi–IV", steps: [s(0, "I"), s(4, "V"), s(5, "vi"), s(3, "IV")] },
  { id: "M3", mode: "major", label: "I–vi–IV–V", steps: [s(0, "I"), s(5, "vi"), s(3, "IV"), s(4, "V")] },
  { id: "M4", mode: "major", label: "ii–V–I", steps: [s(1, "ii"), s(4, "V"), s(0, "I")] },
  { id: "m1", mode: "minor", label: "i–iv–v–i", steps: [s(0, "i"), s(3, "iv"), s(4, "v"), s(0, "i")] },
  { id: "m2", mode: "minor", label: "i–VI–III–VII", steps: [s(0, "i"), s(5, "VI"), s(2, "III"), s(6, "VII")] },
  {
    id: "m3",
    mode: "minor",
    label: "i–iv–V–i",
    steps: [s(0, "i"), s(3, "iv"), { degree: 4, type: "maj", roman: "V" }, s(0, "i")],
    note: "V は第7音を半音上げた和音です（和声的短音階に由来する変化音を含みます）。",
  },
];
function s(degree: number, roman: string): ProgressionStep {
  return { degree, roman };
}

export function progressionChords(p: Progression, key: Key): Chord[] {
  const dia = diatonicChords({ tonic: key.tonic, mode: p.mode });
  return p.steps.map((st) => ({ root: dia[st.degree].chord.root, type: st.type ?? dia[st.degree].chord.type }));
}

// ---- 弾き方 ----

export type PatternKind = "sustain" | "repeat" | "alternate" | "arpUp" | "arpUpDown";

export const PATTERNS: { kind: PatternKind; label: string }[] = [
  { kind: "sustain", label: "和音を伸ばす" },
  { kind: "repeat", label: "和音を繰り返す" },
  { kind: "alternate", label: "低音と和音を交互に" },
  { kind: "arpUp", label: "上行アルペジオ" },
  { kind: "arpUpDown", label: "上下アルペジオ" },
];

/**
 * 1つのコードぶんの音符を作る。tones は低い順。
 * パターンはコードの頭から始め、はみ出す最後の音はコードの終わりで切る。
 */
export function renderPattern(
  tones: number[],
  start: number,
  duration: number,
  kind: PatternKind,
  step: number,
  velocity: number,
): NoteDraft[] {
  const out: NoteDraft[] = [];
  if (tones.length === 0 || duration <= 0) return out;
  const end = start + duration;
  if (kind === "sustain") {
    for (const p of tones) out.push({ pitch: p, start, length: duration, velocity });
    return out;
  }
  let seq: number[][] = [];
  if (kind === "repeat") seq = [tones];
  else if (kind === "alternate") seq = [[tones[0] - 12].filter((p) => p >= 0), tones];
  else if (kind === "arpUp") seq = [...tones, tones[0] + 12].map((p) => [p]);
  else if (kind === "arpUpDown") {
    const up = [...tones, tones[0] + 12];
    const down = up.slice(1, -1).reverse();
    seq = [...up, ...down].map((p) => [p]);
  }
  let i = 0;
  for (let t = start; t < end; t += step, i++) {
    const len = Math.min(step, end - t);
    for (const p of seq[i % seq.length]) if (p <= 127) out.push({ pitch: p, start: t, length: len, velocity });
  }
  return out;
}
