// キャンバス描画の共通処理
import { useEffect, useRef, useState } from "preact/hooks";

/** 要素の大きさを監視する */
export function useSize<T extends HTMLElement>(): [preact.RefObject<T>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/** 高解像度の画面でもにじまないよう、キャンバスの実ピクセルを合わせて 2D コンテキストを返す */
export function prepareCanvas(c: HTMLCanvasElement | null, w: number, h: number): CanvasRenderingContext2D | null {
  if (!c || w <= 0 || h <= 0) return null;
  const dpr = window.devicePixelRatio || 1;
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  if (c.width !== pw || c.height !== ph) {
    c.width = pw;
    c.height = ph;
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
  }
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export const COLORS = {
  bg: "#fbfbfd",
  rowBlack: "#eef0f4",
  rowScale: "#e3efff",
  rowTonic: "#ffe2b8",
  rowOut: "#e6e8ec",
  rowOutLocked: "#d9dce2",
  line: "#e3e6ec",
  beat: "#cfd4dd",
  bar: "#8f98a8",
  note: "#3d6fe0",
  noteBorder: "#1f3f8f",
  noteSel: "#8fb1ff",
  noteSelBorder: "#0b1d4d",
  other: "rgba(120, 128, 145, 0.28)",
  ghost: "rgba(232, 140, 30, 0.35)",
  ghostBorder: "#c46a00",
  highlight: "#e8590c",
  range: "rgba(46, 160, 90, 0.12)",
  rangeEdge: "rgba(46, 160, 90, 0.7)",
  loop: "rgba(160, 90, 220, 0.25)",
  loopOn: "rgba(160, 90, 220, 0.55)",
  playhead: "#d6336c",
  text: "#2b2f38",
  subtext: "#6b7280",
  rubber: "rgba(61, 111, 224, 0.15)",
};

/** 斜線で塗る（範囲より前から始まる音符など） */
export function hatch(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  for (let i = -h; i < w; i += 6) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + h, y);
    ctx.stroke();
  }
  ctx.restore();
}

/** ドラッグ中にポインターが要素の外へ出ても追跡できるようにする */
export function capture(e: PointerEvent) {
  try {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  } catch {
    // ポインターが既に離れている場合などは何もしない
  }
}
