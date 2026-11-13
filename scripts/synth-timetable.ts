// β: 概算ダイヤ（設計図 2.5.3 / 2.5.4）。駅間の所要時間と運転間隔から仮の列車を作る。
import type { Network } from '../src/types';
import { km } from './lib/geo';
import type { Defaults, Headway, LineMeta } from './build-network';

export type Conn = { d: number; a: number; dep: number; arr: number; trip: number };

export function headwayAt(h: Headway, t: number): number {
  if (t < 420) return h.early;
  if (t < 540) return h.peak;
  if (t < 1200) return h.day;
  if (t < 1380) return h.evening;
  return h.late;
}

/** 駅間の分数 = 距離 ÷ 平均速度 ＋ 停車 0.5 分、切り上げ（最低 1 分） */
export function runMinutes(distKm: number, speed: number, stop: number): number {
  return Math.max(1, Math.ceil((distKm / speed) * 60 + stop - 1e-9));
}

/** 路線 ID から決まる固定のずれ（0〜4 分）。全路線が同じ分に出ないようにする */
export function lineOffset(lineCd: number): number {
  return (lineCd * 7919) % 5;
}

export function synthTimetable(net: Network, meta: LineMeta[], defaults: Defaults): Conn[] {
  const conns: Conn[] = [];
  let trip = 0;
  net.lines.forEach((line, li) => {
    const m = meta[li];
    const k = defaults.kinds[m.kind];
    const speed = m.speed ?? k.speed;
    const first = m.first ?? k.first;
    const last = m.last ?? k.last;
    const head = m.headway ?? k.headway;
    const off = lineOffset(m.lineCd);
    const ids = line.stations;
    const fwd = line.loop ? [...ids, ids[0]] : ids;
    const rev = line.loop ? [ids[0], ...ids.slice(1).reverse(), ids[0]] : [...ids].reverse();
    for (const path of [fwd, rev]) {
      const runs: number[] = [];
      for (let i = 0; i + 1 < path.length; i++) {
        const a = net.stations[path[i]];
        const b = net.stations[path[i + 1]];
        runs.push(runMinutes(km(a.lat, a.lon, b.lat, b.lon), speed, defaults.stopMinutes));
      }
      const total = runs.reduce((x, y) => x + y, 0);
      // 終電は「終点着」。環状線は 1 周の半分だけ手前を最終の起点発とする
      const lastDep = last - (line.loop ? Math.floor(total / 2) : total);
      for (let t = first + off; t <= lastDep; t += headwayAt(head, t)) {
        let at = t;
        for (let i = 0; i < runs.length; i++) {
          conns.push({ d: path[i], a: path[i + 1], dep: at, arr: at + runs[i], trip });
          at += runs[i];
        }
        trip++;
      }
    }
  });
  return conns;
}
