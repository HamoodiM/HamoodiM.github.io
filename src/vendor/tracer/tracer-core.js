// Worker-side logic, shared by tracer-worker.js and the Node tests: wraps one
// tracer.wasm instance (one single-threaded copy of the C++ tracer).
import { createWasi } from "./wasi-shim.js";

/** Rows a worker owns: blocks of `block` rows, interleaved across workers. */
export function ownedRanges(index, count, height, block = 2) {
  const ranges = [];
  for (let y0 = index * block; y0 < height; y0 += count * block) {
    ranges.push([y0, Math.min(height, y0 + block)]);
  }
  return ranges;
}

export async function createCore(module, files = {}, log) {
  const stderr = [];
  const wasi = createWasi({
    files,
    log: (fd, line) => {
      if (fd === 2) stderr.push(line);
      // Default: stdout ("Loaded texture ..." once per worker) stays quiet; stderr still warns.
      (log || ((fd, l) => { if (fd === 2) console.warn("[tracer]", l); }))(fd, line);
    },
  });
  const instance = await WebAssembly.instantiate(module, wasi.imports);
  const ex = instance.exports;
  wasi.setMemory(ex.memory);
  ex._initialize();

  // A C++ exception or abort() in the tracer traps; report its stderr text.
  const call = (fn) => {
    try {
      return fn();
    } catch (err) {
      wasi.flush();
      const detail = stderr.slice(-3).join(" | ");
      throw new Error(`tracer.wasm: ${err && err.message}${detail ? ` (${detail})` : ""}`);
    }
  };

  let width = 0, height = 0;
  return {
    exports: ex,
    init(sceneId, w, h) {
      const rc = call(() => ex.rt_init(sceneId, w, h));
      if (rc !== 0) throw new Error(`rt_init(${sceneId}, ${w}, ${h}) failed (${rc})`);
      width = w;
      height = h;
    },
    setCamera(c) { call(() => ex.rt_set_camera(c.yaw, c.pitch, c.distance, c.fov ?? 0)); },
    resetCamera() { call(() => ex.rt_reset_camera()); },
    defaultCamera() {
      return {
        yaw: ex.rt_get_default_camera(0),
        pitch: ex.rt_get_default_camera(1),
        distance: ex.rt_get_default_camera(2),
        fov: ex.rt_get_default_camera(3),
      };
    },
    setBVH(on) { ex.rt_set_bvh(on ? 1 : 0); },
    clear() { ex.rt_clear(); },
    objectCount() { return ex.rt_object_count(); },
    /**
     * Renders one pass (one sample per pixel) over `ranges` and returns the
     * accumulated rows, packed in range order (width * 3 floats per row).
     */
    renderPass(ranges, pass) {
      const rays0 = ex.rt_get_rays();
      const t0 = performance.now();
      for (const [y0, y1] of ranges) call(() => ex.rt_render_rows(y0, y1, pass));
      const ms = performance.now() - t0;
      const rays = ex.rt_get_rays() - rays0;

      const rowFloats = width * 3;
      let rows = 0;
      for (const [y0, y1] of ranges) rows += y1 - y0;
      const data = new Float32Array(rows * rowFloats);
      const buf = new Float32Array(ex.memory.buffer, ex.rt_get_buffer(), width * height * 3);
      let o = 0;
      for (const [y0, y1] of ranges) {
        data.set(buf.subarray(y0 * rowFloats, y1 * rowFloats), o);
        o += (y1 - y0) * rowFloats;
      }
      return { data, rays, ms };
    },
  };
}
