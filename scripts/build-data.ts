// β 版のデータ作成: 駅データ.jp の CSV → public/data/{network.json,timetable.bin,manifest.json}
//   npm run data:beta            （CSV は data/ekidata/ か、環境変数 EKIDATA_DIR）
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeTimetable } from '../src/data/timetable';
import { buildNetwork, readEkidata, type Defaults, type Overrides, type Tweaks } from './build-network';
import { buildTimetable } from './build-timetable';
import { synthTimetable } from './synth-timetable';
import { makeKana } from './lib/kana';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = <T>(f: string): T => JSON.parse(readFileSync(resolve(root, 'data', f), 'utf8'));

const raw = readEkidata(resolve(process.env.EKIDATA_DIR ?? resolve(root, 'data/ekidata')));
const defaults = json<Defaults>('line-defaults.json');
const merge = json<{ merge: number[][]; split: number[]; rename: Record<string, string> }>('station-merge.json');
const tweaks: Tweaks = { ...merge, transfer: json('transfer-pairs.json') };
const { network, meta, warnings } = buildNetwork(raw, defaults, json<Overrides>('line-overrides.json'), tweaks);
// 駅名の読み（CSV に無いときだけ推定）
const kana = await makeKana();
for (const st of network.stations) if (st.kana === st.name) st.kana = kana(st.name);
const conns = synthTimetable(network, meta, defaults);
const timetable = buildTimetable(conns);

const out = resolve(root, 'public/data');
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'network.json'), JSON.stringify(network));
writeFileSync(resolve(out, 'timetable.bin'), Buffer.from(encodeTimetable(timetable)));
writeFileSync(resolve(out, 'manifest.json'), JSON.stringify({ version: network.version, encrypted: false, estimated: true }));

for (const w of warnings) console.warn(`警告: ${w}`);
const kinds: Record<string, number> = {};
for (const m of meta) kinds[m.kind] = (kinds[m.kind] ?? 0) + 1;
console.log(
  `β データ ${network.version}: 駅 ${network.stations.length} / 路線 ${network.lines.length} ` +
    `(${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(', ')}) / 乗換ペア ${network.transferPairs.length} / ` +
    `接続 ${timetable.count}（${(timetable.count * 12 / 1e6).toFixed(1)} MB）`,
);
