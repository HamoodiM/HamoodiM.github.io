// LinguaSpy interactive demo widget. Unstyled but structured DOM (BEM-ish `ls-demo__*` hooks + data-state attributes)
// over the ported rules in grader.ts / leitner.ts / scaffold.ts / ladder.ts. No framework, no timers, no network:
// it only re-renders on visitor input.
//
// Flow per item: NPC line -> answer at the scaffold level for the item's Leitner box -> word-level feedback ->
// cover meter reacts -> the item moves between boxes. A demo clock can be fast-forwarded to make items come due.

import phrasesJson from './phrases.json' with { type: 'json' };
import { foldAccents, grade, joinTokens, normalizeToken, tokenizeTyped } from './grader.ts';
import type { GradeResult, WordTile, WordTileChallenge } from './grader.ts';
import { countDue, createItemState, DAY_MS, HOUR_MS, intervalLabel, isDue, MAX_BOX, MINUTE_MS, selectReviewItems, update } from './leitner.ts';
import type { SrsItemState } from './leitner.ts';
import { buildRecognitionOptions, buildTiles, canType, chooseLevel, fillGaps, getGapIndices, RandomStream, ScaffoldLevel } from './scaffold.ts';
import { applyGrade, CoverMeter, MAX_COVER } from './ladder.ts';
import type { LadderDecision } from './ladder.ts';

// ---- Public types --------------------------------------------------------------------------------------------------

export type DemoCity = 'paris' | 'tokyo';
export type LevelKey = 'recognize' | 'assemble' | 'assemble-plus' | 'gap-fill' | 'produce';
export type WordState = 'ok' | 'wrong' | 'accent';
export type CoverBand = 'high' | 'mid' | 'low' | 'blown';

export type LinguaSpyDemoEvent =
  | { type: 'challenge'; itemId: string; city: DemoCity; level: LevelKey; box: number | null }
  | {
      type: 'graded'; itemId: string; level: LevelKey; attempt: number; passed: boolean; final: boolean;
      assisted: boolean; accentOnly: boolean; hint: string; words: { text: string; state: WordState }[]; modelAnswer: string;
    }
  | { type: 'cover-change'; cover: number; max: number; ratio: number; delta: number; band: CoverBand; blown: boolean }
  | { type: 'box-move'; itemId: string; from: number | null; to: number; dueAt: number; reason: 'promoted' | 'kept' | 'reset' }
  | { type: 'time'; offsetMs: number; now: number; dueCount: number }
  | { type: 'city-change'; city: DemoCity };

export interface LinguaSpyDemoOptions {
  city?: DemoCity;
  onEvent?: (e: LinguaSpyDemoEvent) => void;
  /** Clock source (default Date.now). The fast-forward offset is added on top, like the game's DebugTimeOffset. */
  now?: () => number;
}

// ---- Data ----------------------------------------------------------------------------------------------------------

interface CityDef {
  cityId: string; language: string; languageCode: string; usesWordSpacing: boolean; allowTypedInput: boolean; specialCharacters: string;
}
interface Item {
  id: string; city: string; npc: string; scene: string; npcLine: string; npcReading: string; translation: string;
  intent: string; tiles: WordTile[]; answers: string[][]; skill: string; coverPenalty: number; gaps: number[];
  hints: { tokenIndex: number; text: string }[]; recognitionDistractors: string[];
}
const DATA = phrasesJson as unknown as { cities: Record<DemoCity, CityDef>; items: Item[] };
const CITIES = Object.keys(DATA.cities) as DemoCity[];

const LEVEL_KEYS: readonly LevelKey[] = ['recognize', 'assemble', 'assemble-plus', 'gap-fill', 'produce'];
const LEVEL_LABELS: readonly string[] = [
  'Pick the sentence', 'Build it from tiles', 'Build it from tiles (with distractors)', 'Type the missing words', 'Type the whole reply',
];

function toChallenge(item: Item): WordTileChallenge {
  return {
    intentPrompt: item.intent, tiles: item.tiles, acceptedAnswers: item.answers, skillTag: item.skill,
    coverPenalty: item.coverPenalty, hints: item.hints, gapTokenIndices: item.gaps, recognitionDistractors: item.recognitionDistractors,
  };
}

