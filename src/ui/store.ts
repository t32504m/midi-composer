// 画面全体の状態。曲データ（song）は取り消し履歴の対象。それ以外は作業中の設定や表示状態。
import { useEffect, useState } from "preact/hooks";
import { MixerState, Song, TimeRange, newId } from "../model/types";
import { History, emptyHistory } from "../model/history";
import { ClipboardData } from "../model/edit";
import { ProjectSettings, defaultSettings } from "../io/project";
import { ChordType, PatternKind } from "../theory/theory";
import { TimeSigChangeResult } from "../model/edit";
import { TimeSignature } from "../model/types";
import { Layout, loadLayout, loadSideOpen } from "./layoutPrefs";

export type AssistTab = "scale" | "chord" | "prog";

export interface AssistState {
  open: boolean;
  tab: AssistTab;
  chordRoot: number;
  chordType: ChordType;
  inversion: number;
  octave: number;
  velocity: number;
  progressionId: string;
  changeEvery: "bar" | "halfBar" | "twoBars";
  pattern: PatternKind;
  step: number;
  includeOthers: boolean;
}

export interface SelectionRange extends TimeRange {
  trackIds: number[];
}

export type Dialog =
  | { kind: "unsaved"; action: string; onSave: () => void; onDiscard: () => void }
  | {
      kind: "timesig";
      to: TimeSignature;
      mode: "lastBeat" | "nextBar";
      results: { lastBeat: TimeSigChangeResult; nextBar: TimeSigChangeResult };
      overlaps: { lastBeat: number; nextBar: number };
    }
  | { kind: "message"; title: string; lines: string[] }
  | { kind: "confirm"; title: string; lines: string[]; okLabel: string; onOk: () => void }
  | { kind: "help" };

export interface AppState {
  song: Song;
  history: History;
  /** 最後に保存（または開いた）ときの曲データ */
  savedSong: Song | null;
  /** 曲データ以外で保存対象の設定が変わったか */
  settingsDirty: boolean;
  mixer: MixerState;
  settings: ProjectSettings;
  metronome: boolean;
  activeTrackId: number;
  selection: Set<number>;
  range: SelectionRange | null;
  clipboard: ClipboardData | null;
  playhead: number;
  playing: "none" | "song" | "audition";
  playStartTick: number;
  /** 横方向: 四分音符1個あたりのピクセル */
  zoomX: number;
  /** 縦方向: 1行の高さ */
  rowH: number;
  /** 表示の左端の tick */
  scrollX: number;
  showOtherTracks: boolean;
  assist: AssistState;
  fileName: string;
  fileHandle: FileSystemFileHandle | null;
  dialog: Dialog | null;
  toast: { text: string; id: number } | null;
  audioMessage: string;
  audioState: string;
  /** ピアノロール／コードブロック */
  editorMode: "roll" | "chord";
  selectedBlockId: number | null;
  /** コードを置くときの長さ。fit = ブロックに重ねたらそのブロックに合わせる（空いていれば1小節） */
  blockPlaceLength: "fit" | "half" | "bar" | "twoBars";
  /** クリックで置くために選んでいるコード */
  paletteChord: { root: number; type: ChordType } | null;
  /** 画面の区切りの大きさ（このブラウザに覚えておく。取り消し履歴・プロジェクトには入れない） */
  layout: Layout;
}

export function initialSong(): { song: Song; activeTrackId: number } {
  const ids = [newId(), newId(), newId(), newId()];
  return {
    song: {
      tempo: 120,
      timeSig: { numerator: 4, denominator: 4 },
      tracks: [
        { id: ids[0], name: "メロディー", kind: "melodic", program: 0, volume: 100, notes: [] },
        { id: ids[1], name: "伴奏", kind: "melodic", program: 0, volume: 90, notes: [] },
        { id: ids[2], name: "ベース", kind: "melodic", program: 33, volume: 100, notes: [] },
        { id: ids[3], name: "ドラム", kind: "drum", program: 0, volume: 100, notes: [] },
      ],
    },
    activeTrackId: ids[0],
  };
}

function initialState(): AppState {
  const { song, activeTrackId } = initialSong();
  return {
    song,
    history: emptyHistory(),
    savedSong: song,
    settingsDirty: false,
    mixer: {},
    settings: defaultSettings(),
    metronome: false,
    activeTrackId,
    selection: new Set(),
    range: null,
    clipboard: null,
    playhead: 0,
    playing: "none",
    playStartTick: 0,
    zoomX: 96,
    rowH: 14,
    scrollX: 0,
    showOtherTracks: true,
    assist: {
      open: loadSideOpen(),
      tab: "scale",
      chordRoot: 0,
      chordType: "maj",
      inversion: 0,
      octave: 3,
      velocity: 80,
      progressionId: "M2",
      changeEvery: "bar",
      pattern: "arpUp",
      step: 480,
      includeOthers: true,
    },
    fileName: "曲1",
    fileHandle: null,
    dialog: null,
    toast: null,
    audioMessage: "音声: 未開始（最初の操作で有効になります）",
    audioState: "off",
    editorMode: "roll",
    selectedBlockId: null,
    blockPlaceLength: "fit",
    paletteChord: null,
    layout: loadLayout(),
  };
}

type Listener = () => void;
let state: AppState = initialState();
const listeners = new Set<Listener>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p };
  for (const fn of listeners) fn();
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 状態が変わるたびに再描画する */
export function useAppState(): AppState {
  const [, setVersion] = useState(0);
  useEffect(() => subscribe(() => setVersion((v) => v + 1)), []);
  return state;
}

export function isDirty(s: AppState): boolean {
  return s.song !== s.savedSong || s.settingsDirty;
}

let toastId = 0;
export function toast(text: string) {
  const id = ++toastId;
  setState({ toast: { text, id } });
  window.setTimeout(() => {
    if (getState().toast?.id === id) setState({ toast: null });
  }, 4000);
}

// 再生位置は毎フレーム変わるので、全体の再描画とは別に知らせる
type PlayheadListener = (tick: number) => void;
const playheadListeners = new Set<PlayheadListener>();
export function emitPlayhead(tick: number) {
  for (const fn of playheadListeners) fn(tick);
}
export function onPlayhead(fn: PlayheadListener): () => void {
  playheadListeners.add(fn);
  return () => playheadListeners.delete(fn);
}
