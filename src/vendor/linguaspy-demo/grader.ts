// LinguaSpy sentence grader: TypeScript port of USentenceGrader.
// Source of truth: Source/Personal/LinguaSpy/Language/SentenceGrader.cpp (and .h) in the UE5 project.
// Every function names the C++ lines it mirrors. Pure and deterministic: no DOM, no clock, no randomness.
//
// Comparison ignores case, surrounding whitespace/punctuation and apostrophe style, but accents are
// significant ("café" != "cafe"). When an answer fails only because of accents, the result says so.

/** One word (or word chunk, for languages without spaces) offered as a tile. Mirrors FWordTile (ConversationTypes.h:11-23). */
export interface WordTile {
  text: string;
  /** Optional reading / romanization (e.g. "koohii"). */
  reading?: string;
}

/** Feedback-ladder hint. Mirrors FChallengeHint (ConversationTypes.h:29-41). tokenIndex -1 = general hint. */
export interface ChallengeHint {
  tokenIndex: number;
  text: string;
}

/**
 * A reply the player builds. Mirrors FWordTileChallenge (ConversationTypes.h:54-101).
 * Simplification: TArray<FAcceptedAnswer> (each with .Tokens) is flattened to string[][].
 */
export interface WordTileChallenge {
  intentPrompt?: string;
  tiles: WordTile[];
  /** Every word order that counts as correct. The first entry is the model answer. */
  acceptedAnswers: string[][];
  skillTag?: string;
  /** Cover lost on a wrong answer. C++ default 25 (ConversationTypes.h:77). */
  coverPenalty?: number;
  hints?: ChallengeHint[];
  gapTokenIndices?: number[];
  recognitionDistractors?: string[];
}

/** Mirrors FGradeResult (ConversationTypes.h:243-265). INDEX_NONE is -1. */
export interface GradeResult {
  passed: boolean;
  /** Per submitted token: true if it matches the closest accepted answer at that position. */
  tileCorrect: boolean[];
  /** Index into acceptedAnswers of the closest answer, -1 if none. */
  closestAnswerIndex: number;
  /** Failed, but would pass if accents were ignored. */
  accentOnly: boolean;
  /** First wrong token (or first missing position), -1 if passed. */
  firstWrongIndex: number;
}

export const INDEX_NONE = -1;

/**
 * FChar::IsWhitespace for wide chars calls ::iswspace (Core/Public/Misc/Char.h:282-291), whose exact table is
 * CRT-dependent. This is the Unicode White_Space set, which is what iswspace reports for the characters
 * that matter here (ASCII space/tab/newlines, NBSP, U+3000 ideographic space).
 */
export function isWhitespace(c: number): boolean {
  return (
    (c >= 0x09 && c <= 0x0d) || c === 0x20 || c === 0x85 || c === 0xa0 || c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000
  );
}

/** Mirrors IsStrippablePunctuation, SentenceGrader.cpp:7-22. */
function isStrippablePunctuation(c: number): boolean {
  switch (c) {
    case 0x2c: case 0x2e: case 0x21: case 0x3f: // , . ! ?
    case 0x3b: case 0x3a: case 0x22: // ; : "
    case 0x00ab: case 0x00bb: case 0x00bf: case 0x00a1: // « » ¿ ¡
    // Japanese / full-width punctuation
    case 0x3002: case 0x3001: case 0xff01: case 0xff1f: // 。 、 ！ ？
    case 0x300c: case 0x300d: case 0x3000: case 0xff0c: // 「 」 full-width space ，
    case 0x2026: // …
      return true;
    default:
      return isWhitespace(c);
  }
}

/**
 * Normalizes a single token for comparison. Mirrors USentenceGrader::NormalizeToken, SentenceGrader.cpp:25-38.
 * Trims punctuation/whitespace from both ends, lowercases (FText::ToLower is Unicode-aware; String#toLowerCase
 * is the JS equivalent), and maps typographic apostrophes (U+2019, U+2018) to a straight one.
 */
export function normalizeToken(token: string): string {
  let start = 0;
  let end = token.length;
  while (start < end && isStrippablePunctuation(token.charCodeAt(start))) ++start;
  while (end > start && isStrippablePunctuation(token.charCodeAt(end - 1))) --end;
  return token.slice(start, end).toLowerCase().replaceAll('’', "'").replaceAll('‘', "'");
}

