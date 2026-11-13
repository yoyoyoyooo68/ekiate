import { fetchManifest, loadData, type LoadedData } from '../data/loader';
import { WrongPassphraseError } from '../data/crypto';
import { newSession, loadSession, clearSession, type Mode, type Session } from '../game/session';
import { randomSeed, todaySeed, normalizeSeed } from '../game/seed';
import { createSearcher, type Searcher } from '../routing/searcher';
import type { Network } from '../types';
import { h } from './dom';
import { gameScreen } from './gameScreen';
import { attachGeometry, geometryOf } from '../map/geometry';
import { mapScreen } from './mapScreen';
import { rulesSlides } from './rules';
import { ESTIMATE_BADGE, estimateLevel } from '../data/estimate';

const PASS_KEY = 'ekiate:pass';
const RULES_KEY = 'ekiate:rulesSeen';
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* */ } },
};

export class App {
  private net!: Network;
  private searcher!: Searcher;
  private cleanup: (() => void) | null = null;

  constructor(private root: HTMLElement) {}

  private show(el: HTMLElement, destroy?: () => void) {
    this.cleanup?.();
    this.cleanup = destroy ?? null;
    this.root.replaceChildren(el);
  }

  async start() {
    this.show(h('div', { class: 'screen center' }, h('div', { class: 'card' }, '読み込み中…')));
    let manifest;
    try {
      manifest = await fetchManifest();
    } catch (e) {
      this.fatal((e as Error).message);
      return;
    }
    let pass = store.get(PASS_KEY);
    let error = '';
    for (;;) {
      if (manifest.encrypted && !pass) {
        pass = await this.askPassphrase(error);
      }
      try {
        const data = await this.load(manifest, pass);
        if (manifest.encrypted && pass) store.set(PASS_KEY, pass);
        this.ready(data);
        return;
      } catch (e) {
        if (e instanceof WrongPassphraseError) {
          store.del(PASS_KEY);
          pass = null;
          error = '合言葉が違います';
        } else {
          this.fatal((e as Error).message);
          return;
        }
      }
    }
  }

  private fatal(msg: string) {
    this.show(h('div', { class: 'screen center' }, h('div', { class: 'card' }, h('h2', null, 'エラー'), h('p', null, msg))));
  }

  private askPassphrase(error: string): Promise<string> {
    return new Promise((resolve) => {
      const input = h('input', { type: 'password', class: 'search-input', placeholder: '合言葉', autocomplete: 'current-password' });
      const submit = () => input.value && resolve(input.value);
      this.show(h('div', { class: 'screen center' },
        h('form', { class: 'card', onsubmit: (e: Event) => { e.preventDefault(); submit(); } },
          h('h1', null, '駅当て'),
          h('p', null, '合言葉を入力してください'),
          input,
          error ? h('p', { class: 'warn-text' }, error) : null,
          h('button', { type: 'submit', class: 'btn primary' }, '入る'))));
      input.focus();
    });
  }

  private load(manifest: Awaited<ReturnType<typeof fetchManifest>>, pass: string | null): Promise<LoadedData> {
    const bar = h('div', { class: 'bar-fill' });
    const label = h('p', null, 'データを読み込んでいます…');
    this.show(h('div', { class: 'screen center' }, h('div', { class: 'card' }, label, h('div', { class: 'bar' }, bar))));
    return loadData(manifest, pass, (f) => {
      bar.style.width = `${Math.round(f * 100)}%`;
      if (f >= 1) label.textContent = '復号しています…';
    });
  }

  private ready(data: LoadedData) {
    this.net = data.network;
    attachGeometry(data.network, data.geometry);
    this.searcher = createSearcher(data.timetable, this.net);
    const params = new URLSearchParams(location.search);
    const seed = params.get('seed');
    if (seed) {
      const v = params.get('v');
      history.replaceState(null, '', location.pathname);
      void this.play('seed', seed, v !== null && v !== this.net.version);
    } else if (!store.get(RULES_KEY)) {
      this.openRules(); // 初回起動はルール説明から
    } else this.menu();
  }

  // ---- 画面 ----
  async menu() {
    const net = this.net;
    const today = todaySeed();
    const daily = await loadSession(net, this.searcher, 'daily', today);
    const dailyStatus = !daily ? '未プレイ' : daily.game.status === 'playing' ? 'プレイ中' : daily.game.status === 'won' ? `クリア（${daily.game.moves.length}手）` : '終電';
    const current = await loadSession(net, this.searcher, 'seed', '');
    const est = estimateLevel(net);
    const seedInput = h('input', { class: 'search-input', placeholder: 'シード（好きな文字・数字）' });
    const el = h('div', { class: 'screen center' },
      h('div', { class: 'card menu' },
        h('h1', null, '駅当て', est ? h('span', { class: 'beta' }, ESTIMATE_BADGE[est]) : null),
        h('p', { class: 'muted' }, '路線図の上で「正解の駅」を推理するゲーム'),
        h('h3', null, 'ゲーム'),
        h('button', { type: 'button', class: 'btn primary big', onclick: () => this.play('daily', today) }, `今日の問題（${today}）　${dailyStatus}`),
        h('div', { class: 'row' }, seedInput, h('button', { type: 'button', class: 'btn', onclick: () => seedInput.value.trim() && this.play('seed', seedInput.value) }, 'このシードで')),
        h('button', { type: 'button', class: 'btn big', onclick: () => this.play('random', randomSeed()) }, 'ランダム'),
        current && current.game.status === 'playing'
          ? h('button', { type: 'button', class: 'btn big', onclick: () => this.resume(current) }, `つづきから（${current.mode === 'random' ? 'ランダム' : 'シード'} ${current.seed}・${current.game.moves.length}手）`)
          : null,
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn big', onclick: () => this.openMap() }, 'マップ'),
          h('button', { type: 'button', class: 'btn big', onclick: () => this.openRules() }, 'ルール説明')),
        h('p', { class: 'credit' }, `データ版 ${net.version}`),
        store.get(PASS_KEY) ? h('button', { type: 'button', class: 'link', onclick: () => { store.del(PASS_KEY); location.reload(); } }, '合言葉を入力しなおす') : null,
        h('p', { class: 'credit' }, net.lines.some((l) => l.timeSource === 'odpt') ? '公共交通オープンデータセンターのデータを利用' : ''),
        h('p', { class: 'credit' }, '駅・路線データ: 駅データ.jp')));
    this.show(el);
  }

  private openMap() {
    const s = mapScreen(this.net, () => this.menu());
    this.show(s.el, s.destroy);
  }
  private openRules() {
    this.show(rulesSlides(estimateLevel(this.net), geometryOf(this.net)?.source ?? null, () => {
      store.set(RULES_KEY, '1');
      void this.menu();
    }));
  }

  private async play(mode: Mode, rawSeed: string, versionMismatch = false) {
    const seed = normalizeSeed(rawSeed);
    let session: Session | null = null;
    if (mode === 'daily') session = await loadSession(this.net, this.searcher, 'daily', seed);
    if (!session) {
      session = newSession(this.net, this.searcher, seed, mode);
      if (mode !== 'daily') {
        // 進行中の「つづきから」を上書きする
        const old = await loadSession(this.net, this.searcher, 'seed', '');
        if (old) clearSession(old);
      }
    }
    session.versionMismatch = versionMismatch;
    this.resume(session);
  }

  private resume(session: Session) {
    const s = gameScreen({
      net: this.net,
      session,
      onMenu: () => this.menu(),
      onPlayAgain: () => this.play('random', randomSeed()),
    });
    this.show(s.el, s.destroy);
  }
}
