/** ゲーム開始時刻（5:00） */
export const START = 5 * 60;
/** この時刻以降は赤表示（22:00） */
export const LATE = 22 * 60;

/** 0:00 からの分 → "14:32"。24 時以降は "24:30" のまま。 */
export function fmt(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}
