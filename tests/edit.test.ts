import { describe, expect, it } from "vitest";
import {
  addNotes,
  changeTimeSignature,
  clipboardFromNotes,
  convertBoundaryForTs,
  countSamePitchOverlaps,
  duplicateRange,
  moveNotes,
  notesEnteringRange,
  paste,
  resizeNotes,
  songEnd,
} from "../src/model/edit";
import { resolveOverlaps } from "../src/model/overlap";
import { emptyHistory, pushHistory, redo, undo } from "../src/model/history";
import { note, shape, songWith } from "./helpers";

describe("音符の編集", () => {
  it("複数音の移動で時間差と長さが保たれる（AC-05）", () => {
    const a = note(60, 960, 480);
    const b = note(64, 1000, 240);
    const s = moveNotes(songWith([a, b]), 1000, new Set([a.id, b.id]), 480, 2);
    expect(shape(s.tracks[0].notes)).toEqual([
      { pitch: 62, start: 1440, length: 480, velocity: 100 },
      { pitch: 66, start: 1480, length: 240, velocity: 100 },
    ]);
  });

  it("複数音の伸縮は同じ変化量を加え、最小長で止める", () => {
    const a = note(60, 0, 960);
    const b = note(62, 0, 100);
    const s = resizeNotes(songWith([a, b]), 1000, new Set([a.id, b.id]), -200);
    expect(s.tracks[0].notes.map((n) => n.length).sort((x, y) => x - y)).toEqual([30, 760]);
  });

  it("元の Song は変更されない（取り消しの前提）", () => {
    const a = note(60, 0, 960);
    const before = songWith([a]);
    moveNotes(before, 1000, new Set([a.id]), 240, 0);
    expect(before.tracks[0].notes[0].start).toBe(0);
  });

  it("一回のドラッグは取り消し一回で戻る（AC-03）", () => {
    const a = note(64, 960, 960);
    const s0 = songWith([a]);
    const s1 = resizeNotes(s0, 1000, new Set([a.id]), 480);
    let h = pushHistory(emptyHistory(), s0);
    const u = undo(h, s1)!;
    expect(u.song.tracks[0].notes[0].length).toBe(960);
    h = u.history;
    const r = redo(h, u.song)!;
    expect(r.song.tracks[0].notes[0].length).toBe(1440);
  });
});

describe("範囲の複製（04_DESIGN.md 例3、AC-09）", () => {
  const make = () =>
    songWith([note(60, 0, 960), note(62, 960, 960), note(64, 1920, 1920), note(67, 3840, 1920)]);

  it("無音の時間も間隔に含めて、範囲の直後へ複製する", () => {
    const s0 = make();
    const r = duplicateRange(s0, [1000], { start: 0, end: 7680 });
    const starts = r.song.tracks[0].notes.map((n) => [n.pitch, n.start]);
    expect(starts).toEqual([
      [60, 0],
      [62, 960],
      [64, 1920],
      [67, 3840],
      [60, 7680],
      [62, 8640],
      [64, 9600],
      [67, 11520],
    ]);
    expect(r.newRange).toEqual({ start: 7680, end: 15360 });
    // 続けて複製すると5小節目から
    const r2 = duplicateRange(r.song, [1000], r.newRange);
    expect(r2.song.tracks[0].notes.filter((n) => n.start === 15360)).toHaveLength(1);
  });

  it("元を変えてもコピーは変わらない", () => {
    const s0 = make();
    const r = duplicateRange(s0, [1000], { start: 0, end: 7680 });
    const orig = r.song.tracks[0].notes.find((n) => n.start === 0)!;
    const s2 = moveNotes(r.song, 1000, new Set([orig.id]), 0, 2);
    expect(s2.tracks[0].notes.find((n) => n.start === 7680)!.pitch).toBe(60);
  });

  it("範囲より前から始まる音符は含めない。終わりを越える音符は切らずに含める", () => {
    const s0 = songWith([note(60, 0, 5000), note(62, 7200, 960)]);
    const range = { start: 3840, end: 7680 };
    expect(notesEnteringRange(s0.tracks[0], range)).toHaveLength(1);
    const r = duplicateRange(s0, [1000], range);
    const copies = r.song.tracks[0].notes.filter((n) => n.start >= 7680);
    expect(shape(copies)).toEqual([{ pitch: 62, start: 11040, length: 960, velocity: 100 }]);
  });

  it("貼り付けは既存の音符を消さずに追加する", () => {
    const a = note(60, 0, 960);
    const s0 = songWith([a, note(60, 3840, 960)]);
    const clip = clipboardFromNotes(s0, new Set([a.id]))!;
    const r = paste(s0, clip, 3840, 1000);
    expect(r.song.tracks[0].notes).toHaveLength(3);
    expect(countSamePitchOverlaps(s0.tracks[0].notes, r.added[0].notes)).toBe(1);
  });
});

