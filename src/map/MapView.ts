import { INF, type Leg } from '../routing/csa';
import type { Network } from '../types';
import { schematicLayout } from './layout';
import { themeAt } from './theme';

type Pt = { x: number; y: number };
const ACCENT = '#e8344e';
const GOLD = '#f5b700';

/**
 * 駅名の出し方
 * - none: 出さない（現在駅・行った駅・選択中だけ。PC ではマウスを乗せた駅も）
 * - zoom: 拡大するほど増える（引いたときは主要駅だけ）
 * - all: 全部（重なりは間引く）
 */
export type LabelMode = 'none' | 'zoom' | 'all';

export type MapOptions = {
  labels: LabelMode;
  onSelect?: (station: number | null) => void;
  onSelectLine?: (line: number | null) => void;
  onCamera?: () => void;
};

/** 路線図の Canvas 描画（拡大縮小・ドラッグ・ピンチ・駅の選択・経路アニメーション） */
export class MapView {
  readonly canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private world: Pt[];
  private cam = { x: 0, y: 0, scale: 1 };
  private target: { x: number; y: number; scale: number } | null = null;
  private fitScale = 1;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private dirty = true;
  private raf = 0;
  private frame = 0;
  private ro: ResizeObserver;
  private pointers = new Map<number, Pt>();
  private dragStart: Pt | null = null;
  private moved = false;
  private lastPinch = 0;
  private labelAlways: boolean;
  private lineOf: Map<string, number>;
  private sized = false;
  private onReady: (() => void)[] = [];
  private hover = -1;

  labels: LabelMode;
  time = 720;
  current = -1;
  selected = -1;
  visited = new Set<number>();
  reach: Int32Array | null = null;
  /** true のとき、reach が INF の駅を暗く表示する */
  dimUnreachable = false;
  highlight: Leg[] | null = null;
  /** 結果の振り返り用: 駅 → 手の番号の表記 */
  numbers = new Map<number, string>();
  answer = -1;
  /** 強調する路線（-1 = なし） */
  lineHighlight = -1;
  private anim: { legs: Leg[]; t0: number; dur: number; done: () => void; onProgress?: (p: number) => void } | null = null;

