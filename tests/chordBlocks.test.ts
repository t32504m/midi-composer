import { describe, expect, it } from "vitest";
import {
  blocksOf,
  deleteBlock,
  dissolveBlock,
  isEdited,
  moveBlock,
  placeBlock,
  raiseVoicing,
  regenerateBlock,
} from "../src/model/chordBlocks";
import { changeTimeSignature, deleteNotes, duplicateRange, moveNotes, setVelocity } from "../src/model/edit";
import { BlockParams, Song } from "../src/model/types";
import { pitchName } from "../src/model/pitch";
import { note, songWith } from "./helpers";

const C: BlockParams = { root: 0, type: "maj", octave: 3, inversion: 0, pattern: "sustain", step: 480, velocity: 80 };
const G: BlockParams = { ...C, root: 7 };
const T = 1000;
const track = (s: Song) => s.tracks[0];
const names = (s: Song) => blocksOf(track(s)).map((b) => `${b.root}@${b.start}+${b.length}`);

describe("コードブロック", () => {
  it("置くと、通常の音符とコード名のブロックができる", () => {
    const r = placeBlock(songWith([]), T, C, 0, 3840);
    expect(track(r.song).notes.map((n) => pitchName(n.pitch))).toEqual(["C3", "E3", "G3"]);
    expect(names(r.song)).toEqual(["0@0+3840"]);
    expect(isEdited(track(r.song), blocksOf(track(r.song))[0])).toBe(false);
  });

  it("ブロックの後半に半小節のコードを置くと、前半だけが残る（作り直し）", () => {
    let s = placeBlock(songWith([]), T, C, 0, 3840).song;
    s = placeBlock(s, T, G, 1920, 1920).song;
    expect(names(s)).toEqual(["0@0+1920", "7@1920+1920"]);
    const notes = track(s).notes.map((n) => [pitchName(n.pitch), n.start, n.length]);
    expect(notes).toEqual([
      ["C3", 0, 1920],
      ["E3", 0, 1920],
      ["G3", 0, 1920],
      ["G3", 1920, 1920],
      ["B3", 1920, 1920],
      ["D4", 1920, 1920],
    ]);
  });

  it("ブロックの真ん中に置くと、前後に分かれる", () => {
    let s = placeBlock(songWith([]), T, C, 0, 7680).song;
    s = placeBlock(s, T, G, 3840, 1920).song;
    expect(names(s)).toEqual(["0@0+3840", "7@3840+1920", "0@5760+1920"]);
  });

  it("ブロックでない音符は、ブロックを置いても消えない（AC-08）", () => {
    const s = placeBlock(songWith([note(72, 0, 960)]), T, C, 0, 3840).song;
    expect(track(s).notes.some((n) => n.pitch === 72)).toBe(true);
  });

  it("コードを変えると作り直す。手直しした音はなくなる", () => {
    let s = placeBlock(songWith([]), T, C, 0, 3840).song;
    const b = blocksOf(track(s))[0];
    s = setVelocity(s, new Set([b.noteIds[0]]), 30);
    expect(isEdited(track(s), blocksOf(track(s))[0])).toBe(true);
    s = regenerateBlock(s, T, b.id, { root: 9, type: "min" }).song;
    expect(track(s).notes.map((n) => pitchName(n.pitch))).toEqual(["A3", "C4", "E4"]);
    expect(track(s).notes.every((n) => n.velocity === 80)).toBe(true);
  });

  it("ブロックを動かしても、音符は作り直さない（手直しが残る）", () => {
    let s = placeBlock(songWith([]), T, C, 0, 3840).song;
    const b = blocksOf(track(s))[0];
    s = setVelocity(s, new Set([b.noteIds[0]]), 30);
    s = moveBlock(s, T, b.id, 3840);
    expect(blocksOf(track(s))[0].start).toBe(3840);
    expect(track(s).notes.map((n) => [n.start, n.velocity])).toEqual([
      [3840, 30],
      [3840, 80],
      [3840, 80],
    ]);
  });

  it("動かした先のブロックは置き換わる", () => {
    let s = placeBlock(songWith([]), T, C, 0, 3840).song;
    s = placeBlock(s, T, G, 3840, 3840).song;
    const c = blocksOf(track(s))[0];
    s = moveBlock(s, T, c.id, 1920);
    expect(names(s)).toEqual(["0@1920+3840", "7@5760+1920"]);
  });

  it("削除・解除", () => {
    let s = placeBlock(songWith([note(72, 0, 960)]), T, C, 0, 3840).song;
    const id = blocksOf(track(s))[0].id;
    const removed = deleteBlock(s, T, id);
    expect(track(removed).notes.map((n) => n.pitch)).toEqual([72]);
    s = dissolveBlock(s, T, id);
    expect(blocksOf(track(s))).toHaveLength(0);
    expect(track(s).notes).toHaveLength(4);
  });

  it("ブロックの音符を全部消すと、ブロックも消える", () => {
    let s = placeBlock(songWith([]), T, C, 0, 3840).song;
    const b = blocksOf(track(s))[0];
    s = deleteNotes(s, new Set(b.noteIds));
    expect(blocksOf(track(s))).toHaveLength(0);
  });

  it("ブロックの音符をまとめて時間方向に動かすと、ブロックも一緒に動く", () => {
    let s = placeBlock(songWith([]), T, C, 0, 3840).song;
    const b = blocksOf(track(s))[0];
    s = moveNotes(s, T, new Set(b.noteIds), 960, 0);
    expect(blocksOf(track(s))[0].start).toBe(960);
    expect(isEdited(track(s), blocksOf(track(s))[0])).toBe(false);
  });

  it("範囲の複製で、範囲に収まるブロックも独立して複製される", () => {
    let s = placeBlock(songWith([]), T, C, 0, 3840).song;
    s = duplicateRange(s, [T], { start: 0, end: 3840 }).song;
    const bs = blocksOf(track(s));
    expect(bs.map((b) => b.start)).toEqual([0, 3840]);
    expect(bs[1].noteIds.every((id) => !bs[0].noteIds.includes(id))).toBe(true);
    expect(isEdited(track(s), bs[1])).toBe(false);
  });

  it("拍子を変えると、ブロックも小節・拍の位置で並べ直される", () => {
    let s = placeBlock(songWith([]), T, C, 3840 + 960, 960).song;
    s = changeTimeSignature(s, { numerator: 3, denominator: 4 }, "lastBeat").song;
    const b = blocksOf(track(s))[0];
    expect(b.start).toBe(2880 + 960);
    expect(isEdited(track(s), b)).toBe(false);
  });

  it("高く・低く: 転回形を上げ、端まで行ったらオクターブを変える", () => {
    expect(raiseVoicing(C, 1, 2)).toEqual({ octave: 3, inversion: 1 });
    expect(raiseVoicing({ ...C, inversion: 2 }, 1, 2)).toEqual({ octave: 4, inversion: 0 });
    expect(raiseVoicing(C, -1, 2)).toEqual({ octave: 2, inversion: 2 });
  });
});

