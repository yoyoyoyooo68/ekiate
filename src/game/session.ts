import type { Searcher } from '../routing/searcher';
import type { Network } from '../types';
import { fmt } from '../util/time';
import { Game } from './game';
import { answerFor, normalizeSeed } from './seed';

export type Mode = 'daily' | 'seed' | 'random';

export type Session = {
  seed: string;
  mode: Mode;
  version: string;
  game: Game;
  /** 共有 URL のデータ版が今のデータと違うとき true */
  versionMismatch?: boolean;
};

type Saved = { seed: string; mode: Mode; version: string; moves: string[]; gaveUp?: boolean };

export function newSession(net: Network, searcher: Searcher, seed: string, mode: Mode): Session {
  const s = normalizeSeed(seed);
  return { seed: s, mode, version: net.version, game: new Game(net, searcher, answerFor(net, s)) };
}

const keyOf = (mode: Mode, seed: string) => (mode === 'daily' ? `ekiate:daily:${seed}` : 'ekiate:current');

function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export function saveSession(net: Network, s: Session): void {
  const data: Saved = {
    seed: s.seed,
    mode: s.mode,
    version: s.version,
    moves: s.game.moves.map((m) => net.stations[m.station].id),
    gaveUp: s.game.gaveUp || undefined,
  };
  try {
    storage()?.setItem(keyOf(s.mode, s.seed), JSON.stringify(data));
  } catch {
    /* 保存できなくても遊べる */
  }
}

export function clearSession(s: Session): void {
  storage()?.removeItem(keyOf(s.mode, s.seed));
}

/** 保存を読み出して、手を順に再生して状態を復元する。データ版が違う・壊れているときは null。 */
export async function loadSession(
  net: Network,
  searcher: Searcher,
  mode: Mode,
  seed?: string,
): Promise<Session | null> {
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(keyOf(mode, seed ?? '')) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Saved;
    if (d.version !== net.version) return null;
    const s = newSession(net, searcher, d.seed, d.mode);
    for (const id of d.moves) {
      const i = net.stations.findIndex((x) => x.id === id);
      if (i < 0) return null;
      await s.game.step(i);
    }
    if (d.gaveUp) s.game.giveUp();
    return s;
  } catch {
    return null;
  }
}

const EMOJI_END = '🎯';
function moveEmoji(hint: number | null, time: number): string {
  if (hint === null) return '⬛';
  const left = hint - time;
  return left <= 30 ? '🟩' : left <= 60 ? '🟨' : left <= 120 ? '🟧' : '🟥';
}

/** ネタバレなしの結果テキスト */
export function shareText(s: Session, baseUrl: string): string {
  const g = s.game;
  const label = s.mode === 'daily' ? s.seed : `シード ${s.seed}`;
  const won = g.status === 'won';
  const head = won
    ? `駅当て ${label} ✅ ${g.moves.length}手 / ${fmt(g.time)}着`
    : g.gaveUp
      ? `駅当て ${label} 🏳️ あきらめ / ${fmt(g.time)}`
      : `駅当て ${label} ❌ 終電 / ${fmt(g.time)}`;
  const marks = g.moves.map((m, i) => (won && i === g.moves.length - 1 ? EMOJI_END : moveEmoji(m.hint, m.time)));
  const url = `${baseUrl}?seed=${encodeURIComponent(s.seed)}&v=${encodeURIComponent(s.version)}`;
  return `${head}\n${marks.join('')}\nデータ版 ${s.version}\n${url}`;
}
