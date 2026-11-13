// MIDI書き出しの検証（AC-13）。書き出しはアプリ独自の実装、読み取りは別の実装
// （@tonejs/midi と spessasynth_core）で行い、内容が一致するか確かめる。
import { describe, expect, it } from "vitest";
import { Midi } from "@tonejs/midi";
import { BasicMIDI } from "spessasynth_core";
import { writeSmf } from "../src/midi/smfWriter";
import { importMidi } from "../src/midi/importMidi";
import { resolveOverlaps } from "../src/model/overlap";
import { Song } from "../src/model/types";
import { note } from "./helpers";

function sample(): Song {
  return {
    tempo: 96,
    timeSig: { numerator: 3, denominator: 4 },
    tracks: [
      {
        id: 1,
        name: "メロディー",
        kind: "melodic",
        program: 80,
        volume: 110,
        notes: [note(72, 0, 960, 100), note(74, 960, 480, 90), note(76, 1440, 1440, 70), note(72, 2880, 1)],
      },
      {
        id: 2,
        name: "伴奏",
        kind: "melodic",
        program: 0,
        volume: 90,
        // 同じ音高の重なり: 60 0〜1920 と 60 1440〜1920
        notes: [note(60, 0, 1920, 80), note(64, 0, 1920, 80), note(60, 1440, 480, 85)],
      },
      {
        id: 3,
        name: "ドラム",
        kind: "drum",
        program: 0,
        volume: 100,
        notes: [note(36, 0, 240, 120), note(38, 960, 240, 110), note(42, 480, 240, 60)],
      },
    ],
  };
}

describe("MIDI書き出し（AC-13）", () => {
  it("@tonejs/midi で読むと、音高・位置・長さ・強さ・テンポ・拍子・名前・音色・チャンネルが一致する", () => {
    const song = sample();
    const bytes = writeSmf(song, "テスト曲");
    const midi = new Midi(bytes);
    expect(midi.header.ppq).toBe(960);
    expect(midi.header.tempos[0].bpm).toBeCloseTo(96, 3);
    expect(midi.header.timeSignatures[0].timeSignature).toEqual([3, 4]);
    expect(midi.tracks).toHaveLength(3);

    const expectedChannels = [0, 1, 9];
    song.tracks.forEach((t, i) => {
      const mt = midi.tracks[i];
      expect(mt.channel).toBe(expectedChannels[i]);
      if (t.kind !== "drum") expect(mt.instrument.number).toBe(t.program);
      expect(Math.round(mt.controlChanges[7][0].value * 127)).toBe(t.volume);
      const expected = resolveOverlaps(t.notes).map((n) => [n.pitch, n.start, n.end - n.start, n.velocity]);
      const got = mt.notes
        .map((n) => [n.midi, n.ticks, n.durationTicks, Math.round(n.velocity * 127)])
        .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      expect(got).toEqual(expected);
    });
  });

  it("spessasynth_core でも読める（独立した読み取り手段 2）", () => {
    const bytes = writeSmf(sample());
    const midi = BasicMIDI.fromArrayBuffer(bytes.buffer as ArrayBuffer);
    expect(midi.timeDivision).toBe(960);
    expect(midi.tracks.length).toBe(4);
    // 1トラック目（メロディー）のノートオン数
    const noteOns = midi.tracks[1].events.filter((e) => (e.statusByte & 0xf0) === 0x90);
    expect(noteOns).toHaveLength(4);
  });

  it("ミュート・ソロに関係なく全トラックを書き出す", () => {
    // writeSmf はミュート情報を受け取らない設計。トラック数が一致することを確認
    expect(new Midi(writeSmf(sample())).tracks).toHaveLength(3);
  });
});

describe("MIDI読み込み", () => {
  it("書き出したファイルを読み込むと、トラック・音符・テンポ・拍子が戻る", () => {
    const song = sample();
    const rep = importMidi(writeSmf(song));
    expect(rep.song.tempo).toBeCloseTo(96, 3);
    expect(rep.song.timeSig).toEqual({ numerator: 3, denominator: 4 });
    expect(rep.song.tracks.map((t) => [t.name, t.kind, t.program, t.volume])).toEqual([
      ["メロディー", "melodic", 80, 110],
      ["伴奏", "melodic", 0, 90],
      ["ドラム", "drum", 0, 100],
    ]);
    expect(rep.song.tracks[0].notes.map((n) => [n.pitch, n.start, n.length, n.velocity])).toEqual(
      song.tracks[0].notes.map((n) => [n.pitch, n.start, n.length, n.velocity]),
    );
    expect(rep.roundedNotes).toBe(0);
  });
});
