import { useEffect, useState } from "preact/hooks";
import { engine } from "../audio/engine";
import { BASE_VALUES, beatLength } from "../model/time";
import { raiseVoicing } from "../model/chordBlocks";
import { keyLabel, maxInversion } from "../theory/theory";
import { AppState, getState, isDirty, setState, toast, useAppState } from "./store";
import { TopBar, InputBar } from "./Toolbar";
import { Arrange } from "./Arrange";
import { PianoRoll, dragState } from "./PianoRoll";
import { SidePanel } from "./SidePanel";
import { BlockInfo, ChordLane, ChordPalette } from "./ChordLane";
import { Dialogs } from "./Dialogs";
import { Splitter } from "./layout";
import {
  activeTrack,
  copyAction,
  currentGrid,
  deleteBlockAction,
  deleteSelectionOrRange,
  findBlock,
  goToEnd,
  loopShortcut,
  moveBlockAction,
  quantizeSelection,
  resizeSelection,
  updateBlockAction,
  duplicateAction,
  nudgeSelection,
  pasteAction,
  redoAction,
  selectAll,
  setPlayhead,
  stopPlayback,
  togglePlay,
  undoAction,
  updateSettings,
} from "./actions";
import { openDroppedFile, openProject, saveProject } from "./fileActions";

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  if (tag === "TEXTAREA" || t.isContentEditable) return true;
  if (tag === "INPUT") {
    const type = (t as HTMLInputElement).type;
    return type === "text" || type === "number" || type === "search";
  }
  return false;
}

function onKeyDown(e: KeyboardEvent) {
  const s = getState();
  // Alt 単独で Chrome のメニューにフォーカスが移らないようにする（Alt は吸着の一時解除に使う）
  if (e.key === "Alt") {
    e.preventDefault();
    return;
  }
  if (s.dialog) {
    if (e.key === "Escape") setState({ dialog: null });
    return;
  }
  if (isTyping(e)) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  const handled = () => e.preventDefault();

  if (ctrl) {
    if (k === "z" && !e.shiftKey) return handled(), undoAction();
    if ((k === "z" && e.shiftKey) || k === "y") return handled(), redoAction();
    if (k === "c") return handled(), copyAction();
    if (k === "v") return handled(), pasteAction();
    if (k === "d") return handled(), duplicateAction();
    if (k === "a") return handled(), selectAll();
    if (k === "l") return handled(), loopShortcut();
    if (k === "s") return handled(), void saveProject(e.shiftKey);
    if (k === "o") return handled(), openProject();
    return;
  }
  if (e.key === " ") return handled(), void togglePlay();
  if (e.key === "Home") return handled(), setPlayhead(0);
  if (e.key === "End") return handled(), goToEnd();
  if (k === "q") return handled(), quantizeSelection();
  if (e.key === "Escape") {
    if (dragState.active) return dragState.cancel();
    if (s.playing === "audition") return stopPlayback();
    setState({ selection: new Set(), selectedBlockId: null, paletteChord: null });
    return;
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    handled();
    // 音符を選んでいなければ、選んでいるコードブロックを消す
    if (s.selection.size === 0 && s.selectedBlockId !== null) return deleteBlockAction(s.selectedBlockId);
    return deleteSelectionOrRange();
  }
  if (/^[1-6]$/.test(e.key)) return updateSettings({ inputBase: BASE_VALUES[Number(e.key) - 1].key });
  if (e.key === ".") return updateSettings({ inputMod: s.settings.inputMod === "dotted" ? "none" : "dotted" });
  if (k === "t") return updateSettings({ inputMod: s.settings.inputMod === "triplet" ? "none" : "triplet" });
  // 音符を選んでいなくてコードブロックを選んでいるときは、矢印キーでブロックを操作する
  const block = s.selection.size === 0 ? findBlock(s, s.selectedBlockId) : null;
  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    handled();
    const dir = e.key === "ArrowUp" ? 1 : -1;
    if (block) {
      const b = block.block;
      // ↑↓ = 高く／低く（転回形）、Shift+↑↓ = 1オクターブ
      if (e.shiftKey) {
        const octave = b.octave + dir;
        if (octave >= 0 && octave <= 7) updateBlockAction(b.id, { octave });
      } else updateBlockAction(b.id, raiseVoicing(b, dir, maxInversion(b.type)));
      return;
    }
    const t = activeTrack(s);
    if (t?.kind === "drum") return;
    return nudgeSelection(0, dir * (e.shiftKey ? 12 : 1));
  }
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    handled();
    const dir = e.key === "ArrowLeft" ? -1 : 1;
    if (e.shiftKey) {
      // Shift+←→: 長さを変える（コードブロックは1拍ずつ）
      if (block) {
        const b = block.block;
        const len = b.length + dir * beatLength(s.song.timeSig);
        if (len >= beatLength(s.song.timeSig)) updateBlockAction(b.id, { length: len });
        return;
      }
      return resizeSelection(dir);
    }
    if (block) return moveBlockAction(block.block.id, dir * beatLength(s.song.timeSig));
    const g = currentGrid(false, s) ?? 60;
    return nudgeSelection(dir * g, 0);
  }
}

