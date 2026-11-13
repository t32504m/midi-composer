import { describe, expect, it } from "vitest";
import {
  PROGRESSIONS,
  chordName,
  diatonicChords,
  functionTag,
  inScale,
  progressionChords,
  renderPattern,
  voiceChord,
} from "../src/theory/theory";
import { pitchName } from "../src/model/pitch";

describe("スケールとコード", () => {
  it("Cメジャーのダイアトニックコード", () => {
    const names = diatonicChords({ tonic: 0, mode: "major" }).map((d) => `${d.roman} ${chordName(d.chord)}`);
    expect(names).toEqual(["I C", "ii Dm", "iii Em", "IV F", "V G", "vi Am", "vii° Bdim"]);
  });

  it("Aマイナーのダイアトニックコード", () => {
    const names = diatonicChords({ tonic: 9, mode: "minor" }).map((d) => chordName(d.chord));
    expect(names).toEqual(["Am", "Bdim", "C", "Dm", "Em", "F", "G"]);
  });

  it("スケール外の音も判定できる（目安のみ）", () => {
    expect(inScale(61, { tonic: 0, mode: "major" })).toBe(false);
    expect(inScale(64, { tonic: 0, mode: "major" })).toBe(true);
  });

  it("根音を C3〜B3 に置き、転回形では下の音を1オクターブ上へ", () => {
    expect(voiceChord({ root: 7, type: "maj" }, 3, 0).map(pitchName)).toEqual(["G3", "B3", "D4"]);
    expect(voiceChord({ root: 0, type: "maj" }, 3, 1).map(pitchName)).toEqual(["E3", "G3", "C4"]);
    expect(voiceChord({ root: 0, type: "7" }, 3, 3).map(pitchName)).toEqual(["A#3", "C4", "E4", "G4"]);
  });

  it("短調の i–iv–V–i の V はメジャー", () => {
    const p = PROGRESSIONS.find((x) => x.id === "m3")!;
    expect(progressionChords(p, { tonic: 9, mode: "minor" }).map(chordName)).toEqual(["Am", "Dm", "E", "Am"]);
  });
});

describe("弾き方（04_DESIGN.md 例4）", () => {
  it("I–V–vi–IV・上行アルペジオ・八分で4小節に32音", () => {
    const p = PROGRESSIONS.find((x) => x.id === "M2")!;
    const chords = progressionChords(p, { tonic: 0, mode: "major" });
    const notes = chords.flatMap((c, i) => renderPattern(voiceChord(c, 3, 0), i * 3840, 3840, "arpUp", 480, 80));
    expect(notes).toHaveLength(32);
    expect(notes.slice(0, 4).map((n) => pitchName(n.pitch))).toEqual(["C3", "E3", "G3", "C4"]);
    expect(notes.slice(8, 12).map((n) => pitchName(n.pitch))).toEqual(["G3", "B3", "D4", "G4"]);
    expect(notes.slice(16, 20).map((n) => pitchName(n.pitch))).toEqual(["A3", "C4", "E4", "A4"]);
    expect(notes.slice(24, 28).map((n) => pitchName(n.pitch))).toEqual(["F3", "A3", "C4", "F4"]);
    expect(notes.every((n) => n.length === 480 && n.velocity === 80)).toBe(true);
  });

  it("和音を伸ばす: 構成音をコードの長さで", () => {
    const n = renderPattern([48, 52, 55], 0, 3840, "sustain", 480, 80);
    expect(n.map((x) => [x.pitch, x.length])).toEqual([
      [48, 3840],
      [52, 3840],
      [55, 3840],
    ]);
  });

  it("低音と和音を交互に: 低音は根音の1オクターブ下", () => {
    const n = renderPattern([48, 52, 55], 0, 1920, "alternate", 960, 80);
    expect(n.map((x) => [x.pitch, x.start])).toEqual([
      [36, 0],
      [48, 960],
      [52, 960],
      [55, 960],
    ]);
  });

  it("上下アルペジオ 1・3・5・8・5・3", () => {
    const n = renderPattern([48, 52, 55], 0, 2880, "arpUpDown", 480, 80);
    expect(n.map((x) => x.pitch)).toEqual([48, 52, 55, 60, 55, 52]);
  });

  it("はみ出す最後の音はコードの終わりで切る", () => {
    const n = renderPattern([48, 52, 55], 0, 1000, "repeat", 480, 80);
    expect(n.filter((x) => x.pitch === 48).map((x) => [x.start, x.length])).toEqual([
      [0, 480],
      [480, 480],
      [960, 40],
    ]);
  });
});

describe("コードの働き（目安）", () => {
  it("Cメジャー: C=T、F=SD、G=D、G7=D、Am=T（代理）", () => {
    const key = { tonic: 0, mode: "major" as const };
    expect(functionTag(key, { root: 0, type: "maj" })?.short).toBe("T");
    expect(functionTag(key, { root: 5, type: "maj" })?.short).toBe("SD");
    expect(functionTag(key, { root: 7, type: "maj" })?.short).toBe("D");
    expect(functionTag(key, { root: 7, type: "7" })?.short).toBe("D");
    expect(functionTag(key, { root: 9, type: "min" })?.label).toBe("トニック（代理）");
    expect(functionTag(key, { root: 1, type: "maj" })).toBeNull();
  });
  it("同じ G でも、Gメジャーではトニック", () => {
    expect(functionTag({ tonic: 7, mode: "major" }, { root: 7, type: "maj" })?.short).toBe("T");
  });
  it("Aマイナーの E（第7音を上げた V）はドミナント", () => {
    expect(functionTag({ tonic: 9, mode: "minor" }, { root: 4, type: "maj" })?.short).toBe("D");
  });
});
