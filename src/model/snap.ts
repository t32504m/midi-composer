// 吸着（スナップ）の規則。04_DESIGN.md §3.2〜3.4。
// グリッドの起点は曲頭。置く=切り捨て、動かす・伸ばす=四捨五入（最も近いグリッド）。
import { MIN_NOTE_LENGTH, PPQ, TimeSignature } from "./types";
import { barLength } from "./time";

export type SnapKey =
  | "bar"
  | "half"
  | "quarter"
  | "eighth"
  | "sixteenth"
  | "thirtysecond"
  | "eighthTriplet"
  | "sixteenthTriplet";

export const SNAP_OPTIONS: { key: SnapKey; label: string }[] = [
  { key: "bar", label: "1小節" },
  { key: "half", label: "二分" },
  { key: "quarter", label: "四分" },
  { key: "eighth", label: "八分" },
  { key: "sixteenth", label: "十六分" },
  { key: "thirtysecond", label: "三十二分" },
  { key: "eighthTriplet", label: "八分三連" },
  { key: "sixteenthTriplet", label: "十六分三連" },
];

export function snapTicks(key: SnapKey, ts: TimeSignature): number {
  switch (key) {
    case "bar":
      return barLength(ts);
    case "half":
      return PPQ * 2;
    case "quarter":
      return PPQ;
    case "eighth":
      return PPQ / 2;
    case "sixteenth":
      return PPQ / 4;
    case "thirtysecond":
      return PPQ / 8;
    case "eighthTriplet":
      return PPQ / 3;
    case "sixteenthTriplet":
      return PPQ / 6;
  }
}

/** grid = null は吸着なし */
export type Grid = number | null;

/**
 * 実際に使う吸着の間隔。入力する音符（unit）が吸着の間隔より短いときは、その音符の長さに合わせて細かくする。
 * 例: 吸着が十六分でも、三十二分音符を入力するときは三十二分ごとに置ける（マスの後半にも置ける）。
 */
export function effectiveGrid(grid: Grid, unit: number): Grid {
  if (!grid) return null;
  return unit >= MIN_NOTE_LENGTH && unit < grid ? unit : grid;
}

/**
 * 音符を動かすときの吸着の間隔。つかんだ音符が1マスより短いときは、その長さに収まるまで間隔を半分にする。
 * 例: 吸着が十六分のとき、マスの後半にある三十二分音符は三十二分ごとに動く（マスの頭へ寄せられない）。
 */
export function gridForLength(grid: Grid, length: number): Grid {
  if (!grid) return null;
  let g = grid;
  while (g > length && g / 2 >= MIN_NOTE_LENGTH && Number.isInteger(g / 2)) g /= 2;
  return g;
}

/** 置くとき: クリックしたマスの左端（切り捨て） */
export function snapPlace(tick: number, grid: Grid): number {
  const t = Math.max(0, tick);
  if (!grid) return Math.round(t);
  return Math.floor(t / grid) * grid;
}

/** 最も近いグリッド（四捨五入） */
export function snapNearest(tick: number, grid: Grid): number {
  if (!grid) return Math.round(tick);
  return Math.round(tick / grid) * grid;
}

/**
 * 移動量を求める。つかんだ音符の新しい開始位置をグリッドに合わせ、その差を全体の移動量にする。
 * minStart は選択中の音符で一番前の開始位置。曲頭より前に出ないよう全体で止める。
 */
export function moveDelta(grabbedStart: number, rawDelta: number, grid: Grid, minStart: number): number {
  let target = snapNearest(grabbedStart + rawDelta, grid);
  let delta = target - grabbedStart;
  if (minStart + delta < 0) {
    // 曲頭より前に出る場合: 吸着がオンなら、曲頭以降で最も近い位置へ
    delta = -minStart;
    if (grid) {
      const t = grabbedStart + delta;
      target = Math.ceil(t / grid) * grid;
      const d2 = target - grabbedStart;
      if (minStart + d2 >= 0) delta = d2;
    }
  }
  return delta;
}

/**
 * 右端のドラッグで新しい終了位置を求める。開始位置は変えない。
 * 1マスより短くしたいときは、マスの半分の長さも選べる（例: 十六分の吸着で三十二分音符まで縮められる）。
 */
export function resizeEnd(start: number, rawEnd: number, grid: Grid): number {
  if (!grid) return Math.max(Math.round(rawEnd), start + MIN_NOTE_LENGTH);
  let end = snapNearest(rawEnd, grid);
  if (end <= start) end = (Math.floor(start / grid) + 1) * grid;
  // マスの半分の線（開始より後ろで最初のもの）も候補にする
  const hg = grid / 2;
  const half = (Math.floor(start / hg) + 1) * hg;
  if (half - start >= MIN_NOTE_LENGTH && half < end && Math.abs(rawEnd - half) < Math.abs(rawEnd - end)) end = half;
  while (end - start < MIN_NOTE_LENGTH) end += grid;
  return end;
}

/**
 * Shift+←→ の長さ変更。ふつうは step ぶん伸ばす・縮める。
 * 1マス以下の音符は、縮めるときは半分に、伸ばすときは倍にする（十六分の吸着で 十六分 ⇄ 三十二分 ⇄ 六十四分）。最小は 30 tick。
 */
export function stepLength(length: number, step: number, dir: 1 | -1): number {
  if (dir > 0) return length < step ? Math.min(step, length * 2) : length + step;
  if (length > step) return length - step;
  return Math.max(MIN_NOTE_LENGTH, Math.round(length / 2));
}

/** ピクセル移動量でクリックとドラッグを区別する */
export const DRAG_THRESHOLD_PX = 4;
