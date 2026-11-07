import { isMotionOn } from '../motion-state';
import { loadFlip, loadGsap } from '../gsap-kit';

// TypeScript port of USrsScheduler::Update (SrsScheduler.cpp:46-65) and the box intervals
// (GetInterval, :33-44). MaxBox = 5.
const MAX_BOX = 5;
const INTERVAL = ['10 minutes', '10 minutes', '1 day', '3 days', '7 days', '21 days'];
const EXERCISE = ['word tiles', 'tiles plus distractors', 'tiles plus distractors', 'type the missing word', 'type the missing word', 'type the whole sentence'];

interface State { box: number; passes: number; failures: number; assistedPasses: number }

export function update(s: State, passed: boolean, assisted: boolean): 'fail' | 'assisted' | 'pass' {
  if (!passed) { s.failures++; s.box = 1; return 'fail'; }
  if (assisted) { s.passes++; s.assistedPasses++; return 'assisted'; }
  s.passes++;
  s.box = Math.min(s.box + 1, MAX_BOX);
  return 'pass';
}

export default function initLeitner(root: HTMLElement) {
  const actions = root.querySelector<HTMLElement>('[data-lt-actions]');
  const card = root.querySelector<HTMLElement>('[data-card]');
  const log = root.querySelector<HTMLElement>('[data-lt-log]');
  if (!actions || !card || !log) return;
  actions.hidden = false;
  const boxes = Array.from(root.querySelectorAll<HTMLElement>('.lt__box'));
  const lines = Array.from(root.querySelectorAll<HTMLElement>('[data-line]'));
  const state: State = { box: 0, passes: 0, failures: 0, assistedPasses: 0 };
  const markBox = () => boxes.forEach((b) => b.toggleAttribute('data-current', Number(b.dataset.box) === state.box));
  markBox();

  const move = async (branch: string | null) => {
    const slot = root.querySelector<HTMLElement>(`[data-slot="${state.box}"]`)!;
    lines.forEach((l) => l.toggleAttribute('data-hit', l.dataset.line === branch));
    if (!isMotionOn() || card.parentElement === slot) {
      slot.appendChild(card);
      markBox();
      if (isMotionOn() && card.parentElement === slot) {
        const { gsap } = await loadGsap();
        gsap.fromTo(card, { rotation: -8 }, { rotation: -2, duration: 0.4, ease: 'back.out(3)', clearProps: 'rotation' });
      }
      return;
    }
    const Flip = await loadFlip();
    const st = Flip.getState(card);
    slot.appendChild(card);
    markBox();
    Flip.from(st, { duration: 0.55, ease: 'power3.inOut' });
  };

  actions.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-lt]');
    if (!btn) return;
    const kind = btn.dataset.lt;
    if (kind === 'reset') {
      Object.assign(state, { box: 0, passes: 0, failures: 0, assistedPasses: 0 });
      log.textContent = 'Back to a new phrase in box 0.';
      move(null);
      return;
    }
    const before = state.box;
    const branch = update(state, kind !== 'fail', kind === 'assisted');
    const when = `due again in ${INTERVAL[state.box]}, as ${EXERCISE[state.box]}`;
    log.textContent =
      branch === 'fail'
        ? `Wrong: back to box 1, ${when}. Failures so far: ${state.failures}.`
        : branch === 'assisted'
          ? `Right, but after peeking at the translation: it stays in box ${state.box}, ${when}.`
          : before === MAX_BOX
            ? `Right again: it stays in the top box, ${when}.`
            : `Right without help: up to box ${state.box}, ${when}.`;
    move(branch);
  });
}
