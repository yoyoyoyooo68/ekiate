// 接続の一覧 → Timetable（timetable.bin の中身）。β（概算）と本番（ODPT）で共通。
import type { Timetable } from '../src/types';
import type { Conn } from './synth-timetable';

export function buildTimetable(conns: Conn[]): Timetable {
  const sorted = [...conns].sort((x, y) => x.dep - y.dep || x.arr - y.arr || x.trip - y.trip);
  const n = sorted.length;
  const t: Timetable = {
    count: n,
    depStation: new Uint16Array(n),
    arrStation: new Uint16Array(n),
    dep: new Uint16Array(n),
    arr: new Uint16Array(n),
    trip: new Uint32Array(n),
  };
  sorted.forEach((c, i) => {
    if (c.arr > 65535) throw new Error('時刻が大きすぎます');
    t.depStation[i] = c.d;
    t.arrStation[i] = c.a;
    t.dep[i] = c.dep;
    t.arr[i] = c.arr;
    t.trip[i] = c.trip;
  });
  return t;
}