/** 32-bit FNV-1a, stands in for GetTypeHash(Key) in the recognition / tile-shuffle seed. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; ++i) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function formatSpan(ms: number): string {
  if (ms <= 0) return 'now';
  if (ms < HOUR_MS) return `${Math.ceil(ms / MINUTE_MS)} min`;
  if (ms < DAY_MS) return `${Math.round(ms / HOUR_MS)} h`;
  return `${Math.round(ms / DAY_MS)} d`;
}

function coverBand(cover: number, max: number): CoverBand {
  // Thresholds from USpyHUDWidget::HandleCoverChanged (UI/SpyHUDWidget.cpp:250)
  if (cover <= 0) return 'blown';
  const p = cover / max;
  return p > 0.6 ? 'high' : p > 0.3 ? 'mid' : 'low';
}

// ---- DOM helper ----------------------------------------------------------------------------------------------------

type Attrs = Record<string, string | number | boolean | undefined>;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, attrs: Attrs = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    el.setAttribute(k, v === true ? '' : String(v));
  }
  el.append(...kids);
  return el;
}

// ---- Widget --------------------------------------------------------------------------------------------------------

interface Visit {
  item: Item;
  challenge: WordTileChallenge;
  level: ScaffoldLevel;
  attempt: number;
  boxBefore: number | null;
  /** Shuffled tiles (tile levels). */
  tiles: WordTile[];
  /** Indices into tiles, in placed order. */
  placed: number[];
  options: string[];
  correctOption: number;
  gaps: number[];
  peeked: boolean;
  phase: 'answering' | 'prompted' | 'passed' | 'failed';
  /** Per-position result shown on the placed tiles / typed words after a grade. */
  marks: WordState[] | null;
  chosenOption: number;
  /** Typed text, kept across re-renders: one entry per gap, or [0] for Produce. */
  typed: string[];
}

