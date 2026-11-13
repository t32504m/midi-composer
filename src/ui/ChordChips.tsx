// コードのボタン（チップ）。クリックで選んで試聴、ドラッグでコードの帯へ置ける。
import { PITCH_CLASS_NAMES } from "../model/pitch";
import {
  ChordType,
  FUNCTION_LABELS,
  FunctionShort,
  FunctionTag,
  chordName,
  diatonicChords,
  functionTag,
  keyLabel,
} from "../theory/theory";
import { AppState } from "./store";

/** ドラッグで運ぶデータの種類 */
export const CHORD_MIME = "application/x-midi-composer-chord";

type Chord = { root: number; type: ChordType };

export function ChordChip({
  chord,
  roman,
  sub,
  title,
  on,
  onPick,
}: {
  chord: Chord;
  roman?: string;
  sub?: string;
  title?: string;
  on: boolean;
  onPick: (c: Chord) => void;
}) {
  return (
    <button
      class={`chip-btn${on ? " on" : ""}`}
      draggable
      title={`${title ?? ""}${title ? "／" : ""}クリックで試聴、ドラッグでコードの帯に置けます`}
      onClick={() => onPick(chord)}
      onDragStart={(e) => {
        e.dataTransfer?.setData(CHORD_MIME, JSON.stringify(chord));
        e.dataTransfer?.setData("text/plain", chordName(chord));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
      }}
    >
      {roman && <span class="roman">{roman}</span>}
      <span>{chordName(chord)}</span>
      {sub && <span class="sub">{sub}</span>}
    </button>
  );
}

/** このキーのコードを働き（トニック・サブドミナント・ドミナント）ごとに並べる。あくまで目安。 */
export function FunctionGroups({ s, onPick, selected }: { s: AppState; onPick: (c: Chord) => void; selected: Chord | null }) {
  const key = s.settings.key;
  const dia = diatonicChords(key);
  const items: { roman: string; chord: Chord; tag: FunctionTag }[] = dia.map((d) => ({
    roman: d.roman,
    chord: d.chord,
    tag: functionTag(key, d.chord)!,
  }));
  if (key.mode === "minor") {
    // 短調でよく使う、第7音を上げた V（ナチュラルマイナーの外の音を含む）
    const v = { root: (key.tonic + 7) % 12, type: "maj" as ChordType };
    items.push({ roman: "V", chord: v, tag: functionTag(key, v)! });
  }
  const dom = dia[4].chord;
  return (
    <div class="fn-groups">
      <p class="small">{keyLabel(key)} のコードを、よくある働きごとに並べました（目安）。クリックで試聴、ドラッグでコードの帯に置けます。</p>
      {(["T", "SD", "D"] as FunctionShort[]).map((f) => (
        <div key={f} class="fn-row">
          <div class={`fn-head fn-${f}`}>
            <b>
              {f} {FUNCTION_LABELS[f].name}
            </b>
            <small>{FUNCTION_LABELS[f].feel}</small>
          </div>
          <div class="fn-chords">
            {items
              .filter((it) => it.tag.short === f)
              .map((it) => (
                <ChordChip
                  key={it.roman + it.chord.type}
                  chord={it.chord}
                  roman={it.roman}
                  sub={it.tag.label !== FUNCTION_LABELS[f].name ? it.tag.label.replace(FUNCTION_LABELS[f].name, "") : undefined}
                  title={it.tag.label}
                  on={!!selected && it.chord.root === selected.root && it.chord.type === selected.type}
                  onPick={onPick}
                />
              ))}
          </div>
        </div>
      ))}
      <p class="small">
        働きはキーで変わります。例: {chordName(dom)} は {keyLabel(key)} では{key.mode === "major" ? "ドミナント" : "弱めのドミナント"}ですが、
        {PITCH_CLASS_NAMES[dom.root]} {dom.type === "min" ? "マイナー" : "メジャー"}ではトニックです。前後のコードによっても変わります。
      </p>
    </div>
  );
}
