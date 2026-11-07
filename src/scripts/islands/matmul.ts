import { isMotionOn, onMotionChange } from '../motion-state';

// Toy model of TitanInfer's matmul_avx2 loop nest (src/ops/matrix_ops_simd.cpp:108-150).
// N x N matrices, row-major, 4 floats per cache line, a fully associative LRU cache of CACHE_LINES.
// Each "step" is one 8-wide FMA: it reads A[i][k..k+7] (2 lines), B[k..k+7][j] (8 lines, one per
// row, the strided gather) and accumulates into C[i][j] (1 line).
const N = 16;
const MC = 4, NC = 4, KC = 8, LANES = 8;
const LINE = 4;
const CACHE_LINES = 24;

type Mode = 'blocked' | 'naive';
interface Step { i: number; j: number; k: number; i0: number; j0: number; k0: number }
interface Access { m: 0 | 1 | 2; r: number; c: number; hit: boolean }

function steps(mode: Mode): Step[] {
  const out: Step[] = [];
  if (mode === 'blocked') {
    for (let i0 = 0; i0 < N; i0 += MC)
      for (let k0 = 0; k0 < N; k0 += KC)
        for (let j0 = 0; j0 < N; j0 += NC)
          for (let i = i0; i < i0 + MC; i++)
            for (let j = j0; j < j0 + NC; j++)
              for (let k = k0; k < k0 + KC; k += LANES) out.push({ i, j, k, i0, j0, k0 });
  } else {
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++)
        for (let k = 0; k < N; k += LANES) out.push({ i, j, k, i0: i, j0: j, k0: k });
  }
  return out;
}

const lineId = (m: number, r: number, c: number) => m * 10000 + r * (N / LINE) + Math.floor(c / LINE);

class Cache {
  lines: number[] = [];
  hits = 0;
  misses = 0;
  touch(id: number): boolean {
    const at = this.lines.indexOf(id);
    if (at >= 0) {
      this.lines.splice(at, 1);
      this.lines.unshift(id);
      this.hits++;
      return true;
    }
    this.lines.unshift(id);
    if (this.lines.length > CACHE_LINES) this.lines.pop();
    this.misses++;
    return false;
  }
}

function run(cache: Cache, s: Step): Access[] {
  const acc: Access[] = [];
  const seen = new Set<number>();
  const visit = (m: 0 | 1 | 2, r: number, c: number) => {
    const id = lineId(m, r, c);
    let hit: boolean;
    if (seen.has(id)) hit = true; // same line twice in one FMA (A's 8 floats span 2 lines)
    else { hit = cache.touch(id); seen.add(id); }
    acc.push({ m, r, c, hit });
  };
  for (let l = 0; l < LANES; l++) visit(0, s.i, s.k + l);
  for (let l = 0; l < LANES; l++) visit(1, s.k + l, s.j);
  visit(2, s.i, s.j);
  return acc;
}

function totalMisses(mode: Mode) {
  const c = new Cache();
  for (const s of steps(mode)) run(c, s);
  return c.misses;
}

