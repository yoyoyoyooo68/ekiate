import type { Network } from '../types';
import { h, katakanaToHiragana } from './dom';

/** 駅名検索（ひらがな・漢字の前方一致）。選ぶと onPick が呼ばれる。 */
export function stationSearch(net: Network, onPick: (station: number) => void): HTMLElement {
  const input = h('input', { type: 'search', placeholder: '駅名検索（ひらがな・漢字）', autocomplete: 'off', class: 'search-input' });
  const list = h('ul', { class: 'search-list' });
  const update = () => {
    list.replaceChildren();
    const q = katakanaToHiragana(input.value.trim().normalize('NFKC'));
    if (!q) return;
    const hits: number[] = [];
    net.stations.forEach((s, i) => {
      if (hits.length < 8 && (s.name.startsWith(q) || s.kana.startsWith(q))) hits.push(i);
    });
    for (const i of hits) {
      list.append(
        h('li', null, h('button', {
          type: 'button',
          onclick: () => {
            onPick(i);
            input.value = '';
            list.replaceChildren();
          },
        }, net.stations[i].name)),
      );
    }
    if (!hits.length) list.append(h('li', { class: 'muted' }, '見つかりません'));
  };
  input.addEventListener('input', update);
  return h('div', { class: 'search' }, input, list);
}
