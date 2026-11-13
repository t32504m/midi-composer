// ピアノロール（旋律トラック）とドラム表示。04_DESIGN.md §3.2〜3.6。
import { useEffect, useRef, useState } from "preact/hooks";
import { MIN_NOTE_LENGTH, Note, PPQ, Track } from "../model/types";
import { DRUM_LANES, DRUM_NOTE_LENGTH, drumName } from "../model/instruments";
import { isBlackKey, pitchName } from "../model/pitch";
import { barLength, beatLength, positionLabel } from "../model/time";
import { DRAG_THRESHOLD_PX, gridForLength, moveDelta, resizeEnd, snapNearest, snapPlace } from "../model/snap";
import { addNotes, clampPitchDelta, deleteNotes, findTrack, moveNotes, notesEnteringRange, resizeNotes, setNoteLength, shiftVelocity, setVelocity } from "../model/edit";
import { inScale, scalePitchClasses, snapToScale, voiceChord } from "../theory/theory";
import { COLORS, capture, hatch, prepareCanvas, useSize } from "./canvas";
import { Splitter } from "./layout";
import { AppState, getState, onPlayhead, setState, toast } from "./store";
import { assistPlan, commit, currentGrid, displaySong, inputLength, previewPitches, setPlayhead, setViewWidthTicks } from "./actions";

export const RULER_H = 24;
/** 打鍵の強さレーンとの区切り線の太さ（styles.css の .splitter-y と同じ） */
const SPLIT_H = 5;
const EDGE_PX = 6;

type Drag =
  | { kind: "pendingEmpty"; x0: number; y0: number; tick: number; pitch: number; shift: boolean }
  | { kind: "rubber"; x0: number; y0: number; x1: number; y1: number; base: Set<number> }
  | { kind: "move"; x0: number; y0: number; grabbed: Note; ids: Set<number>; dTick: number; dPitch: number; moved: boolean; shift: boolean; copy: boolean }
  | { kind: "resize"; x0: number; grabbed: Note; ids: Set<number>; dLen: number; moved: boolean }
  | { kind: "vel"; y0: number; note: Note; ids: Set<number>; delta: number; moved: boolean };

/** ドラッグ中かどうか（Esc の扱いをアプリ全体で判断するため） */
export const dragState = { active: false, cancel: () => {} };

interface Lanes {
  pitches: number[]; // 上から順
  rowH: number;
}

function drumLanes(track: Track): Lanes {
  const known = DRUM_LANES.map((l) => l.pitch);
  const extra = [...new Set(track.notes.map((n) => n.pitch).filter((p) => !known.includes(p)))].sort((a, b) => b - a);
  return { pitches: [...known, ...extra], rowH: 22 };
}

