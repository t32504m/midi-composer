// ファイルの保存・読み込み。Chromium の File System Access API を使う（2回目以降は同じファイルへ上書き保存）。
// 使えない環境では、ダウンロードとファイル選択で代替する。
import { PROJECT_EXTENSION, parseProject, serializeProject } from "../io/project";
import { writeSmf } from "../midi/smfWriter";
import { importMidi } from "../midi/importMidi";
import { emptyHistory } from "../model/history";
import { AppState, getState, initialSong, isDirty, setState, toast } from "./store";
import { stopPlayback } from "./actions";
import { defaultSettings } from "../io/project";

type Picker = {
  showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (o: unknown) => Promise<FileSystemFileHandle[]>;
};
const w = window as unknown as Picker;

const PROJECT_TYPES = [{ description: "作曲プロジェクト", accept: { "application/json": [".json"] } }];
const MIDI_TYPES = [{ description: "標準MIDIファイル", accept: { "audio/midi": [".mid", ".midi"] } }];

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

function baseName(name: string): string {
  return name.replace(/\.mcproj\.json$/i, "").replace(/\.json$/i, "").replace(/\.midi?$/i, "");
}

async function writeHandle(handle: FileSystemFileHandle, data: string | Uint8Array) {
  const ws = await handle.createWritable();
  await ws.write(typeof data === "string" ? data : new Blob([data as BlobPart]));
  await ws.close();
}

function download(name: string, data: string | Uint8Array, type: string) {
  const blob = new Blob([typeof data === "string" ? data : (data as BlobPart)], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function projectText(s: AppState): string {
  return serializeProject({ song: s.song, mixer: s.mixer, settings: s.settings });
}

function markSaved(name: string, handle: FileSystemFileHandle | null) {
  const s = getState();
  setState({ savedSong: s.song, settingsDirty: false, fileName: name, fileHandle: handle });
}

/** 上書き保存。初回は保存場所を選ぶ。保存できたら true */
export async function saveProject(saveAs = false): Promise<boolean> {
  const s = getState();
  const text = projectText(s);
  try {
    if (!w.showSaveFilePicker) {
      download(`${s.fileName}${PROJECT_EXTENSION}`, text, "application/json");
      markSaved(s.fileName, null);
      toast("プロジェクトをダウンロードしました");
      return true;
    }
    let handle = saveAs ? null : s.fileHandle;
    if (!handle) handle = await w.showSaveFilePicker({ suggestedName: `${s.fileName}${PROJECT_EXTENSION}`, types: PROJECT_TYPES });
    await writeHandle(handle, text);
    markSaved(baseName(handle.name), handle);
    toast(`保存しました（${handle.name}）`);
    return true;
  } catch (e) {
    if (isAbort(e)) return false;
    setState({ dialog: { kind: "message", title: "保存できませんでした", lines: [String(e instanceof Error ? e.message : e), "編集中の曲はそのままです。"] } });
    return false;
  }
}

/**
 * 未保存の変更があれば、保存するか確認してから action を実行する。
 * needsPicker: action がファイル選択画面を開く場合。ブラウザは「クリック直後」でないと選択画面を開けないので、
 * 保存の後にもう一度ボタンを押してもらってから action を実行する。
 */
function guardUnsaved(actionLabel: string, action: () => void, needsPicker = false) {
  const s = getState();
  if (!isDirty(s)) return action();
  setState({
    dialog: {
      kind: "unsaved",
      action: actionLabel,
      onSave: () => {
        setState({ dialog: null });
        void saveProject().then((ok) => {
          if (!ok) return;
          if (!needsPicker) return action();
          setState({
            dialog: {
              kind: "confirm",
              title: "保存しました",
              lines: ["続けて、開くファイルを選んでください。"],
              okLabel: "ファイルを選ぶ",
              onOk: () => {
                setState({ dialog: null });
                action();
              },
            },
          });
        });
      },
      onDiscard: () => {
        setState({ dialog: null });
        action();
      },
    },
  });
}

function pickerErrorLines(e: unknown): string[] {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "SecurityError" || name === "NotAllowedError")
    return ["ブラウザがファイル選択画面を開けませんでした。もう一度「開く」を押してください。", "ファイルを画面にドラッグ＆ドロップしても開けます。", "編集中の曲はそのままです。"];
  return [String(e instanceof Error ? e.message : e), "編集中の曲はそのままです。"];
}

async function pickFile(types: unknown, accept: string): Promise<{ name: string; handle: FileSystemFileHandle | null; file: File } | null> {
  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({ types, multiple: false });
      return { name: handle.name, handle, file: await handle.getFile() };
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, handle: null, file: f } : null);
    };
    input.click();
  });
}

/** プロジェクトファイルを読み込み、成功したときだけ今の曲と入れ替える */
async function loadProjectFile(file: File, handle: FileSystemFileHandle | null) {
  let text: string;
  try {
    text = await file.text();
  } catch (e) {
    setState({ dialog: { kind: "message", title: "開けませんでした", lines: ["ファイルを読めませんでした。", ...pickerErrorLines(e)] } });
    return;
  }
  const r = parseProject(text);
  if (!r.ok) {
    setState({ dialog: { kind: "message", title: "開けませんでした", lines: [r.message] } });
    return;
  }
  stopPlayback();
  const { song, mixer, settings } = r.data;
  setState({
    song,
    savedSong: song,
    history: emptyHistory(),
    settingsDirty: false,
    mixer,
    settings,
    activeTrackId: song.tracks[0]?.id ?? -1,
    selection: new Set(),
    selectedBlockId: null,
    range: null,
    playhead: 0,
    scrollX: 0,
    fileName: baseName(file.name),
    fileHandle: handle && file.name.toLowerCase().endsWith(".json") ? handle : null,
  });
  toast(`開きました（${file.name}）`);
}

