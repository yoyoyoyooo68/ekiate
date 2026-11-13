// 国土数値情報（鉄道データ N02 ほか）→ data/geometry.json（線の形・並走のずらし・背景。設計図 4.1b・6.9）
//   npm run data:geometry         （元データは data/ksj/ か、環境変数 KSJ_DIR）
//
//   data/ksj/ に置くもの
//     N02-xx_RailroadSection.geojson   必須（鉄道データ。https://nlftp.mlit.go.jp/ksj/ の N02）
//     coast.geojson / rivers.geojson / borders.geojson   任意（海岸線・川・都県境。線や面の GeoJSON。無ければ背景なし）
//
// 駅データ.jp の路線と N02 の線は名前の区切り方が違うので、名前ではなく位置で対応を取る:
//   路線の駅の近く（200m 以内）を通る N02 の線を、会社が合うものから選び、その上の最短経路を駅の間ごとに引く。
//   data/geometry-line-map.json で会社名の別名や、うまくいかない路線の手直しができる。
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Geometry } from '../src/types';
import { buildNetwork, readEkidata, type Defaults, type Overrides, type Tweaks } from './build-network';
import { distToSegment, makeProjection, MinHeap, r5, simplify, type LonLat } from './lib/geometry';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = <T>(f: string): T => JSON.parse(readFileSync(resolve(root, 'data', f), 'utf8'));
const ksjDir = resolve(process.env.KSJ_DIR ?? resolve(root, 'data/ksj'));

type LineMap = {
  /** 駅データ.jp の会社名 → N02 の事業者名（複数可） */
  companies: Record<string, string[]>;
  /** 路線名 → { companies: 使う N02 の事業者名, groups: 使う N02 の路線を "事業者名/路線名" で直接指定, skip: true で直線 } */
  lines: Record<string, { companies?: string[]; groups?: string[]; skip?: boolean }>;
};

// ---------- 入力 ----------
const raw = readEkidata(resolve(process.env.EKIDATA_DIR ?? resolve(root, 'data/ekidata')));
const merge = json<{ merge: number[][]; split: number[]; rename: Record<string, string> }>('station-merge.json');
const tweaks: Tweaks = { ...merge, transfer: json('transfer-pairs.json') };
const { network, meta } = buildNetwork(raw, json<Defaults>('line-defaults.json'), json<Overrides>('line-overrides.json'), tweaks);
const lineMap = json<LineMap>('geometry-line-map.json');
const S = network.stations;

if (!existsSync(ksjDir)) throw new Error(`${ksjDir} がありません。国土数値情報の N02 を置いてください（冒頭のコメント参照）`);
const ksjFiles = readdirSync(ksjDir);
const n02File = ksjFiles.find((f) => /RailroadSection\.geojson$/.test(f));
if (!n02File) throw new Error(`${ksjDir} に *_RailroadSection.geojson がありません`);

const lonMin = Math.min(...S.map((s) => s.lon)) - 0.15;
const lonMax = Math.max(...S.map((s) => s.lon)) + 0.15;
const latMin = Math.min(...S.map((s) => s.lat)) - 0.15;
const latMax = Math.max(...S.map((s) => s.lat)) + 0.15;
const inBox = (p: number[]) => p[0] >= lonMin && p[0] <= lonMax && p[1] >= latMin && p[1] <= latMax;
const P = makeProjection(139.7, 35.7);

// ---------- N02 の線をグラフにする ----------
type GJ = { features: { properties: Record<string, string>; geometry: { type: string; coordinates: any } }[] };
const n02 = JSON.parse(readFileSync(resolve(ksjDir, n02File), 'utf8')) as GJ;

