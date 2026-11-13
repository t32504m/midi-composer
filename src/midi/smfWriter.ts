// 標準MIDIファイル（形式1）の書き出し。04_DESIGN.md §3.9。
// 分解能はアプリ内部と同じ 960 にして、tick を変換せずに書き出す。
import { PPQ, Song } from "../model/types";
import { assignChannels } from "../model/instruments";
import { resolveOverlaps } from "../model/overlap";

function vlq(n: number): number[] {
  const bytes = [n & 0x7f];
  n >>>= 7;
  while (n > 0) {
    bytes.unshift((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  return bytes;
}

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function u16(n: number): number[] {
  return [(n >>> 8) & 0xff, n & 0xff];
}

interface Ev {
  tick: number;
  /** 同じ tick の中の順序: 0=メタ・設定, 1=ノートオフ, 2=ノートオン */
  order: number;
  data: number[];
}

function chunk(type: string, body: number[]): number[] {
  return [...[...type].map((c) => c.charCodeAt(0)), ...u32(body.length), ...body];
}

function trackChunk(events: Ev[]): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body: number[] = [];
  let last = 0;
  for (const e of events) {
    body.push(...vlq(e.tick - last), ...e.data);
    last = e.tick;
  }
  body.push(0x00, 0xff, 0x2f, 0x00); // トラックの終わり
  return chunk("MTrk", body);
}

function metaText(type: number, text: string): number[] {
  const bytes = [...new TextEncoder().encode(text)];
  return [0xff, type, ...vlq(bytes.length), ...bytes];
}

export function writeSmf(song: Song, title = ""): Uint8Array {
  const chunks: number[][] = [];
  const conductor: Ev[] = [];
  if (title) conductor.push({ tick: 0, order: 0, data: metaText(0x03, title) });
  const usPerQuarter = Math.round(60_000_000 / song.tempo);
  conductor.push({
    tick: 0,
    order: 0,
    data: [0xff, 0x51, 0x03, (usPerQuarter >>> 16) & 0xff, (usPerQuarter >>> 8) & 0xff, usPerQuarter & 0xff],
  });
  const { numerator, denominator } = song.timeSig;
  const clocks = denominator === 8 && numerator % 3 === 0 ? 36 : (24 * 4) / denominator;
  conductor.push({
    tick: 0,
    order: 0,
    data: [0xff, 0x58, 0x04, numerator, Math.log2(denominator), clocks, 8],
  });
  chunks.push(trackChunk(conductor));

  const channels = assignChannels(song);
  for (const track of song.tracks) {
    const ch = channels.get(track.id);
    if (ch === undefined) continue;
    const evs: Ev[] = [{ tick: 0, order: 0, data: metaText(0x03, track.name) }];
    if (track.kind !== "drum") evs.push({ tick: 0, order: 0, data: [0xc0 | ch, track.program & 0x7f] });
    evs.push({ tick: 0, order: 0, data: [0xb0 | ch, 7, track.volume & 0x7f] });
    // ミュート・ソロに関係なく全トラックを書き出す（MIDI-01）
    for (const n of resolveOverlaps(track.notes)) {
      evs.push({ tick: n.start, order: 2, data: [0x90 | ch, n.pitch, n.velocity] });
      evs.push({ tick: n.end, order: 1, data: [0x80 | ch, n.pitch, 64] });
    }
    chunks.push(trackChunk(evs));
  }

  const header = chunk("MThd", [...u16(1), ...u16(chunks.length), ...u16(PPQ)]);
  return new Uint8Array([...header, ...chunks.flat()]);
}
