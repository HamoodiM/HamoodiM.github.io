import { isMotionOn, onMotionChange } from '../motion-state';

// Muted loop: plays only while on screen and motion is on; the visitor can always pause or play it.
export default function initVideo(fig: HTMLElement) {
  const v = fig.querySelector('video');
  const btn = fig.querySelector<HTMLButtonElement>('[data-loop-btn]');
  if (!v || !btn) return;
  v.controls = false;
  btn.hidden = false;
  let visible = false;
  let userChoice: 'play' | 'pause' | null = null;

  const sync = () => (btn.textContent = v.paused ? 'Play video' : 'Pause video');
  v.addEventListener('play', sync);
  v.addEventListener('pause', sync);

  const update = () => {
    const want = visible && (userChoice === 'play' || (userChoice === null && isMotionOn()));
    if (want && v.paused) {
      v.preload = 'auto';
      v.play().catch(() => sync());
    } else if (!want && !v.paused) v.pause();
  };

  btn.addEventListener('click', () => {
    userChoice = v.paused ? 'play' : 'pause';
    update();
  });
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; update(); }, { threshold: 0.4 }).observe(fig);
  onMotionChange(() => { userChoice = null; update(); });
  sync();
}