const nx: number[] = [];
const ny: number[] = [];
const nodeOf = new Map<string, number>();
const adj: { to: number; w: number; g: number }[][] = [];
const node = (lon: number, lat: number) => {
  const k = `${Math.round(lon * 1e5)},${Math.round(lat * 1e5)}`;
  let id = nodeOf.get(k);
  if (id === undefined) {
    id = nx.length;
    nodeOf.set(k, id);
    nx.push(P.x(lon));
    ny.push(P.y(lat));
    adj.push([]);
  }
  return id;
};
type Group = { company: string; name: string };
const groups: Group[] = [];
const groupOf = new Map<string, number>();
const edgesU: number[] = [];
const edgesV: number[] = [];
const edgesG: number[] = [];
const endpoints: number[] = [];
for (const f of n02.features) {
  const pr = f.properties;
  if (pr.N02_002 === '1') continue; // 新幹線
  const lines: number[][][] = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates];
  for (const coords of lines) {
    if (!coords.some(inBox)) continue;
    const gk = `${pr.N02_004}/${pr.N02_003}`;
    if (!groupOf.has(gk)) (groupOf.set(gk, groups.length), groups.push({ company: pr.N02_004, name: pr.N02_003 }));
    const g = groupOf.get(gk)!;
    let prev = -1;
    coords.forEach((c, i) => {
      const id = node(c[0], c[1]);
      if (i === 0 || i === coords.length - 1) endpoints.push(id);
      if (prev >= 0 && prev !== id) {
        const w = Math.hypot(nx[id] - nx[prev], ny[id] - ny[prev]);
        adj[prev].push({ to: id, w, g });
        adj[id].push({ to: prev, w, g });
        edgesU.push(prev);
        edgesV.push(id);
        edgesG.push(g);
      }
      prev = id;
    });
  }
}
// 端点どうしが 15m 以内なら、別の線でもつなぐ（g = -1: どの路線でも通れる）
{
  const cell = new Map<string, number[]>();
  for (const id of new Set(endpoints)) {
    const k = `${Math.floor(nx[id] / 15)},${Math.floor(ny[id] / 15)}`;
    (cell.get(k) ?? cell.set(k, []).get(k)!).push(id);
  }
  for (const id of new Set(endpoints)) {
    const cx = Math.floor(nx[id] / 15);
    const cy = Math.floor(ny[id] / 15);
    for (let a = cx - 1; a <= cx + 1; a++)
      for (let b = cy - 1; b <= cy + 1; b++)
        for (const o of cell.get(`${a},${b}`) ?? []) {
          if (o <= id) continue;
          const w = Math.hypot(nx[id] - nx[o], ny[id] - ny[o]);
          if (w > 15 || w === 0) continue;
          adj[id].push({ to: o, w, g: -1 });
          adj[o].push({ to: id, w, g: -1 });
        }
  }
}
console.log(`N02: 線 ${groups.length} 本・折れ線の点 ${nx.length}・辺 ${edgesU.length}`);

// 辺の空間インデックス（300m の格子）
const CELL = 300;
const grid = new Map<string, number[]>();
for (let e = 0; e < edgesU.length; e++) {
  const x0 = Math.min(nx[edgesU[e]], nx[edgesV[e]]);
  const x1 = Math.max(nx[edgesU[e]], nx[edgesV[e]]);
  const y0 = Math.min(ny[edgesU[e]], ny[edgesV[e]]);
  const y1 = Math.max(ny[edgesU[e]], ny[edgesV[e]]);
  for (let a = Math.floor(x0 / CELL); a <= Math.floor(x1 / CELL); a++)
    for (let b = Math.floor(y0 / CELL); b <= Math.floor(y1 / CELL); b++) (grid.get(`${a},${b}`) ?? grid.set(`${a},${b}`, []).get(`${a},${b}`)!).push(e);
}
type Snap = { d: number; e: number; t: number; x: number; y: number };
/** 点に一番近い辺（許可した線の中から）。maxD(m) 以内に無ければ null */
function snap(x: number, y: number, allowed: Set<number>, maxD: number): Snap | null {
  let best: Snap | null = null;
  const r = Math.ceil(maxD / CELL);
  const cx = Math.floor(x / CELL);
  const cy = Math.floor(y / CELL);
  for (let a = cx - r; a <= cx + r; a++)
    for (let b = cy - r; b <= cy + r; b++)
      for (const e of grid.get(`${a},${b}`) ?? []) {
        if (!allowed.has(edgesG[e])) continue;
        const s = distToSegment(x, y, nx[edgesU[e]], ny[edgesU[e]], nx[edgesV[e]], ny[edgesV[e]]);
        if (s.d <= maxD && (!best || s.d < best.d)) best = { d: s.d, e, t: s.t, x: s.x, y: s.y };
      }
  return best;
}

