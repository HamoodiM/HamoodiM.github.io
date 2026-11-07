// LinguaSpy scaffold ladder: TypeScript port of UScaffoldPolicy (how much support a challenge gets).
// Source of truth: Source/Personal/LinguaSpy/Language/ScaffoldPolicy.cpp (and .h). Each function names the C++ lines
// it mirrors. Pure and deterministic (recognition options use a seeded port of FRandomStream).
//
// Level from SRS box: new / box 0 -> Assemble, box 1-2 -> AssemblePlus, box 3-4 -> GapFill, box 5 -> Produce.
// Each wrong attempt at the item earlier in the session steps down one level (minimum Recognize).
// Typing levels need typed input AND word spacing (LanguagePackAsset::CanType); otherwise capped at AssemblePlus.

import { grade, joinTokens, normalizeToken, isWhitespace, INDEX_NONE } from './grader.ts';
import type { GradeResult, WordTile, WordTileChallenge } from './grader.ts';
import type { SrsItemState } from './leitner.ts';

/** Mirrors EScaffoldLevel, ConversationTypes.h:272-284 (ordered from most to least support). */
export const ScaffoldLevel = {
  /** Pick which sentence matches the intent ("pick"). */
  Recognize: 0,
  /** Tiles without distractors ("tiles", ordering only). */
  Assemble: 1,
  /** Tiles with distractors ("tiles", the classic challenge). */
  AssemblePlus: 2,
  /** Model sentence with 1-2 key words blanked; type them ("gap words"). */
  GapFill: 3,
  /** Type the whole sentence ("typed"). */
  Produce: 4,
} as const;
export type ScaffoldLevel = (typeof ScaffoldLevel)[keyof typeof ScaffoldLevel];

/** Share of a challenge's cover penalty charged on the first (prompted) mistake. ScaffoldPolicy.h:28 (0.4f). */
export const PROMPT_PENALTY_SHARE = Math.fround(0.4);

/** Attempts per challenge visit: attempt 1 wrong -> prompt, attempt 2 wrong -> recast. ScaffoldPolicy.h:31. */
export const MAX_ATTEMPTS = 2;

/** The language-pack flags that gate typing. Mirrors the two ULanguagePackAsset fields (LanguagePackAsset.h:75,83). */
export interface LanguageTyping {
  /** False for languages written without spaces between words (Japanese). */
  usesWordSpacing: boolean;
  /** Allows the typing scaffolds (gap-fill / produce). */
  allowTypedInput: boolean;
}

/** Mirrors ULanguagePackAsset::CanType, LanguagePackAsset.h:93: bAllowTypedInput && bUsesWordSpacing (no IME support yet). */
export function canType(pack: LanguageTyping): boolean {
  return pack.allowTypedInput && pack.usesWordSpacing;
}

/**
 * Picks the exercise. state may be null (never seen). sessionErrors = wrong attempts at this item earlier in the session.
 * Mirrors UScaffoldPolicy::ChooseLevel, ScaffoldPolicy.cpp:10-33.
 */
export function chooseLevel(state: Pick<SrsItemState, 'box'> | null, sessionErrors: number, typingAllowed: boolean): ScaffoldLevel {
  let level: number = ScaffoldLevel.Assemble;
  const box = state ? state.box : 0;
  if (box >= 5) level = ScaffoldLevel.Produce;
  else if (box >= 3) level = ScaffoldLevel.GapFill;
  else if (box >= 1) level = ScaffoldLevel.AssemblePlus;

  if (!typingAllowed) level = Math.min(level, ScaffoldLevel.AssemblePlus);
  level = Math.max(level - Math.max(sessionErrors, 0), ScaffoldLevel.Recognize);
  return level as ScaffoldLevel;
}

/** TArray::RemoveSingle on normalized strings: removes the first match, returns whether one was removed. */
function removeSingle(list: string[], value: string): boolean {
  const i = list.indexOf(value);
  if (i < 0) return false;
  list.splice(i, 1);
  return true;
}

/**
 * Tiles to show: Assemble = only the first answer's tiles (as a multiset, no distractors); other levels = all tiles.
 * Mirrors UScaffoldPolicy::BuildTiles, ScaffoldPolicy.cpp:35-57.
 */
export function buildTiles(challenge: WordTileChallenge, level: ScaffoldLevel): WordTile[] {
  if (level !== ScaffoldLevel.Assemble || challenge.acceptedAnswers.length === 0) return challenge.tiles.slice();
  const needed = challenge.acceptedAnswers[0]!.map(normalizeToken);
  const out = challenge.tiles.filter((tile) => removeSingle(needed, normalizeToken(tile.text)));
  return out.length === 0 ? challenge.tiles.slice() : out;
}

