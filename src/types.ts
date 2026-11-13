// 内部データ形式（設計図 4 章）

export type Station = {
  id: string; // 固定 ID（シードで使う。並びはこの ID 順）
  name: string; // 表示名 "浅草（TX）"
  kana: string; // 検索用 "あさくさ"
  lat: number;
  lon: number;
  lines: number[]; // 通る路線
};

export type Line = {
  name: string;
  company: string;
  color: string;
  stations: number[]; // 駅の並び（線を引く順）
  loop?: boolean; // 環状線（最後の駅と最初の駅をつなぐ）
};

export type Network = {
  version: string; // データ版 "2026A"
  stations: Station[];
  lines: Line[];
  transferPairs: [number, number][]; // 乗換ペア（駅 index の組）
};

/** CSA 用の接続一覧。出発時刻順に並んでいる。時刻は 0:00 からの分（24 時以降は 1440 以上）。 */
export type Timetable = {
  count: number;
  depStation: Uint16Array;
  arrStation: Uint16Array;
  dep: Uint16Array;
  arr: Uint16Array;
  trip: Uint32Array;
};
