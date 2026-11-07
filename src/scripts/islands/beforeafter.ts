import { isMotionOn } from '../motion-state';
import { loadGsap } from '../gsap-kit';

export default function initBeforeAfter(root: HTMLElement) {
  const tablist = root.querySelector<HTMLElement>('[data-ba-tablist]');
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const pairs = Array.from(root.querySelectorAll<HTMLElement>('[data-ba-pair]'));
  if (!tablist) return;
  tablist.hidden = false;

  pairs.forEach((p) => {
    const stage = p.querySelector<HTMLElement>('[data-ba-stage]')!;
    const range = p.querySelector<HTMLInputElement>('[data-ba-range]')!;
    range.hidden = false;
    range.addEventListener('input', () => stage.style.setProperty('--split', `${range.value}%`));
  });

  const select = (i: number, focus = false) => {
    tabs.forEach((t, j) => {
      t.setAttribute('aria-selected', String(i === j));
      t.tabIndex = i === j ? 0 : -1;
    });
    pairs.forEach((p, j) => p.toggleAttribute('data-active', i === j));
    if (focus) tabs[i].focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(i));
    t.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k === 'ArrowRight' || k === 'ArrowLeft' || k === 'Home' || k === 'End') {
        e.preventDefault();
        const n = tabs.length;
        const next = k === 'Home' ? 0 : k === 'End' ? n - 1 : (i + (k === 'ArrowRight' ? 1 : -1) + n) % n;
        select(next, true);
      }
    });
  });

  // One demonstration sweep the first time the slider is seen, so it reads as draggable.
  if (!isMotionOn()) return;
  const stage = pairs[0].querySelector<HTMLElement>('[data-ba-stage]')!;
  loadGsap().then(({ gsap }) => {
    if (!isMotionOn()) return;
    gsap.fromTo(
      stage,
      { '--split': '92%' },
      {
        '--split': '50%',
        duration: 1.3,
        scrollTrigger: { trigger: stage, start: 'top 75%', once: true },
        onComplete: () => stage.style.setProperty('--split', '50%'),
      },
    );
  });
}
