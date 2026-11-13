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
  const TUNE: Record<string, number> = (globalThis as { __LT?: Record<string, number> }).__LT ?? {}; // 調整用（scripts/layout-svg.ts から上書きできる）
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
  // 周りに駅が多い場所ほど駅間隔を広げる（神奈川・都心などの過密を避ける）
  const raw = S.map((s) => ({ x: (s.lon - lon0) * kx, y: -(s.lat - lat0) * 111 }));
  const DR = 3; // km
  const bins = new Map<number, number[]>();
  raw.forEach((p, i) => {
    const k = Math.floor(p.x / DR) * 100003 + Math.floor(p.y / DR);
    const g = bins.get(k);
    if (g) g.push(i); else bins.set(k, [i]);
  });
  const dens = raw.map((p) => {
    let c = 0;
    const cx = Math.floor(p.x / DR), cy = Math.floor(p.y / DR);
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++)
      for (const j of bins.get(gx * 100003 + gy) ?? []) if (Math.hypot(raw[j].x - p.x, raw[j].y - p.y) < DR) c++;
    return c;
  });
  const dMed = [...dens].sort((a, b) => a - b)[Math.floor(n / 2)] || 1;
  const wt: number[] = [];
  const base: Pt[] = S.map((s) => {
    const x = (s.lon - lon0) * kx;
    const y = -(s.lat - lat0) * 111;
    const r = Math.hypot(x, y);
    wt.push((1 + (TUNE.ca ?? 1.2) * Math.exp(-r / 8)) * Math.min(TUNE.dmax ?? 1.9, Math.max(0.9, Math.pow(dens[wt.length] / dMed, TUNE.dp ?? 0.5)))); // 都心・過密地ほど駅間隔を広く取る
    if (r < 1e-6) return { x: 0, y: 0 };
    const r2 = R0 * Math.pow(Math.max(r, 0.2) / R0, TUNE.ex ?? 0.45);
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
  // 混んでいる場所を広げて、開始位置の密度を均す。
  // 駅ごとの反発ではなく、ぼかした密度の勾配に沿った滑らかな変形にする（線の直進性を壊さない）
  {
    const C = 1.5; // 格子の大きさ
    const BL = TUNE.bl ?? 4; // ぼかし半径（格子数）
    const STEP = TUNE.st ?? 6;
    for (let rep = 0; rep < (TUNE.rn ?? 40); rep++) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of pos) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
      x0 -= BL * C * 2; y0 -= BL * C * 2;
      const W = Math.ceil((x1 - x0) / C) + BL * 2 + 2, H = Math.ceil((y1 - y0) / C) + BL * 2 + 2;
      let rho = new Float64Array(W * H);
      for (const p of pos) rho[Math.floor((p.y - y0) / C) * W + Math.floor((p.x - x0) / C)] += 1;
      // 箱ぼかしを 2 回（横→縦）
      for (let pass = 0; pass < 2; pass++) {
        const t1 = new Float64Array(W * H), t2 = new Float64Array(W * H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          let sum = 0;
          for (let k = -BL; k <= BL; k++) { const xx = x + k; if (xx >= 0 && xx < W) sum += rho[y * W + xx]; }
          t1[y * W + x] = sum / (2 * BL + 1);
        }
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          let sum = 0;
          for (let k = -BL; k <= BL; k++) { const yy = y + k; if (yy >= 0 && yy < H) sum += t1[yy * W + x]; }
          t2[y * W + x] = sum / (2 * BL + 1);
        }
        rho = t2;
      }
      const dxs = new Float64Array(n), dys = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const gx = Math.min(W - 2, Math.max(1, Math.floor((pos[i].x - x0) / C)));
        const gy = Math.min(H - 2, Math.max(1, Math.floor((pos[i].y - y0) / C)));
        dxs[i] = -(rho[gy * W + gx + 1] - rho[gy * W + gx - 1]) / 2;
        dys[i] = -(rho[(gy + 1) * W + gx] - rho[(gy - 1) * W + gx]) / 2;
      }
      for (let i = 0; i < n; i++) {
        const m = Math.hypot(dxs[i], dys[i]);
        const lim = m * STEP > 0.5 ? 0.5 / (m * STEP) : 1;
        pos[i].x += dxs[i] * STEP * lim;
        pos[i].y += dys[i] * STEP * lim;
      }
    }
  }
  const anchor: Pt[] = pos.map((p) => ({ ...p }));
  const Lmin = 0.8 * unit;
  const Lmax = 2.2 * unit;

  // 各駅につながる辺
  const adj: number[][] = Array.from({ length: n }, () => []);
  edges.forEach(([a, b], ei) => {
    adj[a].push(ei);
    adj[b].push(ei);
  });

  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
    const CKV = TUNE.ck ?? 0.25;
  const EA = Int32Array.from(edges, (e) => e[0]);
  const EB = Int32Array.from(edges, (e) => e[1]);
  const cross = (ax: number, ay: number, bx: number, by: number, px: number, py: number) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  // 辺 (p,q) を、辺 (a,b) の片側へ寄せる（sp, sq は p, q の a→b に対する符号付き面積）
  const push = (p: number, q: number, a: number, b: number, sp: number, sq: number) => {
    const ex = pos[b].x - pos[a].x, ey = pos[b].y - pos[a].y;
    const L = Math.hypot(ex, ey) || 1;
    const nx = -ey / L, ny = ex / L;
    // 近い方の端点を相手の線の向こう側へ運ぶ
    const [near, sn] = Math.abs(sp) < Math.abs(sq) ? [p, sp] : [q, sq];
    const dist = Math.abs(sn) / L + 0.35;
    const sgn = sn > 0 ? -1 : 1;
    dx[near] += sgn * nx * dist * CKV;
    dy[near] += sgn * ny * dist * CKV;
  };
  // ---- 2〜3. ばね反復 ----
  const ITER = 500;
  const cnt = new Float64Array(n);
  for (let it = 0; it < ITER; it++) {
    const t = it / ITER;
    dx.fill(0);
    dy.fill(0);
    cnt.fill(0);
    const snapK = (TUNE.s0 ?? 0.05) + (TUNE.s1 ?? 0.2) * Math.min(1, t * 2); // 後半ほど 45° に強く寄せる
    const anchorK = (TUNE.a0 ?? 0.1) * (1 - t) + (TUNE.a1 ?? 0.02);

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
            const dmin = Lmin * (TUNE.dm ?? 0.95) * Math.min(wt[i], wt[j]);
            if (d >= dmin) continue;
            // 直接つながる駅同士は辺のばねに任せる
            const push = d < 1e-6 ? 0.05 : ((dmin - d) / d) * (TUNE.rp ?? 0.5);
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
    // 交差している辺を、どちらか片側へ動かして離す
    if (t > (TUNE.cs ?? 0.15) && it % 3 === 0) {
      forEachCrossing(pos, EA, EB, (e1, e2) => {
        const a = EA[e1], b = EB[e1], c = EA[e2], d = EB[e2];
        const s1 = cross(pos[a].x, pos[a].y, pos[b].x, pos[b].y, pos[c].x, pos[c].y);
        const s2 = cross(pos[a].x, pos[a].y, pos[b].x, pos[b].y, pos[d].x, pos[d].y);
        const s3 = cross(pos[c].x, pos[c].y, pos[d].x, pos[d].y, pos[a].x, pos[a].y);
        const s4 = cross(pos[c].x, pos[c].y, pos[d].x, pos[d].y, pos[b].x, pos[b].y);
        push(c, d, a, b, s1, s2);
        push(a, b, c, d, s3, s4);
      });
    }
    for (let i = 0; i < n; i++) {
      const m = Math.hypot(dx[i], dy[i]);
      const lim = m > 0.5 ? 0.5 / m : 1; // 1 回に動く量を抑える
      pos[i].x += dx[i] * lim;
      pos[i].y += dy[i] * lim;
    }
  }
  void cnt;
  return pos;
}

