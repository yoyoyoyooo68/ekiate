import { buildGraph, type Graph } from '../src/routing/csa';
import { LocalSearcher } from '../src/routing/searcher';
import type { Network, Timetable } from '../src/types';

/** [出発駅, 到着駅, 出発分, 到着分, 列車] の並びから Timetable を作る */
export function makeTimetable(rows: [number, number, number, number, number][]): Timetable {
  const sorted = [...rows].sort((a, b) => a[2] - b[2]);
  const n = sorted.length;
  const t: Timetable = {
    count: n,
    depStation: new Uint16Array(n),
    arrStation: new Uint16Array(n),
    dep: new Uint16Array(n),
    arr: new Uint16Array(n),
    trip: new Uint32Array(n),
  };
  sorted.forEach((r, i) => {
    t.depStation[i] = r[0];
    t.arrStation[i] = r[1];
    t.dep[i] = r[2];
    t.arr[i] = r[3];
    t.trip[i] = r[4];
  });
  return t;
}

export function makeNetwork(n: number, pairs: [number, number][] = []): Network {
  return {
    version: 't1',
    stations: Array.from({ length: n }, (_, i) => ({
      id: `T${i}`, name: `駅${i}`, kana: `えき${i}`, lat: 35 + i * 0.01, lon: 139, lines: [],
    })),
    lines: [],
    transferPairs: pairs,
  };
}

export function setup(n: number, rows: [number, number, number, number, number][], pairs: [number, number][] = []) {
  const net = makeNetwork(n, pairs);
  const g: Graph = buildGraph(makeTimetable(rows), n, pairs);
  return { net, g, searcher: new LocalSearcher(g) };
}
