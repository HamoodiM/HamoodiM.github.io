// LinguaSpy spaced repetition: TypeScript port of USrsScheduler (Leitner boxes on real time) and FSrsItemKey.
// Source of truth: Source/Personal/LinguaSpy/Language/SrsScheduler.cpp (and .h), state struct FSrsItemState in
// Save/LinguaSpySaveGame.h:103-133. Each function names the C++ lines it mirrors. Pure: the caller passes "now".
//
// Box 0 = seen, never passed unaided. Boxes 1..5 wait 10 min, 1 day, 3 days, 7 days, 21 days.
// Unaided pass -> up one box. Pass after peeking / a hint -> same box, rescheduled. Fail -> box 1, due in 10 min.
//
// Time: the C++ stores FDateTime ticks (100 ns, UTC). This port uses Unix epoch milliseconds (UTC). Every interval
// is a whole number of milliseconds, so due-time arithmetic is exact in both.

/** Mirrors USrsScheduler::MaxBox, SrsScheduler.h:52. */
export const MAX_BOX = 5;

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** Mirrors FSrsItemState, LinguaSpySaveGame.h:103-133 (ticks -> ms). */
export interface SrsItemState {
  /** 0 = seen but never passed unassisted; 1..5 = Leitner boxes. */
  box: number;
  /** When the item is next due (UTC ms). */
  dueUtcMs: number;
  lastReviewUtcMs: number;
  passes: number;
  failures: number;
  /** Passes given with help (peeked at the translation, second attempt, recognition level). */
  assistedPasses: number;
  cityId: string;
  skillTag: string;
}

/** A default-constructed FSrsItemState (all zero, box 0). */
export function createItemState(cityId = '', skillTag = ''): SrsItemState {
  return { box: 0, dueUtcMs: 0, lastReviewUtcMs: 0, passes: 0, failures: 0, assistedPasses: 0, cityId, skillTag };
}

/** Wait after reaching a box. Mirrors USrsScheduler::GetInterval, SrsScheduler.cpp:33-44. */
export function getInterval(box: number): number {
  switch (Math.min(Math.max(box, 0), MAX_BOX)) {
    case 0:
    case 1: return 10 * MINUTE_MS;
    case 2: return 1 * DAY_MS;
    case 3: return 3 * DAY_MS;
    case 4: return 7 * DAY_MS;
    default: return 21 * DAY_MS;
  }
}

/** Human label for a box's wait (UI only). */
export function intervalLabel(box: number): string {
  const ms = getInterval(box);
  if (ms < HOUR_MS) return `${ms / MINUTE_MS} min`;
  const days = ms / DAY_MS;
  return days === 1 ? '1 day' : `${days} days`;
}

/**
 * Applies one answer to the item's schedule, in place (the C++ takes FSrsItemState&). Returns the same object.
 * Mirrors USrsScheduler::Update, SrsScheduler.cpp:46-65.
 * Note (carried over unchanged): a failed brand-new item goes from box 0 to box 1.
 */
export function update(state: SrsItemState, passed: boolean, assisted: boolean, nowMs: number): SrsItemState {
  if (!passed) {
    ++state.failures;
    state.box = 1;
  } else if (assisted) {
    ++state.passes;
    ++state.assistedPasses;
  } else {
    ++state.passes;
    state.box = Math.min(state.box + 1, MAX_BOX);
  }
  state.lastReviewUtcMs = nowMs;
  state.dueUtcMs = nowMs + getInterval(state.box);
  return state;
}

/** Mirrors USrsScheduler::IsDue, SrsScheduler.cpp:67-70. */
export function isDue(state: SrsItemState, nowMs: number): boolean {
  return state.dueUtcMs <= nowMs;
}

/** 0..1 for UI strength dots (Box / MaxBox). Mirrors USrsScheduler::GetStrength, SrsScheduler.cpp:72-75. */
export function getStrength(state: SrsItemState): number {
  return Math.min(Math.max(state.box / MAX_BOX, 0), 1);
}

/** FName equality is case-insensitive; city ids are FNames in the C++. */
function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** FString operator< is case-insensitive (Stricmp). Used for the deterministic key tie-break. */
function stringLess(a: string, b: string): boolean {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  return la < lb;
}

type Entry = [key: string, state: SrsItemState];
type Items = ReadonlyMap<string, SrsItemState>;

/**
 * Picks up to `max` item keys from one city (null = any city). Due items first (most overdue, then lowest box,
 * then key). If fillWithNotDue, tops up with the weakest non-due items (lowest box, most failures, soonest due, key).
 * Mirrors USrsScheduler::SelectReviewItems, SrsScheduler.cpp:77-128.
 */