const crossArea = (ax: number, ay: number, bx: number, by: number, px: number, py: number) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);

/** 端点を共有しない辺どうしの交差を列挙する（格子で絞り込み） */
function forEachCrossing(pos: Pt[], EA: Int32Array, EB: Int32Array, cb: (e1: number, e2: number) => void) {
  const cell = 3;
  const grid = new Map<number, number[]>();
  const m = EA.length;
  for (let e = 0; e < m; e++) {
    const A = pos[EA[e]], B = pos[EB[e]];
    const x0 = Math.floor(Math.min(A.x, B.x) / cell), x1 = Math.floor(Math.max(A.x, B.x) / cell);
    const y0 = Math.floor(Math.min(A.y, B.y) / cell), y1 = Math.floor(Math.max(A.y, B.y) / cell);
    for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
      const k = gx * 100003 + gy;
      const g = grid.get(k);
      if (g) g.push(e); else grid.set(k, [e]);
    }
  }
  const seen = new Set<number>();
  for (const g of grid.values()) {
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      const e1 = g[i], e2 = g[j];
      const key = e1 * 8192 + e2;
      if (seen.has(key)) continue;
      const a = EA[e1], b = EB[e1], c = EA[e2], d = EB[e2];
      if (a === c || a === d || b === c || b === d) continue;
      const A = pos[a], B = pos[b], C = pos[c], D = pos[d];
      if (crossArea(A.x, A.y, B.x, B.y, C.x, C.y) * crossArea(A.x, A.y, B.x, B.y, D.x, D.y) < 0 &&
          crossArea(C.x, C.y, D.x, D.y, A.x, A.y) * crossArea(C.x, C.y, D.x, D.y, B.x, B.y) < 0) {
        seen.add(key);
        cb(e1, e2);
      }
    }
  }
}

/** 辺の交差数（評価用） */
export function countCrossings(net: Network, pos: Pt[]): number {
  const set = new Set<number>();
  const ea: number[] = [], eb: number[] = [];
  for (const l of net.lines) {
    const m = l.stations.length;
    for (let i = 1; i < (l.loop ? m + 1 : m); i++) {
      const a = l.stations[i - 1], b = l.stations[i % m];
      const k = a < b ? a * 4096 + b : b * 4096 + a;
      if (a !== b && !set.has(k)) { set.add(k); ea.push(a); eb.push(b); }
    }
  }
  let c = 0;
  forEachCrossing(pos, Int32Array.from(ea), Int32Array.from(eb), () => c++);
  return c;
}
