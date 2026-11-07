# tracer: the C++ path tracer, live in the browser

A standalone web module that runs the path tracer from `projects/Raytracer` (branch
`portfolio-fixes`) in the browser, with progressive refinement. It needs no framework and has
no npm dependencies. The C++ is compiled to wasm32-wasi with zig's clang. Each Web Worker runs
one single-threaded instance; the workers render interleaved rows, and the page accumulates
their results, tone maps them the same way as `raytracer_cli`, and draws with `putImageData`.

The rendered image is **bit-identical to `raytracer_cli`** for any number of workers (see
"Correctness" below).

## Files

| File | What it is |
|---|---|
| `web_entry.cpp` | Thin C++ entry point exporting the `rt_*` functions; compiled with the tracer's own sources, which are referenced by path and not modified |
| `build.sh` | Builds `tracer.wasm` (zig clang, `-O3 -msimd128`, stripped) and `tracer.js` |
| `tracer.wasm` | Build output: 488 KB raw, 148 KB gzip, 122 KB brotli |
| `wasi-shim.js` | Hand-written WASI imports (fd_write to the console, proc_exit, clock, random, args/environ stubs, read-only in-memory file system) |
| `tracer-core.js` | Logic for one wasm instance (init, camera, render pass, row ownership). Shared by the worker and the Node test |
| `tracer-worker.js` | Module worker: renders its rows pass by pass and posts back Float32 rows |
| `tracer.ts` | Public API (`createTracer`, `attachOrbit`) |
| `tracer.js` | `tracer.ts` with types stripped by `tools/strip-ts.mjs` (generated; don't edit) |
| `textures/bricks_*.jpg` | JPEG (q88) copies of the tracer's brick textures for `hero_materials` |
| `demo.html` | Test page |
| `test/compare.mjs` | Correctness check against `raytracer_cli` |

## Build

Requirements: Bash (Git Bash is fine), zig 0.16 through `python -m ziglang`, and Node ≥ 22.13
(for the built-in TypeScript type stripping).

```bash
cd web-modules/tracer
./build.sh                       # tracer.wasm + tracer.js
# options: RT=<Raytracer checkout>  ZIG_CXX="zig c++"  SIMD=-mno-simd128
node test/compare.mjs            # correctness vs raytracer_cli (needs Raytracer/build-wasm/raytracer_cli.wasm)
python -m http.server 8000       # then open http://localhost:8000/demo.html
```

What the build links: `src/core/{ray,camera,scene,utils,light,scene_loader}.cpp`,
`src/geometry`, `src/materials`, `src/textures`, `src/acceleration`,
`src/rendering/integrator.cpp`, `tools/wasi/exception_stubs.cpp` (so a C++ `throw` prints its
message and aborts), and `web_entry.cpp`. Left out: the CLI, the framebuffer and PNG writer, the
renderer classes, the viewer and the scene gallery. Flags: `-O3 -msimd128 -mexec-model=reactor
-ffunction-sections -fdata-sections -Wl,--gc-sections -Wl,--strip-all`, with a 1 MB stack.

**No source shims were needed.** The tracer's files compile unchanged. Two things are handled
from outside:

- **Ray counting.** `web_entry.cpp` adds an invisible unbounded `Primitive` to the scene. Every
  `Scene::hit()` call tests unbounded primitives (outside the BVH, or in the brute-force loop),
  so this primitive counts every camera, bounce and shadow ray. It never reports a hit, so the
  image does not change.
- **Textures.** `stb_image` loads textures with `fopen`. `wasi-shim.js` provides a read-only
  in-memory file system with one preopened directory `.`. Texture bytes are fetched once on the
  main thread and handed to each worker under the scene's own relative paths
  (`assets/textures/bricks_albedo.png`).

The scenes are embedded at compile time from `Raytracer/scenes/` using `#embed`:
`hero_materials.json` (scene id 0) and `hero_cornell.json` (id 1). The torus knot scene is left
out because its OBJ is 525 KB.

### Size

| | raw | gzip -9 | brotli -q 11 |
|---|---:|---:|---:|
| `tracer.wasm` | 499,674 | 151,556 | 124,535 |
| `tracer.js` + `tracer-worker.js` + `tracer-core.js` + `wasi-shim.js` | 31,175 | ≈ 10,650 | ≈ 9,350 |
| brick textures (materials scene only) | 304,184 | (JPEG) | |

The wasm is well under the 400 KB target, so iostream and nlohmann::json stayed in. The real
`SceneLoader` parses the embedded JSON.

`-msimd128` adds about 12 KB raw and runs 10-15% faster in V8: materials 7.05 vs 6.1 Mrays/s,
Cornell 4.6 vs 4.3. LTO added nothing measurable and was dropped.

Texture note: the original PNGs are 1.17 MB, so the web build ships JPEG copies at 304 KB.
stb_image decodes either format. As a result, the brick sphere in the browser differs from the
CLI by JPEG compression error only. To get a bit-identical materials scene on the web, serve the
PNGs instead (the `SCENES.materials.files` URLs in `tracer.ts`). The Cornell scene has no
textures and is always identical.

## API

```ts
import { createTracer, attachOrbit } from "./tracer.js";

const tracer = createTracer(canvas, { scene: "materials", width: 960, height: 540 });
tracer.onProgress(({ spp, raysPerSec, ms }) => { /* HUD */ });
const detach = attachOrbit(canvas, tracer);
tracer.start();
```

`createTracer(canvas: HTMLCanvasElement, opts: { scene?: string; width?: number; height?: number;
workers?: number; maxSpp?: number }) => { start(): void; stop(): void; reset(): void;
setBVH(on: boolean): void; setCamera(c: { yaw: number; pitch: number; distance: number; fov?:
number }): void; onProgress(cb: (p: { spp: number; raysPerSec: number; ms: number }) => void):
void; destroy(): void }`

- `scene`: `"materials"` (default; `hero_materials.json`) or `"cornell"` (`hero_cornell.json`).
  The aliases `hero_materials` and `hero_cornell` also work.
- `width`/`height`: render size. They default to the canvas's `width`/`height` attributes. The
  canvas backing store is set to this size; scale it with CSS.
- `workers`: defaults to `min(navigator.hardwareConcurrency - 1, 6)`, and at least 1.
- `maxSpp`: defaults to 512. Rendering stops once every pixel has this many samples.
- Loading is lazy. Creating the tracer fetches and compiles `tracer.wasm` once per page (the
  compiled `WebAssembly.Module` is posted to every worker), plus the textures for the materials
  scene. `start()` can be called immediately; rendering begins when all workers are ready.
- `start()`/`stop()` resume and pause without losing the accumulation. `reset()` restarts
  accumulation from 0 spp.
- `setCamera`: orbits around the scene's `look_at` point. **All angles are in degrees.**
  `yaw` 0 / `pitch` 0 means looking along -z from +z, and `pitch` > 0 is above the target.
  `distance` is in scene units. `fov` is the vertical field of view and keeps its current value
  when omitted. Thin-lens depth of field is kept, with the focus distance scaled by
  `distance / sceneDistance`. Each call resets accumulation. Until the first `setCamera`, the
  scene file's camera is used exactly, so the image is identical to the CLI. The scene cameras
  in orbit terms:
  - materials: yaw 0, pitch 7.765, distance 6.661, fov 30
  - cornell: yaw 0, pitch 0, distance 3.3, fov 37
- `setBVH(false)` switches to brute-force intersection. The image is identical; only the speed
  changes. It resets accumulation so that rays/s compares fairly.
- `onProgress` fires on each drawn frame whose spp changed:
  - `spp`: samples per pixel completed over the whole image.
  - `raysPerSec`: all rays (camera, bounce and shadow), averaged since the last reset.
  - `ms`: render time since the last reset, excluding stopped or hidden time. It freezes when
    `maxSpp` is reached.
- The tracer pauses while `document.hidden` and resumes when the tab becomes visible.
  Off-screen pausing (IntersectionObserver) is left to the host page: call `stop()`/`start()`.
- `destroy()` terminates the workers and removes listeners.
- `attachOrbit(canvas, tracer)` sets up drag-to-orbit with pointer events at 0.3°/px, with
  per-scene limits:
  - materials: full yaw, pitch from -6° to +40° around the default.
  - cornell: ±14° yaw and ±10° pitch, so the camera stays inside the box's infinite wall planes.

  While dragging, it renders at about 320 px wide and upscales with smoothing; on release it
  returns to full resolution. A click without movement does not reset anything. Touch uses
  `touch-action: pan-y`: horizontal drags orbit and vertical drags scroll the page. It returns a
  `detach()` function.
- Extra export: `tonemapRows(...)`, the CLI-exact tone mapper, used by the tests.

Tone mapping matches `Framebuffer::update_display` + `to_rgb8` in float32: average, NaN or
negative → 0, `powf(c, 1/2.2)`, `255.999f * clamp`, then truncation. It is applied through 255
precomputed linear thresholds and a binary search, so the main thread does no `pow()` per pixel.
Rows are flipped, because the tracer's row 0 is the bottom of the image.

### WASM exports (`web_entry.cpp`)

`rt_init(scene_id, width, height) -> int` (0 = ok; reloading the same scene only resizes),
`rt_set_camera(yaw, pitch, distance, fov)` (degrees; clears accumulation), `rt_reset_camera()`,
`rt_get_default_camera(i)` (0 yaw, 1 pitch, 2 distance, 3 fov), `rt_set_bvh(int)`,
`rt_render_rows(y0, y1, pass)` (adds one sample per pixel for rows `[y0, y1)` into the float RGB
buffer), `rt_clear()`, `rt_get_buffer() -> float*` (w·h·3, row 0 = bottom),
`rt_get_rays() -> double` (cumulative), `rt_object_count()`.

The per-pixel code mirrors `render_progressive` in `src/cli/headless_main.cpp`:
`seed_rng_for_pixel(x, y, pass, 0)`, a jittered `(u, v)`, `Integrator::trace(camera.get_ray(u,
v), scene, 50)` with Russian roulette after 3 bounces, and a SAH BVH.

### Worker protocol (internal)

Each worker owns interleaved 2-row blocks (`ownedRanges(index, count, height)`) and accumulates
them in wasm memory. The main thread asks it for one pass at a time (`{type:"pass", epoch,
pass}`), and the worker answers with its accumulated rows as a transferred `Float32Array`. A
camera, size or BVH change bumps the epoch and queues a `config` message. Replies from the old
epoch are dropped, and a worker never has more than one pass in flight, so resets take effect
after at most one pass.

## Correctness

`node test/compare.mjs` runs the tracer's own CLI (`build-wasm/raytracer_cli.wasm`, built by
`tools/wasi/build.sh` from the same checkout) under Node's WASI. It uses progressive mode
(`--snapshots`), which is the code path that seeds every pass. It then renders the same scene
with `tracer.wasm` through the worker logic, split over 1, 3 and 5 simulated workers, using the
original PNG textures.

