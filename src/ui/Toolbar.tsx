// ①上部バーと②入力バー
import { useState } from "preact/hooks";
import { TIME_SIGNATURES } from "../model/types";
import { BASE_VALUES, BaseValue, barLength, lengthLabel, tsLabel } from "../model/time";
import { TimeSignature } from "../model/types";
import { SNAP_OPTIONS, SnapKey } from "../model/snap";
import { setTempo } from "../model/edit";
import { engine } from "../audio/engine";
import { AppState, getState, isDirty, setState } from "./store";
import { commit, currentGrid, redoAction, snapGrid, requestTimeSig, setLoopEnabled, stopPlayback, togglePlay, undoAction, updateSettings } from "./actions";
import { PITCH_CLASS_NAMES } from "../model/pitch";
import { exportMidi, importMidiFile, newProject, openProject, saveProject } from "./fileActions";

export function TopBar({ s }: { s: AppState }) {
  const [menu, setMenu] = useState(false);
  const [tempoDraft, setTempoDraft] = useState<string | null>(null);
  const dirty = isDirty(s);
  const loopReady = !!s.settings.loop || !!s.range;
  const run = (fn: () => void) => () => {
    setMenu(false);
    fn();
  };
  const commitTempo = () => {
    if (tempoDraft === null) return;
    const v = Number(tempoDraft);
    if (Number.isFinite(v) && v > 0) commit(setTempo(getState().song, v));
    setTempoDraft(null);
  };
  return (
    <header class="topbar">
      <div class="menu-wrap">
        <button class="menu-btn" onClick={() => setMenu(!menu)} aria-expanded={menu}>
          ファイル ▾
        </button>
        {menu && (
          <div class="menu" onMouseLeave={() => setMenu(false)}>
            <button onClick={run(newProject)}>新しい曲</button>
            <button onClick={run(openProject)}>開く…<kbd>Ctrl+O</kbd></button>
            <button onClick={run(() => void saveProject())}>上書き保存<kbd>Ctrl+S</kbd></button>
            <button onClick={run(() => void saveProject(true))}>名前を付けて保存…<kbd>Ctrl+Shift+S</kbd></button>
            <hr />
            <button onClick={run(() => void exportMidi())}>MIDI書き出し…</button>
            <button onClick={run(importMidiFile)}>MIDIを読み込む…</button>
            <hr />
            <button onClick={run(() => setState({ dialog: { kind: "help" } }))}>操作の一覧</button>
          </div>
        )}
      </div>
      <div class="title">
        {s.fileName}
        {dirty ? <span class="unsaved">●未保存</span> : <span class="saved">保存済み</span>}
      </div>
      <div class="group">
        <button class={`play${s.playing === "song" ? " on" : ""}`} onClick={() => void togglePlay()} title="再生／停止（Space）">
          {s.playing === "song" ? "■ 停止" : "▶ 再生"}
        </button>
        <label
          class={`toggle${s.settings.loopEnabled ? " on" : ""}`}
          title={loopReady ? "選んだ範囲（範囲がなければ前回のループ範囲）を繰り返し再生します" : "全体表示で範囲を選ぶと使えます"}
        >
          <input
            type="checkbox"
            checked={s.settings.loopEnabled}
            disabled={!loopReady}
            onChange={(e) => setLoopEnabled((e.currentTarget as HTMLInputElement).checked)}
          />
          ⟲ループ
          {s.settings.loopEnabled && s.settings.loop && <small>{loopLabel(s.settings.loop, s.song.timeSig)}</small>}
        </label>
      </div>
      <div class="group">
        <label title="テンポを変えると速さだけが変わります。音符の位置は変わりません。">
          テンポ
          <input
            type="number"
            class="tempo"
            min={20}
            max={300}
            value={tempoDraft ?? String(s.song.tempo)}
            onInput={(e) => setTempoDraft((e.currentTarget as HTMLInputElement).value)}
            onBlur={commitTempo}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTempo();
              e.stopPropagation();
            }}
          />
          <small>速さだけ変わります</small>
        </label>
        <label title="拍子を変えると、音符は小節・拍の位置を保って並べ直されます（変更前に確認します）">
          拍子
          <select
            value={tsLabel(s.song.timeSig)}
            onChange={(e) => {
              const v = (e.currentTarget as HTMLSelectElement).value;
              const ts = TIME_SIGNATURES.find((t) => tsLabel(t) === v);
              (e.currentTarget as HTMLSelectElement).value = tsLabel(getState().song.timeSig);
              if (ts) requestTimeSig(ts);
            }}
          >
            {TIME_SIGNATURES.map((t) => (
              <option key={tsLabel(t)} value={tsLabel(t)}>
                {tsLabel(t)}
              </option>
            ))}
          </select>
        </label>
        <label class={`toggle${s.metronome ? " on" : ""}`}>
          <input type="checkbox" checked={s.metronome} onChange={(e) => setState({ metronome: (e.currentTarget as HTMLInputElement).checked })} />
          メトロノーム
        </label>
      </div>
      <div class={`audio-status ${s.audioState}`}>
        {s.audioMessage}
        {s.audioState === "error" && <button onClick={() => void engine.ensureStarted()}>再試行</button>}
        {s.audioState === "off" && <button onClick={() => void engine.ensureStarted()}>音を有効にする</button>}
      </div>
    </header>
  );
}

