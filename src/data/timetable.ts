import type { Timetable } from '../types';

/** 1 接続 = 出発駅(2B) 到着駅(2B) 出発分(2B) 到着分(2B) 列車番号(4B)、リトルエンディアン */
export const CONN_BYTES = 12;

export function encodeTimetable(t: Timetable): ArrayBuffer {
  const buf = new ArrayBuffer(t.count * CONN_BYTES);
  const v = new DataView(buf);
  for (let i = 0; i < t.count; i++) {
    const o = i * CONN_BYTES;
    v.setUint16(o, t.depStation[i], true);
    v.setUint16(o + 2, t.arrStation[i], true);
    v.setUint16(o + 4, t.dep[i], true);
    v.setUint16(o + 6, t.arr[i], true);
    v.setUint32(o + 8, t.trip[i], true);
  }
  return buf;
}

export function decodeTimetable(buf: ArrayBuffer): Timetable {
  const count = Math.floor(buf.byteLength / CONN_BYTES);
  const v = new DataView(buf);
  const t: Timetable = {
    count,
    depStation: new Uint16Array(count),
    arrStation: new Uint16Array(count),
    dep: new Uint16Array(count),
    arr: new Uint16Array(count),
    trip: new Uint32Array(count),
  };
  for (let i = 0; i < count; i++) {
    const o = i * CONN_BYTES;
    t.depStation[i] = v.getUint16(o, true);
    t.arrStation[i] = v.getUint16(o + 2, true);
    t.dep[i] = v.getUint16(o + 4, true);
    t.arr[i] = v.getUint16(o + 6, true);
    t.trip[i] = v.getUint32(o + 8, true);
  }
  return t;
}