/** Latin-1 Supplement + Latin Extended-A fold table, verbatim from SentenceGrader.cpp:44. */
const FOLD_TABLE: ReadonlyMap<number, string> = new Map<number, string>([
  [0x00e0, 'a'], [0x00e1, 'a'], [0x00e2, 'a'], [0x00e3, 'a'], [0x00e4, 'a'], [0x00e5, 'a'],
  [0x00e8, 'e'], [0x00e9, 'e'], [0x00ea, 'e'], [0x00eb, 'e'],
  [0x00ec, 'i'], [0x00ed, 'i'], [0x00ee, 'i'], [0x00ef, 'i'],
  [0x00f2, 'o'], [0x00f3, 'o'], [0x00f4, 'o'], [0x00f5, 'o'], [0x00f6, 'o'],
  [0x00f9, 'u'], [0x00fa, 'u'], [0x00fb, 'u'], [0x00fc, 'u'],
  [0x00fd, 'y'], [0x00ff, 'y'], [0x00f1, 'n'], [0x00e7, 'c'], [0x0153, 'o'], [0x00e6, 'a'],
  [0x00c0, 'A'], [0x00c1, 'A'], [0x00c2, 'A'], [0x00c3, 'A'], [0x00c4, 'A'], [0x00c5, 'A'],
  [0x00c8, 'E'], [0x00c9, 'E'], [0x00ca, 'E'], [0x00cb, 'E'],
  [0x00cc, 'I'], [0x00cd, 'I'], [0x00ce, 'I'], [0x00cf, 'I'],
  [0x00d2, 'O'], [0x00d3, 'O'], [0x00d4, 'O'], [0x00d5, 'O'], [0x00d6, 'O'],
  [0x00d9, 'U'], [0x00da, 'U'], [0x00db, 'U'], [0x00dc, 'U'],
  [0x00dd, 'Y'], [0x00d1, 'N'], [0x00c7, 'C'],
]);

/**
 * Removes diacritics from Latin letters ("café" -> "cafe") for the accent-only hint; non-Latin text is unchanged.
 * Mirrors USentenceGrader::FoldAccents, SentenceGrader.cpp:40-62 (per UTF-16 code unit, like TCHAR).
 */
export function foldAccents(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; ++i) {
    const c = text.charCodeAt(i);
    out += c < 0x00c0 ? text[i] : (FOLD_TABLE.get(c) ?? text[i]);
  }
  return out;
}

/**
 * Splits typed input into tokens on whitespace (keeps elisions like "s'il" whole) and drops punctuation-only
 * tokens ("Bonjour !" -> ["Bonjour"]). Mirrors USentenceGrader::TokenizeTyped, SentenceGrader.cpp:64-90.
 */
export function tokenizeTyped(text: string): string[] {
  const tokens: string[] = [];
  let current = '';
  for (let i = 0; i < text.length; ++i) {
    const c = text.charCodeAt(i);
    if (isWhitespace(c) || c === 0x3000) {
      if (current !== '') {
        tokens.push(current);
        current = '';
      }
    } else {
      current += text[i];
    }
  }
  if (current !== '') tokens.push(current);
  return tokens.filter((t) => normalizeToken(t) !== '');
}

/**
 * Grades the player's tokens against every accepted answer, word by word, position by position.
 * Mirrors USentenceGrader::Grade, SentenceGrader.cpp:92-168:
 *  - score = matching positions minus |length difference|; an exact match wins immediately;
 *  - otherwise the best-scoring answer supplies tileCorrect / closestAnswerIndex;
 *  - on a fail, firstWrongIndex is the first wrong token or, if all placed tokens are right, the first missing one;
 *  - accentOnly is set if some same-length answer matches once accents are folded on both sides.
 */
export function grade(challenge: WordTileChallenge, playerTokens: readonly string[]): GradeResult {
  const result: GradeResult = {
    passed: false,
    tileCorrect: new Array<boolean>(playerTokens.length).fill(false),
    closestAnswerIndex: INDEX_NONE,
    accentOnly: false,
    firstWrongIndex: INDEX_NONE,
  };

  const player = playerTokens.map(normalizeToken);

  let bestScore = -1;
  const answers = challenge.acceptedAnswers;
  for (let answerIndex = 0; answerIndex < answers.length; ++answerIndex) {
    const answer = answers[answerIndex]!;

    const correct = new Array<boolean>(player.length).fill(false);
    let score = 0;
    for (let i = 0; i < player.length; ++i) {
      if (i < answer.length && player[i] === normalizeToken(answer[i]!)) {
        correct[i] = true;
        ++score;
      }
    }

    const exact = score === answer.length && player.length === answer.length && answer.length > 0;
    // Penalize length mismatch so the closest answer is also the closest in size
    score -= Math.abs(answer.length - player.length);

    if (exact || score > bestScore) {
      bestScore = score;
      result.closestAnswerIndex = answerIndex;
      result.tileCorrect = correct;
      result.passed = exact;
    }
    if (exact) break;
  }

  if (!result.passed) {
    result.firstWrongIndex = result.tileCorrect.indexOf(false);
    if (result.firstWrongIndex === INDEX_NONE) {
      // Every placed token is right but something is missing
      result.firstWrongIndex = player.length;
    }

    // Would it pass without accents? Then the learner knows the words and only needs the accent hint.
    for (const answer of answers) {
      if (answer.length !== player.length || answer.length === 0) continue;
      let match = true;
      for (let i = 0; i < player.length && match; ++i) {
        match = foldAccents(player[i]!) === foldAccents(normalizeToken(answer[i]!));
      }
      if (match) {
        result.accentOnly = true;
        break;
      }
    }
  }

  return result;
}

/**
 * Joins tokens into a display sentence. Elided words are single tiles ("s'il", "d'acqua"), so joining is just
 * spaces, or nothing for languages without word spacing. Mirrors USentenceGrader::JoinTokens, SentenceGrader.cpp:170-174.
 */
export function joinTokens(tokens: readonly string[], useSpaces = true): string {
  return tokens.join(useSpaces ? ' ' : '');
}
