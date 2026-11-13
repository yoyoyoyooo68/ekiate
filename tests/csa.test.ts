import { describe, expect, it } from 'vitest';
import { INF, reconstruct, scan } from '../src/routing/csa';
import { setup } from './helpers';

// 駅 0=A 1=B 2=C 3=D
describe('CSA', () => {
  it('途中の乗換は 0 分（着いた分と同じ分の発車に乗れる）', () => {
    const { g } = setup(3, [
      [0, 1, 600, 610, 0],
      [1, 2, 610, 620, 1],
    ]);
    expect(scan(g, 0, 600).arr[2]).toBe(620);
  });

  it('着いた後は +1 分以降の発車しか乗れない', () => {
    const { g } = setup(3, [[1, 2, 610, 620, 1]]);
    expect(scan(g, 1, 610).arr[2]).toBe(620); // 610 以降
    expect(scan(g, 1, 611).arr[2]).toBe(INF); // 611 以降は同じ分の電車に乗れない
  });

  it('乗ってきた電車に乗り続けられる', () => {
    const { g } = setup(3, [
      [0, 1, 600, 610, 0],
      [1, 2, 610, 620, 0],
    ]);
    expect(scan(g, 0, 600).arr[2]).toBe(620);
  });

  it('乗換ペアは 0 分で乗り換えられる', () => {
    const rows: [number, number, number, number, number][] = [
      [0, 1, 600, 610, 0],
      [2, 3, 610, 620, 1],
    ];
    expect(scan(setup(4, rows).g, 0, 600).arr[3]).toBe(INF);
    expect(scan(setup(4, rows, [[1, 2]]).g, 0, 600).arr[3]).toBe(620);
  });

  it('乗換ペアの相手駅へは電車で着かないと行けない', () => {
    const { g } = setup(3, [[0, 2, 600, 610, 0]], [[0, 1]]);
    expect(scan(g, 0, 600).arr[1]).toBe(INF);
  });

  it('経路を復元できる', () => {
    const { g } = setup(4, [
      [0, 1, 600, 610, 0],
      [1, 2, 610, 620, 0],
      [2, 3, 625, 640, 1],
    ]);
    const r = scan(g, 0, 600);
    const legs = reconstruct(g, r, 3)!;
    expect(legs.map((l) => [l.from, l.to])).toEqual([[0, 2], [2, 3]]);
    expect(legs[0].stops).toEqual([0, 1, 2]);
    expect(legs[1].arr).toBe(640);
  });
});