export function selectReviewItems(items: Items, cityId: string | null, nowMs: number, max: number, fillWithNotDue: boolean): string[] {
  const due: Entry[] = [];
  const notDue: Entry[] = [];
  for (const [key, state] of items) {
    if (cityId !== null && !sameName(state.cityId, cityId)) continue;
    (isDue(state, nowMs) ? due : notDue).push([key, state]);
  }

  const cmp = (less: (a: Entry, b: Entry) => boolean) => (a: Entry, b: Entry) => (less(a, b) ? -1 : less(b, a) ? 1 : 0);

  // Most overdue first, then weakest; key as a final tie-break so the order is deterministic
  due.sort(cmp((a, b) => {
    if (a[1].dueUtcMs !== b[1].dueUtcMs) return a[1].dueUtcMs < b[1].dueUtcMs;
    if (a[1].box !== b[1].box) return a[1].box < b[1].box;
    return stringLess(a[0], b[0]);
  }));
  // Weakest first: lowest box, most failures, soonest due
  notDue.sort(cmp((a, b) => {
    if (a[1].box !== b[1].box) return a[1].box < b[1].box;
    if (a[1].failures !== b[1].failures) return a[1].failures > b[1].failures;
    if (a[1].dueUtcMs !== b[1].dueUtcMs) return a[1].dueUtcMs < b[1].dueUtcMs;
    return stringLess(a[0], b[0]);
  }));

  const out: string[] = [];
  for (const [key] of due) {
    if (out.length >= max) return out;
    out.push(key);
  }
  if (fillWithNotDue) {
    for (const [key] of notDue) {
      if (out.length >= max) break;
      out.push(key);
    }
  }
  return out;
}

/** Number of due items in a city (null = any city). Mirrors USrsScheduler::CountDue, SrsScheduler.cpp:130-141. */
export function countDue(items: Items, cityId: string | null, nowMs: number): number {
  let count = 0;
  for (const state of items.values()) {
    if ((cityId === null || sameName(state.cityId, cityId)) && isDue(state, nowMs)) ++count;
  }
  return count;
}

// ---- Item keys ------------------------------------------------------------------------------------------------

/** Identifies one reviewable challenge. Mirrors FSrsItemKey, SrsScheduler.h:10-38. */
export interface SrsItemKey {
  /** Soft object path of the conversation asset, e.g. "/Game/LinguaSpy/Data/French/DA_Conv_Cafe.DA_Conv_Cafe". */
  conversation: string;
  nodeId: string;
  /** -1 (INDEX_NONE) for PlayerChallenge nodes. */
  choiceIndex: number;
}

/**
 * Mirrors FSrsItemKey::IsValid (SrsScheduler.h:26). Simplification: FSoftObjectPath validity is approximated as
 * "non-empty and starts with '/'" (an asset path), and NAME_None as an empty or "None" node id.
 */
export function isValidItemKey(key: SrsItemKey): boolean {
  return key.conversation.startsWith('/') && key.nodeId !== '' && key.nodeId.toLowerCase() !== 'none';
}

/** Stable save key "<ConversationPath>#<NodeId>#<ChoiceIndex>". Mirrors FSrsItemKey::ToString, SrsScheduler.cpp:5-8. */
export function itemKeyToString(key: SrsItemKey): string {
  return `${key.conversation}#${key.nodeId}#${key.choiceIndex}`;
}

/** FCString::IsNumeric (Core/Public/Misc/CString.h:148-173) on a non-empty FString: optional sign, digits, at most one '.'. */
function isNumeric(s: string): boolean {
  if (s === '') return false;
  let i = s[0] === '-' || s[0] === '+' ? 1 : 0;
  let hasDot = false;
  for (; i < s.length; ++i) {
    const ch = s[i]!;
    if (ch === '.') {
      if (hasDot) return false;
      hasDot = true;
    } else if (ch < '0' || ch > '9') {
      return false;
    }
  }
  return true;
}

/** FCString::Atoi: leading integer part, 0 if none. */
function atoi(s: string): number {
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Inverse of itemKeyToString. Returns null for malformed keys. Splits from the right, so asset paths may contain
 * other characters, and "-1" parses (INDEX_NONE round-trips). Mirrors FSrsItemKey::Parse, SrsScheduler.cpp:10-31.
 */
export function parseItemKey(text: string): SrsItemKey | null {
  const last = text.lastIndexOf('#');
  if (last < 0) return null;
  const rest = text.slice(0, last);
  const choiceString = text.slice(last + 1);
  const mid = rest.lastIndexOf('#');
  if (mid < 0) return null;
  const path = rest.slice(0, mid);
  const node = rest.slice(mid + 1);
  if (path === '' || node === '' || choiceString === '') return null;
  if (!isNumeric(choiceString)) return null;
  const key: SrsItemKey = { conversation: path, nodeId: node, choiceIndex: atoi(choiceString) };
  return isValidItemKey(key) ? key : null;
}