```
cornell 160x160 16 spp: worker splits 1/3/5 bit-identical: true; vs raytracer_cli: 0 of 76800 channel values differ (max 0) -> MATCH
materials 192x108 16 spp: worker splits 1/3/5 bit-identical: true; vs raytracer_cli: 0 of 62208 channel values differ (max 0) -> MATCH
```

Float accumulations are bitwise equal across worker splits, and the 8-bit output equals the
CLI's PPM exactly.

End to end in the browser, I rendered Cornell at 160×160 and 16 spp with 4 real workers and
read it back with `getImageData`. Its SHA-256 equals that of the CLI's PPM pixels
(`945cc91e…c525da`).

The CLI's non-progressive mode (`Renderer::render`, used when `--snapshots` is not given) draws
all samples of a pixel from one RNG stream. It therefore converges to the same image but with
different noise; it is not expected to match bit for bit.

Tested against Raytracer commit `a026a30` (portfolio-fixes, including the smooth-shading
changes).

## Performance

Measured in the Claude desktop app's built-in browser (Chromium) on an Intel Core i5-14400F
(16 threads), with 6 workers (the default for 16 threads), `-O3 -msimd128`, and the CPU otherwise
idle. "Render" is the tracer's `ms`, which excludes wasm compile and worker start-up. "Incl.
load" adds those. The browser pane was hidden during the runs, so the first-frame times include
a throttled-rAF fallback of up to 250 ms; render times and rays/s are not affected.