// 最短経路（許可した線だけ通る）
const dist = new Float64Array(nx.length);
const stamp = new Int32Array(nx.length);
const prevNode = new Int32Array(nx.length);
let run = 0;
function route(a: Snap, b: Snap, allowed: Set<number>): [number, number][] | null {
  if (a.e === b.e) return [[a.x, a.y], [b.x, b.y]];
  run++;
  const heap = new MinHeap();
  const setD = (n: number, d: number, from: number) => {
    if (stamp[n] !== run || d < dist[n]) {
      stamp[n] = run;
      dist[n] = d;
      prevNode[n] = from;
      heap.push(d, n);
    }
  };
  const len = (s: Snap) => Math.hypot(nx[edgesU[s.e]] - nx[edgesV[s.e]], ny[edgesU[s.e]] - ny[edgesV[s.e]]);
  const la = len(a);
  const lb = len(b);
  setD(edgesU[a.e], a.t * la, -1);
  setD(edgesV[a.e], (1 - a.t) * la, -1);
  const tu = edgesU[b.e];
  const tv = edgesV[b.e];
  const tailU = b.t * lb;
  const tailV = (1 - b.t) * lb;
  let bestTotal = Infinity;
  let bestEnd = -1;
  let limit = Math.hypot(a.x - b.x, a.y - b.y) * 3 + 1500; // 遠回りしすぎる経路は探さない
  for (let it = heap.pop(); it; it = heap.pop()) {
    const [d, n] = it;
    if (d > dist[n] || d >= bestTotal || d > limit) continue;
    if (n === tu && d + tailU < bestTotal) (bestTotal = d + tailU), (bestEnd = n);
    if (n === tv && d + tailV < bestTotal) (bestTotal = d + tailV), (bestEnd = n);
    for (const e of adj[n]) {
      if (e.g >= 0 && !allowed.has(e.g)) continue;
      setD(e.to, d + e.w, n);
    }
  }
  if (bestEnd < 0) return null;
  const nodes: number[] = [];
  for (let n = bestEnd; n !== -1; n = prevNode[n]) nodes.push(n);
  nodes.reverse();
  return [[a.x, a.y], ...nodes.map((n): [number, number] => [nx[n], ny[n]]), [b.x, b.y]];
}

// ---------- 路線ごとに N02 の線を選び、駅の間の形を引く ----------
const compat = (netCompany: string, n02Company: string, extra?: string[]) => {
  const names = extra ?? lineMap.companies[netCompany] ?? [netCompany];
  return names.some((n) => n02Company === n || n02Company.includes(n) || n.includes(n02Company));
};

type Seg = { line: number; k: number; from: number; to: number; xy: [number, number][]; real: boolean; offset: number };
const stXY = S.map((s) => [P.x(s.lon), P.y(s.lat)] as [number, number]);
const segs: Seg[] = [];
const lineSnaps: Map<number, Snap>[] = []; // 路線ごと: 駅 → 線の上の点
const lineInfo: { chosen: string[]; real: number; total: number }[] = [];
const stationBest: ({ d: number; x: number; y: number } | null)[] = S.map(() => null);