export function PianoRoll({ s }: { s: AppState }) {
  const { song, highlight } = displaySong(s);
  const track = findTrack(song, s.activeTrackId);
  const isDrum = track?.kind === "drum";
  const keysW = isDrum ? 150 : 72;
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const rulerRef = useRef<HTMLCanvasElement>(null);
  const keysRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef<HTMLCanvasElement>(null);
  const velRef = useRef<HTMLCanvasElement>(null);
  const [scrollY, setScrollY] = useState((127 - 79) * s.rowH);
  const [hoverCursor, setHoverCursor] = useState("default");
  const drag = useRef<Drag | null>(null);
  const playheadRef = useRef(s.playhead);
  const [, setTick] = useState(0);
  const redraw = () => setTick((x) => x + 1);

  const VEL_H = s.layout.velH;
  const gridW = Math.max(0, size.w - keysW);
  const mainH = Math.max(0, size.h - RULER_H - SPLIT_H - VEL_H);
  const ppt = s.zoomX / PPQ;
  const lanes: Lanes = isDrum && track ? drumLanes(track) : { pitches: [], rowH: s.rowH };
  const totalH = isDrum ? lanes.pitches.length * lanes.rowH : 128 * s.rowH;
  const maxScrollY = Math.max(0, totalH - mainH);
  const sy = Math.min(scrollY, maxScrollY);

  useEffect(() => setViewWidthTicks(gridW / ppt), [gridW, ppt]);

  // 座標変換
  const xOf = (tick: number) => (tick - s.scrollX) * ppt;
  const tickAt = (x: number) => x / ppt + s.scrollX;
  const yOfPitch = (p: number) => (isDrum ? lanes.pitches.indexOf(p) * lanes.rowH : (127 - p) * s.rowH) - sy;
  const rowH = isDrum ? lanes.rowH : s.rowH;
  const pitchAt = (y: number): number | null => {
    const row = Math.floor((y + sy) / rowH);
    if (isDrum) return lanes.pitches[row] ?? null;
    const p = 127 - row;
    return p >= 0 && p <= 127 ? p : null;
  };

  // 再生位置だけの更新
  useEffect(
    () =>
      onPlayhead((t) => {
        playheadRef.current = t;
        redraw();
      }),
    [],
  );
  useEffect(() => {
    if (s.playing === "none") playheadRef.current = s.playhead;
  }, [s.playhead, s.playing]);

  // ---- 描画 ----
  useEffect(() => {
    if (!track) return;
    const ts = song.timeSig;
    const bl = barLength(ts);
    const bt = beatLength(ts);
    const grid = currentGrid(false, s);
    const t0 = tickAt(0);
    const t1 = tickAt(gridW);
    const key = s.settings.key;
    const showScale = s.settings.showScale && !isDrum;
    const scalePcs = scalePitchClasses(key);
    const d = drag.current;
    const a = s.assist;
    const chordTones = new Set(
      a.open && a.tab === "chord" && !isDrum ? voiceChord({ root: a.chordRoot, type: a.chordType }, a.octave, a.inversion) : [],
    );

    // ルーラー
    const rc = prepareCanvas(rulerRef.current, gridW, RULER_H);
    if (rc) {
      rc.fillStyle = "#f1f3f7";
      rc.fillRect(0, 0, gridW, RULER_H);
      const loop = s.settings.loop;
      if (loop) {
        rc.fillStyle = s.settings.loopEnabled ? COLORS.loopOn : COLORS.loop;
        rc.fillRect(xOf(loop.start), 0, (loop.end - loop.start) * ppt, 6);
      }
      if (s.range && s.range.trackIds.includes(track.id)) {
        rc.fillStyle = COLORS.rangeEdge;
        rc.fillRect(xOf(s.range.start), RULER_H - 4, (s.range.end - s.range.start) * ppt, 4);
      }
      rc.font = "11px system-ui, sans-serif";
      rc.textBaseline = "middle";
      for (let t = Math.floor(t0 / bt) * bt; t <= t1; t += bt) {
        const x = Math.round(xOf(t)) + 0.5;
        const head = t % bl === 0;
        rc.strokeStyle = head ? COLORS.bar : COLORS.beat;
        rc.beginPath();
        rc.moveTo(x, head ? 8 : 16);
        rc.lineTo(x, RULER_H);
        rc.stroke();
        if (head) {
          rc.fillStyle = COLORS.text;
          rc.fillText(String(t / bl + 1), x + 3, 14);
        }
      }
      const ph = xOf(playheadRef.current);
      rc.fillStyle = COLORS.playhead;
      rc.beginPath();
      rc.moveTo(ph - 5, 0);
      rc.lineTo(ph + 5, 0);
      rc.lineTo(ph, 8);
      rc.fill();
    }

    // 鍵盤／楽器名
    const kc = prepareCanvas(keysRef.current, keysW, mainH);
    if (kc) {
      kc.fillStyle = "#fff";
      kc.fillRect(0, 0, keysW, mainH);
      kc.font = "11px system-ui, sans-serif";
      kc.textBaseline = "middle";
      if (isDrum) {
        lanes.pitches.forEach((p, i) => {
          const y = i * lanes.rowH - sy;
          if (y + lanes.rowH < 0 || y > mainH) return;
          kc.fillStyle = i % 2 ? "#f6f7fa" : "#fff";
          kc.fillRect(0, y, keysW, lanes.rowH);
          kc.strokeStyle = COLORS.line;
          kc.strokeRect(0.5, y + 0.5, keysW - 1, lanes.rowH);
          kc.fillStyle = COLORS.text;
          kc.fillText(`${drumName(p)}`, 8, y + lanes.rowH / 2);
          kc.fillStyle = COLORS.subtext;
          kc.fillText(String(p), keysW - 24, y + lanes.rowH / 2);
        });
      } else {
        for (let p = 127; p >= 0; p--) {
          const y = (127 - p) * s.rowH - sy;
          if (y + s.rowH < 0 || y > mainH) continue;
          const black = isBlackKey(p);
          kc.fillStyle = black ? "#2f3440" : "#fff";
          kc.fillRect(0, y, black ? keysW * 0.62 : keysW, s.rowH);
          kc.strokeStyle = "#d5d9e0";
          kc.strokeRect(0.5, y + 0.5, keysW - 1, s.rowH);
          if (showScale && scalePcs.includes(p % 12)) {
            const tonic = p % 12 === key.tonic;
            kc.fillStyle = tonic ? "#1d4ed8" : "#3d84ff";
            kc.beginPath();
            kc.arc(keysW - 10, y + s.rowH / 2, 3, 0, Math.PI * 2);
            kc.fill();
            if (tonic) {
              kc.fillStyle = "#1d4ed8";
              kc.font = "bold 10px system-ui, sans-serif";
              kc.fillText("主", keysW - 30, y + s.rowH / 2);
              kc.font = "11px system-ui, sans-serif";
            }
          }
          if (chordTones.has(p)) {
            // コードの構成音は枠で示す（スケールの目安の点とは別の記号）
            kc.strokeStyle = COLORS.ghostBorder;
            kc.lineWidth = 2;
            kc.strokeRect(1.5, y + 1.5, keysW - 3, s.rowH - 3);
            kc.lineWidth = 1;
          }
          if (p % 12 === 0) {
            kc.fillStyle = COLORS.text;
            kc.fillText(pitchName(p), 4, y + s.rowH / 2);
          }
        }
      }
    }

    // グリッド
    const gc = prepareCanvas(gridRef.current, gridW, mainH);
    if (gc) {
      gc.fillStyle = COLORS.bg;
      gc.fillRect(0, 0, gridW, mainH);
      if (isDrum) {
        lanes.pitches.forEach((_, i) => {
          const y = i * lanes.rowH - sy;
          if (i % 2) {
            gc.fillStyle = "#f3f4f8";
            gc.fillRect(0, y, gridW, lanes.rowH);
          }
        });
      } else {
        for (let p = 127; p >= 0; p--) {
          const y = (127 - p) * s.rowH - sy;
          if (y + s.rowH < 0 || y > mainH) continue;
          if (showScale) {
            // スケールの目安: スケールの音は水色、主音はオレンジ、スケール外は灰色
            const inS = scalePcs.includes(p % 12);
            gc.fillStyle = !inS ? (s.settings.scaleLock ? COLORS.rowOutLocked : COLORS.rowOut) : p % 12 === key.tonic ? COLORS.rowTonic : COLORS.rowScale;
            gc.fillRect(0, y, gridW, s.rowH);
            if (!inS && s.settings.scaleLock) hatch(gc, 0, y, gridW, s.rowH, "rgba(120,128,145,0.18)");
          } else if (isBlackKey(p)) {
            gc.fillStyle = COLORS.rowBlack;
            gc.fillRect(0, y, gridW, s.rowH);
          }
          if (p % 12 === 0 || p % 12 === 5) {
            gc.strokeStyle = COLORS.line;
            gc.beginPath();
            gc.moveTo(0, Math.round(y + s.rowH) + 0.5);
            gc.lineTo(gridW, Math.round(y + s.rowH) + 0.5);
            gc.stroke();
          }
        }
      }
      // 縦線: 吸着の間隔（十分な幅があるとき）、拍、小節
      if (grid && grid * ppt >= 6) {
        gc.strokeStyle = COLORS.line;
        for (let t = Math.floor(t0 / grid) * grid; t <= t1; t += grid) {
          const x = Math.round(xOf(t)) + 0.5;
          gc.beginPath();
          gc.moveTo(x, 0);
          gc.lineTo(x, mainH);
          gc.stroke();
        }
      }
      for (let t = Math.floor(t0 / bt) * bt; t <= t1; t += bt) {
        const x = Math.round(xOf(t)) + 0.5;
        gc.strokeStyle = t % bl === 0 ? COLORS.bar : COLORS.beat;
        gc.beginPath();
        gc.moveTo(x, 0);
        gc.lineTo(x, mainH);
        gc.stroke();
      }
      // 範囲
      const inRange = s.range && s.range.trackIds.includes(track.id) ? s.range : null;
      if (inRange) {
        gc.fillStyle = COLORS.range;
        gc.fillRect(xOf(inRange.start), 0, (inRange.end - inRange.start) * ppt, mainH);
        gc.strokeStyle = COLORS.rangeEdge;
        gc.strokeRect(xOf(inRange.start) + 0.5, 0.5, (inRange.end - inRange.start) * ppt, mainH - 1);
      }
      // 他のトラックの音符（薄く）
      if (s.showOtherTracks && !isDrum) {
        gc.fillStyle = COLORS.other;
        for (const t of song.tracks) {
          if (t.id === track.id || t.kind === "drum") continue;
          for (const n of t.notes) {
            if (n.start + n.length < t0 || n.start > t1) continue;
            gc.fillRect(xOf(n.start), yOfPitch(n.pitch) + 2, Math.max(2, n.length * ppt), rowH - 4);
          }
        }
      }
      // 挿入予定の音符（プレビュー）
      const plan = assistPlan(s);
      if (plan && plan.trackId === track.id) {
        gc.setLineDash([4, 3]);
        for (const n of plan.notes) {
          const x = xOf(n.start);
          const y = yOfPitch(n.pitch);
          gc.fillStyle = COLORS.ghost;
          gc.fillRect(x, y + 1, Math.max(3, n.length * ppt), rowH - 2);
          gc.strokeStyle = COLORS.ghostBorder;
          gc.strokeRect(x + 0.5, y + 1.5, Math.max(3, n.length * ppt) - 1, rowH - 3);
          if (rowH >= 10 && n.length * ppt >= 24) {
            gc.font = `${Math.min(11, rowH - 3)}px system-ui, sans-serif`;
            gc.fillStyle = COLORS.ghostBorder;
            gc.textBaseline = "middle";
            gc.fillText(pitchName(n.pitch), x + 3, y + rowH / 2 + 0.5);
          }
        }
        gc.setLineDash([]);
      }
      // 音符
      const entering = inRange ? new Set(notesEnteringRange(track, inRange).map((n) => n.id)) : new Set<number>();
      const moving = d && (d.kind === "move" || d.kind === "resize") && d.moved ? d : null;
      const copying = moving && moving.kind === "move" && moving.copy;
      const drawNote = (id: number, start: number, pitch: number, len: number, sel: boolean, dashed = false) => {
        if (start + len < t0 || start > t1) return;
        const x = xOf(start);
        const y = yOfPitch(pitch);
        const border = highlight.has(id) ? COLORS.highlight : sel ? COLORS.noteSelBorder : COLORS.noteBorder;
        if (dashed) gc.setLineDash([4, 2]);
        if (isDrum) {
          const cx = x + 1;
          const cy = y + rowH / 2;
          const r = rowH / 2 - 3;
          gc.beginPath();
          gc.moveTo(cx, cy - r);
          gc.lineTo(cx + r, cy);
          gc.lineTo(cx, cy + r);
          gc.lineTo(cx - r, cy);
          gc.closePath();
          gc.fillStyle = sel ? COLORS.noteSel : COLORS.note;
          gc.fill();
          gc.lineWidth = sel ? 2.5 : 1;
          gc.strokeStyle = border;
          gc.stroke();
        } else {
          const w = Math.max(3, len * ppt);
          gc.fillStyle = sel ? COLORS.noteSel : COLORS.note;
          gc.fillRect(x, y + 1, w, rowH - 2);
          if (entering.has(id) && !dashed) hatch(gc, x, y + 1, w, rowH - 2, "rgba(255,255,255,0.75)");
          gc.lineWidth = highlight.has(id) ? 3 : sel ? 2.5 : 1;
          gc.strokeStyle = border;
          gc.strokeRect(x + 0.5, y + 1.5, w - 1, rowH - 3);
          // 文字が入る幅と高さがあれば、音名（例: A3）を書く
          if (rowH >= 10 && w >= 24) {
            const label = pitchName(pitch);
            gc.font = `${Math.min(11, rowH - 3)}px system-ui, sans-serif`;
            if (gc.measureText(label).width + 6 <= w) {
              gc.fillStyle = sel ? COLORS.noteSelBorder : "#ffffff";
              gc.textBaseline = "middle";
              gc.fillText(label, x + 3, y + rowH / 2 + 0.5);
            }
          }
        }
        gc.lineWidth = 1;
        gc.setLineDash([]);
      };
      for (const n of track.notes) {
        const sel = s.selection.has(n.id);
        if (moving && moving.ids.has(n.id)) {
          if (moving.kind === "move") {
            // Ctrl+ドラッグ（コピー）では元の音符を残し、コピー先を点線で示す
            if (copying) drawNote(n.id, n.start, n.pitch, n.length, false);
            drawNote(n.id, n.start + moving.dTick, n.pitch + moving.dPitch, n.length, true, !!copying);
          } else drawNote(n.id, n.start, n.pitch, Math.max(MIN_NOTE_LENGTH, n.length + moving.dLen), sel);
          continue;
        }
        drawNote(n.id, n.start, n.pitch, n.length, sel);
      }
      // 囲んで選択
      if (d && d.kind === "rubber") {
        gc.fillStyle = COLORS.rubber;
        gc.strokeStyle = COLORS.note;
        const x = Math.min(d.x0, d.x1);
        const y = Math.min(d.y0, d.y1);
        gc.fillRect(x, y, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
        gc.strokeRect(x + 0.5, y + 0.5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      }
      // 再生位置
      const ph = Math.round(xOf(playheadRef.current)) + 0.5;
      gc.strokeStyle = COLORS.playhead;
      gc.lineWidth = 1.5;
      gc.beginPath();
      gc.moveTo(ph, 0);
      gc.lineTo(ph, mainH);
      gc.stroke();
      gc.lineWidth = 1;
    }

    // 打鍵の強さ
    const vc = prepareCanvas(velRef.current, gridW, VEL_H);
    if (vc) {
      vc.fillStyle = "#f7f8fb";
      vc.fillRect(0, 0, gridW, VEL_H);
      vc.strokeStyle = COLORS.line;
      vc.beginPath();
      vc.moveTo(0, 0.5);
      vc.lineTo(gridW, 0.5);
      vc.stroke();
      for (let t = Math.floor(t0 / bl) * bl; t <= t1; t += bl) {
        const x = Math.round(xOf(t)) + 0.5;
        vc.strokeStyle = COLORS.beat;
        vc.beginPath();
        vc.moveTo(x, 0);
        vc.lineTo(x, VEL_H);
        vc.stroke();
      }
      vc.font = "10px system-ui, sans-serif";
      for (const n of track.notes) {
        if (n.start < t0 - PPQ || n.start > t1) continue;
        let v = n.velocity;
        if (d && d.kind === "vel" && d.ids.has(n.id)) v = Math.max(1, Math.min(127, v + d.delta));
        const x = xOf(n.start);
        const h = (v / 127) * (VEL_H - 14);
        const sel = s.selection.has(n.id);
        vc.fillStyle = sel ? COLORS.noteSelBorder : COLORS.note;
        vc.fillRect(x, VEL_H - h, 4, h);
        vc.beginPath();
        vc.arc(x + 2, VEL_H - h, 3.5, 0, Math.PI * 2);
        vc.fill();
        if (sel || (d && d.kind === "vel" && d.ids.has(n.id))) {
          vc.fillStyle = COLORS.text;
          vc.fillText(String(v), x + 6, VEL_H - h + 2);
        }
      }
    }
  });

  if (!track) return <div class="roll empty">トラックがありません。「＋旋律トラック」で追加してください。</div>;

  // ---- 操作 ----
  // 操作では、描画時点ではなく最新の曲データを読む（連続した操作でも古いデータを使わない）
  const liveNotes = () => findTrack(getState().song, track.id)?.notes ?? track.notes;
  const hitNote = (x: number, y: number): { note: Note; edge: boolean } | null => {
    const tick = tickAt(x);
    const p = pitchAt(y);
    if (p === null) return null;
    const notes = liveNotes();
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      if (n.pitch !== p) continue;
      if (isDrum) {
        const cx = xOf(n.start);
        if (Math.abs(x - cx) <= rowH / 2) return { note: n, edge: false };
        continue;
      }
      if (tick >= n.start && tick < n.start + n.length) {
        const right = xOf(n.start + n.length);
        const w = n.length * ppt;
        const edgeZone = w < EDGE_PX * 3 ? w / 2 : EDGE_PX;
        return { note: n, edge: right - x <= edgeZone };
      }
    }
    return null;
  };

  const local = (e: PointerEvent | MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const cancelDrag = () => {
    drag.current = null;
    dragState.active = false;
    redraw();
  };
  dragState.cancel = cancelDrag;

  const onGridDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const { x, y } = local(e);
    capture(e);
    const hit = hitNote(x, y);
    const st = getState();
    if (hit) {
      let sel = st.selection;
      if (e.shiftKey) {
        sel = new Set(sel);
        if (sel.has(hit.note.id)) sel.delete(hit.note.id);
        else sel.add(hit.note.id);
        setState({ selection: sel });
        return;
      }
      if (!sel.has(hit.note.id)) {
        sel = new Set([hit.note.id]);
        setState({ selection: sel });
      }
      if (hit.edge && !isDrum) drag.current = { kind: "resize", x0: x, grabbed: hit.note, ids: sel, dLen: 0, moved: false };
      else drag.current = { kind: "move", x0: x, y0: y, grabbed: hit.note, ids: sel, dTick: 0, dPitch: 0, moved: false, shift: false, copy: e.ctrlKey };
      dragState.active = true;
      previewPitches(track.id, [hit.note.pitch], hit.note.velocity, 0.25);
      return;
    }
    const p = pitchAt(y);
    if (p === null) return;
    drag.current = { kind: "pendingEmpty", x0: x, y0: y, tick: tickAt(x), pitch: p, shift: e.shiftKey };
    dragState.active = true;
  };

  const onGridMove = (e: PointerEvent) => {
    const { x, y } = local(e);
    const d = drag.current;
    if (!d) {
      const hit = hitNote(x, y);
      const st = getState();
      const p = pitchAt(y);
      const locked = !hit && !isDrum && st.settings.scaleLock && p !== null && !inScale(p, st.settings.key);
      const c = hit ? (hit.edge && !isDrum ? "ew-resize" : e.ctrlKey ? "copy" : "grab") : locked ? "not-allowed" : "crosshair";
      if (c !== hoverCursor) setHoverCursor(c);
      return;
    }
    const grid = currentGrid(e.altKey);
    if (d.kind === "pendingEmpty") {
      if (Math.hypot(x - d.x0, y - d.y0) >= DRAG_THRESHOLD_PX)
        drag.current = { kind: "rubber", x0: d.x0, y0: d.y0, x1: x, y1: y, base: d.shift ? new Set(getState().selection) : new Set() };
      redraw();
      return;
    }
    if (d.kind === "rubber") {
      d.x1 = x;
      d.y1 = y;
      redraw();
      return;
    }
    if (d.kind === "move") {
      d.copy = e.ctrlKey;
      if (!d.moved && Math.hypot(x - d.x0, y - d.y0) < DRAG_THRESHOLD_PX) return;
      d.moved = true;
      const sel = liveNotes().filter((n) => d.ids.has(n.id));
      const minStart = Math.min(...sel.map((n) => n.start));
      d.dTick = moveDelta(d.grabbed.start, (x - d.x0) / ppt, gridForLength(grid, d.grabbed.length), minStart);
      const pNow = pitchAt(Math.max(0, Math.min(mainH - 1, y)));
      const pDown = pitchAt(Math.max(0, Math.min(mainH - 1, d.y0)));
      if (isDrum) {
        // ドラムは行（楽器）の並びで移動する
        const i0 = lanes.pitches.indexOf(d.grabbed.pitch);
        const i1 = pNow === null ? i0 : lanes.pitches.indexOf(pNow);
        d.dPitch = i1 >= 0 ? lanes.pitches[i1] - d.grabbed.pitch : 0;
        if (d.ids.size > 1) d.dPitch = 0;
      } else if (pNow !== null && pDown !== null) {
        let dp = pNow - pDown;
        const st = getState();
        if (st.settings.scaleLock && dp !== 0) {
          // スケール音のみモード: つかんだ音符がスケールの音に止まるよう、移動量を合わせる
          dp = snapToScale(d.grabbed.pitch + dp, dp > 0 ? 1 : -1, st.settings.key) - d.grabbed.pitch;
        }
        d.dPitch = clampPitchDelta(sel, dp);
      }
      redraw();
      return;
    }
    if (d.kind === "resize") {
      if (!d.moved && Math.abs(x - d.x0) < DRAG_THRESHOLD_PX) return;
      d.moved = true;
      const g = d.grabbed;
      const newEnd = resizeEnd(g.start, g.start + g.length + (x - d.x0) / ppt, grid);
      d.dLen = newEnd - (g.start + g.length);
      redraw();
    }
  };

  const onGridUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    dragState.active = false;
    if (!d) return;
    const st = getState();
    if (d.kind === "pendingEmpty") {
      // クリック: 音符を置く
      if (!isDrum && st.settings.scaleLock && !inScale(d.pitch, st.settings.key)) {
        // スケール音のみモード: スケール外の行には置かない
        toast(`${pitchName(d.pitch)} はスケール外の音です（スケール音のみモード中）`);
        return;
      }
      const grid = currentGrid(e.altKey);
      const start = snapPlace(d.tick, grid);
      const length = isDrum ? DRUM_NOTE_LENGTH : inputLength(st);
      const r = addNotes(st.song, track.id, [{ pitch: d.pitch, start, length, velocity: 100 }]);
      commit(r.song, { selection: new Set(r.ids) });
      previewPitches(track.id, [d.pitch], 100, 0.3);
      return;
    }
    if (d.kind === "rubber") {
      const ta = tickAt(Math.min(d.x0, d.x1));
      const tb = tickAt(Math.max(d.x0, d.x1));
      const sel = new Set(d.base);
      const rowTop = Math.floor((Math.min(d.y0, d.y1) + sy) / rowH);
      const rowBottom = Math.floor((Math.max(d.y0, d.y1) + sy) / rowH);
      for (const n of liveNotes()) {
        const row = isDrum ? lanes.pitches.indexOf(n.pitch) : 127 - n.pitch;
        const inRows = row >= rowTop && row <= rowBottom;
        const end = isDrum ? n.start + 1 : n.start + n.length;
        if (inRows && n.start < tb && end > ta) sel.add(n.id);
      }
      setState({ selection: sel });
      redraw();
      return;
    }
    if (d.kind === "move") {
      if (!d.moved) {
        // クリックだけ: 選択のみ（位置は変えない。AC-16）
        if (st.selection.size > 1) setState({ selection: new Set([d.grabbed.id]) });
        redraw();
        return;
      }
      if (d.copy || e.ctrlKey) {
        // Ctrl+ドラッグ: 元の音符は残し、移動先にコピーを追加する（コピーは独立した音符）
        if (d.dTick === 0 && d.dPitch === 0) return redraw();
        const drafts = liveNotes()
          .filter((n) => d.ids.has(n.id))
          .map((n) => ({ pitch: n.pitch + d.dPitch, start: n.start + d.dTick, length: n.length, velocity: n.velocity }));
        const r = addNotes(st.song, track.id, drafts);
        commit(r.song, { selection: new Set(r.ids) });
        toast(`${r.ids.length}音をコピーしました（取り消し: Ctrl+Z）`);
      } else commit(moveNotes(st.song, track.id, d.ids, d.dTick, d.dPitch));
      if (d.dPitch !== 0) previewPitches(track.id, [d.grabbed.pitch + d.dPitch], d.grabbed.velocity, 0.25);
      return;
    }
    if (d.kind === "resize") {
      if (!d.moved || d.dLen === 0) return redraw();
      if (d.ids.size === 1) commit(setNoteLength(st.song, track.id, d.grabbed.id, d.grabbed.length + d.dLen));
      else commit(resizeNotes(st.song, track.id, d.ids, d.dLen));
    }
  };

  const onContext = (e: MouseEvent) => {
    e.preventDefault();
    const { x, y } = local(e);
    const hit = hitNote(x, y);
    if (!hit) return;
    const st = getState();
    const sel = new Set(st.selection);
    sel.delete(hit.note.id);
    commit(deleteNotes(st.song, new Set([hit.note.id])), { selection: sel });
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const st = getState();
    if (e.ctrlKey) {
      const { x } = local(e);
      const anchor = tickAt(x);
      const zoomX = Math.min(480, Math.max(12, st.zoomX * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      setState({ zoomX, scrollX: Math.max(0, anchor - x / (zoomX / PPQ)) });
      return;
    }
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const dx = e.shiftKey ? e.deltaY : e.deltaX;
      setState({ scrollX: Math.max(0, st.scrollX + dx / ppt) });
      return;
    }
    setScrollY(Math.max(0, Math.min(maxScrollY, sy + e.deltaY)));
  };

  const onRulerDown = (e: PointerEvent) => {
    const { x } = local(e);
    const grid = currentGrid(e.altKey);
    setPlayhead(grid ? snapNearest(tickAt(x), grid) : tickAt(x));
  };

  const onKeysDown = (e: PointerEvent) => {
    const { y } = local(e);
    const p = pitchAt(y);
    if (p !== null) previewPitches(track.id, [p], 100, 0.4);
  };

  // 打鍵の強さレーン
  const hitVel = (x: number): Note | null => {
    let best: Note | null = null;
    let bestD = 8;
    for (const n of liveNotes()) {
      const dx = Math.abs(x - (xOf(n.start) + 2));
      if (dx < bestD || (dx === bestD && best && n.velocity > best.velocity)) {
        best = n;
        bestD = dx;
      }
    }
    return best;
  };
  const onVelDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const { x, y } = local(e);
    const n = hitVel(x);
    if (!n) return;
    capture(e);
    const st = getState();
    const ids = st.selection.has(n.id) ? st.selection : new Set([n.id]);
    if (!st.selection.has(n.id)) setState({ selection: ids });
    drag.current = { kind: "vel", y0: y, note: n, ids, delta: 0, moved: false };
    dragState.active = true;
  };
  const onVelMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.kind !== "vel") return;
    const { y } = local(e);
    if (!d.moved && Math.abs(y - d.y0) < 2) return;
    d.moved = true;
    d.delta = Math.round(((d.y0 - y) / (VEL_H - 14)) * 127);
    redraw();
  };
  const onVelUp = () => {
    const d = drag.current;
    drag.current = null;
    dragState.active = false;
    if (!d || d.kind !== "vel" || !d.moved || d.delta === 0) return redraw();
    const st = getState();
    if (d.ids.size === 1) commit(setVelocity(st.song, d.ids, d.note.velocity + d.delta));
    else commit(shiftVelocity(st.song, d.ids, d.delta));
  };

  const hoverInfo = (() => {
    const d = drag.current;
    if (d && d.kind === "move" && d.moved) {
      return `${d.copy ? "コピー" : "移動"}: ${positionLabel(d.grabbed.start + d.dTick, song.timeSig)}${d.dPitch ? `／${isDrum ? drumName(d.grabbed.pitch + d.dPitch) : pitchName(d.grabbed.pitch + d.dPitch)}` : ""}`;
    }
    if (d && d.kind === "resize" && d.moved) return `長さ: ${d.grabbed.length + d.dLen} tick`;
    return "";
  })();

  return (
    <div class="roll" ref={wrapRef}>
      <div class="roll-row" style={{ height: `${RULER_H}px` }}>
        <div class="roll-corner" style={{ width: `${keysW}px` }}>
          {isDrum ? "楽器" : "鍵盤"}
          {hoverInfo && <span class="drag-info">{hoverInfo}</span>}
        </div>
        <canvas ref={rulerRef} onPointerDown={onRulerDown} title="クリックで再生位置を指定" />
      </div>
      <div class="roll-row" style={{ height: `${mainH}px` }}>
        <canvas ref={keysRef} onPointerDown={onKeysDown} onWheel={onWheel} title={isDrum ? "" : "クリックで音を確認"} />
        <canvas
          ref={gridRef}
          style={{ cursor: drag.current?.kind === "move" && drag.current.moved ? (drag.current.copy ? "copy" : "grabbing") : hoverCursor }}
          onPointerDown={onGridDown}
          onPointerMove={onGridMove}
          onPointerUp={onGridUp}
          onPointerCancel={cancelDrag}
          onContextMenu={onContext}
          onWheel={onWheel}
        />
      </div>
      <Splitter dir="y" target="velH" invert title="ドラッグで打鍵の強さレーンの高さを変える（ダブルクリックで元の高さ）" />
      <div class="roll-row" style={{ height: `${VEL_H}px` }}>
        <div class="roll-corner vel-label" style={{ width: `${keysW}px` }}>
          打鍵の強さ
          <br />
          <small>音符ごと（音量とは別）</small>
        </div>
        <canvas ref={velRef} onPointerDown={onVelDown} onPointerMove={onVelMove} onPointerUp={onVelUp} />
      </div>
    </div>
  );
}
