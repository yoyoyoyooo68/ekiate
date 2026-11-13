import type { Move } from '../game/game';
import { saveSession, shareText, type Session } from '../game/session';
import { MapView } from '../map/MapView';
import { themeAt } from '../map/theme';
import type { Leg } from '../routing/csa';
import type { Network } from '../types';
import { fmt, LATE } from '../util/time';
import { h } from './dom';
import { stationSearch } from './search';

export type GameScreenOptions = {
  net: Network;
  session: Session;
  onMenu: () => void;
  onPlayAgain: () => void;
};

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
  let map: MapView;

  // ---- 要素 ----
  const clock = h('div', { class: 'clock' });
  const sub = h('div', { class: 'clock-sub' });
  const warn = h('div', { class: 'warn hidden' }, '終電が近づいています');
  const resultBtn = h('button', { type: 'button', class: 'btn hidden', onclick: () => showResult() }, '結果');
  const panelBtn = h('button', { type: 'button', class: 'btn panel-toggle', onclick: () => side.classList.toggle('open') }, '履歴・検索');
  const hintbar = h('footer', { class: 'hintbar' });
  const history = h('ol', { class: 'history' });
  const callout = h('div', { class: 'callout hidden' });
  const busyEl = h('div', { class: 'busy hidden' }, '経路を調べています…');
  const banner = h('div', { class: 'banner' + (session.versionMismatch ? '' : ' hidden') }, 'データ版が違うため、共有された問題とは正解が違います');
  const mapwrap = h('div', { class: 'mapwrap' });
  const side = h('aside', { class: 'side' },
    stationSearch(net, (i) => select(i, true)),
    h('h3', null, '履歴'),
    history);
  const overlay = h('div', { class: 'overlay hidden' });

  const el = h('div', { class: 'screen game' },
    h('header', { class: 'topbar' },
      h('button', { type: 'button', class: 'btn', onclick: o.onMenu }, '≡'),
      h('div', { class: 'clock-wrap' }, clock, sub, warn),
      h('div', { class: 'topright' }, h('span', { class: 'ver' }, `データ版 ${net.version}`), resultBtn, panelBtn)),
    banner,
    h('div', { class: 'maprow' }, mapwrap, side, callout, busyEl),
    hintbar,
    overlay);

  map = new MapView(mapwrap, net, { onSelect: (i) => select(i, false), onCamera: () => placeCallout() });

  // ---- 描画 ----
  function placeCallout() {
    if (selected === null || callout.classList.contains('hidden')) return;
    if (!window.matchMedia('(min-width: 761px)').matches) {
      callout.style.left = callout.style.top = '';
      return;
    }
    const p = map.toScreen(selected);
    const rect = mapwrap.getBoundingClientRect();
    const cw = 220;
    const x = Math.min(Math.max(p.x - cw / 2, 8), rect.width - cw - 8);
    const above = p.y > 150;
    const y = above ? p.y - callout.offsetHeight - 16 : p.y + 20;
    callout.style.left = `${rect.left - mapwrap.parentElement!.getBoundingClientRect().left + x}px`;
    callout.style.top = `${Math.max(8, y)}px`;
  }

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
      msg = '5:00 にここからスタート';
      btn = 'ここからスタート';
      enabled = true;
    } else if (i === game.current) msg = 'ここにいます';
    else {
      const t = game.arrivalAt(i);
      if (t === null) msg = '本日中には行けません';
      else {
        msg = `${fmt(t)} 着（あと${t - game.time}分）`;
        enabled = true;
      }
    }
    if (msg) callout.append(h('div', { class: 'callout-msg' }, msg));
    if (game.status === 'playing') {
      callout.append(h('button', { type: 'button', class: 'btn primary', disabled: !enabled || busy, onclick: () => go(i) }, btn));
    }
    callout.append(h('button', { type: 'button', class: 'callout-close', 'aria-label': '閉じる', onclick: () => select(null, false) }, '×'));
    placeCallout();
  }

  function hintText(m: Move, final: boolean): string {
    if (final) return '正解！';
    if (m.hint === null) return '正解の駅には本日中には着けません';
    return `正解の駅に ${fmt(m.hint)} 着（あと${m.hint - m.time}分）`;
  }

  function renderHistory() {
    history.replaceChildren();
    game.moves.forEach((m, n) => {
      const final = game.status === 'won' && n === game.moves.length - 1;
      const li = h('li', { class: n === openMove ? 'open' : '' },
        h('button', { type: 'button', class: 'hist-btn', onclick: () => toggleMove(n) },
          h('div', { class: 'hist-main' }, `${n + 1}. ${nameOf(m.station)}　${fmt(m.time)}着`),
          h('div', { class: 'hist-hint' }, '→ ' + hintText(m, final))));
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
      if (m.path) map.animatePath(m.path, 1).then(() => map.invalidate());
      else map.focusStation(m.station);
    }
    map.invalidate();
    renderHistory();
  }

  function refresh() {
    const t = themeAt(game.time);
    for (const [k, v] of [['--bg', t.bg], ['--fg', t.text], ['--panel', t.panel], ['--border', t.border]]) el.style.setProperty(k, v);
    map.setTime(game.time);
    clock.textContent = fmt(game.time);
    const late = game.time >= LATE && game.status === 'playing';
    clock.classList.toggle('late', game.time >= LATE);
    warn.classList.toggle('hidden', !late);
    sub.textContent =
      game.status !== 'playing' ? `${game.moves.length}手で${game.status === 'won' ? '到着' : '終電'}`
      : game.moves.length === 0 ? '最初の駅を選んでください'
      : `${game.moves.length + 1}手目`;
    map.current = game.current;
    map.visited = new Set(game.moves.map((m) => m.station));
    map.reach = game.reach;
    map.dimUnreachable = game.moves.length > 0 && game.status === 'playing';
    map.invalidate();

    const last = game.lastMove;
    if (!last) hintbar.textContent = '手がかり: 選んだ駅から正解の駅へ、何時何分に着けるか';
    else if (game.status === 'won') hintbar.textContent = `${nameOf(last.station)} が正解です！`;
    else if (game.status === 'lost') hintbar.textContent = '終電を逃しました。これ以上どの駅にも行けません。';
    else {
      const from = game.moves.length === 1 ? '5:00 以降の電車で' : '次の電車で';
      hintbar.textContent = `最新のヒント: ${nameOf(last.station)}を${from}出ると ${last.hint === null ? '正解の駅には本日中には着けません' : `正解の駅に ${fmt(last.hint)} 着（あと ${last.hint - last.time} 分）`}`;
    }
    resultBtn.classList.toggle('hidden', game.status === 'playing');
    renderHistory();
    renderCallout();
  }

  function select(i: number | null, focus: boolean) {
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
    try {
      const move = await game.step(i);
      busyEl.classList.add('hidden');
      selected = null;
      map.setSelected(-1);
      map.highlight = null;
      openMove = -1;
      if (move.path) await map.animatePath(move.path);
      else map.focusStation(i);
      saveSession(net, session);
    } catch (e) {
      hintbar.textContent = String((e as Error).message);
    } finally {
      busy = false;
      busyEl.classList.add('hidden');
    }
    refresh();
    if (game.status !== 'playing') showResult();
  }

  function showResult() {
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
    overlay.replaceChildren(
      h('div', { class: 'card result' },
        h('h2', null, won ? '🎯 正解！' : '❌ 終電を逃しました'),
        h('p', null, `正解の駅は `, h('strong', null, nameOf(game.answer)), ' でした。'),
        h('p', null, won ? `${game.moves.length}手 / ${fmt(game.time)} 着` : `${game.moves.length}手 / 最後の駅に ${fmt(game.time)} 着`),
        h('p', { class: 'muted' }, `シード: ${session.seed}　データ版: ${session.version}`),
        session.versionMismatch ? h('p', { class: 'warn-text' }, 'データ版が違うため問題が違います') : null,
        pre, copy,
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn', onclick: () => overlay.classList.add('hidden') }, '路線図を見る'),
          session.mode !== 'daily' ? h('button', { type: 'button', class: 'btn', onclick: o.onPlayAgain }, 'もう一度（ランダム）') : null,
          h('button', { type: 'button', class: 'btn', onclick: o.onMenu }, 'メニューへ'))));
    overlay.classList.remove('hidden');
  }

  refresh();
  if (game.moves.length) map.whenReady(() => map.focusStation(game.current, false));
  if (game.status !== 'playing') showResult();
  return { el, destroy: () => map.destroy() };
}