network.lines.forEach((l, li) => {
  const ov = lineMap.lines[l.name];
  const n = l.stations.length;
  const pairs: [number, number][] = [];
  for (let k = 0; k + 1 < n; k++) pairs.push([l.stations[k], l.stations[k + 1]]);
  if (l.loop && n > 2) pairs.push([l.stations[n - 1], l.stations[0]]);

  const allowed = new Set<number>();
  const candAll = new Set<number>(); // 会社が合う線すべて（選んだ線でつながらないときの予備）
  const chosen: string[] = [];
  const snaps = new Map<number, Snap>();
  lineSnaps.push(snaps);
  if (!ov?.skip) {
    // 候補の線: 直接指定、無ければ会社が合うもの
    const cand: number[] = [];
    groups.forEach((g, gi) => {
      if (ov?.groups ? ov.groups.includes(`${g.company}/${g.name}`) : compat(l.company, g.company, ov?.companies)) cand.push(gi);
    });
    cand.forEach((g) => candAll.add(g));
    // 各候補が駅のどれを 200m 以内でカバーするか → 貪欲に選ぶ
    const cover = new Map<number, Set<number>>();
    for (const gi of cand) {
      const set = new Set<number>();
      for (const s of l.stations) if (snap(stXY[s][0], stXY[s][1], new Set([gi]), 200)) set.add(s);
      if (set.size) cover.set(gi, set);
    }
    const covered = new Set<number>();
    for (;;) {
      let best = -1;
      let bn = 0;
      for (const [gi, set] of cover) {
        let c = 0;
        for (const s of set) if (!covered.has(s)) c++;
        if (c > bn) (bn = c), (best = gi);
      }
      if (best < 0 || (bn < 2 && covered.size > 0)) break;
      allowed.add(best);
      chosen.push(`${groups[best].company}/${groups[best].name}`);
      for (const s of cover.get(best)!) covered.add(s);
      cover.delete(best);
    }
  }
  if (allowed.size) {
    for (const s of l.stations) {
      const sn = snap(stXY[s][0], stXY[s][1], allowed, 300);
      if (sn) {
        snaps.set(s, sn);
        if (!stationBest[s] || sn.d < stationBest[s]!.d) stationBest[s] = { d: sn.d, x: sn.x, y: sn.y };
      }
    }
  }
  let real = 0;
  pairs.forEach(([a, b], k) => {
    let xy: [number, number][] | null = null;
    const sa = snaps.get(a);
    const sb = snaps.get(b);
    const straight = Math.hypot(stXY[a][0] - stXY[b][0], stXY[a][1] - stXY[b][1]);
    const attempt = (p: Snap | null | undefined, q: Snap | null | undefined, ok: Set<number>) => {
      if (!p || !q) return null;
      const r = route(p, q, ok);
      let len = 0;
      if (r) for (let i = 0; i + 1 < r.length; i++) len += Math.hypot(r[i + 1][0] - r[i][0], r[i + 1][1] - r[i][1]);
      return r && len <= straight * 2.5 + 600 ? r : null;
    };
    xy = attempt(sa, sb, allowed);
    if (!xy && candAll.size > allowed.size)
      xy = attempt(snap(stXY[a][0], stXY[a][1], candAll, 300), snap(stXY[b][0], stXY[b][1], candAll, 300), candAll);
    if (xy) real++;
    segs.push({ line: li, k, from: a, to: b, xy: xy ?? [], real: xy !== null, offset: 0 });
  });
  lineInfo.push({ chosen, real, total: pairs.length });
});

// ---------- 駅の表示位置（線の上に寄せる） ----------
const disp: [number, number][] = S.map((_, i) => (stationBest[i] ? [stationBest[i]!.x, stationBest[i]!.y] : stXY[i]));
for (const s of segs) {
  const a = disp[s.from];
  const b = disp[s.to];
  const pts: [number, number][] = [a, ...s.xy, b];
  s.xy = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.5);
  if (s.xy.length < 2) s.xy = [a, b];
}

