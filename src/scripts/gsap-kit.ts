// GSAP 3.15 (free Standard License, incl. SplitText and Flip). Loaded lazily, once.
import type { gsap as GsapType } from 'gsap';
import type { ScrollTrigger as ST } from 'gsap/ScrollTrigger';
import type { SplitText as SPT } from 'gsap/SplitText';

export interface Kit { gsap: typeof GsapType; ScrollTrigger: typeof ST; SplitText: typeof SPT }
let kit: Promise<Kit> | null = null;

/** The site's one easing curve, cubic-bezier(.2,.7,.1,1), shared with CSS var(--ease). */
export const EASE = 'converge';

export function loadGsap(): Promise<Kit> {
  kit ??= Promise.all([
    import('gsap'),
    import('gsap/ScrollTrigger'),
    import('gsap/SplitText'),
    import('gsap/CustomEase'),
  ]).then(([g, st, sp, ce]) => {
    g.gsap.registerPlugin(st.ScrollTrigger, sp.SplitText, ce.CustomEase);
    ce.CustomEase.create(EASE, '0.2,0.7,0.1,1');
    g.gsap.defaults({ ease: EASE, duration: 0.48 });
    return { gsap: g.gsap, ScrollTrigger: st.ScrollTrigger, SplitText: sp.SplitText };
  });
  return kit;
}

let flip: Promise<typeof import('gsap/Flip')['Flip']> | null = null;
export function loadFlip() {
  flip ??= Promise.all([loadGsap(), import('gsap/Flip')]).then(([k, f]) => {
    k.gsap.registerPlugin(f.Flip);
    return f.Flip;
  });
  return flip;
}
