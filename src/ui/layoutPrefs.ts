// 画面の区切りの大きさ（ドラッグで変えられる）。表示だけの設定なので、プロジェクトには保存せず、このブラウザに覚えておく。

export interface Layout {
  /** 右の作曲補助パネルの幅 */
  sideW: number;
  /** 作曲補助パネル下の「情報」の高さ */
  infoH: number;
  /** トラック一覧・全体表示の高さ */
  arrangeH: number;
  /** トラック一覧の幅 */
  trackListW: number;
  /** コードブロック画面のパレットの高さ */
  paletteH: number;
  /** ピアノロール下の、打鍵の強さレーンの高さ */
  velH: number;
}

export const DEFAULT_LAYOUT: Layout = { sideW: 360, infoH: 190, arrangeH: 200, trackListW: 330, paletteH: 210, velH: 84 };

/** 各区切りの最小・最大。最大が関数のものは、画面の大きさに合わせる */
export const LAYOUT_LIMITS: Record<keyof Layout, { min: number; max: () => number }> = {
  sideW: { min: 240, max: () => Math.max(300, window.innerWidth * 0.5) },
  infoH: { min: 40, max: () => Math.max(120, window.innerHeight * 0.6) },
  arrangeH: { min: 40, max: () => Math.max(120, window.innerHeight * 0.6) },
  trackListW: { min: 260, max: () => 600 },
  paletteH: { min: 36, max: () => Math.max(120, window.innerHeight * 0.6) },
  velH: { min: 24, max: () => 260 },
};

const STORAGE_KEY = "midi-composer.layout";

export function clampLayout(key: keyof Layout, v: number): number {
  const lim = LAYOUT_LIMITS[key];
  return Math.round(Math.min(lim.max(), Math.max(lim.min, v)));
}

/** 覚えておいた大きさを読む。読めない・壊れているときは初期値 */
export function loadLayout(): Layout {
  const out = { ...DEFAULT_LAYOUT };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<Record<keyof Layout, unknown>>) : {};
    for (const k of Object.keys(DEFAULT_LAYOUT) as (keyof Layout)[]) {
      const n = v[k];
      if (typeof n === "number" && Number.isFinite(n)) out[k] = n;
    }
  } catch {
    // 保存できない環境（プライベートウィンドウなど）では初期値のまま
  }
  return out;
}

export function saveLayout(l: Layout) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(l));
  } catch {
    // 覚えておけなくても、今の画面ではそのまま使える
  }
}

const SIDE_OPEN_KEY = "midi-composer.sideOpen";

/** 作曲補助パネルを開いているか（最小化を覚えておく） */
export function loadSideOpen(): boolean {
  try {
    return window.localStorage.getItem(SIDE_OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

export function saveSideOpen(open: boolean) {
  try {
    window.localStorage.setItem(SIDE_OPEN_KEY, open ? "1" : "0");
  } catch {
    // 覚えておけなくても、今の画面ではそのまま使える
  }
}
