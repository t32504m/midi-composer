// 画面の区切り線（ドラッグで大きさを変える）。大きさの初期値・範囲・保存は layoutPrefs.ts。
import { useRef } from "preact/hooks";
import { getState, setState } from "./store";
import { DEFAULT_LAYOUT, Layout, clampLayout, saveLayout } from "./layoutPrefs";

export function setLayout(key: keyof Layout, v: number, save = true) {
  const layout = { ...getState().layout, [key]: clampLayout(key, v) };
  setState({ layout });
  if (save) saveLayout(layout);
}

/**
 * 区切り線。ドラッグで大きさを変え、ダブルクリックで初期の大きさに戻す。
 * dir="x" は左右（幅）、dir="y" は上下（高さ）。invert は、ドラッグと逆向きに大きくなる区切り（右側のパネルの左端など）。
 */
export function Splitter({ dir, target, invert = false, title }: { dir: "x" | "y"; target: keyof Layout; invert?: boolean; title?: string }) {
  const start = useRef<{ p: number; v: number } | null>(null);
  const pos = (e: PointerEvent) => (dir === "x" ? e.clientX : e.clientY);
  return (
    <div
      class={`splitter splitter-${dir}`}
      title={title ?? "ドラッグで大きさを変える（ダブルクリックで元の大きさ）"}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          // ポインターが既に離れている場合などは何もしない
        }
        start.current = { p: pos(e), v: getState().layout[target] };
        document.body.classList.add(`resizing-${dir}`);
      }}
      onPointerMove={(e) => {
        const st = start.current;
        if (!st) return;
        const d = (pos(e) - st.p) * (invert ? -1 : 1);
        setLayout(target, st.v + d, false);
      }}
      onPointerUp={() => {
        if (!start.current) return;
        start.current = null;
        document.body.classList.remove(`resizing-${dir}`);
        setLayout(target, getState().layout[target]);
      }}
      onPointerCancel={() => {
        start.current = null;
        document.body.classList.remove(`resizing-${dir}`);
      }}
      onDblClick={() => setLayout(target, DEFAULT_LAYOUT[target])}
    />
  );
}
