// Connection Scan Algorithm
import type { Timetable } from '../types';

export const INF = 1_000_000_000;

export type Leg = {
  trip: number;
  from: number;
  to: number;
  dep: number;
  arr: number;
  stops: number[]; // from .. to（途中駅を含む）
  times: number[]; // 各 stop の時刻（先頭は発車、以降は到着）
};

export type Graph = {
  tt: Timetable;
  numStations: number;
  group: Int32Array; // 乗換ペアで 0 分乗換できる駅の集まり
  numGroups: number;
  numTrips: number;
};

export function buildGraph(tt: Timetable, numStations: number, pairs: [number, number][]): Graph {
  const parent = Array.from({ length: numStations }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (const [a, b] of pairs) parent[find(a)] = find(b);
  const ids = new Map<number, number>();
  const group = new Int32Array(numStations);
  for (let i = 0; i < numStations; i++) {
    const r = find(i);
    if (!ids.has(r)) ids.set(r, ids.size);
    group[i] = ids.get(r)!;
  }
  let maxTrip = -1;
  for (let i = 0; i < tt.count; i++) if (tt.trip[i] > maxTrip) maxTrip = tt.trip[i];
  return { tt, numStations, group, numGroups: ids.size, numTrips: maxTrip + 1 };
}

export type ScanResult = {
  /** 各駅への最早到着時刻（INF = 今日中に行けない）。出発駅は列車で戻ってきたときだけ値が入る */
  arr: Int32Array;
  inConn: Int32Array;
  tripEnter: Int32Array;
  tripPrev: Int32Array;
};

/**
 * start を boardAt 以降に出発して全駅へ行く最早到着時刻。
 * 乗換は 0 分（同じ駅・乗換ペア、着いた分と同じ分の発車に乗れる）。
 */
export function scan(g: Graph, start: number, boardAt: number): ScanResult {
  const { tt } = g;
  const arr = new Int32Array(g.numStations).fill(INF);
  const inConn = new Int32Array(g.numStations).fill(-1);
  const tripEnter = new Int32Array(g.numTrips).fill(-1);
  const tripPrev = new Int32Array(g.numTrips).fill(-1);
  const board = new Int32Array(g.numGroups).fill(INF);
  const boardSrc = new Int32Array(g.numGroups).fill(-1);
  board[g.group[start]] = boardAt;

  // 出発時刻 >= boardAt の最初の接続
  let lo = 0;
  let hi = tt.count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tt.dep[mid] < boardAt) lo = mid + 1;
    else hi = mid;
  }

  for (let i = lo; i < tt.count; i++) {
    const trip = tt.trip[i];
    const gu = g.group[tt.depStation[i]];
    let ok = tripEnter[trip] >= 0;
    if (!ok && tt.dep[i] >= board[gu]) {
      ok = true;
      tripEnter[trip] = i;
      tripPrev[trip] = boardSrc[gu];
    }
    if (!ok) continue;
    const v = tt.arrStation[i];
    const a = tt.arr[i];
    if (a < arr[v]) {
      arr[v] = a;
      inConn[v] = i;
    }
    const gv = g.group[v];
    if (a < board[gv]) {
      board[gv] = a;
      boardSrc[gv] = i;
    }
  }
  return { arr, inConn, tripEnter, tripPrev };
}

/** target までの経路（乗った列車ごとの区間）。行けないなら null。 */
export function reconstruct(g: Graph, r: ScanResult, target: number): Leg[] | null {
  const { tt } = g;
  let cur = r.inConn[target];
  if (cur < 0) return null;
  const legs: Leg[] = [];
  while (cur >= 0) {
    const trip = tt.trip[cur];
    const enter = r.tripEnter[trip];
    const stops = [tt.depStation[enter]];
    const times = [tt.dep[enter]];
    for (let j = enter; j <= cur; j++) {
      if (tt.trip[j] !== trip) continue;
      stops.push(tt.arrStation[j]);
      times.push(tt.arr[j]);
    }
    legs.push({
      trip,
      from: stops[0],
      to: stops[stops.length - 1],
      dep: times[0],
      arr: times[times.length - 1],
      stops,
      times,
    });
    cur = r.tripPrev[trip];
  }
  return legs.reverse();
}
