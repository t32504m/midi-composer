import { describe, expect, it } from "vitest";
import { effectiveGrid, gridForLength, moveDelta, resizeEnd, snapPlace, stepLength } from "../src/model/snap";
import { noteValueTicks } from "../src/model/time";

const G16 = 240;

describe("吸着（04_DESIGN.md 例1・例2）", () => {
  it("置くときはクリックしたマスの左端（切り捨て）。AC-02", () => {
    expect(snapPlace(1000, G16)).toBe(960);
    expect(snapPlace(1900, G16)).toBe(1680);
  });

  it("吸着なしではそのままの位置", () => {
    expect(snapPlace(1000, null)).toBe(1000);
  });

  it("右端は最も近いグリッドへ。開始は変わらない。AC-03", () => {
    expect(resizeEnd(960, 2300, G16)).toBe(2400);
  });

  it("吸着なしでは任意の位置で終われる。AC-04", () => {
    expect(resizeEnd(960, 2310, null)).toBe(2310);
  });

  it("最小長（30 tick）を下回らない", () => {
    expect(resizeEnd(960, 900, null)).toBe(990);
    // 吸着オンで合わせ先が開始以下なら、開始より後ろの最初のグリッド（またはマスの半分の線）
    expect(resizeEnd(1000, 1180, G16)).toBe(1200);
    expect(resizeEnd(1000, 900, G16)).toBe(1080);
    // 開始がグリッドの直前なら、30 tick 以上になる次のグリッド
    expect(resizeEnd(1190, 1100, G16)).toBe(1440);
  });

  it("移動はつかんだ音符を基準にし、移動量を全体で共通にする。AC-05", () => {
    // A=960 をつかんで約 +500 → A は 1440、移動量 +480
    expect(moveDelta(960, 500, G16, 960)).toBe(480);
    // B=1000 をつかんで +500 → B は 1440、移動量 +440
    expect(moveDelta(1000, 500, G16, 960)).toBe(440);
  });

  it("曲頭より前には出ない（全体で止める）", () => {
    // 一番前の音符(100)は -100 までしか動けない。つかんだ音符(240)は 140 になるが、
    // 吸着オンなので曲頭以降に収まる最も近いグリッド 240 にとどまる
    expect(moveDelta(240, -1000, G16, 100)).toBe(0);
    expect(moveDelta(480, -1000, G16, 300)).toBe(-240);
    expect(moveDelta(240, -1000, null, 100)).toBe(-100);
  });

  it("音価の tick は整数", () => {
    expect(noteValueTicks("thirtysecond", "triplet")).toBe(80);
    expect(noteValueTicks("quarter", "dotted")).toBe(1440);
    expect(noteValueTicks("whole", "none")).toBe(3840);
  });
});

describe("三十二分音符など、吸着の間隔より短い音符", () => {
  const G32 = 120;
  it("入力が三十二分なら、吸着が十六分でも三十二分ごとに置ける（マスの後半にも置ける）", () => {
    const g = effectiveGrid(G16, noteValueTicks("thirtysecond", "none"));
    expect(g).toBe(G32);
    expect(snapPlace(1000, g)).toBe(960);
    expect(snapPlace(1100, g)).toBe(1080);
  });
  it("入力が吸着の間隔以上なら、吸着の設定どおり。吸着オフはオフのまま", () => {
    expect(effectiveGrid(G16, 480)).toBe(G16);
    expect(effectiveGrid(G16, 240)).toBe(G16);
    expect(effectiveGrid(null, 120)).toBeNull();
    // 三連（十六分三連 = 160）は三連の位置に置ける
    expect(effectiveGrid(G16, noteValueTicks("sixteenth", "triplet"))).toBe(160);
  });
  it("十六分の吸着でも、右端のドラッグで三十二分まで縮められる", () => {
    expect(resizeEnd(960, 960 + 130, G16)).toBe(960 + 120);
    expect(resizeEnd(960, 960 + 40, G16)).toBe(960 + 120);
    // 半分より長めに離せば、十六分のまま
    expect(resizeEnd(960, 960 + 200, G16)).toBe(960 + 240);
    // マスの後半にある三十二分音符は、次のグリッドで終わる
    expect(resizeEnd(1080, 1100, G16)).toBe(1200);
  });
  it("Shift+←→ は1マス以下の音符を半分・倍にする（十六分 ⇄ 三十二分 ⇄ 六十四分）", () => {
    expect(stepLength(480, G16, -1)).toBe(240);
    expect(stepLength(240, G16, -1)).toBe(120);
    expect(stepLength(120, G16, -1)).toBe(60);
    expect(stepLength(60, G16, -1)).toBe(30);
    expect(stepLength(30, G16, -1)).toBe(30);
    expect(stepLength(60, G16, 1)).toBe(120);
    expect(stepLength(120, G16, 1)).toBe(240);
    expect(stepLength(240, G16, 1)).toBe(480);
  });
  it("1マスより短い音符を動かすときは、その長さに合わせて細かく動く", () => {
    expect(gridForLength(G16, 120)).toBe(G32);
    expect(gridForLength(G16, 240)).toBe(G16);
    expect(gridForLength(G16, 960)).toBe(G16);
    expect(gridForLength(G16, 50)).toBe(30);
    expect(gridForLength(null, 120)).toBeNull();
    // マスの後半(3960)の三十二分音符を少し右へ → 4080（三十二分ずれた位置のまま）
    expect(3960 + moveDelta(3960, 100, gridForLength(G16, 120), 3960)).toBe(4080);
  });
});
