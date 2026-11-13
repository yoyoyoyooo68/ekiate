// 駅データ.jp の CSV → network.json（設計図 2.5.2）
//   line*.csv / station*.csv / join*.csv / company*.csv を読み、1 都 3 県の駅・路線図・乗換ペアを作る。
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Line, Network, Station } from '../src/types';
import { km } from './lib/geo';
import { lineColor } from './lib/line-colors';
import { parseCsv } from './lib/csv';

export type Kind = 'subway' | 'jrCore' | 'suburban' | 'local';
export type LineMeta = { lineCd: number; kind: Kind; speed?: number; first?: number; last?: number; headway?: Headway };
export type Headway = { early: number; peak: number; day: number; evening: number; late: number };

export type Defaults = {
  version: string;
  stopMinutes: number;
  kinds: Record<Kind, { speed: number; first: number; last: number; headway: Headway }>;
  classify: {
    subwayCompanies: string[];
    jrCompanies: string[];
    jrCoreRadiusKm: number;
    localRadiusKm: number;
    localCompanies: string[];
    center: { lat: number; lon: number };
  };
};
export type Overrides = {
  exclude: string[];
  lines: Record<string, Partial<{ kind: Kind; speed: number; first: number; last: number; headway: Headway }>>;
  /** 会社ごとの上書き（路線の上書きが優先） */
  companies?: Record<string, Partial<{ speed: number; first: number; last: number; headway: Headway }>>;
};
export type Tweaks = {
  merge: number[][];
  split: number[];
  rename: Record<string, string>;
  transfer: { add: [string, string][]; remove: [string, string][] };
};

export type RawCsv = {
  lines: Record<string, string>[];
  stations: Record<string, string>[];
  joins: Record<string, string>[];
  companies: Record<string, string>[];
};

/** フォルダの中から line / station / join / company の CSV（日付付きなら新しいもの）を読む */
export function readEkidata(dir: string): RawCsv {
  if (!existsSync(dir)) throw new Error(`${dir} がありません。駅データ.jp の CSV を置いてください（README 参照）`);
  const files = readdirSync(dir);
  const pick = (prefix: string) => {
    const f = files.filter((n) => n.startsWith(prefix) && n.endsWith('.csv')).sort().pop();
    if (!f) throw new Error(`${dir} に ${prefix}*.csv がありません`);
    return parseCsv(readFileSync(resolve(dir, f), 'utf8'));
  };
  return { lines: pick('line'), stations: pick('station'), joins: pick('join'), companies: pick('company') };
}

const PREFS = new Set(['11', '12', '13', '14']); // 埼玉・千葉・東京・神奈川

