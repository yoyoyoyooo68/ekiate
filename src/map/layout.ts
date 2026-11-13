import type { Network } from '../types';

export type Pt = { x: number; y: number };

/**
 * 路線図のデフォルメ配置。
 * 1. 都心を中心に放射状に歪める（都心は拡大、郊外は圧縮）
 * 2. 各区間を 45° 刻みの方向に、長さを揃えるようにばねで寄せる（首都圏の公式路線図のような見た目）
 * 3. 駅同士の重なりを離す
 * 実際の位置関係（どちら向きか）は保ちつつ、形だけを整える。
 */
const cache = new WeakMap<Network, Pt[]>();

export function schematicLayout(net: Network): Pt[] {
  const hit = cache.get(net);
  if (hit) return hit;
  const res = compute(net);
  cache.set(net, res);
  return res;
}

const DIRS = Array.from({ length: 8 }, (_, i) => ({ x: Math.cos((i * Math.PI) / 4), y: Math.sin((i * Math.PI) / 4) }));

function compute(net: Network): Pt[] {
  const n = net.stations.length;
  const S = net.stations;

  // ---- 中心（山手線の駅の重心。無ければ全駅の重心） ----
  const yam = net.lines.find((l) => l.name.includes('山手線'));
  const cs = yam ? yam.stations : S.map((_, i) => i);
  const lat0 = cs.reduce((a, i) => a + S[i].lat, 0) / cs.length;
  const lon0 = cs.reduce((a, i) => a + S[i].lon, 0) / cs.length;
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111;

  // ---- 1. 放射状に歪める ----
  const R0 = 9; // km。ここまでは緩やかに、外は強く圧縮
  const wt: number[] = [];
  const base: Pt[] = S.map((s) => {
    const x = (s.lon - lon0) * kx;
    const y = -(s.lat - lat0) * 111;
    const r = Math.hypot(x, y);
    wt.push(1 + 1.6 * Math.exp(-r / 8)); // 都心ほど駅間隔を広く取る
    if (r < 1e-6) return { x: 0, y: 0 };
    const r2 = R0 * Math.pow(Math.max(r, 0.2) / R0, 0.45);
    return { x: (x / r) * r2, y: (y / r) * r2 };
  });

  // ---- 辺（路線の隣り合う駅。重複は除く） ----
  const edgeKey = new Set<number>();
  const edges: [number, number][] = [];
  const addEdge = (a: number, b: number) => {
    if (a === b) return;
    const k = a < b ? a * 4096 + b : b * 4096 + a;
    if (edgeKey.has(k)) return;
    edgeKey.add(k);
    edges.push([a, b]);
  };
  for (const l of net.lines) {
    for (let i = 1; i < l.stations.length; i++) addEdge(l.stations[i - 1], l.stations[i]);
    if (l.loop && l.stations.length > 2) addEdge(l.stations[l.stations.length - 1], l.stations[0]);
  }
  const pairs = net.transferPairs.filter(([a, b]) => !edgeKey.has(a < b ? a * 4096 + b : b * 4096 + a));

  // 単位: 隣駅の標準間隔を 1 とする
  const median = (() => {
    const ls = edges.map(([a, b]) => Math.hypot(base[a].x - base[b].x, base[a].y - base[b].y)).sort((p, q) => p - q);
    return ls[Math.floor(ls.length / 2)] || 1;
  })();
  const unit = 1.0;
  const pos: Pt[] = base.map((p) => ({ x: (p.x / median) * unit, y: (p.y / median) * unit }));
  const anchor: Pt[] = pos.map((p) => ({ ...p }));
  const Lmin = 0.8 * unit;
  const Lmax = 2.2 * unit;

  // 各駅につながる辺
  const adj: number[][] = Array.from({ length: n }, () => []);
  edges.forEach(([a, b], ei) => {
    adj[a].push(ei);
    adj[b].push(ei);
  });

  // ---- 2〜3. ばね反復 ----
  const ITER = 500;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  const cnt = new Float64Array(n);
  for (let it = 0; it < ITER; it++) {
    const t = it / ITER;
    dx.fill(0);
    dy.fill(0);
    cnt.fill(0);
    const snapK = 0.15 + 0.35 * Math.min(1, t * 2); // 後半ほど 45° に強く寄せる
    const anchorK = 0.04 * (1 - t) + 0.004;

    // 45° に寄せるばね
    for (const [a, b] of edges) {
      const vx = pos[b].x - pos[a].x;
      const vy = pos[b].y - pos[a].y;
      const len = Math.hypot(vx, vy) || 1e-6;
      const ang = Math.atan2(vy, vx);
      const d = DIRS[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8];
      const w = (wt[a] + wt[b]) / 2;
      const T = Math.min(Lmax * w, Math.max(Lmin * w, len));
      const ex = d.x * T - vx;
      const ey = d.y * T - vy;
      dx[a] -= ex * 0.5 * snapK;
      dy[a] -= ey * 0.5 * snapK;
      dx[b] += ex * 0.5 * snapK;
      dy[b] += ey * 0.5 * snapK;
    }
    // 乗換ペア（同じ場所の別駅）は近くに
    for (const [a, b] of pairs) {
      const vx = pos[b].x - pos[a].x;
      const vy = pos[b].y - pos[a].y;
      const len = Math.hypot(vx, vy) || 1e-6;
      const T = Math.min(len, Lmin * Math.min(wt[a], wt[b]));
      const f = ((T - len) / len) * 0.25;
      dx[a] -= vx * f * 0.5;
      dy[a] -= vy * f * 0.5;
      dx[b] += vx * f * 0.5;
      dy[b] += vy * f * 0.5;
    }
    // 元の位置関係に引き戻す
    for (let i = 0; i < n; i++) {
      dx[i] += (anchor[i].x - pos[i].x) * anchorK;
      dy[i] += (anchor[i].y - pos[i].y) * anchorK;
    }
    // 重なりを離す（格子で近傍だけ見る）
    const cell = Lmin * 2.6;
    const grid = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const key = Math.floor(pos[i].x / cell) * 100003 + Math.floor(pos[i].y / cell);
      const g = grid.get(key);
      if (g) g.push(i);
      else grid.set(key, [i]);
    }
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(pos[i].x / cell);
      const cy = Math.floor(pos[i].y / cell);
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          const g = grid.get(gx * 100003 + gy);
          if (!g) continue;
          for (const j of g) {
            if (j <= i) continue;
            const vx = pos[j].x - pos[i].x;
            const vy = pos[j].y - pos[i].y;
            const d = Math.hypot(vx, vy);
            const dmin = Lmin * 0.85 * Math.min(wt[i], wt[j]);
            if (d >= dmin) continue;
            // 直接つながる駅同士は辺のばねに任せる
            const push = d < 1e-6 ? 0.05 : ((dmin - d) / d) * 0.25;
            const ux = d < 1e-6 ? ((i * 7919) % 13) - 6 : vx;
            const uy = d < 1e-6 ? ((i * 104729) % 11) - 5 : vy;
            dx[i] -= ux * push * 0.5;
            dy[i] -= uy * push * 0.5;
            dx[j] += ux * push * 0.5;
            dy[j] += uy * push * 0.5;
          }
        }
      }
    }
    for (let i = 0; i < n; i++) {
      pos[i].x += dx[i];
      pos[i].y += dy[i];
    }
  }
  void cnt;
  return pos;
}
