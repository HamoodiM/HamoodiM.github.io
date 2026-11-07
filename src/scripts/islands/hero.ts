import { isMotionOn, onMotionChange, idle } from '../motion-state';
import type { Tracer } from '../../vendor/tracer/tracer';

// Live hero: hands the static LCP image over to the in-browser path tracer (src/vendor/tracer, the
// C++ tracer compiled to wasm32-wasi, one instance per worker). It auto-starts on idle on
// desktop-class devices with motion on; phones, Save-Data and reduced motion get a button instead.
export default function initHero(fig: HTMLElement) {
  const canvas = fig.querySelector<HTMLCanvasElement>('canvas');
  const btnStart = fig.querySelector<HTMLButtonElement>('[data-live-start]');
  const btnPause = fig.querySelector<HTMLButtonElement>('[data-live-pause]');
  const btnBvh = fig.querySelector<HTMLButtonElement>('[data-live-bvh]');
  const btnReset = fig.querySelector<HTMLButtonElement>('[data-live-reset]');
  const readout = fig.querySelector<HTMLElement>('[data-hud-readout]');
  const hint = fig.querySelector<HTMLElement>('[data-hud-hint]');
  const stateK = fig.querySelector<HTMLElement>('[data-hud-state] .hud__k');
  const stateV = fig.querySelector<HTMLElement>('[data-hud-state] .hud__v');
  if (!canvas || !btnStart || !btnPause || !btnBvh || !btnReset || !readout || !hint) return;

  const cores = navigator.hardwareConcurrency || 2;
  const workers = Math.max(1, Math.min(cores - 1, 6));
  const saveData = (navigator as any).connection?.saveData === true;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const canAuto = cores >= 4 && !saveData && !coarse;
  const MAX_SPP = 512;

  let tracer: Tracer | null = null;
  let running = false;
  let visible = true;
  let userPaused = false;
  let bvh = true;
  let done = false;

  async function start() {
    if (tracer) { userPaused = false; resume(); return; }
    btnStart!.disabled = true;
    btnStart!.textContent = 'Loading the renderer';
    try {
      const mod = await import('../../vendor/tracer/tracer');
      tracer = mod.createTracer(canvas!, { scene: 'materials', width: 480, height: 270, workers, maxSpp: MAX_SPP });
      let shown = false;
      tracer.onProgress((p) => {
        if (!shown) { canvas!.hidden = false; shown = true; }
        done = p.spp >= MAX_SPP;
        readout!.textContent =
          `${p.spp} spp, ${(p.raysPerSec / 1e6).toFixed(1)} M rays/s, ` +
          `${workers} worker${workers > 1 ? 's' : ''}, BVH ${bvh ? 'on' : 'off'}, ${(p.ms / 1000).toFixed(1)} s`;
        if (done) btnPause!.textContent = 'Done at 512 spp';
      });
      mod.attachOrbit(canvas!, tracer);
      btnStart!.hidden = true;
      [btnPause, btnBvh, btnReset, readout, hint].forEach((el) => (el!.hidden = false));
      if (stateK) stateK.textContent = 'Live render';
      if (stateV) stateV.textContent = `The same scene, traced on your CPU at 480×270 by ${workers} Web Worker${workers > 1 ? 's' : ''} running my C++ compiled to WebAssembly.`;
      resume();
    } catch (err) {
      console.error('[hero] live tracer failed', err);
      btnStart!.textContent = 'The live render could not start here';
    }
  }
  function resume() {
    if (!tracer || running || !visible || document.hidden || userPaused) return;
    tracer.start();
    running = true;
    if (!done) btnPause!.textContent = 'Pause';
  }
  function pause() {
    if (!tracer || !running) return;
    tracer.stop();
    running = false;
    if (!done) btnPause!.textContent = 'Resume';
  }

  btnStart.addEventListener('click', start);
  btnPause.addEventListener('click', () => {
    if (running) { userPaused = true; pause(); } else { userPaused = false; resume(); }
  });
  btnBvh.addEventListener('click', () => {
    bvh = !bvh;
    done = false;
    tracer?.setBVH(bvh);
    btnBvh!.setAttribute('aria-pressed', String(bvh));
    btnBvh!.textContent = bvh ? 'BVH on' : 'BVH off (brute force)';
  });
  btnReset.addEventListener('click', () => { done = false; tracer?.reset(); });
  canvas.addEventListener('pointerdown', () => { done = false; });

  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) resume(); else pause(); }).observe(fig);
  onMotionChange((on) => { if (!on) { userPaused = true; pause(); } });

  if (canAuto && isMotionOn()) idle(() => { if (isMotionOn() && !tracer) start(); }, 2500);
}
