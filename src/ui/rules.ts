import { h } from './dom';

// 各スライドの小さな図（SVG）
const svg = (inner: string) =>
  `<svg viewBox="0 0 240 110" width="240" height="110" role="img" aria-hidden="true">${inner}</svg>`;
const dot = (x: number, y: number, fill = '#fff', stroke = '#333') =>
  `<circle cx="${x}" cy="${y}" r="7" fill="${fill}" stroke="${stroke}" stroke-width="3"/>`;
const line = (x1: number, y1: number, x2: number, y2: number, c: string, extra = '') =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="5" stroke-linecap="round" ${extra}/>`;
const text = (x: number, y: number, t: string, size = 13, fill = '#333') =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-family="system-ui,sans-serif" font-weight="600">${t}</text>`;

const SLIDES: { title: string; body: string; fig: string }[] = [
  {
    title: 'このゲームは？',
    body: '首都圏の路線図の中から「正解の駅」を推理するゲームです。手がかりは「その駅から正解の駅へ、何時何分に着けるか」だけ。',
    fig: svg(line(30, 60, 210, 60, '#9acd32') + dot(30, 60) + dot(90, 60) + dot(150, 60) + `<circle cx="210" cy="60" r="12" fill="#ff3b6b"/>` + text(203, 65, '?', 16, '#fff')),
  },
  {
    title: '最初の駅',
    body: '朝 5:00、収録駅の中から好きな駅を選んでスタートします。',
    fig: svg(text(80, 30, '5:00', 26, '#ff3b6b') + line(40, 75, 200, 75, '#f15a22') + dot(40, 75) + dot(120, 75, '#ff3b6b', '#ff3b6b') + dot(200, 75)),
  },
  {
    title: 'ヒント',
    body: '駅を選ぶと「そこを次の電車で出たら、正解の駅に何時何分に着くか」が出ます。早く着くほど近い駅です。',
    fig: svg(dot(40, 70) + line(40, 70, 190, 70, '#00bb85') + `<circle cx="190" cy="70" r="12" fill="#ff3b6b"/>` + text(40, 40, '次の電車で出ると', 12) + text(120, 98, '14:32 着（あと 32 分）', 13, '#ff3b6b')),
  },
  {
    title: '移動',
    body: '駅を選んで「ここに行く」を押すと電車で移動し、時刻が進みます。着いた時刻の 1 分後以降の電車から乗れます。',
    fig: svg(dot(40, 70) + line(40, 70, 180, 70, '#f39700') + dot(180, 70) + text(30, 40, '14:00', 16, '#555') + text(160, 40, '14:20', 16, '#ff3b6b') + text(118, 62, '→', 18)),
  },
  {
    title: '乗換',
    body: '同じ名前の駅と、点線でつながった駅は乗り換えられます。新幹線や、特急料金のかかる電車は使いません。',
    fig: svg(line(30, 40, 100, 40, '#dd0077') + dot(100, 40) + line(100, 40, 130, 70, '#333', 'stroke-dasharray="3 5" stroke-width="3"') + dot(130, 70) + line(130, 70, 210, 70, '#00bb85') + text(60, 20, '原宿', 12) + text(110, 100, '明治神宮前', 12)),
  },
  {
    title: '勝ち負け',
    body: '終電までに正解の駅に着いたら勝ち。今日中にどこへも行けなくなったら負けです。22 時を過ぎたら要注意。',
    fig: svg(text(30, 55, '勝ち 🎯', 22, '#2a9d5c') + text(30, 90, '終電 ❌', 22, '#d33')),
  },
];

/** ルール説明のスライド。onClose で閉じる。 */
export function rulesSlides(onClose: () => void): HTMLElement {
  let i = 0;
  const fig = h('div', { class: 'slide-fig' });
  const title = h('h2');
  const body = h('p', { class: 'slide-body' });
  const dots = h('div', { class: 'slide-dots' });
  const prev = h('button', { type: 'button', class: 'btn', onclick: () => go(i - 1) }, '前へ');
  const next = h('button', { type: 'button', class: 'btn primary', onclick: () => (i === SLIDES.length - 1 ? onClose() : go(i + 1)) }, '次へ');
  const go = (n: number) => {
    i = Math.max(0, Math.min(SLIDES.length - 1, n));
    const s = SLIDES[i];
    fig.innerHTML = s.fig;
    title.textContent = `${i + 1}. ${s.title}`;
    body.textContent = s.body;
    dots.textContent = SLIDES.map((_, k) => (k === i ? '●' : '○')).join(' ');
    prev.disabled = i === 0;
    next.textContent = i === SLIDES.length - 1 ? '閉じる' : '次へ';
  };
  go(0);
  return h('div', { class: 'screen center' },
    h('div', { class: 'card slides' }, fig, title, body, dots,
      h('div', { class: 'row' }, prev, next),
      h('button', { type: 'button', class: 'link', onclick: onClose }, '閉じる')));
}