/**
 * Token indices to blank for GapFill: authored (valid, unique, sorted), else the longest token(s) of the first answer
 * (ties -> later word; two gaps for answers of 6+ tokens). Mirrors UScaffoldPolicy::GetGapIndices, ScaffoldPolicy.cpp:59-96.
 */
export function getGapIndices(challenge: WordTileChallenge): number[] {
  const gaps: number[] = [];
  const len = challenge.acceptedAnswers.length === 0 ? 0 : challenge.acceptedAnswers[0]!.length;
  for (const gap of challenge.gapTokenIndices ?? []) {
    if (gap >= 0 && gap < len && !gaps.includes(gap)) gaps.push(gap);
  }
  if (gaps.length > 0 || len === 0) return gaps.sort((a, b) => a - b);

  // Automatic: the longest words carry the most meaning (ties -> later word, usually the content word)
  const tokens = challenge.acceptedAnswers[0]!;
  const order = Array.from({ length: len }, (_, i) => i);
  order.sort((a, b) => {
    const la = tokens[a]!.length;
    const lb = tokens[b]!.length;
    return la !== lb ? lb - la : b - a;
  });
  const count = len >= 6 ? 2 : 1;
  for (let i = 0; i < count && i < order.length; ++i) gaps.push(order[i]!);
  return gaps.sort((a, b) => a - b);
}

/** The first answer with gaps replaced by "____". Mirrors UScaffoldPolicy::BuildGapDisplay, ScaffoldPolicy.cpp:98-110. */
export function buildGapDisplay(challenge: WordTileChallenge, useSpaces: boolean): string {
  if (challenge.acceptedAnswers.length === 0) return '';
  const tokens = challenge.acceptedAnswers[0]!.slice();
  for (const gap of getGapIndices(challenge)) tokens[gap] = '____';
  return joinTokens(tokens, useSpaces);
}

/** FString::TrimStartAndEnd (FChar::IsWhitespace on both ends). */
function trimWhitespace(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && isWhitespace(s.charCodeAt(start))) ++start;
  while (end > start && isWhitespace(s.charCodeAt(end - 1))) --end;
  return s.slice(start, end);
}

/** First answer with the typed gap words put back in (for grading). Mirrors UScaffoldPolicy::FillGaps, ScaffoldPolicy.cpp:112-125. */
export function fillGaps(challenge: WordTileChallenge, typedGapWords: readonly string[]): string[] {
  if (challenge.acceptedAnswers.length === 0) return typedGapWords.slice();
  const tokens = challenge.acceptedAnswers[0]!.slice();
  const gaps = getGapIndices(challenge);
  for (let i = 0; i < gaps.length; ++i) {
    tokens[gaps[i]!] = i < typedGapWords.length ? trimWhitespace(typedGapWords[i]!) : '';
  }
  return tokens;
}

/**
 * Bit-exact port of UE's FRandomStream (Engine/Source/Runtime/Core/Public/Math/RandomStream.h): a 32-bit LCG,
 * Seed = Seed * 196314165 + 907633515, fraction from the top 23 bits.
 */
export class RandomStream {
  private seed: number;
  constructor(seed: number) {
    this.seed = seed >>> 0; // Initialize: Seed = uint32(InSeed)
  }
  private mutateSeed(): void {
    this.seed = (Math.imul(this.seed, 196314165) + 907633515) >>> 0;
  }
  /** [0, 1) as a float: bits 0x3F800000 | (Seed >> 9) minus 1.0f, i.e. exactly (Seed >> 9) / 2^23. */
  getFraction(): number {
    this.mutateSeed();
    return (this.seed >>> 9) / 8388608;
  }
  /** TruncToInt(GetFraction() * float(A)), with float32 rounding of the product like the C++. */
  randHelper(a: number): number {
    return a > 0 ? Math.trunc(Math.fround(this.getFraction() * Math.fround(a))) : 0;
  }
  randRange(min: number, max: number): number {
    return min + this.randHelper(max - min + 1);
  }
}