export function openProject() {
  guardUnsaved(
    "開く",
    async () => {
      let picked;
      try {
        picked = await pickFile(PROJECT_TYPES, ".json");
      } catch (e) {
        setState({ dialog: { kind: "message", title: "開けませんでした", lines: pickerErrorLines(e) } });
        return;
      }
      if (picked) await loadProjectFile(picked.file, picked.handle);
    },
    true,
  );
}

export function newProject() {
  guardUnsaved("新しい曲を作る", () => {
    stopPlayback();
    const { song, activeTrackId } = initialSong();
    setState({
      song,
      savedSong: song,
      history: emptyHistory(),
      settingsDirty: false,
      mixer: {},
      settings: defaultSettings(),
      activeTrackId,
      selection: new Set(),
      range: null,
      playhead: 0,
      scrollX: 0,
      fileName: "曲1",
      fileHandle: null,
    });
  });
}

export async function exportMidi() {
  const s = getState();
  const bytes = writeSmf(s.song, s.fileName);
  try {
    if (w.showSaveFilePicker) {
      const h = await w.showSaveFilePicker({ suggestedName: `${s.fileName}.mid`, types: MIDI_TYPES });
      await writeHandle(h, bytes);
    } else download(`${s.fileName}.mid`, bytes, "audio/midi");
  } catch (e) {
    if (isAbort(e)) return;
    setState({ dialog: { kind: "message", title: "書き出せませんでした", lines: [String(e)] } });
    return;
  }
  const muted = s.song.tracks.filter((t) => s.mixer[t.id]?.mute || (s.song.tracks.some((x) => s.mixer[x.id]?.solo) && !s.mixer[t.id]?.solo));
  setState({
    dialog: {
      kind: "message",
      title: "MIDIファイルを書き出しました",
      lines: [
        `${s.song.tracks.length}トラックを書き出しました${muted.length ? `（ミュート中・ソロ以外のトラックも含みます）` : ""}。`,
        "MIDIには音そのものは入っていません。別のソフトでは音色が変わることがあります。",
        "トラック名は UTF-8 で書き込みます。古いソフトでは日本語の名前が文字化けすることがあります。",
      ],
    },
  });
}

/** MIDIファイルを読み込み、新しい曲として開く */
async function loadMidiFile(file: File) {
  let rep;
  try {
    rep = importMidi(await file.arrayBuffer());
  } catch (e) {
    setState({
      dialog: { kind: "message", title: "読み込めませんでした", lines: ["MIDIファイルとして読めませんでした。編集中の曲はそのままです。", String(e)] },
    });
    return;
  }
  if (rep.song.tracks.length === 0) {
    setState({ dialog: { kind: "message", title: "読み込めませんでした", lines: ["音符が見つかりませんでした。編集中の曲はそのままです。"] } });
    return;
  }
  stopPlayback();
  setState({
    song: rep.song,
    savedSong: null,
    history: emptyHistory(),
    settingsDirty: false,
    mixer: {},
    settings: defaultSettings(),
    activeTrackId: rep.song.tracks[0].id,
    selection: new Set(),
    selectedBlockId: null,
    range: null,
    playhead: 0,
    scrollX: 0,
    fileName: baseName(file.name),
    fileHandle: null,
  });
  const lines = [`${rep.song.tracks.length}トラックを読み込みました（新しい曲として開いています。保存するとプロジェクトになります）。`];
  if (rep.dropped.length) lines.push("読み込まなかった情報: " + rep.dropped.map((d) => `${d.label} ${d.count}件`).join("、"));
  if (rep.roundedNotes) lines.push(`分解能の違いで、${rep.roundedNotes}音の位置・長さを最も近い位置に合わせました。`);
  lines.push(...rep.warnings);
  lines.push("タイミングの自動整列やスケールへの補正はしていません。");
  setState({ dialog: { kind: "message", title: "MIDIを読み込みました", lines } });
}

export function importMidiFile() {
  guardUnsaved(
    "MIDIを読み込む",
    async () => {
      let picked;
      try {
        picked = await pickFile(MIDI_TYPES, ".mid,.midi");
      } catch (e) {
        setState({ dialog: { kind: "message", title: "読み込めませんでした", lines: pickerErrorLines(e) } });
        return;
      }
      if (picked) await loadMidiFile(picked.file);
    },
    true,
  );
}

/** ファイルの種類を、拡張子（なければ先頭の数バイト）で判定する */
async function detectKind(file: File): Promise<"project" | "midi" | null> {
  const n = file.name.toLowerCase();
  if (n.endsWith(".mid") || n.endsWith(".midi")) return "midi";
  if (n.endsWith(".json")) return "project";
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (String.fromCharCode(...head) === "MThd") return "midi";
  if (head[0] === 0x7b) return "project"; // "{"
  return null;
}

/** 画面にドロップされたファイルを開く（プロジェクト .json と MIDI .mid / .midi） */
export async function openDroppedFile(file: File, handle: FileSystemFileHandle | null) {
  const kind = await detectKind(file);
  if (!kind) {
    setState({
      dialog: {
        kind: "message",
        title: "このファイルは開けません",
        lines: [`「${file.name}」は対応していない種類のファイルです。`, "開けるのは、プロジェクト（.mcproj.json）と MIDI（.mid / .midi）です。"],
      },
    });
    return;
  }
  guardUnsaved(kind === "project" ? "開く" : "MIDIを読み込む", () => {
    void (kind === "project" ? loadProjectFile(file, handle) : loadMidiFile(file));
  });
}
