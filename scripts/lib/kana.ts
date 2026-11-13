// 駅名の読み（ひらがな）を推定する。駅データ.jp の無料 CSV には駅名の読みが入っていないため、
// 形態素解析（kuromoji）で作る。間違いがあっても、ひらがな検索で見つからないだけでゲームには影響しない。
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const toHira = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

export async function makeKana(): Promise<(name: string) => string> {
  const kuromoji = require('kuromoji');
  const dicPath = resolve(dirname(require.resolve('kuromoji/package.json')), 'dict');
  const tokenizer: { tokenize(s: string): { reading?: string; surface_form: string }[] } = await new Promise((ok, ng) =>
    kuromoji.builder({ dicPath }).build((e: Error | null, t: never) => (e ? ng(e) : ok(t))),
  );
  return (name) => {
    const base = name.replace(/[〈（(].*$/, '');
    return toHira(tokenizer.tokenize(base).map((t) => (t.reading && t.reading !== '*' ? t.reading : t.surface_form)).join(''));
  };
}
