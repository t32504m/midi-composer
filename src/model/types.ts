// 曲データの型。時間はすべて曲頭からの tick（整数）で持つ。四分音符 = PPQ。
import type { ChordType, PatternKind } from "../theory/theory";

export const PPQ = 960;
/** 音符の最小の長さ（128分音符） */
export const MIN_NOTE_LENGTH = 30;
export const MAX_MELODIC_TRACKS = 15;
export const MAX_DRUM_TRACKS = 1;

export interface Note {
  id: number;
  /** MIDIの音高 0〜127。60 = C4（中央のド） */
  pitch: number;
  start: number;
  length: number;
  /** 打鍵の強さ 1〜127 */
  velocity: number;
}

export type TrackKind = "melodic" | "drum";

/** コードブロックの作り方（コードと弾き方） */
export interface BlockParams {
  root: number; // ピッチクラス 0〜11
  type: ChordType;
  octave: number;
  inversion: number;
  pattern: PatternKind;
  step: number;
  velocity: number;
}

/**
 * コードブロック: 同じトラックの音符のまとまりに、コード名と作り方を付けたもの。
 * 音符そのものは通常の音符（Track.notes）。ブロックへの明示的な操作をしたときだけ、そのブロックの音符を作り直す。
 * 曲全体の設定（スケール・補助パネルの設定など）が変わっても、ブロックも音符も変わらない。
 */
export interface ChordBlock extends BlockParams {
  id: number;
  start: number;
  length: number;
  /** このブロックが作った音符のID */
  noteIds: number[];
  /** 作ったときの音符（手直しされたかどうかの判定に使う） */
  generated: { id: number; pitch: number; start: number; length: number; velocity: number }[];
}

export interface Track {
  id: number;
  name: string;
  kind: TrackKind;
  /** GMの音色番号 0〜127（ドラムでは使わない） */
  program: number;
  /** トラックの音量 0〜127（MIDIのCC7） */
  volume: number;
  notes: Note[];
  /** コードブロック（旋律トラックのみ。なければ空） */
  blocks?: ChordBlock[];
}

export interface TimeSignature {
  numerator: number;
  denominator: number;
}

/** 取り消し履歴に入る曲データ。ミュート・ソロや表示設定は含めない。 */
export interface Song {
  tempo: number;
  timeSig: TimeSignature;
  tracks: Track[];
}

/** ミュート・ソロ（取り消しの対象外。保存はする） */
export interface MixerState {
  [trackId: number]: { mute: boolean; solo: boolean };
}

export interface TimeRange {
  start: number;
  end: number;
}

export const TIME_SIGNATURES: TimeSignature[] = [
  { numerator: 4, denominator: 4 },
  { numerator: 3, denominator: 4 },
  { numerator: 2, denominator: 4 },
  { numerator: 6, denominator: 8 },
];

let idCounter = 1;
export function newId(): number {
  return idCounter++;
}
/** 読み込んだデータの最大IDより後ろから採番する */
export function ensureIdAbove(maxId: number): void {
  if (idCounter <= maxId) idCounter = maxId + 1;
}

export function clampInt(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(v)));
}
