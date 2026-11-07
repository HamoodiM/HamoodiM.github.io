// Live, progressive path tracing in the browser with the C++ tracer from
// projects/Raytracer compiled to WebAssembly (tracer.wasm), one single-threaded
// instance per Web Worker. Plain ESM + TypeScript, no framework, no deps.
//
//   import { createTracer, attachOrbit } from "./tracer.js";
//   const tracer = createTracer(canvas, { scene: "materials", width: 960, height: 540 });
//   tracer.onProgress(p => hud.textContent = `${p.spp} spp`);
//   attachOrbit(canvas, tracer);
//   tracer.start();
//
// Each worker owns interleaved 2-row blocks and accumulates them in wasm
// memory; after every pass it posts its accumulated Float32 rows here. This
// thread keeps the full accumulation buffer, tone maps exactly like the CLI
// (average, clamp negatives/NaN to 0, gamma 2.2, 255.999 * clamp, truncate),
// and draws with putImageData. Pixels are seeded per (x, y, pass), so the
// image does not depend on the number of workers.

export interface TracerOptions {
  /** "materials" (default, hero_materials.json) or "cornell" (hero_cornell.json) */
  scene?: string;
  /** Render size in pixels (defaults: the canvas's width/height attributes) */
  width?: number;
  height?: number;
  /** Worker count (default min(hardwareConcurrency - 1, 6), at least 1) */
  workers?: number;
  /** Stop after this many samples per pixel (default 512) */
  maxSpp?: number;
}

export interface TracerProgress {
  /** Samples per pixel completed over the whole image */
  spp: number;
  /** Rays per second (camera + bounce + shadow rays), averaged since the last reset */
  raysPerSec: number;
  /** Render time since the last reset, excluding paused/stopped time */
  ms: number;
}

/** Orbit around the scene's look-at point. Degrees; fov is the vertical field of view. */
export interface TracerCamera {
  yaw: number;
  pitch: number;
  distance: number;
  fov?: number;
}

export interface Tracer {
  start(): void;
  stop(): void;
  reset(): void;
  setBVH(on: boolean): void;
  setCamera(c: TracerCamera): void;
  onProgress(cb: (p: TracerProgress) => void): void;
  destroy(): void;
}

interface SceneInfo {
  id: number;
  /** Paths the scene JSON uses -> URL served next to this module */
  files: Record<string, URL>;
  /** Orbit limits relative to the scene file's camera (degrees) */
  yawRange: [number, number];
  pitchRange: [number, number];
}

// The hero_materials bricks are high-quality JPEG copies (305 KB) of the
// tracer's 1.17 MB PNGs; stb_image decodes either. Use the PNGs for an image
// that is bit-identical to raytracer_cli (see test/compare.mjs).
const SCENES: Record<string, SceneInfo> = {
  materials: {
    id: 0,
    files: {
      "assets/textures/bricks_albedo.png": new URL("./textures/bricks_albedo.jpg", import.meta.url),
      "assets/textures/bricks_normal.png": new URL("./textures/bricks_normal.jpg", import.meta.url),
    },
    yawRange: [-360, 360],
    pitchRange: [-6, 40],
  },
  cornell: { id: 1, files: {}, yawRange: [-14, 14], pitchRange: [-10, 10] },
};
SCENES.hero_materials = SCENES.materials;
SCENES.hero_cornell = SCENES.cornell;

const WASM_URL = new URL("./tracer.wasm", import.meta.url);

let modulePromise: Promise<WebAssembly.Module> | null = null;
const fileCache = new Map<string, Promise<Uint8Array>>();

function loadModule(): Promise<WebAssembly.Module> {
  if (!modulePromise) {
    modulePromise = (async () => {
      if (typeof WebAssembly.compileStreaming === "function") {
        try {
          return await WebAssembly.compileStreaming(fetch(WASM_URL));
        } catch {
          // wrong MIME type on some static servers: fall back to a buffer
        }
      }
      const res = await fetch(WASM_URL);
      if (!res.ok) throw new Error(`tracer.wasm: HTTP ${res.status}`);
      return WebAssembly.compile(await res.arrayBuffer());
    })();
    modulePromise.catch(() => { modulePromise = null; });
  }
  return modulePromise;
}

function loadFile(url: URL): Promise<Uint8Array> {
  const key = url.href;
  let p = fileCache.get(key);
  if (!p) {
    p = fetch(url).then(async (r) => {
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    });
    p.catch(() => fileCache.delete(key));
    fileCache.set(key, p);
  }
  return p;
}

