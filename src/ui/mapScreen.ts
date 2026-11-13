import { geometryOf } from '../map/geometry';
import { MapView } from '../map/MapView';
import { themeAt } from '../map/theme';
import type { Network } from '../types';
import { h } from './dom';
import { stationSearch } from './search';

/** マップだけを見る画面（予習・確認用。拡大すると駅名が出る。時刻と明るさの変化は無し） */
export function mapScreen(net: Network, onBack: () => void): { el: HTMLElement; destroy: () => void } {
  const wrap = h('div', { class: 'mapwrap full' });
  const label = h('div', { class: 'map-label hidden' });
  const select = (i: number | null) => {
    map.setSelected(i ?? -1);
    if (i === null) return;
    map.lineHighlight = -1;
    const st = net.stations[i];
    show(`${st.name}　${st.lines.map((l) => net.lines[l].name).join('・')}`);
  };
  const selectLine = (li: number | null) => {
    map.lineHighlight = li ?? -1;
    map.invalidate();
    if (li === null) show(null);
    else show(`${net.lines[li].name}（${net.lines[li].company}）${net.lines[li].timeSource === 'estimated' ? '　時刻は概算' : ''}`);
  };
  const show = (t: string | null) => {
    label.textContent = t ?? '';
    label.classList.toggle('hidden', !t);
  };
  const el = h('div', { class: 'screen game' },
    h('header', { class: 'topbar' },
      h('button', { type: 'button', class: 'btn', onclick: onBack }, '≡ メニュー'),
      h('div', { class: 'title' }, 'マップ'),
      h('span')),
    h('div', { class: 'maprow' }, wrap),
    h('div', { class: 'floating-search' }, stationSearch(net, (i) => { select(i); map.focusStation(i); })),
    label,
    geometryOf(net) ? h('p', { class: 'attribution' }, '国土数値情報（国土交通省）を加工して作成') : null);
  const t = themeAt(720);
  el.style.setProperty('--bg', t.bg);
  el.style.setProperty('--fg', t.text);
  el.style.setProperty('--panel', t.panel);
  el.style.setProperty('--border', t.border);
  const map: MapView = new MapView(wrap, net, {
    labels: 'zoom',
    onSelect: (i) => { if (i === null) show(null); select(i); },
    onSelectLine: selectLine,
  });
  map.setTime(720);
  return { el, destroy: () => map.destroy() };
}
