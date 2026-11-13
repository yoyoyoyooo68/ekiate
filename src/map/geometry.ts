import type { Geometry, Network } from '../types';

export type Pt = { x: number; y: number };

/** 1 区間（隣り合う 2 駅の間）の線の形。座標は世界座標（km）の x,y を交互に並べたもの */
export type Seg = {
  line: number;
  from: number;
  to: number;
  /** 並走のずらし量（線何本分か。from→to の進行方向の左が正） */
  offset: number;
  pts: Float64Array;
  detail: Float64Array | null;
  bbox: [number, number, number, number];
};

export type Poly = { pts: Float64Array; bbox: [number, number, number, number] };

/** ネットワークに添える形のデータ（読み込み後に 1 回だけ渡す。MapView が取り出す） */
const attached = new WeakMap<Network, Geometry>();
export function attachGeometry(net: Network, geo: Geometry | null) {
  if (geo && geo.stations === net.stations.length && geo.lines === net.lines.length) attached.set(net, geo);
  else attached.delete(net);
}
export function geometryOf(net: Network): Geometry | null {
  return attached.get(net) ?? null;
}

const flat = (pts: number[][], proj: (p: number[]) => Pt): Float64Array => {
  const a = new Float64Array(pts.length * 2);
  pts.forEach((p, i) => {
    const w = proj(p);
    a[2 * i] = w.x;
    a[2 * i + 1] = w.y;
  });
  return a;
};
const boxOf = (a: Float64Array): [number, number, number, number] => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < a.length; i += 2) {
    x0 = Math.min(x0, a[i]); x1 = Math.max(x1, a[i]);
    y0 = Math.min(y0, a[i + 1]); y1 = Math.max(y1, a[i + 1]);
  }
  return [x0, y0, x1, y1];
};

/** 路線図の形（世界座標 = 緯度経度を km に直したもの。x が東、y が南）。形のデータが無い路線は駅を直線で結ぶ */
export class MapGeometry {
  world: Pt[];
  lineSegs: Seg[][];
  /** "a>b" → その 2 駅の間の区間（逆向きなら reversed） */
  private pair = new Map<string, { seg: Seg; reversed: boolean }[]>();
  coast: Poly[] = [];
  rivers: Poly[] = [];
  borders: Poly[] = [];
  readonly hasShapes: boolean;
  readonly source: string | null;

  constructor(net: Network, geo: Geometry | null) {
    const S = net.stations;
    const lat0 = S.reduce((a, s) => a + s.lat, 0) / Math.max(1, S.length);
    const lon0 = S.reduce((a, s) => a + s.lon, 0) / Math.max(1, S.length);
    const kx = Math.cos((lat0 * Math.PI) / 180) * 111;
    const proj = (p: number[]): Pt => ({ x: (p[0] - lon0) * kx, y: -(p[1] - lat0) * 111 });
    this.world = geo ? geo.stationPos.map(proj) : S.map((s) => proj([s.lon, s.lat]));
    this.source = geo?.source ?? null;
    this.hasShapes = !!geo && geo.shapes.length > 0;

    const shapeOf = new Map<number, Geometry['shapes'][number]>();
    geo?.shapes.forEach((sh) => shapeOf.set(sh.line, sh));
    this.lineSegs = net.lines.map((l, li) => {
      const out: Seg[] = [];
      const sh = shapeOf.get(li);
      if (sh) {
        for (const g of sh.segments) {
          const pts = flat(g.pts, proj);
          out.push({ line: li, from: g.from, to: g.to, offset: g.offset, pts, detail: g.ptsDetail ? flat(g.ptsDetail, proj) : null, bbox: boxOf(pts) });
        }
      } else {
        const n = l.stations.length;
        const pairs: [number, number][] = [];
        for (let k = 0; k + 1 < n; k++) pairs.push([l.stations[k], l.stations[k + 1]]);
        if (l.loop && n > 2) pairs.push([l.stations[n - 1], l.stations[0]]);
        for (const [a, b] of pairs) {
          const pts = new Float64Array([this.world[a].x, this.world[a].y, this.world[b].x, this.world[b].y]);
          out.push({ line: li, from: a, to: b, offset: 0, pts, detail: null, bbox: boxOf(pts) });
        }
      }
      for (const seg of out) {
        const add = (k: string, reversed: boolean) => (this.pair.get(k) ?? this.pair.set(k, []).get(k)!).push({ seg, reversed });
        add(`${seg.from}>${seg.to}`, false);
        add(`${seg.to}>${seg.from}`, true);
      }
      return out;
    });

    const poly = (lines: [number, number][][] | undefined): Poly[] =>
      (lines ?? []).map((l) => {
        const pts = flat(l, proj);
        return { pts, bbox: boxOf(pts) };
      });
    this.coast = poly(geo?.background.coast);
    this.rivers = poly(geo?.background.rivers);
    this.borders = poly(geo?.background.borders);
  }

  /** a から b へ隣り合う駅の区間。preferLine の路線があればそれを選ぶ */
  between(a: number, b: number, preferLine = -1): { seg: Seg; reversed: boolean } | null {
    const list = this.pair.get(`${a}>${b}`);
    if (!list) return null;
    return list.find((x) => x.seg.line === preferLine) ?? list[0];
  }
}
