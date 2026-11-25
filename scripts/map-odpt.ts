// 本番: ODPT の列車時刻表（平日）→ 接続の一覧（設計図 2.5.6）
//   ODPT の駅は「路線（line_cd）＋駅名」で駅データ.jp の駅に対応付ける。名前で取れないときは同じ路線の 0.5 km 以内の最寄り駅。
//   1 都 3 県の外の駅（つくばエクスプレスの茨城県内など）は対応が無いので、そこを含む区間は捨てる。
import type { Network } from '../src/types';
import { km } from './lib/geo';
import { norm, type LineMeta } from './build-network';
import type { Conn } from './synth-timetable';

type Obj = { 'odpt:departureTime'?: string; 'odpt:arrivalTime'?: string; 'odpt:departureStation'?: string; 'odpt:arrivalStation'?: string };
export type OdptTrain = {
  'odpt:railway': string;
  'odpt:calendar': string;
  'odpt:trainType'?: string;
  'owl:sameAs': string;
  'odpt:trainTimetableObject': Obj[];
};
export type OdptStation = { 'owl:sameAs': string; 'dc:title': string; 'odpt:railway': string; 'geo:lat'?: number; 'geo:long'?: number };
export type OdptConfig = { railways: Record<string, number>; excludeTrainTypes: string[]; stationAlias: Record<string, string> };

export type MapResult = { conns: Conn[]; lineCds: Set<number>; trains: number; warnings: string[] };

/** "HH:MM" → 分 */
const minutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

/** 名前の比較用: 表記ゆれをそろえ、〈原宿〉などの括弧書きを外す */
const bare = (n: string) => norm(n).replace(/（.*?）/g, '').trim();

export function mapOdpt(
  net: Network,
  meta: LineMeta[],
  stationOf: Map<string, number>,
  trains: OdptTrain[],
  odptStations: OdptStation[],
  cfg: OdptConfig,
  firstTrip: number,
): MapResult {
  const warnings: string[] = [];
  // 括弧を外した名前でも引けるようにする
  const byBare = new Map<string, number>();
  for (const [k, v] of stationOf) {
    const [lc, name] = k.split('|');
    byBare.set(`${lc}|${bare(name)}`, v);
  }
  const lineStations = new Map<number, Set<number>>();
  net.lines.forEach((l, li) => {
    const s = lineStations.get(meta[li].lineCd) ?? lineStations.set(meta[li].lineCd, new Set()).get(meta[li].lineCd)!;
    for (const i of l.stations) s.add(i);
  });

  // ODPT の駅 → 駅 index（無ければ undefined = 範囲外）
  const stIndex = new Map<string, number | undefined>();
  const unmatched: string[] = [];
  for (const s of odptStations) {
    const lc = cfg.railways[s['odpt:railway']];
    if (lc === undefined) continue;
    const title = cfg.stationAlias[s['owl:sameAs']] ?? s['dc:title'];
    let idx = stationOf.get(`${lc}|${norm(title)}`) ?? byBare.get(`${lc}|${bare(title)}`);
    if (idx === undefined && s['geo:lat'] !== undefined && s['geo:long'] !== undefined) {
      let best = 0.5;
      for (const i of lineStations.get(lc) ?? []) {
        const d = km(s['geo:lat'], s['geo:long'], net.stations[i].lat, net.stations[i].lon);
        if (d < best) (best = d), (idx = i);
      }
      if (idx !== undefined) warnings.push(`ODPT の駅「${title}」を位置で「${net.stations[idx].name}」に対応付けました`);
    }
    if (idx === undefined) unmatched.push(title);
    stIndex.set(s['owl:sameAs'], idx);
  }
  if (unmatched.length) warnings.push(`ODPT の駅のうち ${unmatched.length} 駅は対応が無く捨てました（1 都 3 県の外など）: ${unmatched.join('、')}`);

  const exclude = new Set(cfg.excludeTrainTypes);
  const conns: Conn[] = [];
  const lineCds = new Set<number>();
  const served = new Set<number>();
  let trip = firstTrip;
  let count = 0;
  for (const tr of trains) {
    const lc = cfg.railways[tr['odpt:railway']];
    if (lc === undefined || tr['odpt:calendar'] !== 'odpt.Calendar:Weekday') continue;
    if (tr['odpt:trainType'] && exclude.has(tr['odpt:trainType'])) continue;
    lineCds.add(lc);
    // 停車駅ごとの [駅, 着, 発]。日付をまたいだら 1440 を足す（始発前の 0〜3 時台は前日の続き）
    const stops: { st: number | undefined; arr: number; dep: number }[] = [];
    let base = -1;
    let prev = -1;
    const fix = (t: number) => {
      if (base < 0) base = t < 180 ? 1440 : 0;
      let v = t + base;
      if (v < prev) (base += 1440), (v += 1440);
      prev = v;
      return v;
    };
    for (const o of tr['odpt:trainTimetableObject']) {
      const name = o['odpt:departureStation'] ?? o['odpt:arrivalStation'];
      if (!name) continue;
      const a = o['odpt:arrivalTime'] ?? o['odpt:departureTime'];
      const d = o['odpt:departureTime'] ?? o['odpt:arrivalTime'];
      if (!a || !d) continue;
      const arr = fix(minutes(a));
      const dep = fix(minutes(d));
      stops.push({ st: stIndex.get(name), arr, dep });
    }
    let any = false;
    for (let i = 0; i + 1 < stops.length; i++) {
      const x = stops[i];
      const y = stops[i + 1];
      if (x.st === undefined || y.st === undefined || x.st === y.st) continue;
      conns.push({ d: x.st, a: y.st, dep: x.dep, arr: Math.max(y.arr, x.dep), trip });
      served.add(x.st).add(y.st);
      any = true;
    }
    if (any) (trip++, count++);
  }
  // ODPT にした路線で、列車が 1 本も止まらない駅（対応付け漏れの疑い）
  for (const lc of lineCds) {
    const miss = [...(lineStations.get(lc) ?? [])].filter((i) => !served.has(i)).map((i) => net.stations[i].name);
    if (miss.length) warnings.push(`line_cd ${lc}: ODPT の列車が止まらない駅 ${miss.join('、')}`);
  }
  return { conns, lineCds, trains: count, warnings };
}
