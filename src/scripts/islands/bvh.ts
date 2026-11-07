import { isMotionOn } from '../motion-state';
import { loadGsap } from '../gsap-kit';

// Bars grow from zero once, then the speed-up figures count up to the measured value.
export default function initBvh(fig: HTMLElement) {
  if (!isMotionOn()) return;
  loadGsap().then(({ gsap }) => {
    if (!isMotionOn()) return;
    const rows = fig.querySelectorAll<HTMLElement>('.bvh__row');
    const tl = gsap.timeline({
      scrollTrigger: { trigger: fig, start: 'top 75%', once: true },
      onComplete: () => tl.revert(),
    });
    rows.forEach((row, i) => {
      const bars = row.querySelectorAll('[data-bar]');
      const num = row.querySelector<HTMLElement>('[data-count]')!;
      const target = Number(num.dataset.count);
      const counter = { v: target };
      tl.from(bars, { scaleX: 0, duration: 0.7, stagger: 0.12 }, i * 0.09);
      tl.from(
        counter,
        {
          v: 1,
          duration: 0.9,
          onUpdate: () => (num.textContent = Math.round(counter.v).toLocaleString('en-US')),
          onComplete: () => (num.textContent = target.toLocaleString('en-US')),
        },
        i * 0.09 + 0.2,
      );
    });
  });
}
