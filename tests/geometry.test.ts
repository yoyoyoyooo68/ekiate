import { describe, expect, it } from 'vitest';
import { MinHeap, simplify } from '../scripts/lib/geometry';
import { attachGeometry, geometryOf, MapGeometry } from '../src/map/geometry';
import type { Geometry } from '../src/types';
import { makeNetwork } from './helpers';

describe('形の計算', () => {
  it('簡略化は許容内の点を落とし、端と曲がりを残す', () => {
    const out = simplify([[0, 0], [50, 1], [100, 0], [100, 100]], 5);
    expect(out).toEqual([[0, 0], [100, 0], [100, 100]]);
  });
  it('ヒープは小さい順に取り出す', () => {
    const h = new MinHeap();
    [5, 1, 3, 2, 4].forEach((p) => h.push(p, p * 10));
    expect([1, 2, 3, 4, 5].map(() => h.pop()![1])).toEqual([10, 20, 30, 40, 50]);
  });
});

describe('MapGeometry', () => {
  const net = makeNetwork(3);
  net.lines = [{ name: 'L', company: 'C', color: '#000', stations: [0, 1, 2], timeSource: 'estimated' }];
  it('形が無いときは駅を直線で結ぶ', () => {
    const g = new MapGeometry(net, null);
    expect(g.lineSegs[0].length).toBe(2);
    expect(g.between(1, 0)?.reversed).toBe(true);
    expect(g.between(0, 2)).toBeNull();
  });
  it('駅・路線の数が合わない形は使わない', () => {
    const geo = { stations: 2, lines: 1 } as Geometry;
    attachGeometry(net, geo);
    expect(geometryOf(net)).toBeNull();
  });
});
