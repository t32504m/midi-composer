// コードの帯（コードブロック）とパレット。04_DESIGN.md §3.13。
// ブロックの音符は通常の音符。ブロックへの操作（置く・動かす・長さ・コードの変更）をしたときだけ、そのブロックの音符を作り直す。
import { useRef, useState } from "preact/hooks";
import { PPQ } from "../model/types";
import { PITCH_CLASS_NAMES } from "../model/pitch";
import { barLength, beatLength, rangeLabel } from "../model/time";
import { MIN_BLOCK_LENGTH, blockEnd, blocksOf, isEdited, raiseVoicing } from "../model/chordBlocks";
import { CHORD_TYPES, ChordType, PATTERNS, PatternKind, chordName, functionTag, voiceChord } from "../theory/theory";
import { capture, useSize } from "./canvas";
import { AppState, getState, setState } from "./store";
import {
  activeTrack,
  auditionBlock,
  currentGrid,
  deleteBlockAction,
  displaySong,
  dissolveBlockAction,
  dropChord,
  dropTarget,
  moveBlockAction,
  previewPitches,
  setAssist,
  updateBlockAction,
} from "./actions";
import { CHORD_MIME, ChordChip, FunctionGroups } from "./ChordChips";

const KEYS_W = 72;
const EDGE_PX = 7;

type Drag = { kind: "move" | "resize"; blockId: number; x0: number; start: number; length: number; d: number; moved: boolean };

