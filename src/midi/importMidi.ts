// MIDIファイルの読み込み（基本範囲）。04_DESIGN.md §3.9。
// 自動クオンタイズやスケールへの補正はしない。読み込まなかった情報は件数で知らせる。
import { Midi } from "@tonejs/midi";
import { PPQ, Song, TIME_SIGNATURES, Track, newId } from "../model/types";
import { DRUM_CHANNEL } from "../model/instruments";

export interface ImportReport {
  song: Song;
  dropped: { label: string; count: number }[];
  /** 分解能の違いで位置・長さを最も近い tick に合わせた音符の数 */
  roundedNotes: number;
  warnings: string[];
}

/** 書き出し側は UTF-8 で書くが、読み込みライブラリは1バイト文字として返すので直す */
function fixText(s: string): string {
  if (![...s].every((c) => c.charCodeAt(0) < 256)) return s;
  try {
    const bytes = Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return s;
  }
}

export function importMidi(data: ArrayBuffer | Uint8Array): ImportReport {
  const midi = new Midi(data instanceof Uint8Array ? data : new Uint8Array(data));
  const warnings: string[] = [];
  const dropped: { label: string; count: number }[] = [];
  const scale = PPQ / midi.header.ppq;
  let roundedNotes = 0;
  const conv = (t: number) => {
    const v = t * scale;
    return { v: Math.round(v), rounded: !Number.isInteger(v) };
  };

  const rawTempo = midi.header.tempos[0]?.bpm ?? 120;
  const tempo = Math.min(300, Math.max(20, rawTempo));
  if (tempo !== rawTempo) warnings.push(`テンポ ${Math.round(rawTempo)} は対応範囲（20〜300）の外のため、${Math.round(tempo)} にしました。`);
  if (midi.header.tempos.length > 1) dropped.push({ label: "途中のテンポ変更", count: midi.header.tempos.length - 1 });

  let timeSig = { numerator: 4, denominator: 4 };
  const ts0 = midi.header.timeSignatures[0]?.timeSignature;
  if (ts0) {
    const found = TIME_SIGNATURES.find((t) => t.numerator === ts0[0] && t.denominator === ts0[1]);
    if (found) timeSig = { ...found };
    else warnings.push(`拍子 ${ts0[0]}/${ts0[1]} には対応していないため、4/4 として表示します（音符の位置は変わりません）。`);
  }
  if (midi.header.timeSignatures.length > 1)
    dropped.push({ label: "途中の拍子変更", count: midi.header.timeSignatures.length - 1 });

  const tracks: Track[] = [];
  let pedal = 0;
  let otherCC = 0;
  let bends = 0;
  let skippedTracks = 0;
  let melodicCount = 0;
  let drumTrack: Track | null = null;

  for (const tr of midi.tracks) {
    for (const [num, list] of Object.entries(tr.controlChanges)) {
      const n = Number(num);
      if (n === 64) pedal += list.length;
      else if (n !== 7) otherCC += list.length;
    }
    bends += tr.pitchBends.length;
    if (tr.notes.length === 0) continue;
    const isDrum = tr.channel === DRUM_CHANNEL;
    const notes = tr.notes.map((n) => {
      const s = conv(n.ticks);
      const l = conv(n.durationTicks);
      if (s.rounded || l.rounded) roundedNotes++;
      return {
        id: newId(),
        pitch: n.midi,
        start: s.v,
        length: Math.max(1, l.v),
        velocity: Math.max(1, Math.min(127, Math.round(n.velocity * 127))),
      };
    });
    const volCC = tr.controlChanges[7]?.[0];
    const volume = volCC ? Math.round(volCC.value * 127) : 100;
    if (isDrum) {
      // ドラムトラックは1つまで。複数ある場合は1つにまとめる
      if (drumTrack) {
        drumTrack.notes.push(...notes);
        continue;
      }
      drumTrack = { id: newId(), name: fixText(tr.name) || "ドラム", kind: "drum", program: 0, volume, notes };
      tracks.push(drumTrack);
      continue;
    }
    if (melodicCount >= 15) {
      skippedTracks++;
      continue;
    }
    melodicCount++;
    tracks.push({
      id: newId(),
      name: fixText(tr.name) || `トラック${tracks.length + 1}`,
      kind: "melodic",
      program: tr.instrument.number,
      volume,
      notes,
    });
  }
  for (const t of tracks) t.notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);

  if (pedal) dropped.push({ label: "ペダル（サステイン）", count: pedal });
  if (bends) dropped.push({ label: "ピッチベンド", count: bends });
  if (otherCC) dropped.push({ label: "その他のコントロール情報", count: otherCC });
  if (skippedTracks) warnings.push(`旋律トラックが15を超えたため、${skippedTracks}トラックを読み込みませんでした。`);

  return { song: { tempo: Math.round(tempo * 100) / 100, timeSig, tracks }, dropped, roundedNotes, warnings };
}
