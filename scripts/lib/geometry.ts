// 路線の形の計算で使う道具（build-geometry.ts から使う）。座標は [経度, 緯度]、計算は局所の平面（メートル）で行う。
export type LonLat = [number, number];

/** 局所の平面（メートル）への変換。東西は緯度で縮める */
export function makeProjection(lon0: number, lat0: number) {
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320;
  const ky = 110540;
  return {
    x: (lon: number) => (lon - lon0) * kx,
    y: (lat: number) => (lat - lat0) * ky,
    lon: (x: number) => lon0 + x / kx,
    lat: (y: number) => lat0 + y / ky,
  };
}
export type Projection = ReturnType<typeof makeProjection>;

/** 点 p から線分 a-b への最短距離と、線分上の位置 t(0..1) */
export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  return { d: Math.hypot(px - cx, py - cy), t, x: cx, y: cy };
}

/** Douglas–Peucker 法による折れ線の簡略化（pts はメートル座標。tol はメートル） */
export function simplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let best = -1;
    let bd = tol;
    for (let i = s + 1; i < e; i++) {
      const d = distToSegment(pts[i][0], pts[i][1], pts[s][0], pts[s][1], pts[e][0], pts[e][1]).d;
      if (d > bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([s, best], [best, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** 2 分ヒープ（最短経路用） */
export class MinHeap {
  private a: [number, number][] = []; // [優先度, 値]
  get size() {
    return this.a.length;
  }
  push(p: number, v: number) {
    const a = this.a;
    a.push([p, v]);
    let i = a.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (a[up][0] <= a[i][0]) break;
      [a[up], a[i]] = [a[i], a[up]];
      i = up;
    }
  }
  pop(): [number, number] | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** 数値を小数 5 桁（約 1m）に丸める */
export const r5 = (v: number) => Math.round(v * 1e5) / 1e5;
