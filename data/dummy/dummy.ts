// ダミーの路線図と時刻表（実在の駅名を借りた架空ダイヤ）。リポジトリに入れてよいデータ。
import type { Line, Network, Station, Timetable } from '../../src/types';

type S = [name: string, kana: string, lat: number, lon: number];

const STATIONS: S[] = [
  ['新宿', 'しんじゅく', 35.6896, 139.7006],
  ['代々木', 'よよぎ', 35.6833, 139.702],
  ['原宿', 'はらじゅく', 35.6702, 139.7027],
  ['渋谷', 'しぶや', 35.658, 139.7016],
  ['恵比寿', 'えびす', 35.6467, 139.71],
  ['目黒', 'めぐろ', 35.6339, 139.7158],
  ['品川', 'しながわ', 35.6285, 139.7387],
  ['東京', 'とうきょう', 35.6812, 139.7671],
  ['秋葉原', 'あきはばら', 35.6984, 139.7731],
  ['上野', 'うえの', 35.7141, 139.7774],
  ['池袋', 'いけぶくろ', 35.7295, 139.7109],
  ['高田馬場', 'たかだのばば', 35.7126, 139.7038],
  ['明治神宮前', 'めいじじんぐうまえ', 35.6682, 139.7052],
  ['表参道', 'おもてさんどう', 35.6654, 139.7123],
  ['大手町', 'おおてまち', 35.6867, 139.7639],
  ['北千住', 'きたせんじゅ', 35.7497, 139.8049],
  ['御茶ノ水', 'おちゃのみず', 35.6993, 139.7654],
  ['神田', 'かんだ', 35.6918, 139.7708],
  ['中野', 'なかの', 35.7056, 139.6659],
  ['吉祥寺', 'きちじょうじ', 35.703, 139.5798],
  ['笹塚', 'ささづか', 35.6741, 139.6672],
  ['明大前', 'めいだいまえ', 35.6683, 139.6504],
  ['調布', 'ちょうふ', 35.6513, 139.5434],
  ['浅草（TX）', 'あさくさ', 35.7143, 139.7983],
  ['銀座', 'ぎんざ', 35.6717, 139.764],
  ['浅草', 'あさくさ', 35.7106, 139.7967],
];

type Dir = { first: number; last: number };
type L = {
  name: string;
  company: string;
  color: string;
  stops: string[];
  loop?: boolean;
  head: number; // 運転間隔（分）
  fwd: Dir;
  rev: Dir;
};

const LINES: L[] = [
  {
    name: '山手線', company: 'JR東日本', color: '#9acd32',
    stops: ['新宿', '代々木', '原宿', '渋谷', '恵比寿', '目黒', '品川', '東京', '神田', '秋葉原', '上野', '池袋', '高田馬場'],
    loop: true, head: 5, fwd: { first: 290, last: 1445 }, rev: { first: 292, last: 1430 },
  },
  {
    name: '中央線', company: 'JR東日本', color: '#f15a22',
    stops: ['東京', '神田', '御茶ノ水', '新宿', '中野', '吉祥寺'],
    head: 8, fwd: { first: 300, last: 1400 }, rev: { first: 296, last: 1450 },
  },
  {
    name: '千代田線', company: '東京メトロ', color: '#00bb85',
    stops: ['明治神宮前', '表参道', '大手町', '北千住'],
    head: 6, fwd: { first: 305, last: 1435 }, rev: { first: 310, last: 1420 },
  },
  {
    name: '銀座線', company: '東京メトロ', color: '#f39700',
    stops: ['渋谷', '表参道', '銀座', '上野', '浅草'],
    head: 6, fwd: { first: 300, last: 1440 }, rev: { first: 303, last: 1425 },
  },
  {
    name: '京王線', company: '京王電鉄', color: '#dd0077',
    stops: ['新宿', '笹塚', '明大前', '調布'],
    head: 10, fwd: { first: 295, last: 1440 }, rev: { first: 298, last: 1385 },
  },
  {
    name: 'つくばエクスプレス', company: '首都圏新都市鉄道', color: '#1b3a8c',
    stops: ['秋葉原', '浅草（TX）', '北千住'],
    head: 8, fwd: { first: 302, last: 1415 }, rev: { first: 300, last: 1400 },
  },
];

const TRANSFER_PAIRS: [string, string][] = [
  ['原宿', '明治神宮前'],
  ['東京', '大手町'],
];

function km(a: Station, b: Station): number {
  const R = 6371;
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function buildDummy(): { network: Network; timetable: Timetable } {
  const stations: Station[] = STATIONS.map(([name, kana, lat, lon], i) => ({
    id: `D${String(i + 1).padStart(3, '0')}`,
    name, kana, lat, lon, lines: [],
  }));
  const idx = (name: string) => {
    const i = STATIONS.findIndex((s) => s[0] === name);
    if (i < 0) throw new Error(`unknown station ${name}`);
    return i;
  };

  const lines: Line[] = LINES.map((l, li) => {
    const ids = l.stops.map(idx);
    for (const i of ids) stations[i].lines.push(li);
    return { name: l.name, company: l.company, color: l.color, stations: ids, loop: l.loop };
  });

  type Conn = { d: number; a: number; dep: number; arr: number; trip: number };
  const conns: Conn[] = [];
  let nextTrip = 0;
  const addTrip = (path: number[], start: number) => {
    const trip = nextTrip++;
    let t = start;
    for (let k = 0; k + 1 < path.length; k++) {
      const run = Math.max(2, Math.round(km(stations[path[k]], stations[path[k + 1]]) * 2.3));
      conns.push({ d: path[k], a: path[k + 1], dep: t, arr: t + run, trip });
      t += run;
    }
  };

  LINES.forEach((l, li) => {
    const ids = lines[li].stations;
    const fwd = l.loop ? [...ids, ids[0]] : ids;
    const rev = l.loop ? [ids[0], ...ids.slice(1).reverse(), ids[0]] : [...ids].reverse();
    for (let t = l.fwd.first; t <= l.fwd.last; t += l.head) addTrip(fwd, t);
    for (let t = l.rev.first; t <= l.rev.last; t += l.head) addTrip(rev, t);
  });

  conns.sort((x, y) => x.dep - y.dep || x.arr - y.arr || x.trip - y.trip);
  const n = conns.length;
  const timetable: Timetable = {
    count: n,
    depStation: new Uint16Array(n),
    arrStation: new Uint16Array(n),
    dep: new Uint16Array(n),
    arr: new Uint16Array(n),
    trip: new Uint32Array(n),
  };
  conns.forEach((c, i) => {
    timetable.depStation[i] = c.d;
    timetable.arrStation[i] = c.a;
    timetable.dep[i] = c.dep;
    timetable.arr[i] = c.arr;
    timetable.trip[i] = c.trip;
  });

  const network: Network = {
    version: 'dummy1',
    stations,
    lines,
    transferPairs: TRANSFER_PAIRS.map(([a, b]) => [idx(a), idx(b)]),
  };
  return { network, timetable };
}