export function ChordLane({ s, editable }: { s: AppState; editable: boolean }) {
  const track = activeTrack(s);
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const laneRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<{ start: number; length: number; replaceId: number | null; splitId?: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const [, setTick] = useState(0);
  const redraw = () => setTick((x) => x + 1);
  if (!track || track.kind === "drum") return null;
  const { song } = displaySong(s);
  const shown = song.tracks.find((t) => t.id === track.id) ?? track;
  const ppt = s.zoomX / PPQ;
  const xOf = (t: number) => (t - s.scrollX) * ppt;
  const bl = barLength(song.timeSig);
  const laneW = Math.max(0, size.w - KEYS_W);
  const tickAt = (clientX: number) => {
    const r = laneRef.current!.getBoundingClientRect();
    return Math.max(0, (clientX - r.left) / ppt + s.scrollX);
  };
  const blocks = blocksOf(shown);
  const key = s.settings.key;

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes(CHORD_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const p = dropTarget(getState(), track.id, tickAt(e.clientX));
    if (!preview || p.start !== preview.start || p.length !== preview.length || p.replaceId !== preview.replaceId) setPreview(p);
  };
  const onDrop = (e: DragEvent) => {
    const data = e.dataTransfer?.getData(CHORD_MIME);
    setPreview(null);
    if (!data) return;
    e.preventDefault();
    try {
      const c = JSON.parse(data) as { root: number; type: ChordType };
      dropChord(track.id, c, tickAt(e.clientX));
    } catch {
      // 想定外のデータは無視する
    }
  };

  const onLaneDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const st = getState();
    if (st.paletteChord) dropChord(track.id, st.paletteChord, tickAt(e.clientX));
    else setState({ selectedBlockId: null });
  };

  // ブロックの移動・長さの変更は拍単位（吸着オフまたは Alt のときは十六分単位）
  const gridFor = (e: PointerEvent) => (currentGrid(e.altKey) === null ? PPQ / 4 : beatLength(song.timeSig));

  const onBlockDown = (e: PointerEvent, id: number) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    setState({ selectedBlockId: id, selection: new Set(), paletteChord: null });
    if (!editable) return;
    const b = blocks.find((x) => x.id === id)!;
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    const edge = r.right - e.clientX <= EDGE_PX;
    capture(e);
    drag.current = { kind: edge ? "resize" : "move", blockId: id, x0: e.clientX, start: b.start, length: b.length, d: 0, moved: false };
  };
  const onBlockMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.x0) < 4) return;
    d.moved = true;
    const g = gridFor(e);
    const raw = (e.clientX - d.x0) / ppt;
    if (d.kind === "move") {
      const target = Math.max(0, Math.round((d.start + raw) / g) * g);
      d.d = target - d.start;
    } else {
      const end = Math.max(d.start + MIN_BLOCK_LENGTH, Math.round((d.start + d.length + raw) / g) * g);
      d.d = end - (d.start + d.length);
    }
    redraw();
  };
  const onBlockUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved || d.d === 0) return redraw();
    if (d.kind === "move") moveBlockAction(d.blockId, d.d);
    else updateBlockAction(d.blockId, { length: d.length + d.d });
  };

  const height = editable ? 58 : 30;
  // 小節線・拍線は、ピアノロールと同じ計算で1本ずつ置く（繰り返し模様だと端数の誤差がたまってずれるため）
  const bt = beatLength(song.timeSig);
  const lines: { x: number; bar: boolean; t: number }[] = [];
  const firstTick = Math.floor(s.scrollX / bt) * bt;
  const lastTick = s.scrollX + laneW / ppt;
  for (let t = firstTick; t <= lastTick; t += bt) {
    const bar = t % bl === 0;
    if (bar || (editable && bt * ppt >= 12)) lines.push({ x: Math.round(xOf(t)), bar, t });
  }

  return (
    <div class={`chord-lane${editable ? " editable" : ""}`} ref={wrapRef} style={{ height: `${height}px` }}>
      <div class="lane-label" style={{ width: `${KEYS_W}px` }}>
        コード
        {!editable && (
          <button class="link" onClick={() => setState({ editorMode: "chord" })} title="コードブロック画面を開く">
            編集
          </button>
        )}
      </div>
      <div
        class="lane-body"
        ref={laneRef}
        style={{ width: `${laneW}px` }}
        onDragOver={onDragOver}
        onDragLeave={() => setPreview(null)}
        onDrop={onDrop}
        onPointerDown={onLaneDown}
      >
        {lines.map((l) => (
          <div key={l.t} class={`lane-line${l.bar ? " bar" : ""}`} style={{ left: `${l.x}px` }} />
        ))}
        {blocks.length === 0 && !preview && (
          <span class="lane-hint">
            {editable
              ? "上のコードをここへドラッグして置きます（コードをクリックで選んでから、帯をクリックしても置けます）"
              : "コードをここへドラッグして置けます（右の「コード」タブから）。詳しい操作は「編集」から"}
          </span>
        )}
        {blocks.map((b) => {
          const d = drag.current && drag.current.blockId === b.id && drag.current.moved ? drag.current : null;
          const start = d && d.kind === "move" ? b.start + d.d : b.start;
          const len = d && d.kind === "resize" ? b.length + d.d : b.length;
          const x = xOf(start);
          const w = len * ppt;
          if (x + w < 0 || x > laneW) return null;
          const tag = functionTag(key, b);
          const edited = isEdited(shown, b);
          const sel = s.selectedBlockId === b.id;
          return (
            <div
              key={b.id}
              class={`block${sel ? " sel" : ""}${edited ? " edited" : ""}${preview?.replaceId === b.id ? " replacing" : ""}${preview?.splitId === b.id ? " splitting" : ""}`}
              style={{ left: `${x}px`, width: `${Math.max(6, w - 2)}px` }}
              title={`${chordName(b)}／${rangeLabel(b.start, blockEnd(b), song.timeSig)}${edited ? "／手直しあり" : ""}${editable ? "\nクリック: 選んで編集／ドラッグ: 移動／右端: 長さ／右クリック: 削除" : ""}`}
              onPointerDown={(e) => onBlockDown(e, b.id)}
              onPointerMove={onBlockMove}
              onPointerUp={onBlockUp}
              onContextMenu={(e) => {
                e.preventDefault();
                if (editable) deleteBlockAction(b.id);
              }}
            >
              <span class="block-name">{chordName(b)}</span>
              {tag && <span class={`fn fn-${tag.short}`}>{tag.short}</span>}
              {edited && <span class="edited-mark" title="ピアノロールで手直ししています">✎</span>}
              {editable && <span class="block-edge" />}
            </div>
          );
        })}
        {preview && (
          <div class="drop-preview" style={{ left: `${xOf(preview.start)}px`, width: `${Math.max(6, preview.length * ppt - 2)}px` }}>
            {preview.replaceId !== null ? "このコードを置き換え" : preview.splitId !== undefined ? "ここから後ろに置く" : "ここに置く"}
          </div>
        )}
      </div>
    </div>
  );
}

