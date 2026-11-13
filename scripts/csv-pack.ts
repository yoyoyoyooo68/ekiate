// 駅データ.jp の CSV を合言葉で暗号化して 1 ファイルにまとめる / 戻す。
//   PASSPHRASE=合言葉 npm run csv:pack     data/ekidata/*.csv → data/ekidata.enc（リポジトリに入れてよいのは暗号化したものだけ）
//   PASSPHRASE=合言葉 npm run csv:unpack   data/ekidata.enc → data/ekidata/*.csv（Actions で使う）
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { decryptBytes, encryptBytes } from '../src/data/crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(root, 'data/ekidata');
const packed = resolve(root, 'data/ekidata.enc');
const pass = process.env.PASSPHRASE;
if (!pass) {
  console.error('環境変数 PASSPHRASE を設定してください');
  process.exit(1);
}

if (process.argv[2] === 'pack') {
  const files = readdirSync(dir).filter((n) => n.endsWith('.csv'));
  if (!files.length) throw new Error(`${dir} に CSV がありません`);
  const bundle: Record<string, string> = {};
  for (const f of files) bundle[f] = readFileSync(resolve(dir, f)).toString('base64');
  const gz = gzipSync(Buffer.from(JSON.stringify(bundle)));
  writeFileSync(packed, await encryptBytes(new Uint8Array(gz), pass));
  console.log(`packed ${files.length} files -> data/ekidata.enc`);
} else if (process.argv[2] === 'unpack') {
  if (!existsSync(packed)) throw new Error('data/ekidata.enc がありません');
  const gz = await decryptBytes(new Uint8Array(readFileSync(packed)), pass);
  const bundle = JSON.parse(gunzipSync(Buffer.from(gz)).toString('utf8')) as Record<string, string>;
  mkdirSync(dir, { recursive: true });
  for (const [f, b64] of Object.entries(bundle)) writeFileSync(resolve(dir, f), Buffer.from(b64, 'base64'));
  console.log(`unpacked ${Object.keys(bundle).length} files -> data/ekidata/`);
} else {
  console.error('使い方: csv-pack.ts pack | unpack');
  process.exit(1);
}
