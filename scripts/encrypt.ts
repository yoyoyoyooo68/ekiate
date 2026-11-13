// データを合言葉で暗号化する。
//   PASSPHRASE=合言葉 npm run encrypt [データのあるフォルダ(既定: dist/data)]
// network.json / timetable.bin を .enc に置き換え、manifest.json の encrypted を true にする。
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encryptBytes } from '../src/data/crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(process.argv[2] ?? resolve(root, 'dist/data'));
const pass = process.env.PASSPHRASE;
if (!pass) {
  console.error('環境変数 PASSPHRASE を設定してください');
  process.exit(1);
}

for (const name of ['network.json', 'timetable.bin']) {
  const path = resolve(dir, name);
  const enc = await encryptBytes(new Uint8Array(readFileSync(path)), pass);
  writeFileSync(`${path}.enc`, enc);
  rmSync(path);
  console.log(`encrypted ${name}`);
}
const mpath = resolve(dir, 'manifest.json');
const manifest = JSON.parse(readFileSync(mpath, 'utf8'));
manifest.encrypted = true;
writeFileSync(mpath, JSON.stringify(manifest));