/** 表記ゆれ（ヶ/ケ、〈〉/（））をそろえた駅名。同じ駅かどうかの比較に使う */
const norm = (n: string) => n.replace(/ヶ/g, 'ケ').replace(/ヵ/g, 'カ').replace(/〈/g, '（').replace(/〉/g, '）');
const toHira = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const edgeKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** 1 つの路線（駅のつながり）を、列車を走らせる単位の「経路」に分ける */
export function decompose(edges: [number, number][]): { path: number[]; loop: boolean }[] {
  const adj = new Map<number, number[]>();
  const add = (a: number, b: number) => (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
  const seen = new Set<string>();
  const es: [number, number][] = [];
  for (const [a, b] of edges) {
    if (a === b || seen.has(edgeKey(a, b))) continue;
    seen.add(edgeKey(a, b));
    es.push([a, b]);
    add(a, b);
    add(b, a);
  }
  const out: { path: number[]; loop: boolean }[] = [];
  const covered = new Set<string>();
  const visited = new Set<number>();
  const comps: number[][] = [];
  for (const s of adj.keys()) {
    if (visited.has(s)) continue;
    const comp: number[] = [];
    const st = [s];
    visited.add(s);
    while (st.length) {
      const x = st.pop()!;
      comp.push(x);
      for (const y of adj.get(x)!) if (!visited.has(y)) (visited.add(y), st.push(y));
    }
    comps.push(comp);
  }
  comps.sort((a, b) => b.length - a.length);

  for (const comp of comps) {
    const edgeCount = comp.reduce((n, x) => n + adj.get(x)!.length, 0) / 2;
    if (comp.length >= 3 && edgeCount === comp.length && comp.every((x) => adj.get(x)!.length === 2)) {
      // 環状線
      const path = [comp[0]];
      let prev = comp[0];
      let cur = adj.get(comp[0])![0];
      while (cur !== comp[0]) {
        path.push(cur);
        const next = adj.get(cur)!.find((y) => y !== prev)!;
        prev = cur;
        cur = next;
      }
      for (let i = 0; i < path.length; i++) covered.add(edgeKey(path[i], path[(i + 1) % path.length]));
      out.push({ path, loop: true });
      continue;
    }
    // 幅優先で作った木の直径を主経路にする
    const bfs = (from: number) => {
      const par = new Map<number, number>([[from, -1]]);
      const q = [from];
      let last = from;
      for (let i = 0; i < q.length; i++) {
        last = q[i];
        for (const y of adj.get(q[i])!) if (!par.has(y)) (par.set(y, q[i]), q.push(y));
      }
      return { last, par };
    };
    const a = bfs(comp[0]).last;
    const { last: b, par } = bfs(a);
    const main: number[] = [];
    for (let x = b; x !== -1; x = par.get(x)!) main.push(x);
    for (let i = 0; i + 1 < main.length; i++) covered.add(edgeKey(main[i], main[i + 1]));
    out.push({ path: main, loop: false });
    // 残りの辺（支線・環の欠け）を、つながる限り延ばして経路にする
    for (const [u, v] of es) {
      if (covered.has(edgeKey(u, v)) || !comp.includes(u)) continue;
      const path = [u, v];
      covered.add(edgeKey(u, v));
      for (const dir of [1, 0]) {
        for (;;) {
          const end = dir ? path[path.length - 1] : path[0];
          const nx = adj.get(end)!.find((y) => !covered.has(edgeKey(end, y)));
          if (nx === undefined) break;
          covered.add(edgeKey(end, nx));
          if (dir) path.push(nx);
          else path.unshift(nx);
        }
      }
      out.push({ path, loop: false });
    }
  }
  return out;
}

export type BuildResult = { network: Network; meta: LineMeta[]; warnings: string[] };

export function buildNetwork(raw: RawCsv, defaults: Defaults, overrides: Overrides, tweaks: Tweaks): BuildResult {
  const warnings: string[] = [];
  const companyName = new Map(raw.companies.map((c) => [c.company_cd, c.company_name]));

  // --- 路線 ---
  const lineRows = new Map<number, Record<string, string>>();
  for (const l of raw.lines) {
    if (l.e_status && l.e_status !== '0') continue;
    if (l.line_type === '1' || /新幹線/.test(l.line_name)) continue;
    if (overrides.exclude.includes(l.line_name) || overrides.exclude.includes(l.line_cd)) continue;
    lineRows.set(Number(l.line_cd), l);
  }

  // --- 駅（1 都 3 県） ---
  type St = { cd: number; g: number; k: number; name: string; kana: string; lat: number; lon: number; lineCd: number };
  const st = new Map<number, St>();
  const kOf = new Map<string, number>(); // (station_g_cd, 駅名) → 駅の単位。ekidata は 原宿/明治神宮前 のような別名の駅も同じ g_cd にまとめるので、名前でも分ける
  for (const s of raw.stations) {
    if (s.e_status && s.e_status !== '0') continue;
    if (!PREFS.has(s.pref_cd)) continue;
    const lineCd = Number(s.line_cd);
    if (!lineRows.has(lineCd)) continue;
    const gk = `${s.station_g_cd}|${norm(s.station_name)}`;
    if (!kOf.has(gk)) kOf.set(gk, kOf.size);
    st.set(Number(s.station_cd), {
      cd: Number(s.station_cd),
      g: Number(s.station_g_cd),
      k: kOf.get(gk)!,
      name: s.station_name,
      kana: toHira(s.station_name_k || s.station_name),
      lat: Number(s.lat),
      lon: Number(s.lon),
      lineCd,
    });
  }

  // --- 駅のまとめ（station_g_cd → 同名で 0.4km 以内 → 手直し） ---
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    if (!parent.has(x)) parent.set(x, x);
    const p = parent.get(x)!;
    return p === x ? x : (parent.set(x, find(p)), parent.get(x)!);
  };
  const union = (a: number, b: number) => parent.set(find(a), find(b));
  const splitG = new Set(tweaks.split);
  const kByG = new Map<number, number>();
  for (const s of st.values()) if (!kByG.has(s.g)) kByG.set(s.g, s.k);
  for (const s of st.values()) find(s.k);
  const byName = new Map<string, St[]>();
  for (const s of st.values()) (byName.get(norm(s.name)) ?? byName.set(norm(s.name), []).get(norm(s.name))!).push(s);
  for (const list of byName.values()) {
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (splitG.has(a.g) || splitG.has(b.g)) continue;
        if (km(a.lat, a.lon, b.lat, b.lon) <= 0.4) union(a.k, b.k);
      }
  }
  for (const grp of tweaks.merge) for (let i = 1; i < grp.length; i++) if (kByG.has(grp[0]) && kByG.has(grp[i])) union(kByG.get(grp[0])!, kByG.get(grp[i])!);

  type Group = { root: number; id: number; members: St[]; name: string; kana: string; lat: number; lon: number; lineCds: Set<number> };
  const groups = new Map<number, Group>();
  for (const s of st.values()) {
    const root = find(s.k);
    let g = groups.get(root);
    if (!g) {
      g = { root, id: s.cd, members: [], name: s.name, kana: s.kana, lat: 0, lon: 0, lineCds: new Set() };
      groups.set(root, g);
    }
    g.members.push(s);
    g.id = Math.min(g.id, s.cd);
    g.lineCds.add(s.lineCd);
  }
  for (const g of groups.values()) {
    g.lat = g.members.reduce((x, m) => x + m.lat, 0) / g.members.length;
    g.lon = g.members.reduce((x, m) => x + m.lon, 0) / g.members.length;
    const re = tweaks.rename[String(g.members[0].g)];
    if (re) g.name = re;
  }
  // 同じ名前で別の駅になったものには路線名を付けて区別する
  const nameCount = new Map<string, number>();
  for (const g of groups.values()) nameCount.set(g.name, (nameCount.get(g.name) ?? 0) + 1);
  for (const g of groups.values()) {
    if ((nameCount.get(g.name) ?? 0) > 1 && !tweaks.rename[String(g.members[0].g)]) {
      const cd = Math.min(...g.lineCds);
      const ln = lineRows.get(cd)!.line_name.replace(/^(JR|東京メトロ|都営|東京都交通局)/, '') || lineRows.get(cd)!.line_name;
      g.name = `${g.name}（${ln}）`;
    }
  }

  const order = [...groups.values()].sort((a, b) => a.id - b.id);
  const gIndex = new Map<number, number>(order.map((g, i) => [g.root, i]));
  const stationIdx = (cd: number) => gIndex.get(find(st.get(cd)!.k))!;
  if (order.length > 65535) throw new Error('駅が多すぎます（Uint16 を超える）');

  const stations: Station[] = order.map((g) => ({
    id: `e${String(g.id).padStart(8, '0')}`,
    name: g.name,
    kana: g.kana,
    lat: Math.round(g.lat * 1e5) / 1e5,
    lon: Math.round(g.lon * 1e5) / 1e5,
    lines: [],
  }));

  // --- 路線の形（join.csv）→ 経路 ---
  const edgesOf = new Map<number, [number, number][]>();
  for (const j of raw.joins) {
    const lc = Number(j.line_cd);
    const a = Number(j.station_cd1);
    const b = Number(j.station_cd2);
    if (!lineRows.has(lc) || !st.has(a) || !st.has(b)) continue;
    (edgesOf.get(lc) ?? edgesOf.set(lc, []).get(lc)!).push([stationIdx(a), stationIdx(b)]);
  }

  const lines: Line[] = [];
  const meta: LineMeta[] = [];
  const c = defaults.classify;
  const lineCds = [...edgesOf.keys()].sort((a, b) => a - b);
  for (const lc of lineCds) {
    const row = lineRows.get(lc)!;
    const company = companyName.get(row.company_cd) ?? '';
    const parts = decompose(edgesOf.get(lc)!);
    if (!parts.length) continue;
    const allSt = new Set(parts.flatMap((p) => p.path));
    const cLat = [...allSt].reduce((x, i) => x + stations[i].lat, 0) / allSt.size;
    const cLon = [...allSt].reduce((x, i) => x + stations[i].lon, 0) / allSt.size;
    const dist = km(cLat, cLon, c.center.lat, c.center.lon);
    let kind: Kind;
    if (c.subwayCompanies.some((s) => company.includes(s))) kind = 'subway';
    else if (c.localCompanies.some((s) => company.includes(s)) || dist > c.localRadiusKm) kind = 'local';
    else if (c.jrCompanies.some((s) => company.includes(s))) kind = dist <= c.jrCoreRadiusKm ? 'jrCore' : 'suburban';
    else kind = 'suburban';
    const ov = { ...(overrides.companies?.[company] ?? {}), ...(overrides.lines[row.line_name] ?? overrides.lines[row.line_cd] ?? {}) } as Partial<{ kind: Kind; speed: number; first: number; last: number; headway: Headway }>;
    const color = /^[0-9a-fA-F]{6}$/.test(row.line_color_c) ? `#${row.line_color_c}` : lineColor(row.line_name, company);
    parts.forEach((p, k) => {
      const li = lines.length;
      let name = row.line_name;
      if (k > 0) name = `${row.line_name}（${stations[p.path[0]].name}〜${stations[p.path[p.path.length - 1]].name}）`;
      lines.push({ name, company, color, stations: p.path, loop: p.loop || undefined, timeSource: 'estimated' });
      meta.push({ lineCd: lc, kind: ov.kind ?? kind, speed: ov.speed, first: ov.first, last: ov.last, headway: ov.headway });
      for (const i of p.path) if (!stations[i].lines.includes(li)) stations[i].lines.push(li);
    });
  }

  // 路線の無い駅は落とさず警告（join に載らない駅）
  const orphans = stations.filter((s) => !s.lines.length);
  if (orphans.length) warnings.push(`路線に載らない駅が ${orphans.length} 駅あります（例: ${orphans.slice(0, 5).map((s) => s.name).join('、')}）`);

  // --- 乗換ペア ---
  const pairs = new Map<string, [number, number]>();
  const addPair = (a: number, b: number) => {
    if (a !== b) pairs.set(edgeKey(a, b), a < b ? [a, b] : [b, a]);
  };
  // 駅データ.jp が同じ駅にまとめている別名の駅（原宿・明治神宮前〈原宿〉など）は乗換ペアにする
  const idxByG = new Map<number, Set<number>>();
  for (const s of st.values()) (idxByG.get(s.g) ?? idxByG.set(s.g, new Set()).get(s.g)!).add(stationIdx(s.cd));
  for (const set of idxByG.values()) {
    const a = [...set];
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) addPair(a[i], a[j]);
  }
  const byDisplay = new Map<string, number[]>();
  stations.forEach((s, i) => {
    for (const key of [s.name, s.name.replace(/[〈（].*$/, '')]) (byDisplay.get(key) ?? byDisplay.set(key, []).get(key)!).push(i);
  });
  const lookup = (name: string): number[] => [...new Set(byDisplay.get(name) ?? [])];
  for (let i = 0; i < stations.length; i++) {
    for (let j = i + 1; j < stations.length; j++) {
      const a = stations[i];
      const b = stations[j];
      if (Math.abs(a.lat - b.lat) > 0.003 || Math.abs(a.lon - b.lon) > 0.004) continue;
      if (a.name.replace(/[〈（].*$/, '') === b.name.replace(/[〈（].*$/, '')) continue;
      if (a.lines.some((l) => b.lines.includes(l))) continue;
      if (km(a.lat, a.lon, b.lat, b.lon) <= 0.2) addPair(i, j);
    }
  }
  for (const [x, y] of tweaks.transfer.add) {
    const xs = lookup(x);
    const ys = lookup(y);
    if (!xs.length || !ys.length) {
      warnings.push(`乗換ペア「${x}」「${y}」: 駅が見つかりません`);
      continue;
    }
    for (const a of xs) for (const b of ys) addPair(a, b);
  }
  for (const [x, y] of tweaks.transfer.remove) for (const a of lookup(x)) for (const b of lookup(y)) pairs.delete(edgeKey(a, b));

  const network: Network = { version: defaults.version, stations, lines, transferPairs: [...pairs.values()] };
  return { network, meta, warnings };
}
