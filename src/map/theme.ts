// ゲーム内時刻によるマップの明るさ（設計図 6.3）
type RGB = [number, number, number];

const KEYFRAMES: { t: number; bg: RGB }[] = [
  { t: 300, bg: [255, 214, 196] }, // 5:00 朝焼け
  { t: 390, bg: [255, 255, 255] }, // 6:30 昼
  { t: 960, bg: [255, 255, 255] }, // 16:00
  { t: 1020, bg: [255, 196, 140] }, // 夕焼け（橙）
  { t: 1110, bg: [150, 112, 188] }, // 18:30 夕焼け（紫）
  { t: 1170, bg: [16, 23, 53] }, // 夜
];

export type Theme = {
  bg: string;
  text: string;
  halo: string;
  panel: string;
  border: string;
  stationFill: string;
  stationStroke: string;
  geoCoast: string;
  geoRiver: string;
  geoBorder: string;
  glow: number; // 0..1 夜の発光
  night: number; // 0..1
};

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const mix = (a: RGB, b: RGB, k: number): RGB => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const css = (c: RGB, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

export function themeAt(minute: number): Theme {
  let bg: RGB;
  if (minute <= KEYFRAMES[0].t) bg = KEYFRAMES[0].bg;
  else if (minute >= KEYFRAMES[KEYFRAMES.length - 1].t) bg = KEYFRAMES[KEYFRAMES.length - 1].bg;
  else {
    let i = 0;
    while (KEYFRAMES[i + 1].t < minute) i++;
    const a = KEYFRAMES[i];
    const b = KEYFRAMES[i + 1];
    bg = mix(a.bg, b.bg, (minute - a.t) / (b.t - a.t));
  }
  const lum = (0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]) / 255;
  const night = 1 - Math.min(1, Math.max(0, (lum - 0.2) / 0.5));
  const text = mix([20, 33, 61], [232, 236, 255], night);
  return {
    bg: css(bg),
    text: css(text),
    halo: css(bg, 0.85),
    panel: css(mix([255, 255, 255], [24, 31, 68], night), 0.92),
    border: css(mix([0, 0, 0], [255, 255, 255], night), 0.14),
    stationFill: css(mix([255, 255, 255], [29, 36, 72], night)),
    stationStroke: css(mix([60, 66, 80], [170, 180, 255], night)),
    geoCoast: css(mix([150, 170, 195], [90, 105, 160], night), 0.8),
    geoRiver: css(mix([190, 214, 236], [60, 80, 140], night), 0.8),
    geoBorder: css(mix([205, 205, 215], [90, 95, 140], night), 0.7),
    glow: night,
    night,
  };
}
