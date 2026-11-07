import { isMotionOn } from '../motion-state';
import { loadFlip, loadGsap } from '../gsap-kit';

// City tabs (ARIA tabs pattern). The ink marker behind the selected tab is reparented and moved with
// Flip. Selecting a city also tells the grader demo (if installed) which language to use.
export default function initDossier(root: HTMLElement) {
  const tablist = root.querySelector<HTMLElement>('[data-tablist]');
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const panels = Array.from(root.querySelectorAll<HTMLElement>('[data-panel]'));
  const marker = root.querySelector<HTMLElement>('[data-marker]');
  if (!tablist || !marker) return;
  tablist.hidden = false;
  tabs[0].appendChild(marker);
  let current = 0;

  const select = async (i: number, focus = false) => {
    if (i === current) return;
    tabs.forEach((t, j) => {
      t.setAttribute('aria-selected', String(i === j));
      t.tabIndex = i === j ? 0 : -1;
    });
    if (focus) tabs[i].focus();
    const prev = panels[current];
    const next = panels[i];
    current = i;
    document.dispatchEvent(new CustomEvent('ls:city', { detail: tabs[i].dataset.city }));

    if (!isMotionOn()) {
      tabs[i].appendChild(marker);
      prev.removeAttribute('data-active');
      next.setAttribute('data-active', '');
      return;
    }
    const [Flip, { gsap }] = await Promise.all([loadFlip(), loadGsap()]);
    const state = Flip.getState(marker);
    tabs[i].appendChild(marker);
    Flip.from(state, { duration: 0.45 });
    prev.removeAttribute('data-active');
    next.setAttribute('data-active', '');
    const media = next.querySelector('.city__grid > *:first-child');
    const facts = next.querySelectorAll('.city__facts li');
    gsap.fromTo(media, { opacity: 0, y: 12, rotation: -1.5 }, { opacity: 1, y: 0, rotation: -0.4, duration: 0.5, clearProps: 'opacity,transform' });
    gsap.fromTo(facts, { opacity: 0, x: -8 }, { opacity: 1, x: 0, stagger: 0.06, duration: 0.4, delay: 0.1, clearProps: 'opacity,transform' });
  };

  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(i));
    t.addEventListener('keydown', (e) => {
      const n = tabs.length;
      const map: Record<string, number> = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 };
      if (e.key in map) {
        e.preventDefault();
        select(map[e.key], true);
      }
    });
  });
}
