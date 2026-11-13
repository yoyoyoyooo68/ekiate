import { describe, expect, it } from 'vitest';
import { buildDummy } from '../data/dummy/dummy';
import { Game } from '../src/game/game';
import { answerFor, hash53, todaySeed } from '../src/game/seed';
import { newSession, shareText } from '../src/game/session';
import { buildGraph } from '../src/routing/csa';
import { LocalSearcher } from '../src/routing/searcher';
import { decodeTimetable, encodeTimetable } from '../src/data/timetable';
import { decryptBytes, encryptBytes, WrongPassphraseError } from '../src/data/crypto';
import { setup } from './helpers';

describe('Game ルール', () => {
  it('最初の手で正解を引いたら 5:00 に 1 手で勝ち', async () => {
    const { net, searcher } = setup(2, [[0, 1, 400, 410, 0]]);
    const g = new Game(net, searcher, 0);
    await g.step(0);
    expect(g.status).toBe('won');
    expect(g.moves.length).toBe(1);
    expect(g.time).toBe(300);
  });

  it('ヒントは「着いた時刻 +1 分以降」で計算される。最初の手だけ 5:00 以降', async () => {
    // 駅0 から 駅1: 5:00 ちょうど発 (300→310)。
    const { net, searcher } = setup(3, [
      [0, 1, 300, 310, 0],
      [1, 2, 310, 320, 1],
    ]);
    const g = new Game(net, searcher, 1);
    const m = await g.step(0);
    expect(m.hint).toBe(310); // 最初の手は 300 発に乗れる
    expect(g.canGo(1)).toBe(false); // 次の移動は 301 以降なので 300 発は乗れない
  });

  it('行けない駅は選べない・いまいる駅は選べない', async () => {
    const { net, searcher } = setup(3, [[0, 1, 400, 410, 0]]);
    const g = new Game(net, searcher, 2);
    await g.step(0);
    expect(g.canGo(0)).toBe(false);
    expect(g.canGo(1)).toBe(true);
    expect(g.canGo(2)).toBe(false);
    await expect(g.step(2)).rejects.toThrow();
  });

  it('どこにも行けなくなったら負け', async () => {
    const { net, searcher } = setup(3, [[0, 1, 400, 410, 0]]);
    const g = new Game(net, searcher, 2);
    await g.step(0);
    await g.step(1);
    expect(g.status).toBe('lost');
    expect(g.time).toBe(410);
  });

  it('正解に着けない駅のヒントは null', async () => {
    const { net, searcher } = setup(3, [[0, 1, 400, 410, 0]]);
    const g = new Game(net, searcher, 2);
    expect((await g.step(0)).hint).toBeNull();
  });

  it('移動すると時刻が着いた時刻まで進み、正解に着けば勝ち', async () => {
    const { net, searcher } = setup(3, [
      [0, 1, 400, 410, 0],
      [1, 2, 420, 430, 1],
    ]);
    const g = new Game(net, searcher, 2);
    await g.step(0);
    const m = await g.step(1);
    expect(m.time).toBe(410);
    expect(m.hint).toBe(430);
    await g.step(2);
    expect(g.status).toBe('won');
    expect(g.time).toBe(430);
  });
});

describe('ダミーデータ', () => {
  const { network, timetable } = buildDummy();
  const g = buildGraph(timetable, network.stations.length, network.transferPairs);
  const searcher = new LocalSearcher(g);

  it('原宿から明治神宮前方面へ乗り換えて行ける', async () => {
    const name = (n: string) => network.stations.findIndex((s) => s.name === n);
    const reach = await searcher.reach(name('原宿'), 301);
    expect(reach[name('北千住')]).toBeLessThan(1500);
  });

  it('時刻表の符号化・復号が往復できる', () => {
    const back = decodeTimetable(encodeTimetable(timetable));
    expect(back.count).toBe(timetable.count);
    expect(Array.from(back.arr.slice(0, 50))).toEqual(Array.from(timetable.arr.slice(0, 50)));
    expect(back.trip[back.count - 1]).toBe(timetable.trip[timetable.count - 1]);
  });

  it('同じシードなら同じ正解、データ版が違えば（たいてい）変わる', () => {
    expect(answerFor(network, ' 2026-11-13 ')).toBe(answerFor(network, '2026-11-13'));
    const other = { ...network, version: 'x' };
    const seeds = Array.from({ length: 30 }, (_, i) => `s${i}`);
    expect(seeds.some((s) => answerFor(network, s) !== answerFor(other, s))).toBe(true);
    expect(hash53('a')).not.toBe(hash53('b'));
  });

  it('今日の問題は日本時間の日付', () => {
    expect(todaySeed(new Date('2026-11-12T16:00:00Z'))).toBe('2026-11-13');
  });

  it('結果テキストに駅名が出ない', async () => {
    const s = newSession(network, searcher, 'abc', 'seed');
    await s.game.step(0);
    const text = shareText(s, 'https://example.com/');
    for (const st of network.stations) expect(text).not.toContain(st.name);
    expect(text).toContain('データ版 dummy1');
  });
});

describe('暗号化', () => {
  it('合言葉で往復でき、間違うと失敗する', async () => {
    const data = new TextEncoder().encode('こんにちは');
    const enc = await encryptBytes(data, 'pw');
    expect(new TextDecoder().decode(await decryptBytes(enc, 'pw'))).toBe('こんにちは');
    await expect(decryptBytes(enc, 'bad')).rejects.toBeInstanceOf(WrongPassphraseError);
  });
});