export function mountLinguaSpyDemo(root: HTMLElement, opts: LinguaSpyDemoOptions = {}): { destroy(): void } {
  const emit = (e: LinguaSpyDemoEvent) => {
    try { opts.onEvent?.(e); } catch (err) { console.error(err); }
  };
  const clock = opts.now ?? Date.now;
  let offsetMs = 0;
  const now = () => clock() + offsetMs; // USpacedRepetitionSubsystem::GetNow = UtcNow + DebugTimeOffset

  let city: DemoCity = opts.city && CITIES.includes(opts.city) ? opts.city : 'paris';
  const srs = new Map<string, SrsItemState>();
  const sessionErrors = new Map<string, number>();
  let visits = 0;
  let visit: Visit | null = null;
  let lastInput: HTMLInputElement | null = null;

  let lastCover = MAX_COVER;
  const cover = new CoverMeter(MAX_COVER, (value, max) => {
    const delta = Math.round((value - lastCover) * 1000) / 1000; // cover math is float32 like the C++; trim the noise
    lastCover = value;
    renderCover();
    emit({ type: 'cover-change', cover: value, max, ratio: value / max, delta, band: coverBand(value, max), blown: value <= 0 });
  });

  // ---- Skeleton ----
  const el = h('div', 'ls-demo', { 'data-state': 'idle', 'data-city': city });
  const cityBar = h('div', 'ls-demo__cities', { role: 'group', 'aria-label': 'City' });
  for (const c of CITIES) {
    cityBar.append(h('button', 'ls-demo__city', { type: 'button', 'data-action': 'city', 'data-city': c }, DATA.cities[c].cityId));
  }

  const npcName = h('p', 'ls-demo__speaker');
  const prompt = h('p', 'ls-demo__prompt');
  const reading = h('p', 'ls-demo__reading');
  const translation = h('p', 'ls-demo__translation', { id: 'ls-demo-tr-' + hash(String(Math.random())) });
  const peek = h('button', 'ls-demo__peek', { type: 'button', 'data-action': 'peek', 'aria-expanded': 'false', 'aria-controls': translation.id }, 'Ask the handler to translate');
  const npc = h('div', 'ls-demo__npc', {}, npcName, prompt, reading, peek, translation);

  const task = h('p', 'ls-demo__task');
  const level = h('p', 'ls-demo__level');
  const stage = h('div', 'ls-demo__stage');
  const keys = h('div', 'ls-demo__keys', { role: 'group', 'aria-label': 'Accented letters' });
  const submit = h('button', 'ls-demo__submit', { type: 'submit' }, 'Answer');
  const clear = h('button', 'ls-demo__clear', { type: 'button', 'data-action': 'clear' }, 'Clear');
  const cont = h('button', 'ls-demo__continue', { type: 'button', 'data-action': 'continue' }, 'Continue');
  const actions = h('div', 'ls-demo__actions', {}, submit, clear, cont);
  const form = h('form', 'ls-demo__answer', { novalidate: true }, task, level, stage, keys, actions);

  const feedbackMsg = h('p', 'ls-demo__message');
  const graded = h('p', 'ls-demo__graded');
  const feedback = h('div', 'ls-demo__feedback', { 'aria-live': 'polite', 'data-state': '' }, graded, feedbackMsg);

  const coverFill = h('span', 'ls-demo__cover-fill');
  const coverValue = h('span', 'ls-demo__cover-value');
  const coverMeter = h('div', 'ls-demo__cover-meter', { role: 'meter', 'aria-label': 'Cover', 'aria-valuemin': 0, 'aria-valuemax': MAX_COVER },
    h('span', 'ls-demo__cover-label', {}, 'Cover'), h('span', 'ls-demo__cover-track', {}, coverFill), coverValue);

  const boxes = h('ol', 'ls-demo__boxes', { 'aria-label': 'Leitner boxes' });
  const boxEls: HTMLLIElement[] = [];
  for (let b = 0; b <= MAX_BOX; ++b) {
    const li = h('li', 'ls-demo__box', { 'data-box': b },
      h('span', 'ls-demo__box-name', {}, `Box ${b}`),
      h('span', 'ls-demo__box-interval', {}, b === 0 ? `seen · ${intervalLabel(b)}` : intervalLabel(b)),
      h('span', 'ls-demo__box-items'));
    boxEls.push(li);
    boxes.append(li);
  }
  const unseen = h('p', 'ls-demo__unseen');

  const clockText = h('span', 'ls-demo__time');
  const ff = h('div', 'ls-demo__clock', { role: 'group', 'aria-label': 'Demo clock' }, clockText,
    h('button', 'ls-demo__ff', { type: 'button', 'data-action': 'ff', 'data-ms': 10 * MINUTE_MS }, '+10 min'),
    h('button', 'ls-demo__ff', { type: 'button', 'data-action': 'ff', 'data-ms': DAY_MS }, '+1 day'),
    h('button', 'ls-demo__ff', { type: 'button', 'data-action': 'ff', 'data-ms': 7 * DAY_MS }, '+1 week'),
    h('button', 'ls-demo__ff ls-demo__ff--next', { type: 'button', 'data-action': 'ff-next' }, 'Skip to next review'));

  const srsPanel = h('div', 'ls-demo__srs', {}, boxes, unseen, ff);
  el.append(cityBar, npc, form, feedback, coverMeter, srsPanel);
  root.append(el);

  // ---- State helpers ----
  const cityDef = () => DATA.cities[city];
  const useSpaces = () => cityDef().usesWordSpacing;
  const cityItems = () => DATA.items.filter((i) => i.city === city);

  function setPhase(phase: Visit['phase'] | 'idle'): void {
    el.dataset['state'] = phase;
  }

  function pickNext(): Item | null {
    const t = now();
    const [dueKey] = selectReviewItems(srs, cityDef().cityId, t, 1, false);
    if (dueKey) return DATA.items.find((i) => i.id === dueKey) ?? null;
    return cityItems().find((i) => !srs.has(i.id)) ?? null;
  }

  /** Mirrors UConversationSubsystem::PresentChallenge, ConversationSubsystem.cpp:355-385. */
  function present(item: Item | null): void {
    lastInput = null;
    if (!item) {
      visit = null;
      renderIdle();
      return;
    }
    ++visits;
    const challenge = toChallenge(item);
    const state = srs.get(item.id) ?? null;
    let lvl = chooseLevel(state, sessionErrors.get(item.id) ?? 0, canType(cityDef()));
    let options: string[] = [];
    let correctOption = -1;
    if (lvl === ScaffoldLevel.Recognize) {
      const r = buildRecognitionOptions(challenge, useSpaces(), hash(item.id) ^ visits);
      options = r.options;
      correctOption = r.correctIndex;
      if (options.length < 2) lvl = ScaffoldLevel.Assemble; // nothing to choose between
    }
    // Tiles are shuffled at runtime (UI/ConversationWidget.cpp:561)
    const tiles = buildTiles(challenge, lvl);
    const rng = new RandomStream(hash(item.id) + visits);
    for (let i = tiles.length - 1; i > 0; --i) {
      const j = rng.randRange(0, i);
      [tiles[i], tiles[j]] = [tiles[j]!, tiles[i]!];
    }
    visit = {
      item, challenge, level: lvl, attempt: 1, boxBefore: state ? state.box : null, tiles, placed: [], options, correctOption,
      gaps: lvl === ScaffoldLevel.GapFill ? getGapIndices(challenge) : [], peeked: false, phase: 'answering', marks: null, chosenOption: -1, typed: [],
    };
    el.dataset['peeked'] = 'false';
    renderVisit();
    renderBoxes();
    emit({ type: 'challenge', itemId: item.id, city, level: LEVEL_KEYS[lvl]!, box: visit.boxBefore });
  }

  // ---- Rendering ----
  function renderIdle(): void {
    setPhase('idle');
    el.dataset['level'] = '';
    npcName.textContent = '';
    prompt.textContent = 'No phrases are due right now.';
    reading.textContent = '';
    translation.textContent = '';
    translation.hidden = true;
    peek.hidden = true;
    const t = now();
    const next = [...srs.values()].filter((s) => s.cityId === cityDef().cityId).sort((a, b) => a.dueUtcMs - b.dueUtcMs)[0];
    task.textContent = next ? `Next review in ${formatSpan(next.dueUtcMs - t)}. Fast-forward the clock to bring it back.` : '';
    level.textContent = '';
    stage.replaceChildren();
    keys.replaceChildren();
    submit.hidden = clear.hidden = cont.hidden = true;
    renderFeedback(null, '', '');
    renderBoxes();
  }

  function renderVisit(): void {
    if (!visit) return;
    const v = visit;
    setPhase(v.phase);
    el.dataset['level'] = LEVEL_KEYS[v.level]!;
    npcName.textContent = `${v.item.npc} · ${v.item.scene}`;
    prompt.textContent = v.item.npcLine;
    prompt.lang = cityDef().languageCode;
    reading.textContent = v.item.npcReading;
    reading.hidden = !v.item.npcReading;
    translation.textContent = v.item.translation;
    translation.hidden = !v.peeked;
    peek.hidden = false;
    peek.disabled = v.peeked;
    peek.setAttribute('aria-expanded', String(v.peeked));
    task.textContent = v.item.intent;
    level.textContent = LEVEL_LABELS[v.level]!;
    renderStage();
    renderFeedback(null, '', '');
  }

  function renderStage(): void {
    if (!visit) return;
    const v = visit;
    const locked = v.phase === 'passed' || v.phase === 'failed';
    const lang = cityDef().languageCode;
    stage.replaceChildren();
    keys.replaceChildren();

    if (v.level === ScaffoldLevel.Recognize) {
      const list = h('div', 'ls-demo__options', { role: 'group', 'aria-label': 'Which reply fits?' });
      v.options.forEach((o, i) => {
        const state = v.chosenOption === i ? (i === v.correctOption ? 'ok' : 'wrong') : locked && i === v.correctOption ? 'ok' : '';
        list.append(h('button', `ls-demo__option${state ? ` ls-demo__option--${state}` : ''}`,
          { type: 'button', lang, 'data-action': 'option', 'data-index': i, disabled: locked }, o));
      });
      stage.append(list);
    } else if (v.level === ScaffoldLevel.GapFill || v.level === ScaffoldLevel.Produce) {
      const wrap = h('div', 'ls-demo__typing', { lang });
      if (v.level === ScaffoldLevel.GapFill) {
        const model = v.challenge.acceptedAnswers[0]!;
        model.forEach((token, i) => {
          const g = v.gaps.indexOf(i);
          if (i > 0 && useSpaces()) wrap.append(' ');
          if (g < 0) {
            wrap.append(h('span', 'ls-demo__gap-word', {}, token));
          } else {
            wrap.append(h('input', 'ls-demo__input ls-demo__input--gap', {
              type: 'text', 'aria-label': `Missing word ${g + 1} of ${v.gaps.length}`, autocomplete: 'off', autocapitalize: 'off',
              spellcheck: 'false', size: Math.max(4, token.length + 1), 'data-gap': g, disabled: locked,
            }));
            (wrap.lastChild as HTMLInputElement).value = v.typed[g] ?? '';
          }
        });
      } else {
        wrap.append(h('input', 'ls-demo__input', {
          type: 'text', 'aria-label': `Your reply in ${cityDef().language}`, placeholder: `Type your reply in ${cityDef().language}`,
          autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', disabled: locked, 'data-gap': 0,
        }));
        (wrap.lastChild as HTMLInputElement).value = v.typed[0] ?? '';
      }
      stage.append(wrap);
      // On-screen keys for letters English keyboards lack (ULanguagePackAsset::SpecialCharacters, LanguagePackAsset.h:89-91)
      for (const ch of locked ? '' : cityDef().specialCharacters) {
        keys.append(h('button', 'ls-demo__key', { type: 'button', 'data-action': 'key', 'data-char': ch, 'aria-label': `Insert ${ch}`, disabled: locked }, ch));
      }
    } else {
      const line = h('div', 'ls-demo__line', { role: 'group', 'aria-label': 'Your reply (select a word to remove it)', lang });
      v.placed.forEach((tileIndex, pos) => {
        const mark = v.marks?.[pos];
        line.append(tileButton(v.tiles[tileIndex]!, `ls-demo__word${mark ? ` ls-demo__word--${mark}` : ''}`,
          { 'data-action': 'unplace', 'data-pos': pos, disabled: locked }));
      });
      const bank = h('div', 'ls-demo__tiles', { role: 'group', 'aria-label': 'Word tiles', lang });
      v.tiles.forEach((tile, i) => {
        const used = v.placed.includes(i);
        bank.append(tileButton(tile, 'ls-demo__tile', { 'data-action': 'place', 'data-index': i, 'data-state': used ? 'placed' : 'free', disabled: used || locked }));
      });
      stage.append(line, bank);
    }

    const typedOrTiles = v.level !== ScaffoldLevel.Recognize;
    submit.hidden = locked || !typedOrTiles;
    clear.hidden = locked || !(v.level === ScaffoldLevel.Assemble || v.level === ScaffoldLevel.AssemblePlus);
    cont.hidden = !locked;
    cont.textContent = cover.isBlown() ? 'Restore cover and continue' : 'Continue';
  }

  function tileButton(tile: WordTile, cls: string, attrs: Attrs): HTMLButtonElement {
    const label = tile.reading ? `${tile.text} (${tile.reading})` : tile.text;
    const b = h('button', cls, { type: 'button', 'aria-label': label, ...attrs }, h('span', 'ls-demo__tile-text', {}, tile.text));
    if (tile.reading) b.append(h('span', 'ls-demo__tile-reading', {}, tile.reading));
    return b;
  }

  function renderFeedback(words: { text: string; state: WordState }[] | null, state: string, message: string): void {
    feedback.dataset['state'] = state;
    graded.replaceChildren();
    graded.hidden = !words;
    if (words) {
      words.forEach((w, i) => {
        if (i > 0 && useSpaces()) graded.append(' ');
        graded.append(h('span', `ls-demo__word ls-demo__word--${w.state}`, { 'data-state': w.state }, w.text));
      });
    }
    feedbackMsg.textContent = message;
  }

  function renderCover(): void {
    const value = cover.cover;
    const band = coverBand(value, cover.max);
    coverMeter.dataset['state'] = band;
    coverMeter.setAttribute('aria-valuenow', String(Math.round(value)));
    coverMeter.setAttribute('aria-valuetext', band === 'blown' ? 'Cover blown' : `${Math.round(value)} of ${cover.max}`);
    coverMeter.style.setProperty('--ls-cover', String(value / cover.max));
    coverFill.style.width = `${(value / cover.max) * 100}%`;
    coverValue.textContent = band === 'blown' ? 'Blown' : String(Math.round(value));
    el.dataset['cover'] = band;
  }

  function renderBoxes(): void {
    const t = now();
    const def = cityDef();
    const counts = new Array<number>(MAX_BOX + 1).fill(0);
    const lists = boxEls.map((li) => li.querySelector('.ls-demo__box-items') as HTMLElement);
    lists.forEach((l) => l.replaceChildren());
    for (const item of cityItems()) {
      const s = srs.get(item.id);
      if (!s) continue;
      counts[s.box] = (counts[s.box] ?? 0) + 1;
      const due = isDue(s, t);
      const current = visit?.item.id === item.id;
      lists[s.box]!.append(h('span', `ls-demo__chip${current ? ' ls-demo__chip--current' : ''}`, {
        'data-due': String(due), lang: def.languageCode,
        title: `${due ? 'Due now' : `Due in ${formatSpan(s.dueUtcMs - t)}`} · ${s.passes} pass, ${s.failures} fail`,
      }, joinTokens(item.answers[0]!, def.usesWordSpacing)));
    }
    const activeBox = visit ? srs.get(visit.item.id)?.box ?? null : null;
    boxEls.forEach((li, b) => {
      li.dataset['count'] = String(counts[b]);
      li.classList.toggle('ls-demo__box--active', b === activeBox);
    });
    const unseenCount = cityItems().filter((i) => !srs.has(i.id)).length;
    unseen.textContent = `Not seen yet: ${unseenCount}`;
    unseen.dataset['count'] = String(unseenCount);
    const dueCount = countDue(srs, def.cityId, t);
    clockText.textContent = `Clock +${formatSpan(offsetMs) === 'now' ? '0 min' : formatSpan(offsetMs)} · ${dueCount} due`;
    el.dataset['due'] = String(dueCount);
  }

  // ---- Answering ----
  function marksFor(result: GradeResult, tokens: readonly string[], challenge: WordTileChallenge): WordState[] {
    // Demo-only presentation: a wrong word that matches once accents are folded is shown as "accent".
    const answer = challenge.acceptedAnswers[Math.max(result.closestAnswerIndex, 0)] ?? [];
    return tokens.map((t, i) => {
      if (result.tileCorrect[i]) return 'ok';
      const want = answer[i];
      return want !== undefined && foldAccents(normalizeToken(t)) === foldAccents(normalizeToken(want)) ? 'accent' : 'wrong';
    });
  }

  function submitAnswer(): void {
    const v = visit;
    if (!v || v.phase === 'passed' || v.phase === 'failed') return;
    let tokens: string[];
    if (v.level === ScaffoldLevel.Assemble || v.level === ScaffoldLevel.AssemblePlus) {
      tokens = v.placed.map((i) => v.tiles[i]!.text);
      if (tokens.length === 0) return renderFeedback(null, 'info', 'Build a sentence from the tiles first.');
    } else if (v.level === ScaffoldLevel.GapFill) {
      const inputs = [...stage.querySelectorAll<HTMLInputElement>('.ls-demo__input--gap')];
      const words = inputs.map((inp) => inp.value);
      if (words.every((w) => w.trim() === '')) return renderFeedback(null, 'info', 'Type the missing words first.');
      tokens = fillGaps(v.challenge, words);
    } else if (v.level === ScaffoldLevel.Produce) {
      const inp = stage.querySelector<HTMLInputElement>('.ls-demo__input');
      tokens = tokenizeTyped(inp?.value ?? '');
      if (tokens.length === 0) return renderFeedback(null, 'info', 'Type your reply first.');
    } else {
      return;
    }
    const result = grade(v.challenge, tokens); // UConversationSubsystem::SubmitAnswer / SubmitGapWords (:415-434)
    finishAttempt(result, tokens);
  }

  function chooseOption(index: number): void {
    const v = visit;
    if (!v || v.level !== ScaffoldLevel.Recognize || v.phase === 'passed' || v.phase === 'failed') return;
    // UConversationSubsystem::SubmitRecognition (:436-447)
    const passed = index === v.correctOption && v.correctOption !== -1;
    v.chosenOption = index;
    finishAttempt({ passed, tileCorrect: [], closestAnswerIndex: 0, accentOnly: false, firstWrongIndex: passed ? -1 : 0 }, null);
  }

  function finishAttempt(result: GradeResult, tokens: string[] | null): void {
    const v = visit!;
    const d: LadderDecision = applyGrade(result, {
      challenge: v.challenge, presentation: { level: v.level, attempt: v.attempt }, submittedTokens: tokens?.length ?? 0, peeked: v.peeked,
    });
    const model = joinTokens(v.challenge.acceptedAnswers[0]!, useSpaces());
    v.marks = tokens ? marksFor(d.grade, tokens, v.challenge) : null;
    const words = tokens ? tokens.map((text, i) => ({ text, state: v.marks![i]! })) : [];
    if (d.sessionError) sessionErrors.set(v.item.id, (sessionErrors.get(v.item.id) ?? 0) + 1);

    // Feedback text: UConversationWidget::HandleAnswerFeedback (UI/ConversationWidget.cpp:782-833)
    let state: string;
    let message: string;
    if (!d.final) {
      v.phase = 'prompted';
      v.attempt = d.nextAttempt;
      state = 'hint';
      message = `Handler: "${d.hint}" Try again.`;
    } else if (d.grade.passed) {
      v.phase = 'passed';
      state = d.assisted ? 'assisted' : 'pass';
      message = d.hint ? `${d.hint} "${model}"` : d.assisted ? `Got it: "${model}". Next time, try it without help.` : 'Perfect! Your cover holds.';
    } else {
      v.phase = 'failed';
      state = 'fail';
      message = `The local narrows their eyes... A local would say: "${model}"`;
    }

    setPhase(v.phase);
    const showTyped = v.level === ScaffoldLevel.GapFill || v.level === ScaffoldLevel.Produce;
    renderStage();
    renderFeedback(showTyped ? words : null, state, message);
    emit({
      type: 'graded', itemId: v.item.id, level: LEVEL_KEYS[v.level]!, attempt: d.final ? v.attempt : v.attempt - 1, passed: d.grade.passed,
      final: d.final, assisted: d.assisted, accentOnly: d.grade.accentOnly, hint: d.hint, words, modelAnswer: d.final ? model : '',
    });

    // Penalty / recovery after the feedback broadcast, as in the C++ (the UI shows the hint first)
    if (d.coverDelta < 0) cover.applyPenalty(-d.coverDelta);
    else if (d.coverDelta > 0) cover.recover(d.coverDelta);
    if (cover.isBlown()) {
      // In the game OnCoverBlown halts the conversation and drills the missed phrases (ConversationSubsystem.cpp:732-742).
      feedbackMsg.textContent = `${message} Your cover is blown: in the game you would now drill the phrases you missed.`;
      cont.textContent = 'Restore cover and continue';
    }

    if (d.srs) {
      const s = srs.get(v.item.id) ?? createItemState(cityDef().cityId, v.item.skill);
      const from = srs.has(v.item.id) ? s.box : null;
      update(s, d.srs.passed, d.srs.assisted, now()); // USpacedRepetitionSubsystem::RecordResult -> USrsScheduler::Update
      srs.set(v.item.id, s);
      renderBoxes();
      emit({
        type: 'box-move', itemId: v.item.id, from, to: s.box, dueAt: s.dueUtcMs,
        reason: !d.srs.passed ? 'reset' : from === null ? (s.box > 0 ? 'promoted' : 'kept') : s.box > from ? 'promoted' : 'kept',
      });
      cont.focus();
    } else {
      // On a prompt, put the cursor on the first gap that is not right yet
      const firstWrongGap = v.level === ScaffoldLevel.GapFill ? v.gaps.findIndex((g) => v.marks?.[g] !== 'ok') : -1;
      const gapInput = firstWrongGap >= 0 ? stage.querySelector<HTMLInputElement>(`[data-gap="${firstWrongGap}"]`) : null;
      if (gapInput) {
        gapInput.select();
        gapInput.focus();
      } else {
        focusAnswer();
      }
    }
  }

  function focusAnswer(): void {
    const target = stage.querySelector<HTMLElement>('input:not([disabled]), .ls-demo__tile:not([disabled]), .ls-demo__option:not([disabled])');
    if (target instanceof HTMLInputElement) target.select();
    target?.focus();
  }

  function clearMarks(): void {
    if (!visit || !visit.marks) return;
    visit.marks = null;
  }

  function advanceTime(ms: number): void {
    offsetMs += Math.max(0, ms);
    // SessionErrors lives on a UWorldSubsystem, so in the game it resets when the level reloads. The demo treats a
    // jump of a day or more as "came back later": a new session, so earlier mistakes stop stepping the level down.
    if (ms >= DAY_MS) sessionErrors.clear();
    renderBoxes();
    emit({ type: 'time', offsetMs, now: now(), dueCount: countDue(srs, cityDef().cityId, now()) });
    if (!visit) present(pickNext());
  }

  // ---- Events (delegated) ----
  function onClick(ev: MouseEvent): void {
    const btn = (ev.target as Element | null)?.closest<HTMLElement>('[data-action]');
    if (!btn || !el.contains(btn) || (btn as HTMLButtonElement).disabled) return;
    const v = visit;
    switch (btn.dataset['action']) {
      case 'city': {
        const next = btn.dataset['city'] as DemoCity;
        if (next === city) return;
        city = next;
        el.dataset['city'] = city;
        renderCityButtons();
        emit({ type: 'city-change', city });
        present(pickNext());
        return;
      }
      case 'peek':
        if (v && !v.peeked) {
          v.peeked = true; // a pass after peeking is assisted (ConversationSubsystem.cpp:492)
          translation.hidden = false;
          peek.disabled = true;
          peek.setAttribute('aria-expanded', 'true');
          el.dataset['peeked'] = 'true';
        }
        return;
      case 'place': {
        if (!v) return;
        const i = Number(btn.dataset['index']);
        if (v.placed.includes(i)) return;
        v.placed.push(i);
        clearMarks();
        renderStage();
        const free = stage.querySelector<HTMLElement>('.ls-demo__tile:not([disabled])');
        (free ?? submit).focus();
        return;
      }
      case 'unplace': {
        if (!v) return;
        const pos = Number(btn.dataset['pos']);
        const [tileIndex] = v.placed.splice(pos, 1);
        clearMarks();
        renderStage();
        stage.querySelector<HTMLElement>(`.ls-demo__tile[data-index="${tileIndex}"]`)?.focus();
        return;
      }
      case 'clear':
        if (!v) return;
        v.placed = [];
        clearMarks();
        renderStage();
        focusAnswer();
        return;
      case 'option':
        chooseOption(Number(btn.dataset['index']));
        return;
      case 'key': {
        const inp = lastInput && stage.contains(lastInput) ? lastInput : stage.querySelector<HTMLInputElement>('.ls-demo__input');
        if (!inp || inp.disabled) return;
        const ch = btn.dataset['char'] ?? '';
        const start = inp.selectionStart ?? inp.value.length;
        const end = inp.selectionEnd ?? inp.value.length;
        inp.setRangeText(ch, start, end, 'end');
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.focus();
        return;
      }
      case 'continue':
        if (cover.isBlown()) cover.reset(); // the game drills the missed phrases first, then ResetCover
        present(pickNext());
        focusAnswer();
        return;
      case 'ff':
        advanceTime(Number(btn.dataset['ms']));
        return;
      case 'ff-next': {
        const t = now();
        const states = [...srs.values()].filter((s) => s.cityId === cityDef().cityId && !isDue(s, t));
        if (states.length === 0) return;
        advanceTime(Math.min(...states.map((s) => s.dueUtcMs)) - t);
        return;
      }
    }
  }

  function onSubmit(ev: SubmitEvent): void {
    ev.preventDefault();
    submitAnswer();
  }

  function onFocusIn(ev: FocusEvent): void {
    if (ev.target instanceof HTMLInputElement && ev.target.classList.contains('ls-demo__input')) lastInput = ev.target;
  }

  function onInput(ev: Event): void {
    const t = ev.target;
    if (visit && t instanceof HTMLInputElement && t.dataset['gap'] !== undefined) visit.typed[Number(t.dataset['gap'])] = t.value;
  }

  function renderCityButtons(): void {
    cityBar.querySelectorAll<HTMLButtonElement>('.ls-demo__city').forEach((b) => {
      const on = b.dataset['city'] === city;
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('ls-demo__city--active', on);
    });
  }

  el.addEventListener('click', onClick);
  form.addEventListener('submit', onSubmit);
  el.addEventListener('focusin', onFocusIn);
  el.addEventListener('input', onInput);

  renderCityButtons();
  renderCover();
  present(pickNext());

  return {
    destroy() {
      el.removeEventListener('click', onClick);
      form.removeEventListener('submit', onSubmit);
      el.removeEventListener('focusin', onFocusIn);
      el.removeEventListener('input', onInput);
      el.remove();
      visit = null;
    },
  };
}
