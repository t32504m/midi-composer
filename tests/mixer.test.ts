import { describe, expect, it } from "vitest";
import { audibleTrackIds } from "../src/model/mixer";
import { Song } from "../src/model/types";

const song: Song = {
  tempo: 120,
  timeSig: { numerator: 4, denominator: 4 },
  tracks: [1, 2, 3, 4].map((id) => ({ id, name: `t${id}`, kind: id === 4 ? "drum" : "melodic", program: 0, volume: 100, notes: [] })),
};

describe("ミュート・ソロ（AC-10）", () => {
  it("ソロがなければミュート以外を鳴らす", () => {
    expect([...audibleTrackIds(song, { 2: { mute: true, solo: false } })]).toEqual([1, 3, 4]);
  });
  it("ソロがあればソロのトラックだけを鳴らす", () => {
    expect([...audibleTrackIds(song, { 3: { mute: false, solo: true }, 4: { mute: true, solo: true } })]).toEqual([3, 4]);
  });
});