export default function initMatmul(fig: HTMLElement) {
  const canvas = fig.querySelector<HTMLCanvasElement>('[data-mm-canvas]');
  const controls = fig.querySelector<HTMLElement>('[data-mm-controls]');
  if (!canvas || !controls) return;
  const ctx2 = canvas.getContext('2d');
  if (!ctx2) return;
  const g = ctx2;
  controls.hidden = false;

  const $ = <T extends HTMLElement>(sel: string) => fig.querySelector<T>(sel)!;
  const elStep = $('[data-mm-step]');
  const elMiss = $('[data-mm-miss]');
  const elHit = $('[data-mm-hit]');
  const elCmp = $('[data-mm-compare]');
  const elSlots = $('[data-mm-slots]');
  const elMode = $('[data-mm-modelabel]');
  const range = $<HTMLInputElement>('[data-mm-range]');
  const btnPlay = $<HTMLButtonElement>('[data-mm="play"]');
  const btnStep = $<HTMLButtonElement>('[data-mm="step"]');
  const btnBlocked = $<HTMLButtonElement>('[data-mm="blocked"]');
  const btnNaive = $<HTMLButtonElement>('[data-mm="naive"]');

  const fmt = (n: number) => n.toLocaleString('en-US');
  const totals = { naive: totalMisses('naive'), blocked: totalMisses('blocked') };
  elCmp.textContent = `unblocked ${fmt(totals.naive)}, blocked ${fmt(totals.blocked)}`;

  const slots = Array.from({ length: CACHE_LINES }, () => {
    const i = document.createElement('i');
    elSlots.appendChild(i);
    return i;
  });

  const css = getComputedStyle(fig);
  const col = (name: string, fb: string) => css.getPropertyValue(name).trim() || fb;
  const C = {
    bg: col('--t-bg', '#0f1412'), cell: col('--t-cell', '#1d2723'), ink: col('--t-ink', '#d6e2da'),
    ink2: col('--t-ink-2', '#8fa198'), a: col('--t-a', '#5b8db8'), b: col('--t-b', '#c9963a'),
    c: col('--t-c', '#d6e2da'), hot: col('--t-hot', '#7cffb2'), miss: col('--t-miss', '#e46a5e'),
  };
  const matColor = [C.a, C.b, C.c];

  let mode: Mode = 'blocked';
  let list = steps(mode);
  let cache = new Cache();
  let pos = 0; // steps executed
  let lastAcc: Access[] = [];
  let playing = false;
  let visible = false;
  let userPaused = false;
  let raf = 0;
  let acc = 0;
  let prevT = 0;
  const RATE = 32; // steps per second

  // ---- layout ----
  let W = 0, H = 0, cell = 0, gx: number[] = [], gy = 0, pad = 0;
  function layout() {
    const w = canvas!.clientWidth || 720;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    pad = w < 520 ? 6 : 14;
    const gap = w < 520 ? 16 : 34;
    cell = Math.max(4, Math.floor((w - 2 * pad - 2 * gap) / (3 * N)));
    const gridW = cell * N;
    const used = 3 * gridW + 2 * gap;
    const left = Math.round((w - used) / 2);
    gx = [left, left + gridW + gap, left + 2 * (gridW + gap)];
    gy = w < 520 ? 18 : 26;
    W = w;
    H = gy + gridW + (w < 520 ? 8 : 14);
    canvas!.style.aspectRatio = `${W} / ${H}`;
    canvas!.width = Math.round(W * dpr);
    canvas!.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function resident() {
    const set = new Set(cache.lines);
    return set;
  }

  function draw() {
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);
    const small = W < 520;
    g.font = `${small ? 10 : 12}px ui-monospace, Consolas, monospace`;
    g.textBaseline = 'alphabetic';
    const labels = small ? ['A', 'B', 'C'] : ['A  (M × K)', 'B  (K × N)', 'C  (M × N)'];
    const gridW = cell * N;
    const res = resident();
    for (let m = 0; m < 3; m++) {
      g.fillStyle = matColor[m];
      g.fillText(labels[m], gx[m], gy - (small ? 6 : 9));
      for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++) {
          const inCache = res.has(lineId(m, r, c));
          g.fillStyle = C.cell;
          g.fillRect(gx[m] + c * cell, gy + r * cell, cell - 1, cell - 1);
          if (inCache) {
            g.globalAlpha = 0.38;
            g.fillStyle = matColor[m];
            g.fillRect(gx[m] + c * cell, gy + r * cell, cell - 1, cell - 1);
            g.globalAlpha = 1;
          }
        }
    }
    // operators between grids
    g.fillStyle = C.ink2;
    g.font = `${small ? 12 : 16}px ui-monospace, Consolas, monospace`;
    g.textAlign = 'center';
    const mid = gy + gridW / 2 + 5;
    g.fillText('×', (gx[0] + gridW + gx[1]) / 2, mid);
    g.fillText('=', (gx[1] + gridW + gx[2]) / 2, mid);
    g.textAlign = 'left';

    // current accesses
    for (const a of lastAcc) {
      g.fillStyle = a.hit ? matColor[a.m] : C.miss;
      g.fillRect(gx[a.m] + a.c * cell, gy + a.r * cell, cell - 1, cell - 1);
    }
    // block outlines in blocked mode
    const s = pos > 0 ? list[pos - 1] : null;
    if (s && mode === 'blocked') {
      g.strokeStyle = C.hot;
      g.lineWidth = small ? 1 : 1.5;
      const box = (m: number, r0: number, c0: number, rows: number, cols: number) =>
        g.strokeRect(gx[m] + c0 * cell - 1.5, gy + r0 * cell - 1.5, cols * cell + 2, rows * cell + 2);
      box(0, s.i0, s.k0, MC, KC);
      box(1, s.k0, s.j0, KC, NC);
      box(2, s.i0, s.j0, MC, NC);
    }
    if (s) {
      g.strokeStyle = C.hot;
      g.lineWidth = 1;
      g.strokeRect(gx[2] + s.j * cell - 0.5, gy + s.i * cell - 0.5, cell, cell);
    }
  }

  function updateText() {
    elStep.textContent = `${pos} / ${list.length}`;
    elMiss.textContent = fmt(cache.misses);
    elHit.textContent = fmt(cache.hits);
    range.value = String(pos);
    slots.forEach((el, i) => {
      const id = cache.lines[i];
      if (id === undefined) { el.className = ''; el.textContent = ''; return; }
      const m = Math.floor(id / 10000);
      el.className = ['a', 'b', 'c'][m];
      el.textContent = ['A', 'B', 'C'][m];
    });
  }

  function stepOnce() {
    if (pos >= list.length) return false;
    lastAcc = run(cache, list[pos]);
    pos++;
    return true;
  }

  function seek(target: number) {
    cache = new Cache();
    pos = 0;
    lastAcc = [];
    while (pos < target) stepOnce();
    draw();
    updateText();
  }

  function setMode(m: Mode) {
    mode = m;
    list = steps(m);
    btnBlocked.setAttribute('aria-pressed', String(m === 'blocked'));
    btnNaive.setAttribute('aria-pressed', String(m === 'naive'));
    elMode.textContent = m === 'blocked' ? 'blocked order (i, k, j blocks)' : 'unblocked order (i, j, k)';
    seek(0);
  }

  function frame(t: number) {
    if (!playing) return;
    if (!prevT) prevT = t;
    acc += ((t - prevT) / 1000) * RATE;
    prevT = t;
    let n = Math.floor(acc);
    acc -= n;
    let moved = false;
    while (n-- > 0) moved = stepOnce() || moved;
    if (moved) { draw(); updateText(); }
    if (pos >= list.length) { setPlaying(false); return; }
    raf = requestAnimationFrame(frame);
  }

  function setPlaying(on: boolean) {
    if (on && pos >= list.length) seek(0);
    playing = on;
    btnPlay.textContent = on ? 'Pause' : pos >= list.length ? 'Replay' : 'Play';
    btnPlay.setAttribute('aria-pressed', String(on));
    cancelAnimationFrame(raf);
    if (on) { prevT = 0; acc = 0; raf = requestAnimationFrame(frame); }
  }

  btnPlay.addEventListener('click', () => { userPaused = playing; setPlaying(!playing); });
  btnStep.addEventListener('click', () => { setPlaying(false); userPaused = true; if (stepOnce()) { draw(); updateText(); } });
  btnBlocked.addEventListener('click', () => { const was = playing; setPlaying(false); setMode('blocked'); if (was) setPlaying(true); });
  btnNaive.addEventListener('click', () => { const was = playing; setPlaying(false); setMode('naive'); if (was) setPlaying(true); });
  range.max = String(list.length);
  range.addEventListener('input', () => { setPlaying(false); userPaused = true; seek(Number(range.value)); btnPlay.textContent = 'Play'; });

  layout();
  setMode('blocked');
  // Start part-way in, so the static (motion-off) state already shows blocks in cache.
  if (!isMotionOn()) seek(40);

  new ResizeObserver(() => { layout(); draw(); }).observe(canvas);
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (!visible && playing) setPlaying(false);
    else if (visible && isMotionOn() && !userPaused && pos < list.length) setPlaying(true);
  }, { threshold: 0.5 }).observe(fig);
  document.addEventListener('visibilitychange', () => { if (document.hidden) setPlaying(false); });
  onMotionChange((on) => { if (!on) { setPlaying(false); } });
}
