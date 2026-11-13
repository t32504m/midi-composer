// ③トラック一覧と④全体表示。全体表示はクリップではなく、各トラックの音符を縮小して表示するだけ。
// 時間範囲の選択・再生位置の指定・ループ範囲の表示をここで行う（04_DESIGN.md §3.5）。
import { useEffect, useRef, useState } from "preact/hooks";
import { PPQ, Track } from "../model/types";
import { INSTRUMENTS, instrumentName } from "../model/instruments";
import { barLength, beatLength } from "../model/time";
import { DRAG_THRESHOLD_PX, snapNearest } from "../model/snap";
import { canAddTrack, moveTrack, renameTrack, setProgram, setTrackVolume, songEnd } from "../model/edit";
import { COLORS, capture, prepareCanvas, useSize } from "./canvas";
import { Splitter } from "./layout";
import { chordName } from "../theory/theory";
import { AppState, getState, onPlayhead, setState } from "./store";
import {
  addTrackAction,
  commit,
  snapGrid,
  deleteTrackAction,
  displaySong,
  setActiveTrack,
  setMixer,
  setPlayhead,
  updateSettings,
} from "./actions";

const RULER_H = 24;
const ROW_H = 40;

export function Arrange({ s }: { s: AppState }) {
  return (
    <div class="arrange" style={{ height: `${s.layout.arrangeH}px` }}>
      <TrackList s={s} />
      <Splitter dir="x" target="trackListW" title="ドラッグでトラック一覧の幅を変える（ダブルクリックで元の幅）" />
      <Overview s={s} />
    </div>
  );
}