describe("空いている部分に合わせる（fitGap）", () => {
  it("半分にしたブロックの後ろの空きに、その空きだけで置く", async () => {
    const { fitGap } = await import("../src/model/chordBlocks");
    let s = placeBlock(songWith([]), T, C, 0, 3840).song;
    s = regenerateBlock(s, T, blocksOf(track(s))[0].id, { length: 1920 }).song;
    expect(fitGap(track(s), 2500, 3840)).toEqual({ start: 1920, length: 1920 });
    s = placeBlock(s, T, G, 1920, 1920).song;
    expect(names(s)).toEqual(["0@0+1920", "7@1920+1920"]);
  });
  it("前後にブロックがある空きは、その間だけ。空の小節は1小節", async () => {
    const { fitGap } = await import("../src/model/chordBlocks");
    let s = placeBlock(songWith([]), T, C, 0, 960).song;
    s = placeBlock(s, T, G, 2880, 960).song;
    expect(fitGap(track(s), 1500, 3840)).toEqual({ start: 960, length: 1920 });
    expect(fitGap(track(s), 5000, 3840)).toEqual({ start: 3840, length: 3840 });
    expect(fitGap(track(s), 100, 3840)).toBeNull();
  });
  it("拍を指定すると、ドロップした拍から置く（小節の真ん中にも置ける）", async () => {
    const { fitGap } = await import("../src/model/chordBlocks");
    const s = placeBlock(songWith([]), T, C, 0, 960).song;
    // 空の2小節目の3拍目 → 3拍目から小節の終わりまで
    expect(fitGap(track(s), 3840 + 1920 + 100, 3840, 960)).toEqual({ start: 5760, length: 1920 });
    // 1拍目なら小節全体
    expect(fitGap(track(s), 3900, 3840, 960)).toEqual({ start: 3840, length: 3840 });
    // 前のブロックの直後の拍は、空きの始まりから
    expect(fitGap(track(s), 1000, 3840, 960)).toEqual({ start: 960, length: 2880 });
  });
});

describe("ブロックの途中に置く（splitSlot）", () => {
  it("1小節のブロックの3拍目に置くと、前半は元のコード、後半は新しいコード", async () => {
    const { splitSlot } = await import("../src/model/chordBlocks");
    let s = placeBlock(songWith([]), T, C, 0, 3840).song;
    const b = blocksOf(track(s))[0];
    const slot = splitSlot(b, 2000, 960)!;
    expect(slot).toEqual({ start: 1920, length: 1920 });
    s = placeBlock(s, T, G, slot.start, slot.length).song;
    expect(names(s)).toEqual(["0@0+1920", "7@1920+1920"]);
  });
  it("最初の拍なら null（ブロック全体を置き換える）", async () => {
    const { splitSlot } = await import("../src/model/chordBlocks");
    const s = placeBlock(songWith([]), T, C, 0, 3840).song;
    expect(splitSlot(blocksOf(track(s))[0], 500, 960)).toBeNull();
  });
});