describe("挿入と取り消し（AC-08）", () => {
  it("挿入を取り消すと、挿入した音符だけが消える", () => {
    const s0 = songWith([note(60, 0, 1920)]);
    const r = addNotes(s0, 1000, [
      { pitch: 48, start: 0, length: 480, velocity: 80 },
      { pitch: 52, start: 480, length: 480, velocity: 80 },
    ]);
    expect(r.song.tracks[0].notes).toHaveLength(3);
    const u = undo(pushHistory(emptyHistory(), s0), r.song)!;
    expect(shape(u.song.tracks[0].notes)).toEqual([{ pitch: 60, start: 0, length: 1920, velocity: 100 }]);
  });
});

describe("同じ音高の重なり（§3.9、AC-15）", () => {
  it("後の音符が始まる時点で前の音符を終わらせる", () => {
    const r = resolveOverlaps([note(60, 0, 1920), note(60, 1440, 480)]);
    expect(r).toEqual([
      { pitch: 60, start: 0, end: 1440, velocity: 100 },
      { pitch: 60, start: 1440, end: 1920, velocity: 100 },
    ]);
  });

  it("開始位置と音高が同じ音符は1つにまとめる（強さは大きい方、長さは長い方）", () => {
    const r = resolveOverlaps([note(60, 0, 480, 50), note(60, 0, 960, 90)]);
    expect(r).toEqual([{ pitch: 60, start: 0, end: 960, velocity: 90 }]);
  });
});