// ---- Tone mapping ---------------------------------------------------------
// The CLI writes, per channel (Framebuffer::update_display + to_rgb8):
//   c = accum * (1.0f / spp); if !(c >= 0) c = 0;
//   byte = (uint8_t)(255.999f * clamp(powf(c, 1.0f / 2.2f), 0, 1))
// That is monotonic in c, so it is precomputed once as 255 float32 thresholds
// (THRESH[k - 1] = smallest c giving byte >= k) and applied with a binary
// search: no pow() per pixel on the main thread.
const F255 = Math.fround(255.999);
const INV_GAMMA = Math.fround(1 / Math.fround(2.2));
function byteOf(c: number): number {
  if (!(c >= 0)) c = 0;
  let g = Math.fround(Math.pow(c, INV_GAMMA));
  if (g > 1) g = 1;
  return Math.floor(Math.fround(F255 * g));
}
const THRESH = new Float32Array(255);
{
  const f = new Float32Array(1);
  const u = new Uint32Array(f.buffer);
  for (let k = 1; k <= 255; k++) {
    // smallest non-negative float32 bit pattern with byteOf >= k (bits are monotonic for c >= 0)
    let lo = 0, hi = 0x7f800000;  // +inf
    while (lo < hi) {
      const mid = lo + Math.floor((hi - lo) / 2);
      u[0] = mid;
      if (byteOf(f[0]) >= k) hi = mid; else lo = mid + 1;
    }
    u[0] = lo;
    THRESH[k - 1] = f[0];
  }
}
function toByte(c: number): number {
  if (!(c >= THRESH[0])) return 0;  // also NaN and negatives
  let lo = 0, hi = 255;  // answer: number of thresholds <= c
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (THRESH[mid - 1] <= c) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/**
 * Tone maps accumulated rows into RGBA bytes like raytracer_cli. `accum` rows
 * are bottom-up (tracer convention); `rgba` rows are top-down. Exported for tests.
 */
export function tonemapRows(
  accum: Float32Array, rowSpp: ArrayLike<number>, width: number, height: number,
  rgba: Uint8ClampedArray | Uint8Array, y0 = 0, y1 = height,
): void {
  for (let y = y0; y < y1; y++) {
    const spp = rowSpp[y];
    const inv = spp > 0 ? Math.fround(1 / spp) : 0;
    let s = y * width * 3;
    let d = (height - 1 - y) * width * 4;
    for (let x = 0; x < width; x++, s += 3, d += 4) {
      rgba[d] = toByte(Math.fround(accum[s] * inv));
      rgba[d + 1] = toByte(Math.fround(accum[s + 1] * inv));
      rgba[d + 2] = toByte(Math.fround(accum[s + 2] * inv));
      rgba[d + 3] = 255;
    }
  }
}

// ---- Tracer ---------------------------------------------------------------

interface WorkerSlot {
  worker: Worker;
  ready: boolean;
  busy: boolean;      // a "pass" message is in flight (any epoch)
  nextPass: number;   // next pass to render in the current epoch
}

interface Internals {
  defaults: TracerCamera | null;
  camera: TracerCamera | null;
  scene: SceneInfo;
  setInteractive(on: boolean): void;
  whenReady(cb: () => void): void;
}
const internals = new WeakMap<Tracer, Internals>();

export function createTracer(canvas: HTMLCanvasElement, opts: TracerOptions = {}): Tracer {
  const scene = SCENES[opts.scene ?? "materials"];
  if (!scene) throw new Error(`unknown scene "${opts.scene}" (use "materials" or "cornell")`);
  const fullW = Math.max(2, Math.round(opts.width ?? canvas.width));
  const fullH = Math.max(2, Math.round(opts.height ?? canvas.height));
  const maxSpp = Math.max(1, Math.round(opts.maxSpp ?? 512));
  const cores = typeof navigator !== "undefined" && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
  const workerCount = Math.max(1, Math.round(opts.workers ?? Math.min(cores - 1, 6)));

  canvas.width = fullW;
  canvas.height = fullH;
  const ctx = canvas.getContext("2d")!;
  const small = document.createElement("canvas");
  const smallCtx = small.getContext("2d")!;

  let w = fullW, h = fullH;
  let accum = new Float32Array(w * h * 3);
  let rowSpp = new Int32Array(h);
  let image = new ImageData(w, h);
  let epoch = 0;
  let bvh = true;
  let camera: TracerCamera | null = null;  // null = the scene file's camera
  let defaults: TracerCamera | null = null;
  let running = false;
  let destroyed = false;
  let hidden = typeof document !== "undefined" && document.hidden;
  let ready = false;
  const readyCallbacks: Array<() => void> = [];
  let progressCb: ((p: TracerProgress) => void) | null = null;

  // stats since the last reset
  let rays = 0;
  let activeMs = 0;
  let activeSince = -1;  // performance.now() while rendering, else -1
  let lastSpp = -1;
  let drawQueued = false;
  let rafId = 0;
  let timerId: ReturnType<typeof setTimeout> | undefined;

  const slots: WorkerSlot[] = [];

  const active = () => running && !hidden && ready && !destroyed;
  const minSpp = () => {
    let m = Infinity;
    for (let y = 0; y < h; y++) if (rowSpp[y] < m) m = rowSpp[y];
    return m === Infinity ? 0 : m;
  };

  function clock() {
    const now = performance.now();
    const want = active() && minSpp() < maxSpp;
    if (want && activeSince < 0) activeSince = now;
    if (!want && activeSince >= 0) {
      activeMs += now - activeSince;
      activeSince = -1;
    }
  }
  const elapsed = () => activeMs + (activeSince >= 0 ? performance.now() - activeSince : 0);

  function config() {
    return { type: "config", width: w, height: h, bvh, camera };
  }

  function dispatch(slot: WorkerSlot) {
    if (!active() || !slot.ready || slot.busy || slot.nextPass >= maxSpp) return;
    slot.busy = true;
    slot.worker.postMessage({ type: "pass", epoch, pass: slot.nextPass });
    slot.nextPass++;
  }
  const dispatchAll = () => { clock(); slots.forEach(dispatch); };

  function resetAccumulation() {
    epoch++;
    if (image.width !== w || image.height !== h) {
      accum = new Float32Array(w * h * 3);
      rowSpp = new Int32Array(h);
      image = new ImageData(w, h);
    } else {
      accum.fill(0);
      rowSpp.fill(0);
    }
    rays = 0;
    activeMs = 0;
    activeSince = -1;
    lastSpp = -1;
    const msg = config();
    for (const s of slots) {
      s.nextPass = 0;
      s.worker.postMessage(msg);  // handled after init / any in-flight pass
    }
    dispatchAll();
  }

  function draw() {
    drawQueued = false;
    if (destroyed) return;
    const spp = minSpp();
    // Keep the previous frame until the new accumulation covers the whole
    // image (no black rows while orbiting or after a resize).
    if (spp === 0) return;
    if (w === fullW && h === fullH) {
      ctx.putImageData(image, 0, 0);
    } else {
      if (small.width !== w || small.height !== h) {
        small.width = w;
        small.height = h;
      }
      smallCtx.putImageData(image, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(small, 0, 0, fullW, fullH);
    }
    clock();
    if (progressCb && spp !== lastSpp) {
      lastSpp = spp;
      const ms = elapsed();
      progressCb({ spp, raysPerSec: ms > 0 ? (rays * 1000) / ms : 0, ms });
    }
  }
  function queueDraw() {
    if (drawQueued || destroyed) return;
    drawQueued = true;
    // rAF normally; the timer covers pages whose rAF is throttled (background
    // panes, hidden iframes) so progress and the final frame still arrive.
    const run = () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timerId);
      if (drawQueued) draw();
    };
    rafId = requestAnimationFrame(run);
    timerId = setTimeout(run, 250);
  }

  function onMessage(slot: WorkerSlot, m: any) {
    if (destroyed) return;
    if (m.type === "ready") {
      slot.ready = true;
      if (!defaults) defaults = m.camera;
      if (!ready && slots.every((s) => s.ready)) {
        ready = true;
        readyCallbacks.splice(0).forEach((cb) => cb());
      }
      dispatchAll();
      return;
    }
    if (m.type === "error") {
      console.error("[tracer]", m.message);
      slot.busy = false;
      running = false;
      clock();
      return;
    }
    if (m.type !== "rows") return;
    slot.busy = false;
    if (m.epoch === epoch && m.width === w && m.height === h) {
      const rowFloats = w * 3;
      let o = 0;
      for (const [y0, y1] of m.ranges as Array<[number, number]>) {
        accum.set((m.data as Float32Array).subarray(o, o + (y1 - y0) * rowFloats), y0 * rowFloats);
        o += (y1 - y0) * rowFloats;
        for (let y = y0; y < y1; y++) rowSpp[y] = m.pass + 1;
        tonemapRows(accum, rowSpp, w, h, image.data, y0, y1);
      }
      rays += m.rays;
      queueDraw();
    }
    dispatch(slot);
    if (minSpp() >= maxSpp) clock();
  }

  const onVisibility = () => {
    hidden = document.hidden;
    if (hidden) clock();
    else dispatchAll();
  };
  document.addEventListener("visibilitychange", onVisibility);

  // Spin up workers: compile the module once, share it with every worker.
  (async () => {
    const entries = Object.entries(scene.files);
    const [module, ...datas] = await Promise.all([loadModule(), ...entries.map(([, url]) => loadFile(url))]);
    if (destroyed) return;
    const files: Record<string, Uint8Array> = {};
    entries.forEach(([path], i) => { files[path] = datas[i]; });
    for (let i = 0; i < workerCount; i++) {
      // Literal new Worker(new URL(..., import.meta.url)) so Vite/Astro bundle the worker.
      const worker = new Worker(new URL("./tracer-worker.js", import.meta.url), { type: "module" });
      const slot: WorkerSlot = { worker, ready: false, busy: false, nextPass: 0 };
      worker.onmessage = (e) => onMessage(slot, e.data);
      worker.onerror = (e) => console.error("[tracer] worker error", e.message);
      slots.push(slot);
      worker.postMessage({
        type: "init", module, files, scene: scene.id, width: w, height: h,
        index: i, count: workerCount, bvh, camera,
      });
    }
  })().catch((err) => console.error("[tracer] failed to start:", err));

  const tracer: Tracer = {
    start() {
      running = true;
      dispatchAll();
    },
    stop() {
      running = false;
      clock();
    },
    reset() {
      resetAccumulation();
    },
    setBVH(on: boolean) {
      if (bvh === on) return;
      bvh = on;
      resetAccumulation();
    },
    setCamera(c: TracerCamera) {
      const fov = c.fov ?? camera?.fov ?? defaults?.fov;
      camera = { yaw: c.yaw, pitch: c.pitch, distance: c.distance, fov };
      resetAccumulation();
    },
    onProgress(cb) {
      progressCb = cb;
    },
    destroy() {
      if (destroyed) return;
      running = false;
      clock();
      destroyed = true;
      cancelAnimationFrame(rafId);
      clearTimeout(timerId);
      document.removeEventListener("visibilitychange", onVisibility);
      for (const s of slots) s.worker.terminate();
      slots.length = 0;
    },
  };

  internals.set(tracer, {
    get defaults() { return defaults; },
    get camera() { return camera; },
    scene,
    setInteractive(on: boolean) {
      // While dragging: about 320 px wide (at most full size), full size on release.
      const scale = on ? Math.min(1, 320 / fullW) : 1;
      const nw = Math.max(2, Math.round(fullW * scale));
      const nh = Math.max(2, Math.round(fullH * scale));
      if (nw === w && nh === h) return;
      w = nw;
      h = nh;
      resetAccumulation();
    },
    whenReady(cb: () => void) {
      if (ready) cb(); else readyCallbacks.push(cb);
    },
  });
  return tracer;
}

