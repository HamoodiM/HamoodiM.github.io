// Motion layer for text: headings resolve character by character in random order, like samples
// landing in a progressive render; dossier briefing lines lose their redaction bars; stamps land.
// Nothing is hidden until this runs, and everything is reverted when motion is turned off.
import { isMotionOn, onMotionChange } from './motion-state';
import { loadGsap } from './gsap-kit';

export default function initReveal() {
  let ctx: gsap.Context | null = null;
  const splits: { revert(): void }[] = [];

  const inView = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.top < innerHeight * 0.92 && r.bottom > 0;
  };

  async function setup() {
    const { gsap, SplitText } = await loadGsap();
    if (!isMotionOn() || ctx) return;
    await document.fonts?.ready;
    const emit = getComputedStyle(document.documentElement).getPropertyValue('--emit-ink').trim() || '#7a4e0e';

    ctx = gsap.context(() => {
      document.querySelectorAll<HTMLElement>('[data-reveal]').forEach((h) => {
        if (inView(h)) return; // never hide what is already on screen
        const split = SplitText.create(h, { type: 'words,chars', aria: 'auto' });
        splits.push(split);
        const tl = gsap.timeline({
          scrollTrigger: { trigger: h, start: 'top 88%', once: true },
          onComplete: () => split.revert(),
        });
        tl.from(split.chars, { opacity: 0, duration: 0.36, ease: 'steps(3)', stagger: { each: 0.03, from: 'random' } })
          .from(split.chars, { color: emit, duration: 0.5, stagger: { each: 0.03, from: 'random' } }, 0.12);
      });

      document.querySelectorAll<HTMLElement>('[data-redact] > p').forEach((p) => {
        if (inView(p)) return;
        SplitText.create(p, {
          type: 'lines',
          linesClass: 'redact-line',
          autoSplit: true,
          onSplit(self) {
            splits.push(self);
            const bars = self.lines.map((line) => {
              const bar = document.createElement('span');
              bar.className = 'redact-bar';
              bar.setAttribute('aria-hidden', 'true');
              line.appendChild(bar);
              return bar;
            });
            return gsap.to(bars, {
              scaleX: 0,
              duration: 0.6,
              stagger: 0.09,
              ease: 'power3.inOut',
              scrollTrigger: { trigger: p, start: 'top 80%', once: true },
              onComplete: () => self.revert(),
            });
          },
        });
      });

      document.querySelectorAll<HTMLElement>('[data-stamp]').forEach((s, i) => {
        if (inView(s)) return;
        gsap.from(s, {
          scale: 1.9,
          opacity: 0,
          rotation: `-=${8 + i * 4}`,
          duration: 0.3,
          delay: i * 0.18,
          ease: 'power4.in',
          clearProps: 'transform,opacity',
          scrollTrigger: { trigger: s, start: 'top 85%', once: true },
        });
      });
    });
  }

  function teardown() {
    ctx?.revert();
    ctx = null;
    splits.splice(0).forEach((s) => s.revert());
  }

  if (isMotionOn()) setup();
  onMotionChange((on) => (on ? setup() : teardown()));
}
