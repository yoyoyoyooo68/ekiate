import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildNetwork, decompose, type Defaults, type Overrides, type Tweaks } from '../scripts/build-network';
import { buildTimetable } from '../scripts/build-timetable';
import { headwayAt, lineOffset, runMinutes, synthTimetable } from '../scripts/synth-timetable';
import { parseCsv } from '../scripts/lib/csv';
import { buildGraph, scan } from '../src/routing/csa';

const defaults = JSON.parse(readFileSync(resolve(__dirname, '../data/line-defaults.json'), 'utf8')) as Defaults;
const noOverrides: Overrides = { exclude: [], lines: {} };
const noTweaks: Tweaks = { merge: [], split: [], rename: {}, transfer: { add: [], remove: [] } };

// 駅データ.jp の形式に合わせた小さな見本（東京近辺の座標）
const H = 'station_cd,station_g_cd,station_name,station_name_k,line_cd,pref_cd,lon,lat,e_status';
const stations = (rows: [number, number, string, string, number, number, number, number][]) =>
  [H, ...rows.map((r) => `${r[0]},${r[1]},${r[2]},${r[3]},${r[4]},${r[5]},${r[6]},${r[7]},0`)].join('\n');

const raw = {
  companies: parseCsv('company_cd,company_name\n1,JR東日本\n2,京王電鉄\n3,東京メトロ'),
  lines: parseCsv(
    [
      'line_cd,company_cd,line_name,line_color_c,line_type,e_status',
      '1,1,JR山手線,9ACD32,0,0',
      '2,2,京王線,DD0077,0,0',
      '3,1,JR東北新幹線,00AA00,1,0',
      '4,3,東京メトロ丸ノ内線,F62E36,0,0',
    ].join('\n'),
  ),
  stations: parseCsv(
    stations([
      // 山手線（環状）A-B-C-D
      [11, 100, 'ア', 'ア', 1, 13, 139.70, 35.69],
      [12, 101, 'イ', 'イ', 1, 13, 139.74, 35.69],
      [13, 102, 'ウ', 'ウ', 1, 13, 139.74, 35.65],
      [14, 103, 'エ', 'エ', 1, 13, 139.70, 35.65],
      // 京王線: P1-P2-P3-P4 と P3-P5（支線）
      [21, 100, 'ア', 'ア', 2, 13, 139.70, 35.69], // アと同じ駅
      [22, 200, 'ピ２', 'ピ２', 2, 13, 139.66, 35.69],
      [23, 201, 'ピ３', 'ピ３', 2, 13, 139.62, 35.69],
      [24, 202, 'ピ４', 'ピ４', 2, 13, 139.58, 35.69],
      [25, 203, 'ピ５', 'ピ５', 2, 13, 139.62, 35.65],
      // 新幹線（除く）
      [31, 100, 'ア', 'ア', 3, 13, 139.70, 35.69],
      [32, 300, '茨城', 'イバラキ', 3, 8, 140.2, 36.1],
      // 丸ノ内線: ウの近くに別名の駅（乗換ペアの自動検出）、県外の駅、同名の別駅（ウ）
      [41, 400, 'ウ南', 'ウミナミ', 4, 13, 139.7415, 35.6495],
      [42, 401, 'ウ', 'ウ', 4, 13, 139.50, 35.60], // 遠く離れた同名 → 別の駅
      [43, 402, '栃木', 'トチギ', 4, 9, 139.50, 35.90],
    ]),
  ),
  joins: parseCsv(
    [
      'line_cd,station_cd1,station_cd2',
      '1,11,12', '1,12,13', '1,13,14', '1,14,11',
      '2,21,22', '2,22,23', '2,23,24', '2,23,25',
      '3,31,32',
      '4,41,42', '4,42,43',
    ].join('\n'),
  ),
};

describe('parseCsv', () => {
  it('クォート・BOM・改行コードを扱う', () => {
    const r = parseCsv('﻿a,b\r\n"x,1","y""z"\r\n2,3\r\n');
    expect(r).toEqual([{ a: 'x,1', b: 'y"z' }, { a: '2', b: '3' }]);
  });
});

describe('decompose', () => {
  it('一本の線は 1 経路、環は loop', () => {
    expect(decompose([[1, 2], [2, 3], [3, 4]]).map((p) => p.path.length)).toEqual([4]);
    const loop = decompose([[1, 2], [2, 3], [3, 4], [4, 1]]);
    expect(loop).toHaveLength(1);
    expect(loop[0].loop).toBe(true);
    expect(new Set(loop[0].path).size).toBe(4);
  });
  it('支線は別の経路になり、すべての辺が覆われる', () => {
    const edges: [number, number][] = [[1, 2], [2, 3], [3, 4], [3, 5], [5, 6]];
    const parts = decompose(edges);
    expect(parts).toHaveLength(2);
    const covered = new Set<string>();
    for (const p of parts) for (let i = 0; i + 1 < p.path.length; i++) covered.add([p.path[i], p.path[i + 1]].sort().join('-'));
    for (const [a, b] of edges) expect(covered.has([a, b].sort().join('-'))).toBe(true);
  });
  it('つながっていない部分は別経路', () => {
    expect(decompose([[1, 2], [3, 4]])).toHaveLength(2);
  });
});