export function InputBar({ s }: { s: AppState }) {
  const st = s.settings;
  return (
    <div class="inputbar">
      <div class="group" title="これから置く音符の長さ。変えても、置いた音符は変わりません。">
        <span class="label">音の長さ</span>
        {BASE_VALUES.map((v, i) => (
          <button
            key={v.key}
            class={`seg${st.inputBase === v.key ? " on" : ""}`}
            onClick={() => updateSettings({ inputBase: v.key as BaseValue })}
            title={`${v.label}（キー ${i + 1}）`}
          >
            {v.short}
          </button>
        ))}
        <button
          class={`seg${st.inputMod === "dotted" ? " on" : ""}`}
          onClick={() => updateSettings({ inputMod: st.inputMod === "dotted" ? "none" : "dotted" })}
          title="付点: 長さを1.5倍にします（キー .）"
        >
          付点
        </button>
        <button
          class={`seg${st.inputMod === "triplet" ? " on" : ""}`}
          onClick={() => updateSettings({ inputMod: st.inputMod === "triplet" ? "none" : "triplet" })}
          title="三連: 3つで元の音符2つ分の長さです（キー T）"
        >
          三連
        </button>
      </div>
      <div class="group" title="音符を置く・動かす・伸ばすときに合わせる間隔（スナップ）。変えても、置いた音符は動きません。Alt を押している間は一時的に解除します。">
        <span class="label">吸着</span>
        <select value={st.snapKey} onChange={(e) => updateSettings({ snapKey: (e.currentTarget as HTMLSelectElement).value as SnapKey })}>
          {SNAP_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <button class={`seg${st.snapEnabled ? " on" : ""}`} onClick={() => updateSettings({ snapEnabled: !st.snapEnabled })}>
          {st.snapEnabled ? "ON" : "OFF"}
        </button>
        {(() => {
          const g = snapGrid(false, s);
          const fine = currentGrid(false, s);
          return g && fine && fine < g ? (
            <small class="hint fine">入力が短いため、{lengthLabel(fine).replace(/音符$/, "")}ごとに置けます</small>
          ) : (
            <small class="hint">これから置く・動かす音符に使います</small>
          );
        })()}
      </div>
      <div class="group" title="スケールの目安。表示とスケール音のみモードは、置いた音符を変えません。">
        <span class="label">スケール</span>
        <select
          value={st.key.tonic}
          onChange={(e) => {
            if (getState().playing === "audition") stopPlayback();
            updateSettings({ key: { ...st.key, tonic: Number((e.currentTarget as HTMLSelectElement).value) } });
          }}
        >
          {PITCH_CLASS_NAMES.map((n, i) => (
            <option key={n} value={i}>
              {n}
            </option>
          ))}
        </select>
        <select
          value={st.key.mode}
          onChange={(e) => {
            if (getState().playing === "audition") stopPlayback();
            updateSettings({ key: { ...st.key, mode: (e.currentTarget as HTMLSelectElement).value as "major" | "minor" } });
          }}
        >
          <option value="major">メジャー</option>
          <option value="minor">マイナー</option>
        </select>
        <label class={`toggle${st.showScale ? " on" : ""}`} title="ピアノロールの背景に、スケールの音（水色）・主音（オレンジ）・スケール外（灰色）を表示します">
          <input type="checkbox" checked={st.showScale} onChange={(e) => updateSettings({ showScale: (e.currentTarget as HTMLInputElement).checked })} />
          表示
        </label>
        <label
          class={`toggle${st.scaleLock ? " on" : ""}`}
          title="オンにすると、新しく置く音と上下に動かす音をスケールの音に限ります。置いてある音符は変わりません。ドラムには影響しません。"
        >
          <input
            type="checkbox"
            checked={st.scaleLock}
            onChange={(e) => {
              const on = (e.currentTarget as HTMLInputElement).checked;
              updateSettings({ scaleLock: on, showScale: on ? true : st.showScale });
            }}
          />
          スケール音のみ
        </label>
      </div>
      <div class="group">
        <button onClick={undoAction} disabled={s.history.past.length === 0} title="取り消し（Ctrl+Z）">
          ↶ 取り消し
        </button>
        <button onClick={redoAction} disabled={s.history.future.length === 0} title="やり直し（Ctrl+Y）">
          ↷ やり直し
        </button>
      </div>
      <div class="group">
        <label class="toggle" title="編集中でないトラックの音符を薄く表示します">
          <input type="checkbox" checked={s.showOtherTracks} onChange={(e) => setState({ showOtherTracks: (e.currentTarget as HTMLInputElement).checked })} />
          他のトラックを薄く表示
        </label>
        <span class="label">縦</span>
        <button onClick={() => setState({ rowH: Math.max(8, s.rowH - 2) })} title="縦方向に縮小">
          －
        </button>
        <button onClick={() => setState({ rowH: Math.min(28, s.rowH + 2) })} title="縦方向に拡大">
          ＋
        </button>
        <span class="label">横</span>
        <button onClick={() => setState({ zoomX: Math.max(12, s.zoomX / 1.25) })} title="横方向に縮小（Ctrl+ホイール）">
          －
        </button>
        <button onClick={() => setState({ zoomX: Math.min(480, s.zoomX * 1.25) })} title="横方向に拡大（Ctrl+ホイール）">
          ＋
        </button>
      </div>
    </div>
  );
}

/** ループ範囲の短い表示（例: 2〜3小節） */
function loopLabel(loop: { start: number; end: number }, ts: TimeSignature): string {
  const bl = barLength(ts);
  const a = loop.start / bl + 1;
  const b = loop.end / bl;
  if (Number.isInteger(a) && Number.isInteger(b)) return a === b ? `${a}小節` : `${a}〜${b}小節`;
  return "範囲";
}
