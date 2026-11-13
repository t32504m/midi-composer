// 同じトラック・同じ音高で重なった音符の変換規則（04_DESIGN.md §3.9）。
// 曲データは変更せず、再生とMIDI書き出しの直前に適用する。両者で同じ規則を使う。
import { Note } from "./types";

export interface PlayNote {
  pitch: number;
  start: number;
  end: number;
  velocity: number;
}

export function resolveOverlaps(notes: readonly Note[]): PlayNote[] {
  const byPitch = new Map<number, PlayNote[]>();
  for (const n of notes) {
    const list = byPitch.get(n.pitch) ?? [];
    list.push({ pitch: n.pitch, start: n.start, end: n.start + n.length, velocity: n.velocity });
    byPitch.set(n.pitch, list);
  }
  const out: PlayNote[] = [];
  for (const list of byPitch.values()) {
    list.sort((a, b) => a.start - b.start);
    // 開始位置が同じ音符は1つにまとめる（強さは大きい方、長さは長い方）
    const merged: PlayNote[] = [];
    for (const n of list) {
      const last = merged[merged.length - 1];
      if (last && last.start === n.start) {
        last.velocity = Math.max(last.velocity, n.velocity);
        last.end = Math.max(last.end, n.end);
      } else merged.push({ ...n });
    }
    // 後の音符が始まる時点で、前の音符を終わらせる
    for (let i = 0; i < merged.length - 1; i++) {
      if (merged[i].end > merged[i + 1].start) merged[i].end = merged[i + 1].start;
    }
    out.push(...merged);
  }
  return out.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}