| Scene | Size | Time to 64 spp (render) | Incl. load | First frame | Rays/s (6 workers) |
|---|---|---:|---:|---:|---:|
| materials | 480×270 | 1.04 s | 1.35 s | 0.31 s | 27.0 M |
| materials | 960×540 | 3.91 s | 4.08 s | 0.36 s | 28.9 M |
| cornell | 480×270 | 2.94 s | 3.21 s | 0.31 s | 19.1 M |
| cornell | 960×540 | 11.46 s | 11.49 s | 0.44 s | 19.6 M |

Cornell is slower per sample: it is a closed box, so every path bounces until Russian roulette
ends it, and each diffuse hit casts a shadow ray. On the materials scene many paths escape to
the background. A single thread in Node reaches 6-7 Mrays/s on materials and 4-4.6 on Cornell,
so 6 workers scale to about 4.3×.

Orbit drags render at 320×180 and reach about 50 spp in half a second, so dragging stays
interactive.

## Integration notes for the site

- The worker is created with the literal `new Worker(new URL("./tracer-worker.js",
  import.meta.url), { type: "module" })`, and assets are referenced with `new URL(...,
  import.meta.url)`. Vite/Astro will bundle the worker and emit `tracer.wasm` and the textures
  as assets. Import `tracer.ts` (or `tracer.js`) from a client-side island script.
- No COOP/COEP headers or SharedArrayBuffer are needed, so it works on GitHub Pages.
- Static servers should send `.wasm` as `application/wasm`. Otherwise the loader falls back from
  `compileStreaming` to `compile(arrayBuffer)`.
- `tracer.ts` uses only erasable TypeScript syntax. It was type-stripped with Node, not checked
  with `tsc`, because no TypeScript install was used.
