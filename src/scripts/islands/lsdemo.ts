import { isMotionOn } from '../motion-state';
import { loadGsap } from '../gsap-kit';
import type { LinguaSpyDemoEvent, DemoCity } from '../../vendor/linguaspy-demo/widget';

// Mounts the LinguaSpy grader/scheduler demo (TypeScript port, src/vendor/linguaspy-demo) and gives
// its events motion: graded words land one by one, a wrong answer shakes the line and the cover
// meter, and the box a phrase lands in flashes stamp red. The widget has its own
// Paris/Tokyo switcher (it only has content for those two cities).
export default async function initDemo(root: HTMLElement) {
  const mount = root.querySelector<HTMLElement>('[data-demo-root]');
  if (!mount) return;
  const { mountLinguaSpyDemo } = await import('../../vendor/linguaspy-demo/widget');

  const onEvent = async (e: LinguaSpyDemoEvent) => {
    if (!isMotionOn()) return;
    const { gsap } = await loadGsap();
    if (e.type === 'graded') {
      const words = mount.querySelectorAll('.ls-demo__graded .ls-demo__word');
      if (words.length) gsap.fromTo(words, { opacity: 0, y: 6 }, { opacity: 1, y: 0, stagger: 0.05, duration: 0.3, clearProps: 'opacity,transform' });
    } else if (e.type === 'cover-change' && e.delta < 0) {
      const meter = mount.querySelector('.ls-demo__cover-meter');
      if (meter) gsap.fromTo(meter, { x: -6 }, { x: 0, duration: 0.5, ease: 'elastic.out(1, 0.35)', clearProps: 'transform' });
    } else if (e.type === 'box-move') {
      const box = mount.querySelector(`.ls-demo__box[data-box="${e.to}"]`);
      if (box) gsap.fromTo(box, { backgroundColor: '#962520', color: '#fff8ec' }, { backgroundColor: 'rgba(0,0,0,0)', color: 'inherit', duration: 0.9, clearProps: 'backgroundColor,color' });
    }
  };

  const city: DemoCity = 'paris';
  mountLinguaSpyDemo(mount, { city, onEvent });
  mount.closest('[data-island]')?.removeAttribute('hidden');
}
