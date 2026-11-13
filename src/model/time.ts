import { PPQ, TimeSignature } from "./types";

/** 1小節の長さ（tick） */
export function barLength(ts: TimeSignature): number {
  return (PPQ * 4 * ts.numerator) / ts.denominator;
}

/** 1拍の長さ（tick）。6/8 は付点四分音符を1拍と数える。 */
export function beatLength(ts: TimeSignature): number {
  if (ts.denominator === 8 && ts.numerator % 3 === 0) return (PPQ * 3) / 2;
  return (PPQ * 4) / ts.denominator;
}

export function beatsPerBar(ts: TimeSignature): number {
  return Math.round(barLength(ts) / beatLength(ts));
}

export function tsLabel(ts: TimeSignature): string {
  return `${ts.numerator}/${ts.denominator}`;
}

export type BaseValue = "whole" | "half" | "quarter" | "eighth" | "sixteenth" | "thirtysecond";
export type ValueModifier = "none" | "dotted" | "triplet";

export const BASE_VALUES: { key: BaseValue; label: string; short: string; ticks: number }[] = [
  { key: "whole", label: "全音符", short: "全", ticks: PPQ * 4 },
  { key: "half", label: "二分音符", short: "2分", ticks: PPQ * 2 },
  { key: "quarter", label: "四分音符", short: "4分", ticks: PPQ },
  { key: "eighth", label: "八分音符", short: "8分", ticks: PPQ / 2 },
  { key: "sixteenth", label: "十六分音符", short: "16分", ticks: PPQ / 4 },
  { key: "thirtysecond", label: "三十二分音符", short: "32分", ticks: PPQ / 8 },
];

export function noteValueTicks(base: BaseValue, mod: ValueModifier): number {
  const b = BASE_VALUES.find((v) => v.key === base)!.ticks;
  if (mod === "dotted") return (b * 3) / 2;
  if (mod === "triplet") return (b * 2) / 3;
  return b;
}

/** 長さを音価の名前で説明する。該当がなければ tick で表す。 */
export function lengthLabel(ticks: number): string {
  for (const v of BASE_VALUES) {
    if (ticks === v.ticks) return v.label;
    if (ticks === (v.ticks * 3) / 2) return `付点${v.label}`;
    if (ticks === (v.ticks * 2) / 3) return `三連${v.label}`;
  }
  return `${ticks} tick（四分音符=${PPQ}）`;
}

export interface BarBeat {
  bar: number; // 1始まり
  beat: number; // 1始まり
  remainder: number; // 拍の頭からの tick
}

export function toBarBeat(tick: number, ts: TimeSignature): BarBeat {
  const bl = barLength(ts);
  const bt = beatLength(ts);
  const bar = Math.floor(tick / bl);
  const inBar = tick - bar * bl;
  const beat = Math.floor(inBar / bt);
  return { bar: bar + 1, beat: beat + 1, remainder: inBar - beat * bt };
}

export function positionLabel(tick: number, ts: TimeSignature): string {
  const p = toBarBeat(tick, ts);
  let s = `${p.bar}小節目 ${p.beat}拍目`;
  if (p.remainder > 0) {
    const sixteenth = PPQ / 4;
    if (p.remainder % sixteenth === 0) s += `＋16分×${p.remainder / sixteenth}`;
    else s += `＋${p.remainder}tick`;
  }
  return s;
}

/** 範囲の表示（例: 1小節目1拍目〜2小節目の終わり） */
export function rangeLabel(start: number, end: number, ts: TimeSignature): string {
  const bl = barLength(ts);
  const endLabel =
    end % bl === 0 ? `${end / bl}小節目の終わり` : positionLabel(end, ts);
  const bars = (end - start) / bl;
  const barsLabel = Number.isInteger(bars) ? `（${bars}小節）` : "";
  return `${positionLabel(start, ts)}〜${endLabel}${barsLabel}`;
}

export function ticksToSeconds(ticks: number, tempo: number): number {
  return (ticks / PPQ) * (60 / tempo);
}

export function secondsToTicks(sec: number, tempo: number): number {
  return (sec * tempo * PPQ) / 60;
}