// ---------- 並走のずらし ----------
// 別の路線が同じ線路の上を通っていたら、線何本分かずらす。同じ路線駅（line_cd）の枝は同じ列に置く。
const family = (li: number) => meta[li].lineCd;
type Sample = { seg: number; fam: number; x: number; y: number; th: number; set: number[]; off: number };
const samples: Sample[] = [];
segs.forEach((s, si) => {
  for (let i = 0; i + 1 < s.xy.length; i++) {
    const [x0, y0] = s.xy[i];
    const [x1, y1] = s.xy[i + 1];
    const L = Math.hypot(x1 - x0, y1 - y0);
    if (L < 1) continue;
    const th = Math.atan2(y1 - y0, x1 - x0);
    const m = Math.max(1, Math.round(L / 30));
    for (let j = 0; j < m; j++) {
      const t = (j + 0.5) / m;
      samples.push({ seg: si, fam: family(s.line), x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, th, set: [], off: 0 });
    }
  }
});
{
  const SC = 30;
  const g = new Map<string, number[]>();
  samples.forEach((p, i) => {
    const k = `${Math.floor(p.x / SC)},${Math.floor(p.y / SC)}`;
    (g.get(k) ?? g.set(k, []).get(k)!).push(i);
  });
  for (const p of samples) {
    const set = new Set<number>([p.fam]);
    const cx = Math.floor(p.x / SC);
    const cy = Math.floor(p.y / SC);
    for (let a = cx - 1; a <= cx + 1; a++)
      for (let b = cy - 1; b <= cy + 1; b++)
        for (const j of g.get(`${a},${b}`) ?? []) {
          const q = samples[j];
          if (q.fam === p.fam || set.has(q.fam)) continue;
          if (Math.hypot(q.x - p.x, q.y - p.y) > 25) continue;
          const dth = Math.abs(((q.th - p.th + Math.PI * 3) % (Math.PI * 2)) - Math.PI); // 0..π（同じ向き=π, 逆向き=0）
          if (dth > Math.PI * 0.86 || dth < Math.PI * 0.14) set.add(q.fam);
        }
    p.set = [...set].sort((u, v) => u - v);
  }
  // 「正の向き」の境目の角度は、並走している線がいちばん少ない向きにする（境目で左右が入れ替わるのを避ける）
  const bins = new Array(36).fill(0);
  for (const p of samples) if (p.set.length > 1) bins[Math.floor((((p.th % Math.PI) + Math.PI) % Math.PI) / (Math.PI / 36))]++;
  let bestBin = 0;
  let bestSum = Infinity;
  for (let i = 0; i < 36; i++) {
    const sum = bins[i] + bins[(i + 1) % 36] + bins[(i + 35) % 36];
    if (sum < bestSum) (bestSum = sum), (bestBin = i);
  }
  const beta = (bestBin + 0.5) * (Math.PI / 36);
  for (const p of samples) {
    const k = p.set.length;
    if (k < 2) continue;
    const c = p.set.indexOf(p.fam) - (k - 1) / 2; // 正の向きの左を正とした位置
    const phi = (((p.th - beta) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    p.off = phi < Math.PI ? c : -c; // 逆向きの線は左右を反転（自分の進行方向の左が正）
  }
  const bySeg = new Map<number, number[]>();
  for (const p of samples) (bySeg.get(p.seg) ?? bySeg.set(p.seg, []).get(p.seg)!).push(p.off);
  for (const [si, offs] of bySeg) {
    offs.sort((a, b) => a - b);
    segs[si].offset = Math.round(offs[Math.floor(offs.length / 2)] * 2) / 2;
  }
}

// ---------- 出力 ----------
const toLL = (pts: [number, number][]): LonLat[] => pts.map(([x, y]) => [r5(P.lon(x)), r5(P.lat(y))]);
const shapes: Geometry['shapes'] = [];
const noShape: string[] = [];
network.lines.forEach((l, li) => {
  const info = lineInfo[li];
  if (info.real === 0 || info.real < info.total * 0.5) {
    noShape.push(`${l.name}（${info.real}/${info.total}）`);
    return;
  }
  shapes.push({
    line: li,
    segments: segs
      .filter((s) => s.line === li)
      .map((s) => {
        const coarse = simplify(s.xy, 70);
        const fine = simplify(s.xy, 6);
        return {
          from: s.from,
          to: s.to,
          offset: s.offset,
          pts: toLL(coarse),
          ...(fine.length > coarse.length ? { ptsDetail: toLL(fine) } : {}),
        };
      }),
  });
});

// 背景（任意）
const readLines = (name: string): LonLat[][] => {
  const f = ksjFiles.find((n) => n === `${name}.geojson`);
  if (!f) return [];
  const gj = JSON.parse(readFileSync(resolve(ksjDir, f), 'utf8')) as GJ;
  const out: LonLat[][] = [];
  const addLine = (cs: number[][]) => {
    let run: [number, number][] = [];
    const flush = () => {
      if (run.length > 1) {
        const s = simplify(run.map(([lon, lat]) => [P.x(lon), P.y(lat)]), 120);
        out.push(toLL(s));
      }
      run = [];
    };
    for (const c of cs) {
      if (inBox(c)) run.push([c[0], c[1]]);
      else flush();
    }
    flush();
  };
  for (const ft of gj.features) {
    const g = ft.geometry;
    if (g.type === 'LineString') addLine(g.coordinates);
    else if (g.type === 'MultiLineString') g.coordinates.forEach(addLine);
    else if (g.type === 'Polygon') g.coordinates.forEach(addLine);
    else if (g.type === 'MultiPolygon') g.coordinates.forEach((poly: number[][][]) => poly.forEach(addLine));
  }
  return out;
};
const background = { coast: readLines('coast'), rivers: readLines('rivers'), borders: readLines('borders') };

const geometry: Geometry = {
  source: '国土数値情報（鉄道データ・行政区域・河川）国土交通省',
  stations: S.length,
  lines: network.lines.length,
  stationPos: disp.map(([x, y]) => [r5(P.lon(x)), r5(P.lat(y))]),
  shapes,
  background,
};
const body = JSON.stringify(geometry);
writeFileSync(resolve(root, 'data/geometry.json'), body);

const realSegs = segs.filter((s) => s.real).length;
const gz = (await import('node:zlib')).gzipSync(body).length;
console.log(`形が付いた路線 ${shapes.length}/${network.lines.length}・区間 ${realSegs}/${segs.length}（${((realSegs / segs.length) * 100).toFixed(1)}%）`);
console.log(`並走のずらし: ずれのある区間 ${segs.filter((s) => s.offset !== 0).length}`);
console.log(`geometry.json ${(body.length / 1e6).toFixed(2)} MB（gzip ${(gz / 1e6).toFixed(2)} MB）／背景 海岸 ${background.coast.length}・川 ${background.rivers.length}・県境 ${background.borders.length}`);
if (noShape.length) console.log(`形が付かなかった路線 ${noShape.length}: ${noShape.join('、')}`);
if (process.env.FAILS) for (const s of segs) if (!s.real) console.log(`失敗 ${network.lines[s.line].name}: ${S[s.from].name}→${S[s.to].name}（${lineSnaps[s.line].has(s.from)?'':'駅×'}${lineSnaps[s.line].has(s.to)?'':'駅×'}）`);
if (process.env.VERBOSE) lineInfo.forEach((i, li) => console.log(`${network.lines[li].name}\t${i.real}/${i.total}\t${i.chosen.join(' + ')}`));
mkdirSync(resolve(root, 'data'), { recursive: true });
