import type { Network } from '../types';

/** cyrb53 ハッシュ（53 ビット） */
export function hash53(str: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function normalizeSeed(s: string): string {
  return s.normalize('NFKC').trim();
}

/** 正解の駅 index: ハッシュ(シード + データ版) → 駅 ID 順に並べた何番目か */
export function answerFor(net: Network, seed: string): number {
  const order = net.stations.map((_, i) => i).sort((a, b) => (net.stations[a].id < net.stations[b].id ? -1 : 1));
  return order[hash53(`${normalizeSeed(seed)}|${net.version}`) % order.length];
}

/** 日本時間の今日 "2026-11-13" */
export function todaySeed(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function randomSeed(): string {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return (a[0].toString(36) + a[1].toString(36)).slice(0, 7);
}
