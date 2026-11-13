/// <reference lib="webworker" />
import { decodeTimetable } from '../data/timetable';
import { buildGraph, lastDepartureOf, reconstruct, scan, type Graph } from './csa';

let graph: Graph | null = null;

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'init') {
    graph = buildGraph(decodeTimetable(m.buffer), m.numStations, m.pairs);
    (self as unknown as Worker).postMessage({ type: 'ready' });
  } else if (m.type === 'reach' && graph) {
    const r = scan(graph, m.start, m.boardAt);
    (self as unknown as Worker).postMessage({ id: m.id, arr: r.arr }, [r.arr.buffer]);
  } else if (m.type === 'last' && graph) {
    (self as unknown as Worker).postMessage({ id: m.id, last: lastDepartureOf(graph, m.station) });
  } else if (m.type === 'path' && graph) {
    const r = scan(graph, m.start, m.boardAt);
    (self as unknown as Worker).postMessage({ id: m.id, legs: reconstruct(graph, r, m.target) });
  }
};