function TrackList({ s }: { s: AppState }) {
  const [editing, setEditing] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [volDraft, setVolDraft] = useState<{ id: number; v: number } | null>(null);
  const song = s.song;
  return (
    <div class="tracklist" style={{ width: `${s.layout.trackListW}px` }}>
      <div class="tracklist-head" style={{ height: `${RULER_H}px` }}>
        トラック
        <span class="sub">M=ミュート S=ソロ</span>
      </div>
      {song.tracks.map((t: Track, i: number) => {
        const m = s.mixer[t.id] ?? { mute: false, solo: false };
        const active = t.id === s.activeTrackId;
        return (
          <div
            key={t.id}
            class={`track-row${active ? " active" : ""}${dragFrom === i ? " dragging" : ""}`}
            style={{ height: `${ROW_H}px` }}
            draggable={editing === null}
            onDragStart={(e) => {
              setDragFrom(i);
              e.dataTransfer?.setData("text/plain", String(i));
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom !== null && dragFrom !== i) commit(moveTrack(getState().song, dragFrom, i));
              setDragFrom(null);
            }}
            onDragEnd={() => setDragFrom(null)}
            onClick={() => setActiveTrack(t.id)}
            title="クリックで編集するトラックを選びます。ドラッグで並べ替えます。"
          >
            <span class="grip" aria-hidden="true">⋮⋮</span>
            <div class="track-main">
              {editing === t.id ? (
                <input
                  class="track-name-input"
                  value={t.name}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditing(null);
                    e.stopPropagation();
                  }}
                  onBlur={(e) => {
                    const v = (e.currentTarget as HTMLInputElement).value.trim();
                    if (v && v !== t.name) commit(renameTrack(getState().song, t.id, v));
                    setEditing(null);
                  }}
                />
              ) : (
                <span class="track-name" onDblClick={() => setEditing(t.id)} title="ダブルクリックで名前を変更">
                  {t.name}
                </span>
              )}
              <div class="track-controls" onClick={(e) => e.stopPropagation()}>
                {t.kind === "drum" ? (
                  <span class="drum-label">ドラム（GM標準）</span>
                ) : (
                  <select
                    value={t.program}
                    title="音色（このトラックの音に作用します。音符は変わりません）"
                    onChange={(e) => commit(setProgram(getState().song, t.id, Number((e.currentTarget as HTMLSelectElement).value)))}
                  >
                    {!INSTRUMENTS.some((x) => x.program === t.program) && <option value={t.program}>{instrumentName(t.program)}</option>}
                    {INSTRUMENTS.map((x) => (
                      <option key={x.program} value={x.program}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  type="range"
                  min={0}
                  max={127}
                  class="vol"
                  value={volDraft?.id === t.id ? volDraft.v : t.volume}
                  title={`トラックの音量 ${volDraft?.id === t.id ? volDraft.v : t.volume}（打鍵の強さとは別）`}
                  onInput={(e) => setVolDraft({ id: t.id, v: Number((e.currentTarget as HTMLInputElement).value) })}
                  onChange={(e) => {
                    commit(setTrackVolume(getState().song, t.id, Number((e.currentTarget as HTMLInputElement).value)));
                    setVolDraft(null);
                  }}
                />
              </div>
            </div>
            <div class="track-buttons" onClick={(e) => e.stopPropagation()}>
              <button class={`ms${m.mute ? " on" : ""}`} title="ミュート（一時的に鳴らさない）" onClick={() => setMixer(t.id, { mute: !m.mute })}>
                M
              </button>
              <button class={`ms${m.solo ? " on solo" : ""}`} title="ソロ（このトラックだけ鳴らす）" onClick={() => setMixer(t.id, { solo: !m.solo })}>
                S
              </button>
              <button class="del" title="トラックを削除（取り消せます）" onClick={() => deleteTrackAction(t.id)}>
                ×
              </button>
            </div>
          </div>
        );
      })}
      <div class="track-add">
        <button disabled={!canAddTrack(song, "melodic")} onClick={() => addTrackAction("melodic")} title="旋律トラックは15まで">
          ＋旋律トラック
        </button>
        <button disabled={!canAddTrack(song, "drum")} onClick={() => addTrackAction("drum")} title="ドラムトラックは1つまで">
          ＋ドラム
        </button>
      </div>
    </div>
  );
}

type ODrag = { x0: number; y0: number; row: number; tick0: number; x1: number; y1: number; shift: boolean; moved: boolean };

function Overview({ s }: { s: AppState }) {
  const { song } = displaySong(s);
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const drag = useRef<ODrag | null>(null);
  const playheadRef = useRef(s.playhead);
  const [, setTick] = useState(0);
  const redraw = () => setTick((x) => x + 1);
  const w = size.w;
  const h = RULER_H + song.tracks.length * ROW_H;
  const ppt = s.zoomX / PPQ;
  const bl = barLength(song.timeSig);
  const viewTicks = w / ppt;
  const totalTicks = Math.max(songEnd(song) + bl * 8, bl * 32, s.scrollX + viewTicks);

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

  // 横スクロールバーと scrollX を同期
  useEffect(() => {
    const el = scrollRef.current;
    if (el && Math.abs(el.scrollLeft - s.scrollX * ppt) > 1) el.scrollLeft = s.scrollX * ppt;
  }, [s.scrollX, ppt]);

  const xOf = (t: number) => (t - s.scrollX) * ppt;
  const tickAt = (x: number) => x / ppt + s.scrollX;

  useEffect(() => {
    const ctx = prepareCanvas(canvasRef.current, w, h);
    if (!ctx) return;
    const bt = beatLength(song.timeSig);
    const t0 = tickAt(0);
    const t1 = tickAt(w);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#f1f3f7";
    ctx.fillRect(0, 0, w, RULER_H);
    song.tracks.forEach((t, i) => {
      const y = RULER_H + i * ROW_H;
      if (t.id === s.activeTrackId) {
        ctx.fillStyle = "rgba(61,111,224,0.07)";
        ctx.fillRect(0, y, w, ROW_H);
      }
      ctx.strokeStyle = COLORS.line;
      ctx.beginPath();
      ctx.moveTo(0, y + ROW_H - 0.5);
      ctx.lineTo(w, y + ROW_H - 0.5);
      ctx.stroke();
    });
    ctx.font = "11px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    for (let t = Math.floor(t0 / bt) * bt; t <= t1; t += bt) {
      const x = Math.round(xOf(t)) + 0.5;
      const head = t % bl === 0;
      ctx.strokeStyle = head ? COLORS.bar : "#e6e9ef";
      ctx.beginPath();
      ctx.moveTo(x, head ? 8 : RULER_H);
      ctx.lineTo(x, h);
      ctx.stroke();
      if (head) {
        ctx.fillStyle = COLORS.text;
        ctx.fillText(String(t / bl + 1), x + 3, 14);
      }
    }
    // ループ範囲
    const loop = s.settings.loop;
    if (loop) {
      ctx.fillStyle = s.settings.loopEnabled ? COLORS.loopOn : COLORS.loop;
      ctx.fillRect(xOf(loop.start), 0, (loop.end - loop.start) * ppt, 6);
    }
    // 範囲
    const d = drag.current;
    const range =
      d && d.moved
        ? rangeFromDrag(d)
        : s.range
          ? { start: s.range.start, end: s.range.end, rows: s.range.trackIds.map((id) => song.tracks.findIndex((t) => t.id === id)) }
          : null;
    if (range) {
      for (const row of range.rows) {
        if (row < 0) continue;
        const y = RULER_H + row * ROW_H;
        ctx.fillStyle = "rgba(46,160,90,0.18)";
        ctx.fillRect(xOf(range.start), y + 1, (range.end - range.start) * ppt, ROW_H - 2);
        ctx.strokeStyle = COLORS.rangeEdge;
        ctx.strokeRect(xOf(range.start) + 0.5, y + 1.5, (range.end - range.start) * ppt, ROW_H - 3);
      }
    }
    // 音符（縮小表示）
    song.tracks.forEach((t, i) => {
      const y = RULER_H + i * ROW_H;
      if (t.notes.length === 0) return;
      const lo = Math.min(...t.notes.map((n) => n.pitch));
      const hi = Math.max(...t.notes.map((n) => n.pitch));
      const span = Math.max(12, hi - lo + 1);
      const mid = (lo + hi) / 2;
      ctx.fillStyle = t.kind === "drum" ? "#5b6476" : COLORS.note;
      for (const n of t.notes) {
        const end = n.start + (t.kind === "drum" ? PPQ / 8 : n.length);
        if (end < t0 || n.start > t1) continue;
        const yy = y + ROW_H / 2 - ((n.pitch - mid) / span) * (ROW_H - 10) - 1.5;
        ctx.fillRect(xOf(n.start), yy, Math.max(2, (end - n.start) * ppt), 3);
      }
    });
    // コードブロックの名前
    ctx.font = "bold 10px system-ui, sans-serif";
    ctx.textBaseline = "top";
    song.tracks.forEach((t, i) => {
      const y = RULER_H + i * ROW_H;
      for (const b of t.blocks ?? []) {
        const x = xOf(b.start);
        const bw = b.length * ppt;
        if (x + bw < 0 || x > w) continue;
        ctx.fillStyle = "rgba(255, 244, 222, 0.9)";
        ctx.fillRect(x + 1, y + 2, Math.max(4, bw - 2), 12);
        ctx.strokeStyle = "#d39b3a";
        ctx.strokeRect(x + 1.5, y + 2.5, Math.max(4, bw - 3), 11);
        if (bw > 18) {
          ctx.fillStyle = "#7a4b00";
          ctx.fillText(chordName(b), x + 4, y + 3, bw - 6);
        }
      }
    });
    // 再生位置
    const ph = Math.round(xOf(playheadRef.current)) + 0.5;
    ctx.strokeStyle = COLORS.playhead;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(ph, 0);
    ctx.lineTo(ph, h);
    ctx.stroke();
    ctx.lineWidth = 1;
  });

  function snapTick(t: number, alt: boolean) {
    const g = snapGrid(alt);
    return Math.max(0, g ? snapNearest(t, g) : Math.round(t));
  }

  function rangeFromDrag(d: ODrag) {
    const a = snapTick(d.tick0, false);
    const b = snapTick(tickAt(d.x1), false);
    const r1 = Math.max(0, Math.min(song.tracks.length - 1, Math.floor((d.y1 - RULER_H) / ROW_H)));
    const rows: number[] = [];
    if (d.shift) for (let r = Math.min(d.row, r1); r <= Math.max(d.row, r1); r++) rows.push(r);
    else rows.push(d.row);
    return { start: Math.min(a, b), end: Math.max(a, b), rows };
  }

  const local = (e: PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const { x, y } = local(e);
    if (y < RULER_H) {
      setPlayhead(snapTick(tickAt(x), e.altKey));
      return;
    }
    const row = Math.floor((y - RULER_H) / ROW_H);
    if (row < 0 || row >= song.tracks.length) return;
    capture(e);
    drag.current = { x0: x, y0: y, row, tick0: tickAt(x), x1: x, y1: y, shift: e.shiftKey, moved: false };
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const { x, y } = local(e);
    d.x1 = x;
    d.y1 = y;
    d.shift = d.shift || e.shiftKey;
    if (!d.moved && Math.hypot(x - d.x0, y - d.y0) >= DRAG_THRESHOLD_PX) d.moved = true;
    if (d.moved) redraw();
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const track = song.tracks[d.row];
    if (!d.moved) {
      // クリック: そのトラックを編集対象にし、範囲を解除
      if (track) setActiveTrack(track.id);
      setState({ range: null });
      return;
    }
    const r = rangeFromDrag(d);
    if (r.end <= r.start) {
      setState({ range: null });
      return;
    }
    const trackIds = r.rows.map((i) => song.tracks[i].id);
    setState({ range: { start: r.start, end: r.end, trackIds } });
    // ループ中に範囲を選び直したら、ループもその範囲に合わせる
    if (getState().settings.loopEnabled) updateSettings({ loop: { start: r.start, end: r.end } });
    if (track && !trackIds.includes(getState().activeTrackId)) setActiveTrack(track.id);
  };

  return (
    <div class="overview" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onWheel={(e) => {
          e.preventDefault();
          const st = getState();
          if (e.ctrlKey) {
            const zoomX = Math.min(480, Math.max(12, st.zoomX * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
            setState({ zoomX });
          } else setState({ scrollX: Math.max(0, st.scrollX + (e.deltaY || e.deltaX) / ppt) });
        }}
        title="上の帯: 再生位置を指定／トラックの行を横にドラッグ: 時間範囲を選択（Shift で複数トラック）"
      />
      <div
        class="hscroll"
        ref={scrollRef}
        onScroll={(e) => {
          const left = (e.currentTarget as HTMLDivElement).scrollLeft;
          const t = left / ppt;
          if (Math.abs(t - getState().scrollX) > 0.5 / ppt) setState({ scrollX: t });
        }}
      >
        <div style={{ width: `${totalTicks * ppt}px`, height: "1px" }} />
      </div>
    </div>
  );
}