/** コードブロック画面の上部: コードのパレットと、置き方の設定 */
export function ChordPalette({ s }: { s: AppState }) {
  const a = s.assist;
  const track = activeTrack(s);
  const sel = s.paletteChord;
  const [freeRoot, setFreeRoot] = useState(0);
  const [freeType, setFreeType] = useState<ChordType>("7");
  const pick = (c: { root: number; type: ChordType }) => {
    // ブロックを選んでいるときは、そのブロックのコードを変える
    const selBlock = track ? blocksOf(track).find((x) => x.id === getState().selectedBlockId) : undefined;
    if (selBlock) {
      const mi = CHORD_TYPES.find((x) => x.type === c.type)!.intervals.length - 1;
      updateBlockAction(selBlock.id, { root: c.root, type: c.type, inversion: Math.min(selBlock.inversion, mi) });
      return;
    }
    const same = sel && sel.root === c.root && sel.type === c.type;
    setState({ paletteChord: same ? null : c });
    if (track && track.kind !== "drum") previewPitches(track.id, voiceChord(c, a.octave, Math.min(a.inversion, 2)), a.velocity, 0.8);
  };
  return (
    <div class="chord-palette" style={{ height: `${s.layout.paletteH}px` }}>
      <div class="palette-left">
        <FunctionGroups s={s} onPick={pick} selected={sel} />
        <div class="row wrap">
          <span class="small">ほかのコード:</span>
          <select value={freeRoot} onChange={(e) => setFreeRoot(Number((e.currentTarget as HTMLSelectElement).value))}>
            {PITCH_CLASS_NAMES.map((n, i) => (
              <option key={n} value={i}>
                {n}
              </option>
            ))}
          </select>
          <select value={freeType} onChange={(e) => setFreeType((e.currentTarget as HTMLSelectElement).value as ChordType)}>
            {CHORD_TYPES.map((c) => (
              <option key={c.type} value={c.type}>
                {c.label}
              </option>
            ))}
          </select>
          <span class="fn-chords">
            <ChordChip chord={{ root: freeRoot, type: freeType }} on={!!sel && sel.root === freeRoot && sel.type === freeType} onPick={pick} />
          </span>
        </div>
      </div>
      <div class="palette-right">
        <label>
          置く長さ
          <select
            value={s.blockPlaceLength}
            onChange={(e) => setState({ blockPlaceLength: (e.currentTarget as HTMLSelectElement).value as AppState["blockPlaceLength"] })}
          >
            <option value="fit">空きに合わせる（ドロップした拍から）</option>
            <option value="half">半小節</option>
            <option value="bar">1小節</option>
            <option value="twoBars">2小節</option>
          </select>
        </label>
        <label title="新しく置くブロックの弾き方。置いたブロックは、選んで右の情報欄から変えます">
          弾き方
          <select value={a.pattern} onChange={(e) => setAssist({ pattern: (e.currentTarget as HTMLSelectElement).value as PatternKind })}>
            {PATTERNS.map((p) => (
              <option key={p.kind} value={p.kind}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          細かさ
          <select value={a.step} disabled={a.pattern === "sustain"} onChange={(e) => setAssist({ step: Number((e.currentTarget as HTMLSelectElement).value) })}>
            <option value={960}>四分</option>
            <option value={480}>八分</option>
            <option value={240}>十六分</option>
          </select>
        </label>
        <label title="根音を置くオクターブ">
          音域
          <select value={a.octave} onChange={(e) => setAssist({ octave: Number((e.currentTarget as HTMLSelectElement).value) })}>
            {[1, 2, 3, 4, 5].map((o) => (
              <option key={o} value={o}>
                C{o}〜B{o}
              </option>
            ))}
          </select>
        </label>
        <p class="small">
          置き方: コードを帯へドラッグ（ドロップした拍から、空いている部分にぴったり入ります）／ブロックの最初の拍に重ねると置き換え、途中の拍に重ねるとそこから後ろだけ置き換え／ブロックをドラッグで移動、右端で長さ、右クリックで削除。
          ブロックをクリックすると、帯の下で編集できます。ここの設定を変えても、置いたブロックは変わりません。
        </p>
      </div>
    </div>
  );
}

/** 情報欄: 選んだコードブロック */
export function BlockInfo({ s, bar = false }: { s: AppState; bar?: boolean }) {
  const track = activeTrack(s);
  const b = track ? blocksOf(track).find((x) => x.id === s.selectedBlockId) : undefined;
  if (bar && track && track.kind !== "drum" && !b)
    return (
      <div class="block-info bar empty">
        ブロックをクリックすると、ここでコード・音の高さ・弾き方を変えられます。ブロックを選んだ状態で上のコードをクリックすると、そのブロックのコードが変わります。
      </div>
    );
  if (!track || !b) return null;
  const tag = functionTag(s.settings.key, b);
  const edited = isEdited(track, b);
  const maxInv = CHORD_TYPES.find((c) => c.type === b.type)!.intervals.length - 1;
  const up = (dir: 1 | -1) => updateBlockAction(b.id, raiseVoicing(b, dir, maxInv));
  const tones = voiceChord(b, b.octave, b.inversion);
  return (
    <div class={`block-info${bar ? " bar" : ""}`}>
      <p>
        <b>選択中のブロック {chordName(b)}</b>
        {tag && (
          <span class={`fn fn-${tag.short}`} title={tag.label}>
            {tag.short} {tag.label}
          </span>
        )}
      </p>
      <p class="small">{rangeLabel(b.start, blockEnd(b), s.song.timeSig)}</p>
      {edited && <p class="warn-inline">✎ ピアノロールで手直ししています。下の設定を変えると作り直し、手直しは消えます。</p>}
      <div class="row wrap">
        <label>
          根音
          <select value={b.root} onChange={(e) => updateBlockAction(b.id, { root: Number((e.currentTarget as HTMLSelectElement).value) })}>
            {PITCH_CLASS_NAMES.map((n, i) => (
              <option key={n} value={i}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          種類
          <select
            value={b.type}
            onChange={(e) => {
              const type = (e.currentTarget as HTMLSelectElement).value as ChordType;
              const mi = CHORD_TYPES.find((c) => c.type === type)!.intervals.length - 1;
              updateBlockAction(b.id, { type, inversion: Math.min(b.inversion, mi) });
            }}
          >
            {CHORD_TYPES.map((c) => (
              <option key={c.type} value={c.type}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div class="row wrap">
        <span class="small">音の高さ: {tones.map((p) => `${PITCH_CLASS_NAMES[p % 12]}${Math.floor(p / 12) - 1}`).join("・")}</span>
        <button onClick={() => up(1)} title="転回形を1つ上げます（端まで行くとオクターブ上へ）">
          ▲ 高く
        </button>
        <button onClick={() => up(-1)} title="転回形を1つ下げます（端まで行くとオクターブ下へ）">
          ▼ 低く
        </button>
      </div>
      <div class="row wrap">
        <label>
          弾き方
          <select value={b.pattern} onChange={(e) => updateBlockAction(b.id, { pattern: (e.currentTarget as HTMLSelectElement).value as PatternKind })}>
            {PATTERNS.map((p) => (
              <option key={p.kind} value={p.kind}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          細かさ
          <select value={b.step} disabled={b.pattern === "sustain"} onChange={(e) => updateBlockAction(b.id, { step: Number((e.currentTarget as HTMLSelectElement).value) })}>
            <option value={960}>四分</option>
            <option value={480}>八分</option>
            <option value={240}>十六分</option>
          </select>
        </label>
        <label>
          強さ
          <input
            type="number"
            min={1}
            max={127}
            value={b.velocity}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              const v = Math.max(1, Math.min(127, Number((e.currentTarget as HTMLInputElement).value) || b.velocity));
              updateBlockAction(b.id, { velocity: v });
            }}
          />
        </label>
      </div>
      <div class="row wrap">
        <button onClick={() => void auditionBlock(b.id)}>▶ 試聴</button>
        <button onClick={() => dissolveBlockAction(b.id)} title="コード名を外し、音符をふつうの音符として残します">
          ブロックを解除
        </button>
        <button class="danger" onClick={() => deleteBlockAction(b.id)}>
          削除
        </button>
      </div>
      {!bar && <p class="small">ブロックの音符は通常の音符です。ピアノロールで1音ずつ直せます。直したブロックは「✎」が付き、上の設定を変えるときに確認します。</p>}
    </div>
  );
}
