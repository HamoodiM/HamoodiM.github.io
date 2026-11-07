import { isMotionOn, onMotionChange } from '../motion-state';
import { loadGsap } from '../gsap-kit';

// 1 to 256 spp. A range input always works; with motion on (home page) scroll drives it while the
// frame is sticky for 1.2 viewports.
export default function initConverge(root: HTMLElement) {
  const frames = Array.from(root.querySelectorAll<HTMLImageElement>('.converge__frame'));
  const range = root.querySelector<HTMLInputElement>('[data-spp-range]');
  const readout = root.querySelector<HTMLElement>('[data-spp-readout]');
  if (!frames.length || !range || !readout) return;
  frames.forEach((f) => (f.loading = 'eager'));
  const last = frames.length - 1;
  let current = last;

  const show = (i: number) => {
    i = Math.max(0, Math.min(last, i));
    if (i === current) return;
    frames[current].removeAttribute('data-active');
    frames[i].setAttribute('data-active', '');
    current = i;
    const spp = frames[i].dataset.spp ?? '';
    if (readout.firstChild) readout.firstChild.nodeValue = spp;
    range.value = String(i);
    range.setAttribute('aria-valuetext', `${spp} samples per pixel`);
  };
  range.addEventListener('input', () => show(Number(range.value)));

  if (!root.hasAttribute('data-scrub')) return;
  let trigger: ScrollTrigger | null = null;

  async function setup() {
    const { ScrollTrigger } = await loadGsap();
    if (!isMotionOn() || trigger) return;
    ScrollTrigger.refresh();
    trigger = ScrollTrigger.create({
      trigger: root,
      start: 'top 20%',
      end: 'bottom bottom',
      onUpdate: (self) => show(Math.round(self.progress * last)),
    });
    show(Math.round(trigger.progress * last));
  }
  async function teardown() {
    trigger?.kill();
    trigger = null;
    show(last);
    (await loadGsap()).ScrollTrigger.refresh();
  }
  if (isMotionOn()) setup();
  onMotionChange((on) => (on ? setup() : teardown()));
}
