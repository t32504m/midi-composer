// 取り消し・やり直し。曲データ（Song）を丸ごと記録する。
// Song は変更せずに作り直すので、変わっていない部分は前の版と共有され、記録は軽い。
import { Song } from "./types";

export const HISTORY_LIMIT = 200;

export interface History {
  past: Song[];
  future: Song[];
}

export function emptyHistory(): History {
  return { past: [], future: [] };
}

export function pushHistory(h: History, before: Song): History {
  const past = [...h.past, before];
  if (past.length > HISTORY_LIMIT) past.shift();
  return { past, future: [] };
}

export function undo(h: History, current: Song): { history: History; song: Song } | null {
  if (h.past.length === 0) return null;
  const song = h.past[h.past.length - 1];
  return { history: { past: h.past.slice(0, -1), future: [current, ...h.future] }, song };
}

export function redo(h: History, current: Song): { history: History; song: Song } | null {
  if (h.future.length === 0) return null;
  const song = h.future[0];
  return { history: { past: [...h.past, current], future: h.future.slice(1) }, song };
}