  constructor(
    container: HTMLElement,
    private net: Network,
    private opts: MapOptions,
  ) {
    this.labels = opts.labels;
    container.appendChild(this.canvas);
    this.canvas.className = 'map-canvas';
    this.world = schematicLayout(net);
    this.labelAlways = net.stations.length < 100;
    this.lineOf = new Map();
    net.lines.forEach((l, li) => l.stations.forEach((s) => this.lineOf.set(`${li}:${s}`, 1)));

    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onUp);
    this.canvas.addEventListener('pointerleave', () => {
      if (this.hover >= 0) {
        this.hover = -1;
        this.dirty = true;
      }
    });
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.ro = new ResizeObserver(() => this.resize(container));
    this.ro.observe(container);
    this.resize(container);
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.frame++;
      this.tick();
    };
    loop();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.canvas.remove();
  }

  // ---- 状態の更新 ----
  invalidate() {
    this.dirty = true;
  }
  setTime(m: number) {
    this.time = m;
    this.dirty = true;
  }
  setSelected(i: number) {
    this.selected = i;
    this.dirty = true;
  }
  /** 画面に載ってサイズが決まったあとで実行する（初期カメラ位置用） */
  whenReady(f: () => void) {
    if (this.sized) f();
    else this.onReady.push(f);
  }

  /** 経路をなぞるアニメーション。終わったら resolve。onProgress は 0..1（イージング後） */
  animatePath(legs: Leg[], dur = 2000, onProgress?: (p: number) => void): Promise<void> {
    return new Promise((resolve) => {
      this.skipAnimation();
      this.anim = { legs, t0: performance.now(), dur, done: resolve, onProgress };
      this.fitStations(legs.flatMap((l) => l.stops));
    });
  }
  get animating() {
    return this.anim !== null;
  }
  /** 演出を飛ばして最後まで進める */
  skipAnimation() {
    if (this.anim) this.anim.t0 = -1e9;
    this.dirty = true;
  }

  // ---- カメラ ----
  private resize(container: HTMLElement) {
    const r = container.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    const wasFit = Math.abs(this.cam.scale - this.fitScale) < 1e-9;
    this.computeFit();
    if (wasFit || (!this.sized && r.width > 10)) this.fit(false);
    if (!this.sized && r.width > 10) {
      this.sized = true;
      this.onReady.forEach((f) => f());
      this.onReady = [];
    }
    this.dirty = true;
    this.opts.onCamera?.();
  }
  private bounds(ids: number[]) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const i of ids) {
      const p = this.world[i];
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
    return { x0, y0, x1, y1 };
  }
  private computeFit() {
    const b = this.bounds(this.net.stations.map((_, i) => i));
    const bw = Math.max(b.x1 - b.x0, 1);
    const bh = Math.max(b.y1 - b.y0, 1);
    this.fitScale = Math.min(this.w / bw, this.h / bh) * 0.85;
  }
  fit(animate = true) {
    this.computeFit();
    this.fitStations(this.net.stations.map((_, i) => i), animate, 0.85);
  }
  /** 指定した駅がすべて入るようにカメラを合わせる */
  fitStations(ids: number[], animate = true, margin = 0.7) {
    const b = this.bounds(ids);
    const bw = Math.max(b.x1 - b.x0, 1);
    const bh = Math.max(b.y1 - b.y0, 1);
    const scale = Math.min(Math.min(this.w / bw, this.h / bh) * margin, this.fitScale * 40);
    this.moveCamera({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, scale: ids.length > 1 ? scale : this.fitScale * 4 }, animate);
  }
  focusStation(i: number, animate = true) {
    const p = this.world[i];
    this.moveCamera({ x: p.x, y: p.y, scale: Math.max(this.cam.scale, this.fitScale * 1.8) }, animate);
  }
  private moveCamera(c: { x: number; y: number; scale: number }, animate: boolean) {
    if (animate) this.target = c;
    else {
      this.cam = { ...c };
      this.target = null;
    }
    this.dirty = true;
    this.opts.onCamera?.();
  }

  toScreen(i: number): Pt {
    const p = this.world[i];
    return { x: (p.x - this.cam.x) * this.cam.scale + this.w / 2, y: (p.y - this.cam.y) * this.cam.scale + this.h / 2 };
  }
  private sp(p: Pt): Pt {
    return { x: (p.x - this.cam.x) * this.cam.scale + this.w / 2, y: (p.y - this.cam.y) * this.cam.scale + this.h / 2 };
  }
  private zoomAt(px: number, py: number, factor: number) {
    const min = this.fitScale * 0.6;
    const max = this.fitScale * 60;
    const next = Math.min(max, Math.max(min, this.cam.scale * factor));
    // カーソル位置の世界座標を固定
    const wx = (px - this.w / 2) / this.cam.scale + this.cam.x;
    const wy = (py - this.h / 2) / this.cam.scale + this.cam.y;
    this.cam.scale = next;
    this.cam.x = wx - (px - this.w / 2) / next;
    this.cam.y = wy - (py - this.h / 2) / next;
    this.target = null;
    this.dirty = true;
    this.opts.onCamera?.();
  }

  // ---- 入力 ----
  private pos(e: PointerEvent): Pt {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  private onDown = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, this.pos(e));
    this.dragStart = this.pos(e);
    this.moved = false;
    this.target = null;
    if (this.pointers.size === 2) this.lastPinch = this.pinchDist();
  };
  private pinchDist() {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  private onMove = (e: PointerEvent) => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) {
      // マウスを乗せただけ（押していない）
      if (e.pointerType === 'mouse' && this.labels === 'none') {
        const hv = this.hit(this.pos(e)) ?? -1;
        if (hv !== this.hover) {
          this.hover = hv;
          this.dirty = true;
        }
      }
      return;
    }
    const cur = this.pos(e);
    if (this.pointers.size === 1) {
      if (this.dragStart && Math.hypot(cur.x - this.dragStart.x, cur.y - this.dragStart.y) > 5) this.moved = true;
      if (this.moved) {
        this.cam.x -= (cur.x - prev.x) / this.cam.scale;
        this.cam.y -= (cur.y - prev.y) / this.cam.scale;
        this.dirty = true;
        this.opts.onCamera?.();
      }
    }
    this.pointers.set(e.pointerId, cur);
    if (this.pointers.size === 2) {
      this.moved = true;
      const d = this.pinchDist();
      const [a, b] = [...this.pointers.values()];
      if (this.lastPinch > 0) this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / this.lastPinch);
      this.lastPinch = d;
    }
  };
  private onUp = (e: PointerEvent) => {
    const had = this.pointers.has(e.pointerId);
    this.pointers.delete(e.pointerId);
    this.lastPinch = 0;
    if (had && !this.moved && this.pointers.size === 0 && e.type === 'pointerup') {
      if (this.anim) {
        this.skipAnimation(); // クリックで演出を飛ばす
        return;
      }
      const p = this.pos(e);
      const st = this.hit(p);
      if (st !== null) this.opts.onSelect?.(st);
      else {
        const li = this.opts.onSelectLine ? this.hitLine(p) : null;
        if (li !== null) this.opts.onSelectLine!(li);
        else {
          this.opts.onSelect?.(null);
          this.opts.onSelectLine?.(null);
        }
      }
    }
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    this.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
  };
  private hit(p: Pt): number | null {
    let best = -1;
    let bd = 16;
    for (let i = 0; i < this.world.length; i++) {
      const s = this.toScreen(i);
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best < 0 ? null : best;
  }
  private hitLine(p: Pt): number | null {
    let best = -1;
    let bd = 9;
    this.net.lines.forEach((l, li) => {
      const n = l.stations.length;
      const segs = l.loop ? n : n - 1;
      for (let k = 0; k < segs; k++) {
        const a = this.toScreen(l.stations[k]);
        const b = this.toScreen(l.stations[(k + 1) % n]);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
        const d = Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
        if (d < bd) {
          bd = d;
          best = li;
        }
      }
    });
    return best < 0 ? null : best;
  }

  // ---- 描画 ----
  private tick() {
    if (this.target) {
      const t = this.target;
      const k = 0.18;
      this.cam.x += (t.x - this.cam.x) * k;
      this.cam.y += (t.y - this.cam.y) * k;
      this.cam.scale *= Math.pow(t.scale / this.cam.scale, k);
      if (Math.abs(t.x - this.cam.x) * this.cam.scale < 0.3 && Math.abs(t.y - this.cam.y) * this.cam.scale < 0.3 && Math.abs(Math.log(t.scale / this.cam.scale)) < 0.003) {
        this.cam = { ...t };
        this.target = null;
      }
      this.dirty = true;
      this.opts.onCamera?.();
    }
    const pulsing = this.current >= 0 || this.anim !== null;
    if (this.dirty || (pulsing && (this.anim !== null || this.frame % 2 === 0))) {
      this.dirty = false;
      this.draw();
    }
  }

  private lineWidth(): number {
    const z = this.cam.scale / this.fitScale;
    return Math.min(8, Math.max(2, 2.2 * Math.sqrt(z)));
  }

  private onLine(i: number): boolean {
    return this.lineHighlight < 0 || this.lineOf.has(`${this.lineHighlight}:${i}`);
  }

  private draw() {
    const { ctx } = this;
    const th = themeAt(this.time);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const lw = this.lineWidth();
    const scr = this.world.map((p) => this.sp(p));
    const z = this.cam.scale / this.fitScale;

    // 路線
    this.net.lines.forEach((l, li) => {
      if (l.stations.length < 2) return;
      const on = this.lineHighlight < 0 || this.lineHighlight === li;
      ctx.globalAlpha = on ? 1 : 0.15;
      ctx.beginPath();
      l.stations.forEach((s, k) => (k ? ctx.lineTo(scr[s].x, scr[s].y) : ctx.moveTo(scr[s].x, scr[s].y)));
      if (l.loop) ctx.closePath();
      ctx.strokeStyle = l.color;
      ctx.lineWidth = on && this.lineHighlight >= 0 ? lw + 2 : lw;
      ctx.shadowColor = l.color;
      ctx.shadowBlur = th.glow * 10;
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    // 乗換ペア（点線）
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = th.stationStroke;
    ctx.lineWidth = 1.5;
    for (const [a, b] of this.net.transferPairs) {
      ctx.beginPath();
      ctx.moveTo(scr[a].x, scr[a].y);
      ctx.lineTo(scr[b].x, scr[b].y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // 経路の強調
    this.drawPath(scr, lw);

    // 駅
    const r = Math.min(9, Math.max(3.5, 3.8 * Math.sqrt(z)));
    const pulse = (Math.sin(performance.now() / 280) + 1) / 2;
    const dimmed = (i: number) =>
      (this.dimUnreachable && this.reach !== null && i !== this.current && this.reach[i] >= INF) || !this.onLine(i);
    for (let i = 0; i < scr.length; i++) {
      const p = scr[i];
      if (p.x < -20 || p.y < -20 || p.x > this.w + 20 || p.y > this.h + 20) continue;
      const dim = dimmed(i);
      ctx.globalAlpha = dim ? 0.3 : 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = th.stationFill;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = dim ? '#888' : th.stationStroke;
      ctx.stroke();
      if (this.visited.has(i)) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = '#f5a623';
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (this.current >= 0) {
      const p = scr[this.current];
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 4 + pulse * 5, 0, Math.PI * 2);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = ACCENT;
      ctx.fill();
    }
    if (this.selected >= 0) {
      const p = scr[this.selected];
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2);
      ctx.strokeStyle = th.text;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    if (this.answer >= 0) {
      const p = scr[this.answer];
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2);
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 3.5;
      ctx.stroke();
    }

    this.drawLabels(scr, r, z, th, dimmed);

    // 手の番号・正解の星
    ctx.font = '700 11px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this.numbers.forEach((txt, i) => {
      const p = scr[i];
      const bw = Math.max(18, txt.length * 7 + 8);
      ctx.fillStyle = '#14213d';
      ctx.beginPath();
      ctx.roundRect(p.x - r - 4 - bw / 2, p.y - r - 14, bw, 16, 4);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(txt, p.x - r - 4, p.y - r - 6);
    });
    if (this.answer >= 0) {
      const p = scr[this.answer];
      ctx.font = '18px system-ui, sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = th.halo;
      ctx.strokeText('★', p.x, p.y - r - 14);
      ctx.fillStyle = GOLD;
      ctx.fillText('★', p.x, p.y - r - 14);
    }
    ctx.textAlign = 'start';
  }

  private drawLabels(scr: Pt[], r: number, z: number, th: ReturnType<typeof themeAt>, dimmed: (i: number) => boolean) {
    const { ctx } = this;
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'start';
    ctx.lineWidth = 4;
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const cand: { i: number; pri: number; forced: boolean }[] = [];
    for (let i = 0; i < scr.length; i++) {
      const p = scr[i];
      if (p.x < -60 || p.y < -20 || p.x > this.w + 60 || p.y > this.h + 20) continue;
      const forced = i === this.current || i === this.selected || this.visited.has(i) || i === this.answer || this.numbers.has(i);
      let show = forced;
      if (this.labels === 'all') show = true;
      else if (this.labels === 'zoom') {
        const n = this.net.stations[i].lines.length;
        show = forced || this.labelAlways || z >= (n >= 3 ? 1.5 : n === 2 ? 2.5 : 4);
      }
      if (!show) continue;
      if (this.labels !== 'none' && this.lineHighlight >= 0 && !this.onLine(i) && !forced) continue;
      cand.push({ i, forced, pri: (forced ? 100 : 0) + this.net.stations[i].lines.length });
    }
    cand.sort((a, b) => b.pri - a.pri || a.i - b.i);
    for (const c of cand) {
      const p = scr[c.i];
      const name = this.net.stations[c.i].name;
      const wdt = ctx.measureText(name).width;
      const rect = { x0: p.x + r + 5, y0: p.y - 8, x1: p.x + r + 5 + wdt, y1: p.y + 8 };
      // 名前を出さないモードの強制ラベルは間引かない。それ以外は重なったら出さない
      if (!(c.forced && this.labels === 'none') && placed.some((q) => rect.x0 < q.x1 && rect.x1 > q.x0 && rect.y0 < q.y1 && rect.y1 > q.y0)) continue;
      placed.push(rect);
      ctx.globalAlpha = dimmed(c.i) ? 0.45 : 1;
      ctx.strokeStyle = th.halo;
      ctx.strokeText(name, rect.x0, p.y);
      ctx.fillStyle = th.text;
      ctx.fillText(name, rect.x0, p.y);
      ctx.globalAlpha = 1;
    }
    // マウスを乗せた駅（小さく）
    if (this.labels === 'none' && this.hover >= 0 && !cand.some((c) => c.i === this.hover)) {
      const p = scr[this.hover];
      ctx.font = '500 11px system-ui, sans-serif';
      ctx.strokeStyle = th.halo;
      ctx.strokeText(this.net.stations[this.hover].name, p.x + r + 5, p.y);
      ctx.fillStyle = th.text;
      ctx.fillText(this.net.stations[this.hover].name, p.x + r + 5, p.y);
    }
  }

  private legColor(l: Leg): string {
    for (let li = 0; li < this.net.lines.length; li++) {
      if (this.lineOf.has(`${li}:${l.from}`) && this.lineOf.has(`${li}:${l.to}`)) return this.net.lines[li].color;
    }
    return ACCENT;
  }

  private drawPath(scr: Pt[], lw: number) {
    const legs = this.anim?.legs ?? this.highlight;
    if (!legs || !legs.length) return;
    type Seg = { a: Pt; b: Pt; color: string; dotted: boolean; len: number };
    const segs: Seg[] = [];
    legs.forEach((l, li) => {
      const color = this.legColor(l);
      if (li > 0) {
        const a = scr[legs[li - 1].to];
        const b = scr[l.from];
        if (legs[li - 1].to !== l.from) segs.push({ a, b, color: ACCENT, dotted: true, len: Math.hypot(a.x - b.x, a.y - b.y) });
      }
      for (let k = 0; k + 1 < l.stops.length; k++) {
        const a = scr[l.stops[k]];
        const b = scr[l.stops[k + 1]];
        segs.push({ a, b, color, dotted: false, len: Math.hypot(a.x - b.x, a.y - b.y) });
      }
    });
    const total = segs.reduce((s, x) => s + x.len, 0) || 1;
    let remain = total;
    let finished: (() => void) | null = null;
    if (this.anim) {
      const p = Math.min(1, (performance.now() - this.anim.t0) / this.anim.dur);
      const e = p * p * (3 - 2 * p);
      remain = total * e;
      this.anim.onProgress?.(e);
      if (p >= 1) {
        finished = this.anim.done;
        this.anim = null;
      }
    }
    const { ctx } = this;
    for (const pass of [0, 1]) {
      let left = remain;
      for (const s of segs) {
        if (left <= 0) break;
        const f = Math.min(1, left / (s.len || 1));
        left -= s.len;
        ctx.beginPath();
        ctx.moveTo(s.a.x, s.a.y);
        ctx.lineTo(s.a.x + (s.b.x - s.a.x) * f, s.a.y + (s.b.y - s.a.y) * f);
        ctx.setLineDash(s.dotted ? [3, 4] : []);
        ctx.lineWidth = pass === 0 ? lw + 6 : lw + 1;
        ctx.strokeStyle = pass === 0 ? 'rgba(255,255,255,0.9)' : s.color;
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    finished?.();
  }
}
