import type { Move } from '../game/game';
import { saveSession, shareText, type Session } from '../game/session';
import { geometryOf } from '../map/geometry';
import { MapView } from '../map/MapView';
import { themeAt } from '../map/theme';
import type { Leg } from '../routing/csa';
import type { Network } from '../types';
import { fmt, LATE } from '../util/time';
import { ESTIMATE_BADGE, estimateLevel } from '../data/estimate';
import { h } from './dom';
import { rulesSlides } from './rules';
import { stationSearch } from './search';

export type GameScreenOptions = {
  net: Network;
  session: Session;
  onMenu: () => void;
  onPlayAgain: () => void;
};

const MOVE_MS = 2000;

export function gameScreen(o: GameScreenOptions): { el: HTMLElement; destroy: () => void } {
  const { net, session } = o;
  const game = session.game;
  const nameOf = (i: number) => net.stations[i].name;
  const lineNameOf = (l: Leg) => {
    const k = net.lines.find((ln) => ln.stations.includes(l.from) && ln.stations.includes(l.to));
    return k ? k.name : '電車';
  };

  let selected: number | null = null;
  let busy = false;
  let openMove = -1;
  let resultMap: MapView | null = null;

  // ---- 要素 ----
  const clock = h('div', { class: 'clock' });
  const sub = h('div', { class: 'clock-sub' });
  const warn = h('div', { class: 'warn hidden' }, '終電が近づいています');
  const resultBtn = h('button', { type: 'button', class: 'btn hidden', onclick: () => showResult() }, '結果');
  const panelBtn = h('button', { type: 'button', class: 'btn panel-toggle', onclick: () => side.classList.toggle('open') }, '履歴・検索');
  const menuPop = h('div', { class: 'menu-pop hidden' });
  const hintbar = h('footer', { class: 'hintbar' });
  const history = h('ol', { class: 'history' });
  const callout = h('div', { class: 'callout hidden' });
  const busyEl = h('div', { class: 'busy hidden' }, '経路を調べています…');
  const skipEl = h('div', { class: 'busy hidden' }, 'クリックで飛ばす');
  const banner = h('div', { class: 'banner' + (session.versionMismatch ? '' : ' hidden') }, 'データ版が違うため、共有された問題とは正解が違います');
  const mapwrap = h('div', { class: 'mapwrap' });
  const side = h('aside', { class: 'side' },
    stationSearch(net, (i) => select(i, true)),
    h('h3', null, '履歴'),
    history);
  const overlay = h('div', { class: 'overlay hidden' });

  const el = h('div', { class: 'screen game' },
    h('header', { class: 'topbar' },
      h('button', { type: 'button', class: 'btn', 'aria-label': 'メニュー', onclick: () => menuPop.classList.toggle('hidden') }, '≡'),
      h('div', { class: 'clock-wrap' }, clock, sub, warn, estimateLevel(net) ? h('div', { class: 'beta small' }, ESTIMATE_BADGE[estimateLevel(net)!]) : null),
      h('div', { class: 'topright' }, resultBtn, panelBtn)),
    menuPop,
    banner,
    h('div', { class: 'maprow' }, mapwrap, side, callout, busyEl, skipEl),
    hintbar,
    overlay);

  const map = new MapView(mapwrap, net, { labels: 'none', onSelect: (i) => select(i, false), onCamera: () => placeCallout() });

  // ---- メニュー ----
  function renderMenu() {
    menuPop.replaceChildren(
      h('button', { type: 'button', onclick: () => { closeMenu(); showRules(); } }, 'ルール説明'),
      h('button', { type: 'button', onclick: () => { closeMenu(); o.onMenu(); } }, 'メインメニューへ'),
      ...(game.status === 'playing'
        ? [h('button', { type: 'button', class: 'danger', onclick: () => { closeMenu(); confirmGiveUp(); } }, 'あきらめる')]
        : []));
  }
  function closeMenu() {
    menuPop.classList.add('hidden');
  }
  menuPop.addEventListener('click', () => {
    /* 項目側で閉じる */
  });

  function showRules() {
    overlay.replaceChildren(rulesSlides(estimateLevel(net), geometryOf(net)?.source ?? null, () => closeOverlay()));
    overlay.classList.remove('hidden');
  }
  function confirmGiveUp() {
    overlay.replaceChildren(
      h('div', { class: 'card' },
        h('h2', null, '本当にあきらめますか？'),
        h('p', null, '負けとして扱われ、正解の駅が表示されます。'),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn', onclick: () => closeOverlay() }, 'つづける'),
          h('button', { type: 'button', class: 'btn danger-fill', onclick: () => {
            game.giveUp();
            saveSession(net, session);
            closeOverlay();
            refresh();
            showResult();
          } }, 'あきらめる'))));
    overlay.classList.remove('hidden');
  }
  function closeOverlay() {
    overlay.classList.add('hidden');
    resultMap?.destroy();
    resultMap = null;
    overlay.replaceChildren();
  }

  // ---- 描画 ----
  function placeCallout() {
    if (selected === null || callout.classList.contains('hidden')) return;
    if (!window.matchMedia('(min-width: 761px)').matches) {
      callout.style.left = callout.style.top = '';
      return;
    }
    const p = map.toScreen(selected);
    const rect = mapwrap.getBoundingClientRect();
    const cw = 200;
    const x = Math.min(Math.max(p.x - cw / 2, 8), rect.width - cw - 8);
    const above = p.y > 120;
    const y = above ? p.y - callout.offsetHeight - 16 : p.y + 20;
    callout.style.left = `${rect.left - mapwrap.parentElement!.getBoundingClientRect().left + x}px`;
    callout.style.top = `${Math.max(8, y)}px`;
  }

  /** 吹き出し: 駅名と「ここに行く」だけ（到着時刻・経路は出さない） */
  function renderCallout() {
    callout.replaceChildren();
    if (selected === null) {
      callout.classList.add('hidden');
      return;
    }
    const i = selected;
    callout.classList.remove('hidden');
    callout.append(h('div', { class: 'callout-name' }, nameOf(i)));
    let msg = '';
    let btn = 'ここに行く';
    let enabled = false;
    if (game.status !== 'playing') msg = '';
    else if (game.moves.length === 0) {
      btn = 'ここからスタート';
      enabled = true;
    } else if (i === game.current) msg = 'いまここにいます';
    else if (game.arrivalAt(i) === null) msg = '本日中には行けません';
    else enabled = true;
    if (msg) callout.append(h('div', { class: 'callout-msg' }, msg));
    if (game.status === 'playing') {
      callout.append(h('button', { type: 'button', class: 'btn primary', disabled: !enabled || busy, onclick: () => go(i) }, btn));
    }
    callout.append(h('button', { type: 'button', class: 'callout-close', 'aria-label': '閉じる', onclick: () => select(null, false) }, '×'));
    placeCallout();
  }

  function remainText(m: Move): string {
    if (m.hint === null) return '本日中には着けません';
    return `${fmt(m.hint)} 着（あと${m.hint - m.time}分）`;
  }

  function renderHint() {
    hintbar.replaceChildren();
    const n = game.moves.length;
    if (!n) {
      hintbar.append(h('span', { class: 'hint-idle' }, '最初の駅を選んでください。手がかりは「そこから正解の駅へ何時に着けるか」だけです。'));
      return;
    }
    const last = game.moves[n - 1];
    if (game.status === 'won') {
      hintbar.append(h('span', { class: 'hint-main' }, `${nameOf(last.station)} が正解です！`));
      return;
    }
    if (game.gaveUp) {
      hintbar.append(h('span', { class: 'hint-main' }, 'あきらめました'));
      return;
    }
    if (game.status === 'lost') {
      hintbar.append(h('span', { class: 'hint-main' }, '終電を逃しました。これ以上どの駅にも行けません。'));
      return;
    }
    hintbar.append(h('span', { class: 'hint-main' }, `${nameOf(last.station)}から → 正解の駅に ${remainText(last)}`));
    const prev = n >= 2 ? game.moves[n - 2] : null;
    if (prev && prev.hint !== null && last.hint !== null) {
      const d = last.hint - last.time - (prev.hint - prev.time);
      if (d < 0) hintbar.append(h('span', { class: 'delta good' }, `▲前回より${-d}分近い`));
      else if (d > 0) hintbar.append(h('span', { class: 'delta bad' }, `▼前回より${d}分遠い`));
      else hintbar.append(h('span', { class: 'delta' }, '前回と同じ'));
    }
  }

  function renderHistory() {
    history.replaceChildren();
    game.moves.forEach((m, n) => {
      const final = game.status === 'won' && n === game.moves.length - 1;
      const li = h('li', { class: n === openMove ? 'open' : '' },
        h('button', { type: 'button', class: 'hist-btn', onclick: () => toggleMove(n) },
          h('div', { class: 'hist-main' }, h('span', { class: 'hist-n' }, String(n + 1)), nameOf(m.station), h('span', { class: 'hist-time' }, fmt(m.time))),
          h('div', { class: 'hist-hint' }, final ? '正解！' : `正解着 ${remainText(m)}`)));
      if (n === openMove) {
        const d = h('ul', { class: 'legs' });
        if (!m.path) d.append(h('li', null, '最初の駅（移動なし）'));
        else for (const l of m.path) d.append(h('li', null, `${lineNameOf(l)}　${nameOf(l.from)} ${fmt(l.dep)}発 → ${nameOf(l.to)} ${fmt(l.arr)}着`));
        li.append(d);
      }
      history.append(li);
    });
    history.scrollTop = history.scrollHeight;
  }

  function toggleMove(n: number) {
    if (openMove === n) {
      openMove = -1;
      map.highlight = null;
    } else {
      openMove = n;
      const m = game.moves[n];
      map.highlight = m.path;
      if (m.path) map.fitStations(m.path.flatMap((l) => l.stops));
      else map.focusStation(m.station);
    }
    map.invalidate();
    renderHistory();
  }

  /** 時刻に合わせて時計・空の色を更新 */
  function applyTime(t: number) {
    const th = themeAt(t);
    for (const [k, v] of [['--bg', th.bg], ['--fg', th.text], ['--panel', th.panel], ['--border', th.border]]) el.style.setProperty(k, v);
    map.setTime(t);
    clock.textContent = fmt(Math.round(t));
    clock.classList.toggle('late', t >= LATE);
  }

  function refresh() {
    applyTime(game.time);
    const late = game.time >= LATE && game.status === 'playing';
    warn.classList.toggle('hidden', !late);
    sub.textContent =
      game.status !== 'playing' ? (game.gaveUp ? `${game.moves.length}手でリタイア` : `${game.moves.length}手で${game.status === 'won' ? '到着' : '終電'}`)
      : game.moves.length === 0 ? 'スタート駅を選んでください'
      : `${game.moves.length + 1}手目`;
    map.current = game.current;
    map.visited = new Set(game.moves.map((m) => m.station));
    map.reach = game.reach;
    map.dimUnreachable = game.moves.length > 0 && game.status === 'playing';
    map.invalidate();
    renderHint();
    resultBtn.classList.toggle('hidden', game.status === 'playing');
    renderMenu();
    renderHistory();
    renderCallout();
  }

  function select(i: number | null, focus: boolean) {
    if (busy) return;
    selected = i;
    map.setSelected(i ?? -1);
    if (i !== null && focus) map.focusStation(i);
    if (i !== null) side.classList.remove('open');
    renderCallout();
  }

  async function go(i: number) {
    if (busy) return;
    busy = true;
    busyEl.classList.remove('hidden');
    renderCallout();
    const oldTime = game.time;
    try {
      const move = await game.step(i);
      busyEl.classList.add('hidden');
      selected = null;
      map.setSelected(-1);
      map.highlight = null;
      openMove = -1;
      callout.classList.add('hidden');
      if (move.path) {
        // 約 2 秒: 経路をなぞりながら時刻のカウントアップと空の色の変化。クリックで飛ばせる
        skipEl.classList.remove('hidden');
        await map.animatePath(move.path, MOVE_MS, (p) => applyTime(oldTime + (game.time - oldTime) * p));
        skipEl.classList.add('hidden');
      } else map.focusStation(i);
      saveSession(net, session);
    } catch (e) {
      hintbar.textContent = String((e as Error).message);
    } finally {
      busy = false;
      busyEl.classList.add('hidden');
      skipEl.classList.add('hidden');
    }
    refresh();
    if (game.status !== 'playing') showResult();
  }

  /** 結果画面: 全行程を地図で振り返る */
  function showResult() {
    resultMap?.destroy();
    const won = game.status === 'won';
    const text = shareText(session, location.origin + location.pathname);
    const copy = h('button', { type: 'button', class: 'btn primary', onclick: async () => {
      try {
        await navigator.clipboard.writeText(text);
        copy.textContent = 'コピーしました';
      } catch {
        pre.select();
        copy.textContent = '選択しました（コピーしてください）';
      }
    } }, '結果をコピー');
    const pre = h('textarea', { class: 'share', readonly: true, rows: 5 });
    pre.value = text;
    const note = h('p', { class: 'muted hidden' });
    const rmap = h('div', { class: 'result-map' });
    const title = won ? '正解！' : game.gaveUp ? '正解は…' : '終電を逃しました';
    overlay.replaceChildren(
      h('div', { class: 'card result' },
        h('div', { class: 'result-title' }, title),
        h('div', { class: 'result-answer' }, nameOf(game.answer)),
        rmap,
        h('p', { class: 'result-stats' }, `${game.moves.length}手 / ${fmt(game.time)}${won ? ' 着' : ''}`),
        note,
        h('p', { class: 'muted small' }, `シード ${session.seed}　データ版 ${session.version}`),
        session.versionMismatch ? h('p', { class: 'warn-text' }, 'データ版が違うため問題が違います') : null,
        pre, copy,
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn', onclick: () => closeOverlay() }, '閉じる'),
          session.mode !== 'daily' ? h('button', { type: 'button', class: 'btn', onclick: o.onPlayAgain }, 'もう一度（ランダム）') : null,
          h('button', { type: 'button', class: 'btn', onclick: o.onMenu }, 'メニューへ'))));
    overlay.classList.remove('hidden');

    const rm = new MapView(rmap, net, { labels: 'all' });
    resultMap = rm;
    rm.setTime(720);
    rm.answer = game.answer;
    const nums = new Map<number, string>();
    game.moves.forEach((m, n) => nums.set(m.station, nums.has(m.station) ? `${nums.get(m.station)}・${n + 1}` : String(n + 1)));
    rm.numbers = nums;
    rm.visited = new Set(game.moves.map((m) => m.station));
    rm.highlight = game.moves.flatMap((m) => m.path ?? []);
    rm.whenReady(() => rm.fitStations([...game.moves.map((m) => m.station), game.answer, ...rm.highlight!.flatMap((l) => l.stops)], false, 0.8));

    // 終電事情（負けのとき、分かる範囲で）
    if (game.status === 'lost' && !game.gaveUp && game.current >= 0) {
      const cur = game.current;
      void game.searcher.lastDeparture(cur).then((t) => {
        if (t === null) return;
        note.textContent = `${nameOf(cur)}からの最終電車は ${fmt(t)} に出ていました`;
        note.classList.remove('hidden');
      });
    }
  }

  applyTime(game.time);
  refresh();
  if (game.moves.length) map.whenReady(() => map.focusStation(game.current, false));
  if (game.status !== 'playing') showResult();
  return {
    el,
    destroy: () => {
      map.destroy();
      resultMap?.destroy();
    },
  };
}
