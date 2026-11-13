import { MixerState, Song } from "./types";

/** ソロのトラックがあればソロだけ、なければミュート以外を鳴らす */
export function audibleTrackIds(song: Song, mixer: MixerState): Set<number> {
  const anySolo = song.tracks.some((t) => mixer[t.id]?.solo);
  return new Set(song.tracks.filter((t) => (anySolo ? mixer[t.id]?.solo : !mixer[t.id]?.mute)).map((t) => t.id));
}
