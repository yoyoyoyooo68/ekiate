// ダミーデータを public/data/ に書き出す（npm run data:dummy）
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDummy } from '../data/dummy/dummy';
import { encodeTimetable } from '../src/data/timetable';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public/data');
mkdirSync(out, { recursive: true });

const { network, timetable } = buildDummy();
writeFileSync(resolve(out, 'network.json'), JSON.stringify(network));
writeFileSync(resolve(out, 'timetable.bin'), Buffer.from(encodeTimetable(timetable)));
writeFileSync(resolve(out, 'manifest.json'), JSON.stringify({ version: network.version, encrypted: false }));
console.log(`dummy data: ${network.stations.length} stations, ${timetable.count} connections -> ${out}`);
