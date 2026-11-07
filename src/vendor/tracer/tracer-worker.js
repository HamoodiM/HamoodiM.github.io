// Module worker: one single-threaded tracer.wasm instance.
//
// Messages in (handled strictly in order):
//   { type: "init", module: WebAssembly.Module, files, scene, width, height,
//     index, count, bvh, camera }                -> { type: "ready", camera, objects }
//   { type: "config", width, height, bvh, camera } (camera null = scene camera;
//     clears the accumulation)
//   { type: "pass", epoch, pass }                -> { type: "rows", epoch, pass, width,
//     height, ranges, data: Float32Array, rays, ms }
// The worker owns interleaved 2-row blocks (ownedRanges(index, count, height))
// and accumulates them in wasm memory; each "rows" reply carries the
// accumulated sums for its rows after `pass + 1` samples per pixel.
import { createCore, ownedRanges } from "./tracer-core.js";

let core = null;
let index = 0, count = 1, scene = 0, width = 0, height = 0;
let ranges = [];
let queue = Promise.resolve();

function configure(m) {
  if (m.width !== width || m.height !== height) {
    core.init(scene, m.width, m.height);
    width = m.width;
    height = m.height;
    ranges = ownedRanges(index, count, height);
  }
  core.setBVH(m.bvh !== false);
  if (m.camera) core.setCamera(m.camera);
  else core.resetCamera();
  core.clear();
}

async function handle(m) {
  switch (m.type) {
    case "init": {
      index = m.index;
      count = m.count;
      scene = m.scene;
      core = await createCore(m.module, m.files);
      configure(m);
      self.postMessage({ type: "ready", camera: core.defaultCamera(), objects: core.objectCount() });
      break;
    }
    case "config":
      configure(m);
      break;
    case "pass": {
      const r = core.renderPass(ranges, m.pass);
      self.postMessage(
        { type: "rows", epoch: m.epoch, pass: m.pass, width, height, ranges, data: r.data, rays: r.rays, ms: r.ms },
        [r.data.buffer],
      );
      break;
    }
  }
}

self.onmessage = (e) => {
  const m = e.data;
  queue = queue.then(() => handle(m)).catch((err) => {
    self.postMessage({ type: "error", message: String((err && err.message) || err), epoch: m.epoch });
  });
};
