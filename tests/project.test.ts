import { describe, expect, it } from "vitest";
import { defaultSettings, parseProject, serializeProject } from "../src/io/project";
import { note, shape, songWith } from "./helpers";

describe("プロジェクトの保存と復元（AC-12・AC-17）", () => {
  it("保存して開き直すと、音符・トラック・音色・テンポ・拍子・ミュート・設定が戻る", () => {
    const song = songWith([note(60, 0, 960, 90), note(64, 960, 480, 70)], {
      tempo: 132,
      timeSig: { numerator: 6, denominator: 8 },
    });
    song.tracks[0].program = 48;
    song.tracks[0].volume = 77;
    const settings = { ...defaultSettings(), key: { tonic: 9, mode: "minor" as const }, snapKey: "eighth" as const };
    const text = serializeProject({ song, mixer: { 1000: { mute: true, solo: false } }, settings });
    const r = parseProject(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.song.tempo).toBe(132);
    expect(r.data.song.timeSig).toEqual({ numerator: 6, denominator: 8 });
    expect(r.data.song.tracks[0]).toMatchObject({ id: 1000, name: "メロディー", program: 48, volume: 77 });
    expect(shape(r.data.song.tracks[0].notes)).toEqual(shape(song.tracks[0].notes));
    expect(r.data.mixer[1000]).toEqual({ mute: true, solo: false });
    expect(r.data.settings.key).toEqual({ tonic: 9, mode: "minor" });
    expect(r.data.settings.snapKey).toBe("eighth");
  });

  it("壊れたファイルはエラーになる", () => {
    expect(parseProject("{ broken").ok).toBe(false);
    expect(parseProject(JSON.stringify({ hello: 1 })).ok).toBe(false);
    const good = JSON.parse(serializeProject({ song: songWith([note(60, 0, 960)]), mixer: {}, settings: defaultSettings() }));
    good.song.tracks[0].notes[0].pitch = 200;
    const r = parseProject(JSON.stringify(good));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("編集中の曲はそのまま");
  });

  it("新しい版のファイルは、版が新しいことを知らせる", () => {
    const doc = JSON.parse(serializeProject({ song: songWith([]), mixer: {}, settings: defaultSettings() }));
    doc.version = 99;
    const r = parseProject(JSON.stringify(doc));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("新しい版");
  });
});

describe("コードブロックの保存（版2）", () => {
  it("ブロックと、手直しの有無が保存・復元される", async () => {
    const { placeBlock, blocksOf, isEdited } = await import("../src/model/chordBlocks");
    const { setVelocity } = await import("../src/model/edit");
    const C = { root: 0, type: "maj" as const, octave: 3, inversion: 0, pattern: "arpUp" as const, step: 480, velocity: 80 };
    let song = placeBlock(songWith([note(72, 0, 960)]), 1000, C, 0, 3840).song;
    song = placeBlock(song, 1000, { ...C, root: 7 }, 3840, 3840).song;
    const second = blocksOf(song.tracks[0])[1];
    song = setVelocity(song, new Set([second.noteIds[0]]), 20);
    const r = parseProject(serializeProject({ song, mixer: {}, settings: defaultSettings() }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = r.data.song.tracks[0];
    const bs = blocksOf(t);
    expect(bs.map((b) => [b.root, b.start, b.length, b.pattern])).toEqual([
      [0, 0, 3840, "arpUp"],
      [7, 3840, 3840, "arpUp"],
    ]);
    expect(bs[0].noteIds).toHaveLength(8);
    expect(isEdited(t, bs[0])).toBe(false);
    expect(isEdited(t, bs[1])).toBe(true);
    expect(t.notes).toHaveLength(17);
  });

  it("版1のファイル（ブロックなし）も開ける", () => {
    const doc = JSON.parse(serializeProject({ song: songWith([note(60, 0, 960)]), mixer: {}, settings: defaultSettings() }));
    doc.version = 1;
    delete doc.song.tracks[0].blocks;
    const r = parseProject(JSON.stringify(doc));
    expect(r.ok).toBe(true);
  });
});
