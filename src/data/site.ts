const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + '/';

/** Prefix a site-relative path with the configured base (GitHub Pages project sites need this). */
export const url = (path = ''): string => base + path.replace(/^\//, '');

export const NAME = 'Mohammad Mohammad';
export const EMAIL = 'mohpresentations@gmail.com';
export const GITHUB = 'https://github.com/HamoodiM';
export const LINKEDIN = 'https://www.linkedin.com/in/mohammadm152';
export const RESUME = url('resume/Mohammad%20Mohammad%20-%20Gameplay%20Programmer.pdf');

/** The live tracer (src/vendor/tracer) and the grader demo (src/vendor/linguaspy-demo) are installed. Set either to false to fall back to the static render or hide the demo. */
export const TRACER_INSTALLED = true;
export const LINGUASPY_DEMO_INSTALLED = true;

export interface Project {
  slug: 'hitreglab' | 'linguaspy' | 'raytracer' | 'titaninfer';
  name: string;
  pitch: string;
  /** Shorter pitch shown at phone width, so all three projects fit in the first two screens. */
  short: string;
  meta: string;
  source?: string;
  sourceNote?: string;
}

export const projects: Project[] = [
  {
    slug: 'hitreglab',
    name: 'Hitreg Lab',
    pitch:
      "A UE5 C++ first-person test range for how shots feel and register: data-driven weapons, controller aim assist, client prediction with server-side rewind lag compensation, a peeker's-advantage meter and a kill cam, all measured over a dedicated server.",
    short: "A UE5 C++ FPS lab: lag compensation, peeker's advantage, aim assist and a kill cam, all measured.",
    meta: 'Unreal Engine 5.8, C++. Nov 2026.',
    source: 'https://github.com/HamoodiM/HitregLab',
  },
  {
    slug: 'linguaspy',
    name: 'LinguaSpy',
    pitch:
      'A top-down spy game about learning a language. You keep your cover in Paris, Madrid, Tokyo or Rome by answering locals in French, Spanish, Japanese or Italian.',
    short: 'A UE5 C++ spy game: keep your cover by answering locals in French, Spanish, Japanese or Italian.',
    meta: 'Solo. Unreal Engine 5.8, C++. Sept to Nov 2026.',
    source: 'https://github.com/HamoodiM/LinguaSpy',
  },
  {
    slug: 'raytracer',
    name: 'Raytracer',
    pitch:
      'A CPU path tracer in C++17, started from Ray Tracing in One Weekend. I fixed five sampling and shading bugs and added a binned-SAH BVH, OpenMP rendering and Russian roulette.',
    short: 'A C++17 path tracer. I fixed five rendering bugs and added a SAH BVH, OpenMP and Russian roulette.',
    meta: 'Solo. C++17, CMake. Oct 2025, fixes and BVH Nov 2026.',
    source: 'https://github.com/HamoodiM/Raytracer',
  },
];

/** Not on the home page any more; its page stays up and is linked from About. */
export const otherProjects: Project[] = [
  {
    slug: 'titaninfer',
    name: 'TitanInfer',
    pitch:
      'A neural-network inference library in C++20 written without BLAS or Eigen: an aligned tensor, a cache-blocked AVX2/FMA matrix multiply, and a binary model format with a PyTorch exporter. 346 GoogleTest cases.',
    short: 'A C++20 inference library with no BLAS: aligned tensors, a cache-blocked AVX2 matmul, 346 tests.',
    meta: 'Solo. C++20, CMake, GoogleTest. Feb to Mar 2026.',
    source: 'https://github.com/HamoodiM/TitanInfer',
  },
];

export const RT_REPO = 'https://github.com/HamoodiM/Raytracer';
export const rtCommit = (hash: string) => `${RT_REPO}/commit/${hash}`;
export const rtBlob = (path: string, lines?: string) =>
  `${RT_REPO}/blob/main/${path}${lines ? '#' + lines : ''}`;
