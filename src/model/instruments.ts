import { Song } from "./types";

/** 初期の音色（GMの音色番号）。04_DESIGN.md §4 D-5 */
export const INSTRUMENTS: { program: number; name: string }[] = [
  { program: 0, name: "グランドピアノ" },
  { program: 4, name: "エレクトリックピアノ" },
  { program: 24, name: "ナイロンギター" },
  { program: 25, name: "スチールギター" },
  { program: 33, name: "フィンガーベース" },
  { program: 48, name: "ストリングス" },
  { program: 80, name: "シンセリード" },
  { program: 88, name: "シンセパッド" },
];

export function instrumentName(program: number): string {
  return INSTRUMENTS.find((i) => i.program === program)?.name ?? `GM音色 ${program + 1}番`;
}

/** ドラム表示の楽器（上から順）。括弧の数字はGMの音番号。 */
export const DRUM_LANES: { pitch: number; name: string }[] = [
  { pitch: 49, name: "クラッシュ" },
  { pitch: 51, name: "ライド" },
  { pitch: 46, name: "オープンハイハット" },
  { pitch: 44, name: "ペダルハイハット" },
  { pitch: 42, name: "クローズドハイハット" },
  { pitch: 50, name: "ハイタム" },
  { pitch: 47, name: "ミッドタム" },
  { pitch: 45, name: "ロータム" },
  { pitch: 39, name: "クラップ" },
  { pitch: 38, name: "スネア" },
  { pitch: 37, name: "サイドスティック" },
  { pitch: 36, name: "キック" },
];

export function drumName(pitch: number): string {
  return DRUM_LANES.find((l) => l.pitch === pitch)?.name ?? `その他（${pitch}）`;
}

/** ドラムの音符の長さ（十六分音符で固定） */
export const DRUM_NOTE_LENGTH = 240;

/** MIDIの10チャンネル（0始まりで9）はドラム */
export const DRUM_CHANNEL = 9;
const MELODIC_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];

/** トラックID → MIDIチャンネル（0始まり）。旋律トラックは並び順に、ドラムは9。 */
export function assignChannels(song: Song): Map<number, number> {
  const map = new Map<number, number>();
  let i = 0;
  for (const t of song.tracks) {
    if (t.kind === "drum") map.set(t.id, DRUM_CHANNEL);
    else if (i < MELODIC_CHANNELS.length) map.set(t.id, MELODIC_CHANNELS[i++]);
  }
  return map;
}