/** FString == is case-insensitive; TArray<FString>::Contains / IndexOfByKey / AddUnique use it. */
function sameText(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export interface RecognitionOptions {
  options: string[];
  correctIndex: number;
}

/**
 * Recognition options (target language): the model answer plus up to 2 wrong sentences (authored, else made by
 * swapping a distractor tile into the answer, else by swapping two adjacent words). Each wrong candidate is graded
 * to make sure it is not accidentally accepted. Shuffled with the seed.
 * Mirrors UScaffoldPolicy::BuildRecognitionOptions, ScaffoldPolicy.cpp:127-210 (same RNG call order).
 */
export function buildRecognitionOptions(challenge: WordTileChallenge, useSpaces: boolean, seed: number): RecognitionOptions {
  if (challenge.acceptedAnswers.length === 0) return { options: [], correctIndex: INDEX_NONE };

  const model = challenge.acceptedAnswers[0]!;
  const correct = joinTokens(model, useSpaces);
  const isAccepted = (tokens: readonly string[]) => grade(challenge, tokens).passed;
  const contains = (list: readonly string[], s: string) => list.some((x) => sameText(x, s));

  const wrong: string[] = [];
  for (const authored of challenge.recognitionDistractors ?? []) {
    if (authored !== '' && !sameText(authored, correct) && wrong.length < 2 && !contains(wrong, authored)) {
      wrong.push(authored);
    }
  }

  const random = new RandomStream(seed);

  // Swap one distractor tile into the answer: "je voudrais un thé" for "je voudrais un café"
  if (wrong.length < 2) {
    const neededNorm = model.map(normalizeToken);
    const distractors: string[] = [];
    for (const tile of challenge.tiles) {
      if (!removeSingle(neededNorm, normalizeToken(tile.text))) distractors.push(tile.text);
    }
    for (let d = 0; d < distractors.length && wrong.length < 2; ++d) {
      // Try each position, starting from a seeded one, until the result is not an accepted answer
      const start = random.randRange(0, model.length - 1);
      for (let offset = 0; offset < model.length; ++offset) {
        const candidate = model.slice();
        candidate[(start + offset) % model.length] = distractors[d]!;
        const joined = joinTokens(candidate, useSpaces);
        if (!sameText(joined, correct) && !contains(wrong, joined) && !isAccepted(candidate)) {
          wrong.push(joined);
          break;
        }
      }
    }
  }

  // Last resort: wrong word order
  for (let i = 0; i + 1 < model.length && wrong.length < 2; ++i) {
    const candidate = model.slice();
    [candidate[i], candidate[i + 1]] = [candidate[i + 1]!, candidate[i]!];
    const joined = joinTokens(candidate, useSpaces);
    if (!sameText(joined, correct) && !contains(wrong, joined) && !isAccepted(candidate)) wrong.push(joined);
  }

  const options = wrong.slice();
  options.push(correct);
  for (let i = options.length - 1; i > 0; --i) {
    const j = random.randRange(0, i);
    [options[i], options[j]] = [options[j]!, options[i]!];
  }
  return { options, correctIndex: options.findIndex((o) => sameText(o, correct)) };
}

/**
 * Passing with this much support doesn't promote the SRS item (recognition, or a second attempt after a prompt).
 * Mirrors UScaffoldPolicy::IsAssistedPass, ScaffoldPolicy.cpp:212-215.
 */
export function isAssistedPass(level: ScaffoldLevel, attempt: number): boolean {
  return level === ScaffoldLevel.Recognize || attempt > 1;
}

/** Text of the accent hint (ScaffoldPolicy.cpp:221, LOCTEXT "AccentHint"). */
export const ACCENT_HINT = 'So close - the words are right. Check the accents.';

/**
 * Hint after a wrong attempt: accent hint, then the authored hint for the first wrong token, then a general hint,
 * then a length hint (only if the closest answer is the model answer), then a generic one.
 * Mirrors UScaffoldPolicy::ChooseHint, ScaffoldPolicy.cpp:217-243.
 */
export function chooseHint(challenge: WordTileChallenge, result: GradeResult, submittedTokens: number): string {
  if (result.accentOnly) return ACCENT_HINT;
  const hints = challenge.hints ?? [];
  for (const hint of hints) {
    if (hint.tokenIndex >= 0 && hint.tokenIndex === result.firstWrongIndex && hint.text !== '') return hint.text;
  }
  for (const hint of hints) {
    if (hint.tokenIndex < 0 && hint.text !== '') return hint.text;
  }
  const expected = challenge.acceptedAnswers.length === 0 ? 0 : challenge.acceptedAnswers[0]!.length;
  if (expected > 0 && submittedTokens !== expected && result.closestAnswerIndex === 0) {
    return `Not quite. The phrase has ${expected} ${expected === 1 ? 'word' : 'words'}.`;
  }
  return 'Not quite. Look at the highlighted word and try again.';
}

/** Display name for UI/telemetry. Mirrors UScaffoldPolicy::LevelName, ScaffoldPolicy.cpp:245-256. */
export function levelName(level: ScaffoldLevel): string {
  switch (level) {
    case ScaffoldLevel.Recognize: return 'Recognize';
    case ScaffoldLevel.Assemble: return 'Assemble';
    case ScaffoldLevel.AssemblePlus: return 'AssemblePlus';
    case ScaffoldLevel.GapFill: return 'GapFill';
    case ScaffoldLevel.Produce: return 'Produce';
  }
  return 'Unknown';
}