describe("拍子の変更（§3.12、AC-18・AC-21・AC-22）", () => {
  const four = () =>
    songWith([
      note(60, 0, 960),
      note(62, 960, 960),
      note(64, 1920, 1920), // 3拍目からの二分音符
      note(65, 2880, 480), // 4拍目の頭
      note(67, 3360, 480), // 4拍目の裏
      note(69, 3840 + 1920, 960), // 2小節目3拍目
    ]);

  it("1〜3拍目の音符は同じ小節・拍に並び、長さ・音高・強さは変わらない（AC-18）", () => {
    const r = changeTimeSignature(four(), { numerator: 3, denominator: 4 }, "lastBeat");
    const byPitch = Object.fromEntries(r.song.tracks[0].notes.map((n) => [n.pitch, n]));
    expect(byPitch[60].start).toBe(0);
    expect(byPitch[62].start).toBe(960);
    expect(byPitch[64].start).toBe(1920);
    expect(byPitch[64].length).toBe(1920);
    expect(byPitch[69].start).toBe(2880 + 1920); // 2小節目3拍目のまま
    expect(r.overflowIds).toHaveLength(2);
    expect(r.overflowByTrack.get(1000)).toBe(2);
    expect(r.song.timeSig).toEqual({ numerator: 3, denominator: 4 });
  });

  it("はみ出す音符を「最後の拍」へ移す（拍の中の位置を保つ）（AC-22）", () => {
    const r = changeTimeSignature(four(), { numerator: 3, denominator: 4 }, "lastBeat");
    const byPitch = Object.fromEntries(r.song.tracks[0].notes.map((n) => [n.pitch, n]));
    expect(byPitch[65].start).toBe(1920); // 3拍目の頭
    expect(byPitch[67].start).toBe(2400); // 3拍目の裏
    expect(r.song.tracks[0].notes).toHaveLength(6);
  });

  it("はみ出す音符を「次の小節の1拍目」へ移す（AC-22）", () => {
    const r = changeTimeSignature(four(), { numerator: 3, denominator: 4 }, "nextBar");
    const byPitch = Object.fromEntries(r.song.tracks[0].notes.map((n) => [n.pitch, n]));
    expect(byPitch[65].start).toBe(2880);
    expect(byPitch[67].start).toBe(3360);
    expect(byPitch[65].length).toBe(480);
  });

  it("4/4 → 2/4 では、最後の拍に集まる／次の小節へ順に並ぶ", () => {
    const s = songWith([note(60, 1920, 240), note(62, 2880 + 240, 240)]);
    const last = changeTimeSignature(s, { numerator: 2, denominator: 4 }, "lastBeat");
    expect(last.song.tracks[0].notes.map((n) => n.start)).toEqual([960, 1200]);
    const next = changeTimeSignature(s, { numerator: 2, denominator: 4 }, "nextBar");
    expect(next.song.tracks[0].notes.map((n) => n.start)).toEqual([1920, 2880 + 240]);
  });

  it("4/4 → 6/8 は小節の頭からの距離を保ち、4拍目は最後の拍（付点四分）へ", () => {
    const s = songWith([note(60, 960, 240), note(62, 3360, 240)]);
    const r = changeTimeSignature(s, { numerator: 6, denominator: 8 }, "lastBeat");
    expect(r.song.tracks[0].notes.map((n) => n.start)).toEqual([960, 1920]);
  });

  it("はみ出しがない往復では元に戻る（AC-21）", () => {
    const s = songWith([note(60, 0, 960), note(62, 2880 + 960, 480), note(64, 2880 * 3 + 1920, 960)], {
      timeSig: { numerator: 3, denominator: 4 },
    });
    const to4 = changeTimeSignature(s, { numerator: 4, denominator: 4 }, "lastBeat");
    expect(to4.overflowIds).toHaveLength(0);
    expect(to4.song.tracks[0].notes.map((n) => n.start)).toEqual([0, 3840 + 960, 3840 * 3 + 1920]);
    const back = changeTimeSignature(to4.song, { numerator: 3, denominator: 4 }, "lastBeat");
    expect(shape(back.song.tracks[0].notes)).toEqual(shape(s.tracks[0].notes));
  });

  it("範囲の端も同じ小節・拍へ。入らない位置は小節の終わりへ", () => {
    const f = { numerator: 4, denominator: 4 };
    const t = { numerator: 3, denominator: 4 };
    expect(convertBoundaryForTs(7680, f, t)).toBe(5760);
    expect(convertBoundaryForTs(3840 + 1920, f, t)).toBe(2880 + 1920);
    expect(convertBoundaryForTs(2880, f, t)).toBe(2880);
  });
});

describe("曲の長さ", () => {
  it("最後の音符の終わりを小節の終わりへ切り上げる", () => {
    expect(songEnd(songWith([note(60, 1680, 3840)]))).toBe(7680);
    expect(songEnd(songWith([]))).toBe(0);
  });
});

describe("クオンタイズ（Q）と長さの変更（Shift+←→）", () => {
  it("選んだ音符の開始位置だけを、それぞれ最も近いグリッドへ。長さと選んでいない音符は変えない", async () => {
    const { quantizeNotes } = await import("../src/model/edit");
    const a = note(60, 250, 500);
    const b = note(62, 1100, 300);
    const c = note(64, 1210, 100);
    const r = quantizeNotes(songWith([a, b, c]), 1000, new Set([a.id, b.id]), 240);
    expect(r.changed).toBe(2);
    expect(shape(r.song.tracks[0].notes)).toEqual([
      { pitch: 60, start: 240, length: 500, velocity: 100 },
      { pitch: 62, start: 1200, length: 300, velocity: 100 },
      { pitch: 64, start: 1210, length: 100, velocity: 100 },
    ]);
  });
  it("すでにグリッド上なら何も変えない", async () => {
    const { quantizeNotes } = await import("../src/model/edit");
    const s0 = songWith([note(60, 480, 240)]);
    const r = quantizeNotes(s0, 1000, new Set([s0.tracks[0].notes[0].id]), 240);
    expect(r.changed).toBe(0);
    expect(r.song).toBe(s0);
  });
  it("長さの変更は最小長で止まる", () => {
    const a = note(60, 0, 240);
    const s = resizeNotes(songWith([a]), 1000, new Set([a.id]), -480);
    expect(s.tracks[0].notes[0].length).toBe(30);
  });
});
