// LinguaSpy feedback ladder and cover meter: TypeScript port of the rules in UConversationSubsystem::ApplyGrade and
// UCoverComponent. Sources: Source/Personal/LinguaSpy/Dialogue/ConversationSubsystem.cpp:449-535 and
// Cover/CoverComponent.cpp. Pure: applyGrade() returns a decision; the caller applies it.
//
// In the game ApplyGrade is a method on a 900-line subsystem that also does telemetry, mission tallies and audio.
// Only the rules that decide the outcome are ported here: prompt vs final, assisted vs unaided, accent pass,
// cover penalty split (40% on the prompt, 60% on the recast), cover recovery on a pass, and the SRS record.

import type { GradeResult, WordTileChallenge } from './grader.ts';
import { chooseHint, isAssistedPass, MAX_ATTEMPTS, PROMPT_PENALTY_SHARE, ScaffoldLevel } from './scaffold.ts';

/** UCoverComponent::MaxCover default, CoverComponent.h:49. */
export const MAX_COVER = 100;
/** UConversationSubsystem::CoverRecoveryOnPass default, ConversationSubsystem.h:273. */
export const COVER_RECOVERY_ON_PASS = 5;
/** FWordTileChallenge::CoverPenalty default, ConversationTypes.h:77. */
export const DEFAULT_COVER_PENALTY = 25;
/** Hint shown when a typed answer is accepted despite accents (ConversationSubsystem.cpp:498). */
export const ACCENT_PASS_HINT = 'Accepted - but watch the accents.';

/** The spy's cover meter. Mirrors UCoverComponent, CoverComponent.cpp:5-43 (float math via Math.fround). */
export class CoverMeter {
  readonly max: number;
  private value: number;
  private readonly onChange: ((cover: number, max: number) => void) | undefined;
  private readonly onBlown: (() => void) | undefined;

  constructor(max = MAX_COVER, onChange?: (cover: number, max: number) => void, onBlown?: () => void) {
    this.max = Math.max(1, max);
    this.value = this.max;
    this.onChange = onChange;
    this.onBlown = onBlown;
  }

  get cover(): number {
    return this.value;
  }

  /** Mirrors UCoverComponent::IsBlown, CoverComponent.h:44. */
  isBlown(): boolean {
    return this.value <= 0;
  }

  /** Mirrors UCoverComponent::ApplyPenalty, CoverComponent.cpp:16-27: no-op once blown; fires onBlown on reaching 0. */
  applyPenalty(amount: number): void {
    if (this.isBlown()) return;
    this.set(Math.fround(this.value - Math.max(0, amount)));
    if (this.isBlown()) this.onBlown?.();
  }

  /** Mirrors UCoverComponent::Recover, CoverComponent.cpp:29-32. */
  recover(amount: number): void {
    this.set(Math.fround(this.value + Math.max(0, amount)));
  }

  /** Mirrors UCoverComponent::ResetCover, CoverComponent.cpp:34-37. */
  reset(): void {
    this.set(this.max);
  }

  /** Mirrors UCoverComponent::SetCover, CoverComponent.cpp:39-43: clamp, then broadcast. */
  private set(next: number): void {
    this.value = Math.min(Math.max(next, 0), this.max);
    this.onChange?.(this.value, this.max);
  }
}

/** The part of FChallengePresentation that the rules read. */
export interface Presentation {
  level: ScaffoldLevel;
  /** 1-based attempt at this visit. */
  attempt: number;
}

export interface LadderContext {
  challenge: WordTileChallenge;
  presentation: Presentation;
  /** Number of tokens the player submitted (0 for recognition). */
  submittedTokens: number;
  /** The player revealed the handler's translation of this line (UConversationSubsystem::IsPeeked). */
  peeked: boolean;
}

/** What the caller should do after a graded attempt. Mirrors FAnswerFeedback plus the side effects of ApplyGrade. */
export interface LadderDecision {
  /** The grade after the accent-pass rule (passed may have been flipped to true). */
  grade: GradeResult;
  /** false = prompt (hint, try again); true = pass or recast. */
  final: boolean;
  /** Final pass that does not promote the SRS item. */
  assisted: boolean;
  /** Typed answer accepted on the last attempt despite wrong accents. */
  accentPass: boolean;
  /** Hint on a prompt, or the accent-pass note on a final pass. Empty otherwise. */
  hint: string;
  /** Cover change: negative = penalty, positive = recovery. */
  coverDelta: number;
  /** Add one to this item's session-error count (feeds chooseLevel next visit). */
  sessionError: boolean;
  /** Record to the scheduler: present only on a final answer. */
  srs: { passed: boolean; assisted: boolean } | null;
  /** Attempt number for the next try (unchanged on a final). */
  nextAttempt: number;
}

/**
 * Turns a raw grade into game rules, for a challenge inside a conversation (cover applies).
 * Mirrors UConversationSubsystem::ApplyGrade, ConversationSubsystem.cpp:449-535, and the SRS flag passed by
 * RecordFinal (:538-568). Not ported: telemetry, mission tallies, audio, debrief/practice modes, review de-duplication.
 */
export function applyGrade(input: GradeResult, ctx: LadderContext): LadderDecision {
  const { challenge, presentation, peeked } = ctx;
  const penalty = challenge.coverPenalty ?? DEFAULT_COVER_PENALTY;

  // Typed answers that are right apart from accents: the first try gets the accent hint; on the last try it passes
  // as assisted (the learner knows the words; the keyboard is the problem, not the French)  [:453-461]
  const grade: GradeResult = { ...input, tileCorrect: input.tileCorrect.slice() };
  const typed = presentation.level === ScaffoldLevel.GapFill || presentation.level === ScaffoldLevel.Produce;
  const accentPass = typed && grade.accentOnly && presentation.attempt >= MAX_ATTEMPTS;
  if (accentPass) grade.passed = true;

  if (!grade.passed && presentation.attempt < MAX_ATTEMPTS) {
    // Feedback ladder step 1: prompt (hint, part of the penalty), and the player tries again  [:468-489]
    return {
      grade,
      final: false,
      assisted: false,
      accentPass: false,
      hint: chooseHint(challenge, grade, ctx.submittedTokens),
      coverDelta: -Math.fround(penalty * PROMPT_PENALTY_SHARE),
      sessionError: true,
      srs: null,
      nextAttempt: presentation.attempt + 1,
    };
  }

  // Final: pass (maybe assisted), or the recast with the model answer  [:491-535]
  const assisted = grade.passed && (isAssistedPass(presentation.level, presentation.attempt) || peeked);
  const share = presentation.attempt > 1 ? Math.fround(1 - PROMPT_PENALTY_SHARE) : 1;
  return {
    grade,
    final: true,
    assisted: assisted || accentPass,
    accentPass,
    hint: accentPass ? ACCENT_PASS_HINT : '',
    coverDelta: grade.passed ? COVER_RECOVERY_ON_PASS : -Math.fround(penalty * share),
    sessionError: !grade.passed,
    srs: { passed: grade.passed, assisted: assisted || accentPass },
    nextAttempt: presentation.attempt,
  };
}