describe('buildNetwork', () => {
  const { network, meta, warnings } = buildNetwork(raw, defaults, noOverrides, noTweaks);
  const names = network.stations.map((s) => s.name);

  it('新幹線・県外の駅を除き、同じ駅（station_g_cd）をまとめる', () => {
    expect(network.lines.map((l) => l.name).some((n) => n.includes('新幹線'))).toBe(false);
    expect(names).not.toContain('茨城');
    expect(names).not.toContain('栃木');
    expect(names.filter((n) => n.startsWith('ア'))).toHaveLength(1);
    const a = network.stations.find((s) => s.name === 'ア')!;
    expect(a.lines.length).toBe(2); // 山手線と京王線
  });
  it('同名で離れた駅は別の駅にして、路線名で区別する', () => {
    const us = names.filter((n) => n.startsWith('ウ（'));
    expect(us).toHaveLength(2);
  });
  it('駅 ID の順に並ぶ', () => {
    const ids = network.stations.map((s) => s.id);
    expect(ids).toEqual([...ids].sort());
  });
  it('環状線・支線・種類の判定', () => {
    const yama = network.lines.findIndex((l) => l.name === 'JR山手線');
    expect(network.lines[yama].loop).toBe(true);
    expect(meta[yama].kind).toBe('jrCore');
    expect(network.lines.filter((l) => l.name.startsWith('京王線')).length).toBe(2);
    expect(meta[network.lines.findIndex((l) => l.name.includes('丸ノ内'))].kind).toBe('subway');
    expect(network.lines.every((l) => l.timeSource === 'estimated')).toBe(true);
  });
  it('200m 以内で共通の路線が無い別名の駅は乗換ペアになる', () => {
    const wu = network.stations.findIndex((s) => s.name.startsWith('ウ（') && s.lines.length === 1 && network.lines[s.lines[0]].name === 'JR山手線');
    const south = names.indexOf('ウ南');
    expect(wu).toBeGreaterThanOrEqual(0);
    expect(network.transferPairs.some(([a, b]) => (a === wu && b === south) || (a === south && b === wu))).toBe(true);
  });
  it('乗換ペアの手直し（add / remove・見つからない名前は警告）', () => {
    const t: Tweaks = { ...noTweaks, transfer: { add: [['ア', 'ピ４'], ['ア', 'ナイ駅']], remove: [] } };
    const r = buildNetwork(raw, defaults, noOverrides, t);
    expect(r.network.transferPairs.length).toBe(network.transferPairs.length + 1);
    expect(r.warnings.some((w) => w.includes('ナイ駅'))).toBe(true);
    expect(warnings).toEqual([]);
  });
  it('line-overrides で除外・上書きできる', () => {
    const r = buildNetwork(raw, defaults, { exclude: ['京王線'], lines: { 'JR山手線': { kind: 'local', speed: 20 } } }, noTweaks);
    expect(r.network.lines.some((l) => l.name.startsWith('京王線'))).toBe(false);
    expect(r.meta[0].kind).toBe('local');
    expect(r.meta[0].speed).toBe(20);
  });
});

describe('synthTimetable', () => {
  it('所要時間・運転間隔・ずれ', () => {
    expect(runMinutes(0, 30, 0.5)).toBe(1);
    expect(runMinutes(5, 30, 0.5)).toBe(11); // 10 分 + 0.5 → 切り上げ
    expect(headwayAt(defaults.kinds.subway.headway, 8 * 60)).toBe(3);
    expect(headwayAt(defaults.kinds.subway.headway, 24 * 60)).toBe(10);
    expect(lineOffset(7)).toBe(lineOffset(7));
    expect(lineOffset(1)).toBeLessThan(5);
  });

  const { network, meta } = buildNetwork(raw, defaults, noOverrides, noTweaks);
  const conns = synthTimetable(network, meta, defaults);
  const tt = buildTimetable(conns);

  it('終電は終点着（kind の last）を超えない。始発以降に走る', () => {
    expect(tt.count).toBeGreaterThan(0);
    network.lines.forEach((l, li) => {
      if (l.loop) return;
      const last = defaults.kinds[meta[li].kind].last;
      const set = new Set(l.stations);
      let max = 0;
      for (const c of conns) if (set.has(c.d) && set.has(c.a)) max = Math.max(max, c.arr);
      expect(max).toBeLessThanOrEqual(last);
    });
    for (let i = 1; i < tt.count; i++) expect(tt.dep[i]).toBeGreaterThanOrEqual(tt.dep[i - 1]);
  });
  it('両方向の列車がある', () => {
    const a = network.stations.findIndex((s) => s.name === 'ピ４');
    const b = network.stations.findIndex((s) => s.name === 'ア');
    expect(conns.some((c) => c.d === a)).toBe(true);
    expect(conns.some((c) => c.a === a)).toBe(true);
    expect(conns.some((c) => c.d === b)).toBe(true);
  });
  it('CSA で駅どうしに行ける（支線の乗換・乗換ペア・終電）', () => {
    const g = buildGraph(tt, network.stations.length, network.transferPairs);
    const idx = (n: string) => network.stations.findIndex((s) => s.name === n);
    const r = scan(g, idx('ピ４'), 5 * 60);
    expect(r.arr[idx('ピ５')]).toBeLessThan(10 * 60); // ピ３ で支線へ
    expect(r.arr[idx('イ')]).toBeLessThan(12 * 60); // 京王線 → 山手線
    const late = scan(g, idx('ピ４'), 26 * 60);
    expect(late.arr[idx('イ')]).toBeGreaterThan(1_000_000 - 1); // 終電後は行けない
  });
});
