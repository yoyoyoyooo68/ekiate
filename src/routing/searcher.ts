import { decodeTimetable } from '../data/timetable';
import type { Network } from '../types';
import { buildGraph, lastDepartureOf, reconstruct, scan, type Graph, type Leg } from './csa';

/** 経路探索の窓口。ゲームのルールはこれ越しに探索する（Worker でも直接でも同じ形）。 */
export interface Searcher {
  /** start を boardAt 以降に出発して、全駅への最早到着時刻 */
  reach(start: number, boardAt: number): Promise<Int32Array>;
  /** start を boardAt 以降に出発して target に最も早く着く経路 */
  path(start: number, boardAt: number, target: number): Promise<Leg[] | null>;
  /** その駅の最終発車時刻（列車が無ければ null） */
  lastDeparture(station: number): Promise<number | null>;
}

export class LocalSearcher implements Searcher {
  constructor(private g: Graph) {}
  async lastDeparture(station: number) {
    return lastDepartureOf(this.g, station);
  }
  async reach(start: number, boardAt: number) {
    return scan(this.g, start, boardAt).arr;
  }
  async path(start: number, boardAt: number, target: number) {
    return reconstruct(this.g, scan(this.g, start, boardAt), target);
  }
}

export class WorkerSearcher implements Searcher {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, (v: any) => void>();
  private ready: Promise<void>;
  /** 計算中の件数（UI の「調べています…」用） */
  busy = 0;
  onBusyChange?: (busy: boolean) => void;

  constructor(buffer: ArrayBuffer, net: Network) {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.ready = new Promise((resolve, reject) => {
      this.worker.onmessage = (e) => {
        if (e.data.type === 'ready') resolve();
        else this.pending.get(e.data.id)?.(e.data), this.pending.delete(e.data.id);
      };
      this.worker.onerror = (e) => reject(e);
    });
    this.worker.postMessage(
      { type: 'init', buffer, numStations: net.stations.length, pairs: net.transferPairs },
      [buffer],
    );
  }

  private async call(msg: object): Promise<any> {
    await this.ready;
    const id = this.nextId++;
    this.setBusy(1);
    return new Promise((resolve) => {
      this.pending.set(id, (v) => {
        this.setBusy(-1);
        resolve(v);
      });
      this.worker.postMessage({ ...msg, id });
    });
  }
  private setBusy(d: number) {
    const was = this.busy > 0;
    this.busy += d;
    if (was !== this.busy > 0) this.onBusyChange?.(this.busy > 0);
  }
  async reach(start: number, boardAt: number) {
    return (await this.call({ type: 'reach', start, boardAt })).arr as Int32Array;
  }
  async path(start: number, boardAt: number, target: number) {
    return (await this.call({ type: 'path', start, boardAt, target })).legs as Leg[] | null;
  }
  async lastDeparture(station: number) {
    return (await this.call({ type: 'last', station })).last as number | null;
  }
}

export function createSearcher(buffer: ArrayBuffer, net: Network): Searcher {
  try {
    return new WorkerSearcher(buffer.slice(0), net);
  } catch {
    const g = buildGraph(decodeTimetable(buffer), net.stations.length, net.transferPairs);
    return new LocalSearcher(g);
  }
}
