// ------------------------------------------------------------------
// キャンバス・砂時計の形状
// ------------------------------------------------------------------
// キャンバスの論理サイズ。main.js が canvas 要素にも同じ値を設定する。
export const W = 520;
export const H = 760;

const MARGIN = 60;
export const OUTER_LEFT = MARGIN;
export const OUTER_RIGHT = W - MARGIN;
export const TOP_Y = 50;
export const BOTTOM_Y = H - 50;
export const CENTER_X = W / 2;
const NECK_HEIGHT = 26;
export const MID_Y = (TOP_Y + BOTTOM_Y) / 2;
const NECK_TOP_Y = MID_Y - NECK_HEIGHT / 2;
export const NECK_BOTTOM_Y = MID_Y + NECK_HEIGHT / 2;

// くびれの内幅の半分。スライダーで変わるため、書き換えは setNeckHalfWidth を通す。
export let neckHalfWidth = 14;

export function setNeckHalfWidth(value) {
  neckHalfWidth = value;
}

// 曲線の三角関数は起動時に計算し、物理計算では0.25px間隔で補間する。
const wallCurve = Float64Array.from({ length: H * 4 + 1 }, (_, i) => {
  const distance = Math.abs(i / 4 - MID_Y);
  const t = Math.max(0, Math.min(1, (distance - NECK_HEIGHT / 2) / (NECK_TOP_Y - TOP_Y)));
  return (1 - Math.cos(Math.PI * t)) / 2;
});

// 丸いガラスの描画と衝突判定には同じ境界を使う。
export function leftBoundAt(y) {
  const sample = Math.max(0, Math.min(H * 4 - 1, y * 4));
  const index = sample | 0;
  const curve = wallCurve[index] + (wallCurve[index + 1] - wallCurve[index]) * (sample - index);
  return CENTER_X - neckHalfWidth - (CENTER_X - neckHalfWidth - OUTER_LEFT) * curve;
}

export function rightBoundAt(y) {
  return W - leftBoundAt(y);
}

export function isInsideGlass(point) {
  if (point.y < TOP_Y || point.y > BOTTOM_Y) return false;
  return point.x >= leftBoundAt(point.y) && point.x <= rightBoundAt(point.y);
}
