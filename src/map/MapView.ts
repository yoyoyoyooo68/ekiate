import { INF, type Leg } from '../routing/csa';
import type { Network } from '../types';
import { themeAt } from './theme';

type Pt = { x: number; y: number };
const ACCENT = '#ff3b6b';

export type MapOptions = {
  onSelect: (station: number | null) => void;
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

  time = 720;
  current = -1;
  selected = -1;
  visited = new Set<number>();
  reach: Int32Array | null = null;
  /** true のとき、reach が INF の駅を暗く表示する */
  dimUnreachable = false;
  highlight: Leg[] | null = null;
  private anim: { legs: Leg[]; t0: number; dur: number; done: () => void } | null = null;

  constructor(
    container: HTMLElement,
    private net: Network,
    private opts: MapOptions,
  ) {
    container.appendChild(this.canvas);
    this.canvas.className = 'map-canvas';
    const lats = net.stations.map((s) => s.lat);
    const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
    const k = Math.cos((lat0 * Math.PI) / 180);
    this.world = net.stations.map((s) => ({ x: s.lon * k * 1000, y: -s.lat * 1000 }));
    this.labelAlways = net.stations.length < 100;
    this.lineOf = new Map();
    net.lines.forEach((l, li) => l.stations.forEach((s) => this.lineOf.set(`${li}:${s}`, 1)));

    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.ro = new ResizeObserver(() => this.resize(container));
    this.ro.observe(container);
    this.resize(container);
    this.fit(false);
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

  private sized = false;
  private onReady: (() => void)[] = [];
  /** 画面に載ってサイズが決まったあとで実行する（初期カメラ位置用） */
  whenReady(f: () => void) {
    if (this.sized) f();
    else this.onReady.push(f);
  }

  /** 経路をなぞるアニメーション。終わったら resolve */
  animatePath(legs: Leg[], dur = 900): Promise<void> {
    return new Promise((resolve) => {
      this.anim?.done();
      this.anim = { legs, t0: performance.now(), dur, done: resolve };
      this.fitPoints(legs.flatMap((l) => l.stops));
    });
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
    this.fitPoints(this.net.stations.map((_, i) => i), animate, 0.85);
  }
  private fitPoints(ids: number[], animate = true, margin = 0.7) {
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
    const f = next / this.cam.scale;
    // カーソル位置の世界座標を固定
    const wx = (px - this.w / 2) / this.cam.scale + this.cam.x;
    const wy = (py - this.h / 2) / this.cam.scale + this.cam.y;
    this.cam.scale = next;
    this.cam.x = wx - (px - this.w / 2) / next;
    this.cam.y = wy - (py - this.h / 2) / next;
    void f;
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
    if (!prev) return;
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
      this.opts.onSelect(this.hit(this.pos(e)));
    }
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = { x: e.clientX - this.canvas.getBoundingClientRect().left, y: e.clientY - this.canvas.getBoundingClientRect().top };
    this.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
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
    if (this.dirty || (pulsing && this.frame % 2 === 0)) {
      this.dirty = false;
      this.draw();
    }
  }

  private lineWidth(): number {
    const z = this.cam.scale / this.fitScale;
    return Math.min(8, Math.max(2, 2.2 * Math.sqrt(z)));
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
    for (const l of this.net.lines) {
      if (l.stations.length < 2) continue;
      ctx.beginPath();
      l.stations.forEach((s, k) => (k ? ctx.lineTo(scr[s].x, scr[s].y) : ctx.moveTo(scr[s].x, scr[s].y)));
      if (l.loop) ctx.closePath();
      ctx.strokeStyle = l.color;
      ctx.lineWidth = lw;
      ctx.shadowColor = l.color;
      ctx.shadowBlur = th.glow * 10;
      ctx.stroke();
    }
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
    for (let i = 0; i < scr.length; i++) {
      const p = scr[i];
      if (p.x < -20 || p.y < -20 || p.x > this.w + 20 || p.y > this.h + 20) continue;
      const dim = this.dimUnreachable && this.reach !== null && i !== this.current && this.reach[i] >= INF;
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

    // 駅名
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    for (let i = 0; i < scr.length; i++) {
      const p = scr[i];
      if (p.x < -60 || p.y < -20 || p.x > this.w + 60 || p.y > this.h + 20) continue;
      const st = this.net.stations[i];
      const forced = i === this.current || i === this.selected || this.visited.has(i);
      const nLines = st.lines.length;
      const show = this.labelAlways || z >= (nLines >= 3 ? 1.5 : nLines === 2 ? 2.5 : 4);
      if (!show && !forced) continue;
      const dim = this.dimUnreachable && this.reach !== null && i !== this.current && this.reach[i] >= INF;
      ctx.globalAlpha = dim ? 0.45 : 1;
      ctx.strokeStyle = th.halo;
      ctx.strokeText(st.name, p.x + r + 5, p.y);
      ctx.fillStyle = th.text;
      ctx.fillText(st.name, p.x + r + 5, p.y);
      ctx.globalAlpha = 1;
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
    if (this.anim) {
      const p = Math.min(1, (performance.now() - this.anim.t0) / this.anim.dur);
      remain = total * (p * p * (3 - 2 * p));
      if (p >= 1) {
        const done = this.anim.done;
        this.anim = null;
        done();
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
  }
}
