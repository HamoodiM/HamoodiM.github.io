// Site-wide motion preference. Default comes from prefers-reduced-motion (set before first paint by
// the inline script in Base.astro); the bar toggle overrides it and is stored in localStorage.
type Listener = (on: boolean) => void;
const listeners = new Set<Listener>();
const root = document.documentElement;

export const isMotionOn = (): boolean => root.dataset.motion === 'on';

export function onMotionChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function apply(on: boolean, persist: boolean) {
  if (isMotionOn() === on) return;
  root.dataset.motion = on ? 'on' : 'off';
  if (persist) {
    try { localStorage.setItem('motion', on ? 'on' : 'off'); } catch { /* private mode */ }
  }
  syncButtons();
  listeners.forEach((fn) => fn(on));
}

function syncButtons() {
  document.querySelectorAll<HTMLButtonElement>('[data-motion-toggle]').forEach((b) => {
    b.setAttribute('aria-pressed', String(isMotionOn()));
    const label = b.querySelector('.motion__label');
    if (label) label.textContent = isMotionOn() ? 'Motion on' : 'Motion off';
  });
}

export function initMotionToggle() {
  syncButtons();
  document.querySelectorAll<HTMLButtonElement>('[data-motion-toggle]').forEach((b) =>
    b.addEventListener('click', () => apply(!isMotionOn(), true)),
  );
  // Follow the OS setting live unless the visitor has chosen explicitly.
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
    let stored: string | null = null;
    try { stored = localStorage.getItem('motion'); } catch { /* ignore */ }
    if (stored !== 'on' && stored !== 'off') apply(!e.matches, false);
  });
}

export function idle(fn: () => void, timeout = 1500) {
  if ('requestIdleCallback' in window) (window as any).requestIdleCallback(fn, { timeout });
  else setTimeout(fn, 200);
}