/** ファイルのドラッグ＆ドロップ: 画面のどこにドロップしても、そのファイルを開く */
function useFileDrop(): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setOver(true);
    };
    const dragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // 既定の動作（ブラウザがファイルを表示して、アプリから離れてしまう）を止める
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      const dt = e.dataTransfer!;
      const file = dt.files[0];
      if (!file) return;
      if (dt.files.length > 1) toast("複数のファイルがドロップされたため、最初の1つだけを開きます");
      // Chromium ではファイルの「ハンドル」も取れるので、開いたプロジェクトへそのまま上書き保存できる
      const item = Array.from(dt.items).find((i) => i.kind === "file") as
        | (DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> })
        | undefined;
      const handlePromise = item?.getAsFileSystemHandle ? item.getAsFileSystemHandle() : Promise.resolve(null);
      void handlePromise
        .catch(() => null)
        .then((h) => openDroppedFile(file, h && h.kind === "file" ? (h as FileSystemFileHandle) : null));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", dragOver);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", dragOver);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);
  return over;
}

export function App() {
  const s: AppState = useAppState();
  const fileOver = useFileDrop();

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    const unsub = engine.subscribe((st) => setState({ audioMessage: st.message, audioState: st.state }));
    // ブラウザの自動再生の制限のため、最初の操作で音声を有効にする
    const start = () => void engine.ensureStarted();
    window.addEventListener("pointerdown", start, { once: true });
    // 入力欄や選択欄にフォーカスが残っていると矢印キーなどがそちらへ行くので、
    // ピアノロールや帯など、入力欄以外をクリックしたらフォーカスを外す
    const releaseFocus = (e: PointerEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const target = e.target as HTMLElement | null;
      if (!el || !target || el === document.body) return;
      if (target.closest("input, select, textarea, button, label")) return;
      if (el.matches("input, select, textarea")) el.blur();
    };
    window.addEventListener("pointerdown", releaseFocus, true);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty(getState())) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("pointerdown", releaseFocus, true);
      unsub();
    };
  }, []);

  useEffect(() => {
    document.title = `${isDirty(s) ? "● " : ""}${s.fileName} — MIDI作曲エディター`;
  }, [s.fileName, s.song, s.savedSong, s.settingsDirty]);

  const t = activeTrack(s);
  return (
    <div class="app">
      <TopBar s={s} />
      <InputBar s={s} />
      <div class="workspace">
        <div class="editor">
          <Arrange s={s} />
          <Splitter dir="y" target="arrangeH" title="ドラッグでトラック一覧・全体表示の高さを変える（ダブルクリックで元の高さ）" />
          <div class="roll-head">
            <b>{t ? t.name : ""}</b>
            {t?.kind === "drum" ? (
              <span class="sub">ドラム表示（楽器名で入力）</span>
            ) : (
              <span class="mode-switch" role="tablist">
                <button class={s.editorMode === "roll" ? "on" : ""} onClick={() => setState({ editorMode: "roll" })} title="音符を1つずつ編集します">
                  ピアノロール
                </button>
                <button
                  class={s.editorMode === "chord" ? "on" : ""}
                  onClick={() => setState({ editorMode: "chord" })}
                  title="コードをドラッグして置き、ブロックとして並べ替えます"
                >
                  コードブロック
                </button>
              </span>
            )}
            {t?.kind !== "drum" && s.settings.showScale && (
              <span class="legend">
                {keyLabel(s.settings.key)}: <span class="swatch sw-scale">スケールの音</span>
                <span class="swatch sw-tonic">主音</span>
                <span class="swatch sw-out">スケール外</span>
                {s.settings.scaleLock && <b class="lock">スケール音のみモード中</b>}
              </span>
            )}
          </div>
          {t?.kind !== "drum" && s.editorMode === "chord" && (
            <>
              <ChordPalette s={s} />
              <Splitter dir="y" target="paletteH" title="ドラッグでコードの一覧の高さを変える（ダブルクリックで元の高さ）" />
            </>
          )}
          <ChordLane s={s} editable={s.editorMode === "chord"} />
          {t?.kind !== "drum" && s.editorMode === "chord" && <BlockInfo s={s} bar />}
          <PianoRoll s={s} />
        </div>
        <SidePanel s={s} />
      </div>
      <footer class="hintbar">
        クリック=音符を置く ／ ドラッグ=まとめて選ぶ ／ 音符をドラッグ=移動（Ctrlでコピー） ／ 右端をドラッグ=長さ ／ 右クリック=消す ／ Altを押しながら=吸着を一時解除 ／ Space=再生
        <button class="link" onClick={() => setState({ dialog: { kind: "help" } })}>
          操作の一覧
        </button>
      </footer>
      {s.toast && <div class="toast">{s.toast.text}</div>}
      {fileOver && (
        <div class="file-drop">
          <div>
            ここにドロップすると開きます
            <small>プロジェクト（.mcproj.json）／MIDI（.mid・.midi）</small>
          </div>
        </div>
      )}
      <Dialogs s={s} />
    </div>
  );
}
