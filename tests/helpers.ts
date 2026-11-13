import { Song, Note, newId } from "../src/model/types";

export function note(pitch: number, start: number, length: number, velocity = 100): Note {
  return { id: newId(), pitch, start, length, velocity };
}

export function songWith(notes: Note[], extra: Partial<Song> = {}): Song {
  return {
    tempo: 120,
    timeSig: { numerator: 4, denominator: 4 },
    tracks: [{ id: 1000, name: "メロディー", kind: "melodic", program: 0, volume: 100, notes }],
    ...extra,
  };
}

/** 音符の比較用（IDを除く） */
export function shape(notes: readonly Note[]) {
  return notes.map((n) => ({ pitch: n.pitch, start: n.start, length: n.length, velocity: n.velocity }));
}
