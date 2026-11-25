// 本番: ODPT から列車時刻表・駅・路線をまとめて取得し data/odpt-raw/ に置く（設計図 2.5.6）
//   ODPT_KEY=… npm run odpt:fetch     （手元では .env.local に ODPT_KEY=… と書いておけば読む）
// 取ったデータはリポジトリに入れない（.gitignore 済み）。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let key = process.env.ODPT_KEY;
const envFile = resolve(root, '.env.local');
if (!key && existsSync(envFile)) key = /^ODPT_KEY=(.+)$/m.exec(readFileSync(envFile, 'utf8'))?.[1]?.trim();
if (!key) throw new Error('ODPT_KEY がありません（環境変数か .env.local に書く）');

const out = resolve(process.env.ODPT_DIR ?? resolve(root, 'data/odpt-raw'));
mkdirSync(out, { recursive: true });
for (const type of ['TrainTimetable', 'Station', 'Railway']) {
  const url = `https://api.odpt.org/api/v4/odpt:${type}.json?acl:consumerKey=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`odpt:${type} の取得に失敗しました（HTTP ${res.status}）`);
  const body = await res.text();
  const n = (JSON.parse(body) as unknown[]).length;
  writeFileSync(resolve(out, `${type}.json`), body);
  console.log(`odpt:${type}: ${n} 件（${(body.length / 1e6).toFixed(1)} MB）`);
}
