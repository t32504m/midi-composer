const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const SOLFEGE = ["ド", "ド#", "レ", "レ#", "ミ", "ファ", "ファ#", "ソ", "ソ#", "ラ", "ラ#", "シ"];

/** 中央のド（MIDI 60）を C4 とする表記 */
export function pitchName(pitch: number): string {
  return `${NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}

export function pitchLabel(pitch: number): string {
  return `${pitchName(pitch)}（${SOLFEGE[pitch % 12]}）`;
}

export function pitchClassName(pc: number): string {
  return NAMES[((pc % 12) + 12) % 12];
}

export function isBlackKey(pitch: number): boolean {
  return [1, 3, 6, 8, 10].includes(pitch % 12);
}

export const PITCH_CLASS_NAMES = NAMES;