/**
 * Drag-to-orbit on `canvas` (pointer events). Renders at low resolution while
 * dragging and goes back to full resolution on release. Horizontal touch drags
 * orbit; vertical touch drags still scroll the page (touch-action: pan-y).
 * Returns a function that removes the listeners.
 */
export function attachOrbit(canvas: HTMLCanvasElement, tracer: Tracer): () => void {
  const inner = internals.get(tracer);
  if (!inner) throw new Error("attachOrbit: not a tracer from createTracer()");
  const DEG_PER_PX = 0.3;
  let dragging = false;
  let lowRes = false;
  let pointerId = -1;
  let startX = 0, startY = 0;
  let start: TracerCamera | null = null;
  let pending: TracerCamera | null = null;
  let raf = 0;

  canvas.style.touchAction = "pan-y";
  canvas.style.cursor = "grab";

  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const current = (): TracerCamera | null => inner.camera ?? inner.defaults;

  const flush = () => {
    raf = 0;
    if (pending) tracer.setCamera(pending);
    pending = null;
  };

  const down = (e: PointerEvent) => {
    if (dragging || (e.pointerType === "mouse" && e.button !== 0)) return;
    const cam = current();
    if (!cam) return;  // workers not ready yet
    dragging = true;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    start = { ...cam };
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
    canvas.style.cursor = "grabbing";
  };
  const move = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== pointerId || !start) return;
    if (!lowRes) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < 3) return;  // a click, not a drag
      lowRes = true;
      inner.setInteractive(true);
    }
    const d = inner.defaults!;
    const { yawRange, pitchRange } = inner.scene;
    pending = {
      yaw: clamp(start.yaw - (e.clientX - startX) * DEG_PER_PX, d.yaw + yawRange[0], d.yaw + yawRange[1]),
      pitch: clamp(start.pitch + (e.clientY - startY) * DEG_PER_PX, d.pitch + pitchRange[0], d.pitch + pitchRange[1]),
      distance: start.distance,
      fov: start.fov,
    };
    if (!raf) raf = requestAnimationFrame(flush);
  };
  const up = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    canvas.style.cursor = "grab";
    if (raf) { cancelAnimationFrame(raf); flush(); }
    if (lowRes) inner.setInteractive(false);
    lowRes = false;
  };

  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  return () => {
    canvas.removeEventListener("pointerdown", down);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", up);
    canvas.removeEventListener("pointercancel", up);
    if (raf) cancelAnimationFrame(raf);
  };
}
