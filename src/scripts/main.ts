// Entry: motion toggle, then islands booted lazily (near the viewport, or on idle for the hero).
import { initMotionToggle, idle } from './motion-state';

type Boot = { default: (el: HTMLElement) => void | Promise<void> };
const islands: Record<string, () => Promise<Boot>> = {
  hero: () => import('./islands/hero'),
  converge: () => import('./islands/converge'),
  beforeafter: () => import('./islands/beforeafter'),
  bvh: () => import('./islands/bvh'),
  matmul: () => import('./islands/matmul'),
  dossier: () => import('./islands/dossier'),
  leitner: () => import('./islands/leitner'),
  video: () => import('./islands/video'),
  lsdemo: () => import('./islands/lsdemo'),
};

initMotionToggle();

function boot(el: HTMLElement) {
  const name = el.dataset.island ?? '';
  const load = islands[name];
  if (!load) return;
  load()
    .then((m) => m.default(el))
    .catch((err) => console.error(`[island:${name}]`, err));
}

const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      boot(e.target as HTMLElement);
    }
  },
  { rootMargin: '800px 0px' },
);

document.querySelectorAll<HTMLElement>('[data-island]').forEach((el) => {
  if (el.dataset.islandWhen === 'idle') idle(() => boot(el));
  else io.observe(el);
});

// Heading reveals, redaction bars and stamps (GSAP), after first paint.
idle(() => {
  import('./reveal').then((m) => m.default()).catch((err) => console.error('[reveal]', err));
});
