import { MapView } from '../map/MapView';
import { themeAt } from '../map/theme';
import type { Network } from '../types';
import { h } from './dom';
import { stationSearch } from './search';

/** マップだけを見る画面（時刻表示なし・昼の配色） */
export function mapScreen(net: Network, onBack: () => void): { el: HTMLElement; destroy: () => void } {
  const wrap = h('div', { class: 'mapwrap full' });
  const label = h('div', { class: 'map-label hidden' });
  let map: MapView;
  const select = (i: number | null) => {
    if (i === null) {
      label.classList.add('hidden');
      map.setSelected(-1);
      return;
    }
    map.setSelected(i);
    const st = net.stations[i];
    label.textContent = `${st.name}　${st.lines.map((l) => net.lines[l].name).join('・')}`;
    label.classList.remove('hidden');
  };
  const el = h('div', { class: 'screen game' },
    h('header', { class: 'topbar' },
      h('button', { type: 'button', class: 'btn', onclick: onBack }, '≡ メニュー'),
      h('div', { class: 'title' }, 'マップ'),
      h('span')),
    h('div', { class: 'maprow' }, wrap),
    h('div', { class: 'floating-search' }, stationSearch(net, (i) => { select(i); map.focusStation(i); })),
    label);
  const t = themeAt(720);
  el.style.setProperty('--bg', t.bg);
  el.style.setProperty('--fg', t.text);
  el.style.setProperty('--panel', t.panel);
  el.style.setProperty('--border', t.border);
  map = new MapView(wrap, net, { onSelect: select });
  map.setTime(720);
  return { el, destroy: () => map.destroy() };
}
