import type { Network } from '../types';

/** 時刻が概算の路線がどれだけあるか: 'all'（β 版）/ 'some'（本物と混在）/ null（すべて本物） */
export function estimateLevel(net: Network): 'all' | 'some' | null {
  const n = net.lines.filter((l) => l.timeSource === 'estimated').length;
  if (n === 0) return null;
  return n === net.lines.length ? 'all' : 'some';
}

export const ESTIMATE_BADGE = { all: 'β 概算ダイヤ', some: '一部の路線は概算' } as const;
export const ESTIMATE_RULE = {
  all: 'いまは概算の時刻で、実際のダイヤとは違います。',
  some: '一部の路線は概算の時刻で、実際のダイヤとは違います（マップで路線を押すと分かります）。',
} as const;
