// 概算ダイヤの確かめ用: 駅 A を指定の時刻に出て駅 B に最短でいつ着くか。乗換案内と見比べる。
//   npm run check:route -- 新宿 横浜 8:00
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeTimetable } from '../src/data/timetable';
import { buildGraph, INF, scan } from '../src/routing/csa';
import type { Network } from '../src/types';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data');
const net = JSON.parse(readFileSync(resolve(dir, 'network.json'), 'utf8')) as Network;
const buf = readFileSync(resolve(dir, 'timetable.bin'));
const tt = decodeTimetable(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
const g = buildGraph(tt, net.stations.length, net.transferPairs);

const [from, to, at = '8:00'] = process.argv.slice(2);
const find = (n: string) => net.stations.map((s, i) => [s.name, i] as const).filter(([name]) => name === n || name.startsWith(`${n}（`) || name.startsWith(`${n}〈`));
const [h, m] = at.split(':').map(Number);
const fmt = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
for (const [fn, fi] of find(from)) {
  const r = scan(g, fi, h * 60 + m);
  for (const [tn, ti] of find(to)) {
    const t = r.arr[ti];
    console.log(`${fn} ${fmt(h * 60 + m)}発 → ${tn}: ${t >= INF ? '今日中には着けません' : `${fmt(t)} 着（${t - (h * 60 + m)} 分）`}`);
  }
}
