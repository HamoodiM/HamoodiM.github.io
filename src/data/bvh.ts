// Measured values copied from renders/bvh_timing.txt in the Raytracer repo (portfolio-fixes branch).
// bvh_bench 512, Intel Core i5-14400F, Windows 11, single thread, wasm32-wasi (zig 0.16 / clang 21, -O2)
// under Node 24.20.0, 2026-11-07. Raw file: src/data/bvh_timing.txt.

export interface BvhRow {
  tris: number;
  buildMs: number;
  nodes: number;
  sah: number; // Mrays/s
  mid: number; // Mrays/s
  brute: number; // Mrays/s
  bruteRays: number;
  speedup: number;
}

export const bvhRows: BvhRow[] = [
  { tris: 128, buildMs: 0.7, nodes: 123, sah: 8.015, mid: 8.422, brute: 0.97074, bruteRays: 16384, speedup: 8 },
  { tris: 1058, buildMs: 1.4, nodes: 1125, sah: 5.34, mid: 3.953, brute: 0.08136, bruteRays: 16384, speedup: 66 },
  { tris: 8192, buildMs: 14.7, nodes: 8805, sah: 3.055, mid: 2.833, brute: 0.00982, bruteRays: 16384, speedup: 311 },
  { tris: 32768, buildMs: 48.5, nodes: 35681, sah: 2.86, mid: 2.238, brute: 0.00238, bruteRays: 12207, speedup: 1202 },
  { tris: 131072, buildMs: 244.2, nodes: 142811, sah: 1.703, mid: 1.546, brute: 0.00048, bruteRays: 3051, speedup: 3513 },
  { tris: 524288, buildMs: 1070.7, nodes: 570307, sah: 1.543, mid: 1.393, brute: 0.00013, bruteRays: 762, speedup: 11585 },
];

export const bvhMachine =
  'Intel Core i5-14400F, Windows 11, one thread, WebAssembly build (wasm32-wasi, clang -O2) running in Node 24.20';

export const e2e = { scene: 'hero_knot.json', objects: 17285, res: '320×180', spp: 4, bvhS: 0.48, bruteS: 158.73 };
