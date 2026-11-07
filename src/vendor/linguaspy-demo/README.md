# linguaspy-demo

A small interactive web demo of LinguaSpy's learning core: the sentence grader, the Leitner spaced-repetition
scheduler, the scaffold policy that picks the exercise from the Leitner box, and the cover meter. Everything is a
TypeScript port of the UE5 C++ in `C:\UnrealEngineProjects\Personal\Source\Personal\LinguaSpy\`. The data is the game's
real content.

**Label for the site to show:**

> TypeScript port of the game's C++ grader and scheduler, tested against the same cases.

## Files

| File | What it is | C++ source it mirrors |
| --- | --- | --- |
| `grader.ts` | normalize, fold accents, tokenize, grade, join | `Language/SentenceGrader.cpp` |
| `leitner.ts` | intervals, update, isDue, strength, review selection, item keys | `Language/SrsScheduler.cpp/.h` |
| `scaffold.ts` | chooseLevel, tiles, gaps, recognition options, hints, `canType`, an `FRandomStream` port | `Language/ScaffoldPolicy.cpp/.h`, `LanguagePackAsset.h:93` |
| `ladder.ts` | feedback ladder (prompt or recast, assisted or not, accent pass) and the cover meter | `Dialogue/ConversationSubsystem.cpp:449-535`, `Cover/CoverComponent.cpp` |
| `widget.ts` | `mountLinguaSpyDemo()`: the DOM widget | presentation follows `UI/ConversationWidget.cpp` |
| `phrases.json` | 10 real items (6 Paris, 4 Tokyo), each with a `source` script path and line range | `Tools/Content/paris_content.py`, `tokyo_content.py` |
| `*.test.ts` | 70 tests (`node --test`) | `Tests/*.cpp` |
| `demo.html`, `demo.css` | standalone test page | |

Each function in the ported files has a comment with the C++ file and line range it mirrors. They are pure and
deterministic: no DOM, no clock (the caller passes `now`), and seeded randomness only.

## Commands

```sh
npm install        # dev-only: typescript, @types/node
npm test           # type-checks, then runs: node --test "*.test.ts"  (Node >= 22.18 runs .ts directly)
npm run build      # tsc -> dist/ (ES modules, .ts imports rewritten to .js, phrases.json copied)
npm run size       # raw and gzipped size of dist/
```

To view the standalone demo, serve the folder (`python -m http.server 8000`) and open `/demo.html`. Add `?city=tokyo`
to start in Tokyo. The demo needs `npm run build` first because it loads `dist/widget.js`.

## API

```ts
import { mountLinguaSpyDemo } from './widget.ts';

const demo = mountLinguaSpyDemo(rootEl, {
  city: 'paris',             // 'paris' | 'tokyo' (default 'paris')
  onEvent: (e) => { ... },   // optional
  now: () => Date.now(),     // optional clock; the fast-forward offset is added on top
});
demo.destroy();              // removes listeners and the widget's DOM
```

The widget appends one `div.ls-demo` to `root` and never touches anything else. It has no timers or animation loop and
only re-renders on visitor input. The pure modules can also be imported directly (`grade`, `update`, `chooseLevel`, ...).

`widget.ts` imports `./phrases.json` with `with { type: 'json' }`, which works in Vite/Astro, Node and current browsers.

### Events (`onEvent`)

| `type` | When | Payload |
| --- | --- | --- |
| `challenge` | a phrase is shown | `itemId, city, level, box` (`box` is `null` for a never-seen item) |
| `graded` | after every attempt | `itemId, level, attempt, passed, final, assisted, accentOnly, hint, words[{text, state}], modelAnswer` |
| `cover-change` | cover changes (also on a no-op recover at max, like the C++ broadcast) | `cover, max, ratio, delta, band, blown` |
| `box-move` | a final answer is recorded | `itemId, from, to, dueAt, reason: 'promoted' \| 'kept' \| 'reset'` |
| `time` | the clock is fast-forwarded | `offsetMs, now, dueCount` |
| `city-change` | city switched | `city` |

`level` is one of `recognize` (pick), `assemble` (tiles, no distractors), `assemble-plus` (tiles with distractors),
`gap-fill` (type the gap words), `produce` (type the whole reply).

### DOM hooks

Root: `.ls-demo` with `data-state` = `idle | answering | prompted | passed | failed`, plus `data-level`, `data-city`,
`data-cover` (`high | mid | low | blown`), `data-due` (due count), and `data-peeked`.

| Class | Element |
| --- | --- |
| `ls-demo__cities`, `__city` (`aria-pressed`, `__city--active`) | city switcher |
| `__npc`, `__speaker`, `__prompt` (the NPC line), `__reading` (romaji), `__peek`, `__translation` | NPC panel |
| `__answer` (form), `__task` (intent), `__level` (exercise label), `__stage` | answer panel |
| `__options` > `__option` (`--ok`, `--wrong`) | pick level |
| `__line` > `__word` (`--ok`, `--wrong`, `--accent`); `__tiles` > `__tile` (`data-state="free \| placed"`), `__tile-text`, `__tile-reading` | tile levels |
| `__typing`, `__input`, `__input--gap`, `__gap-word`, `__keys` > `__key` | typed levels (French accent keys) |
| `__actions`, `__submit`, `__clear`, `__continue` | buttons |
| `__feedback` (`data-state="hint \| pass \| assisted \| fail \| info"`, `aria-live`), `__graded` > `__word--ok/--wrong/--accent`, `__message` | feedback |
| `__cover-meter` (`role="meter"`, `data-state` = band, CSS var `--ls-cover` 0..1), `__cover-track`, `__cover-fill`, `__cover-value` | cover meter |
| `__srs`, `__boxes` > `__box` (`data-box`, `data-count`, `__box--active`), `__box-name`, `__box-interval`, `__box-items` > `__chip` (`data-due`, `__chip--current`) | the 6 Leitner boxes |
| `__unseen` (`data-count`), `__clock`, `__time`, `__ff`, `__ff--next` | not-seen count and the fast-forward controls |

Everything is a native `<button>` or `<input>` inside a `<form>`, so it works with Tab, Enter and Space. After a tile is
placed, focus moves to the next free tile, then to Answer. After a final answer, focus moves to Continue. Placed tiles
stay in the bank as disabled (`data-state="placed"`), so the layout doesn't jump.

## How the demo flow maps to the game

1. The next phrase is the most overdue due item (`selectReviewItems`), or else the next unseen one in authored order.
2. The exercise is `chooseLevel(box, sessionErrors, canType(city))`: box 0 gives tiles without distractors, boxes 1-2
   tiles with distractors, 3-4 gap words, 5 the whole reply typed. Each earlier mistake on the item steps it down one
   level, down to picking the sentence. Tokyo is capped at tiles because `bAllowTypedInput && bUsesWordSpacing` is false
   (Japanese has no word spacing and the game has no IME support).
3. The grade gives word-level feedback. The first wrong attempt gets a hint and loses 40% of the phrase's cover penalty.
   The second wrong attempt shows the model answer and loses the other 60%. A pass recovers 5 cover.
4. The final result updates the Leitner box. An unaided pass moves the item up one box. A pass after a hint, after
   peeking at the translation, or at the pick level keeps the box and reschedules it. A fail sends it to box 1. The
   waits are 10 min, 1 day, 3, 7 and 21 days.
5. The clock buttons (+10 min, +1 day, +1 week, skip to next review) add an offset to the clock, like the game's
   `DebugTimeOffset`, so items come due.

## Ported faithfully

- Grader: the same punctuation table (including Japanese and full-width characters), Unicode lowercasing, typographic
  apostrophes, the per-position score with the length penalty, early exit on an exact match, `firstWrongIndex`, the
  accent-only check, and the same fold table.
- Scheduler: the same constants and promotion and demotion rules. `IsDue` uses `<=`. The review sort orders and their
  tie-breaks are the same, and key comparisons are case-insensitive like `FString` and `FName`. Key format and parsing
  match, including `FCString::IsNumeric`.
- Scaffold: the level thresholds, the typing cap, the error step-down, multiset tile filtering, automatic and authored
  gaps, recognition options (the same algorithm and the same RNG call order, with a bit-exact `FRandomStream` LCG), the
  assisted-pass rule, the hint priority and the hint strings.
- Feedback ladder and cover: `PromptPenaltyShare = 0.4f`, `MaxAttempts = 2`, the accent pass on the last typed attempt,
  `CoverRecoveryOnPass = 5`, `MaxCover = 100`, clamping, "no penalty once blown", and float32 cover math.
- A known quirk is kept on purpose (and covered by a test): a failed brand-new item goes from box 0 to box 1, which
  the scaffold policy treats as stronger.

## Simplified or approximated (honest list)

- **Time** is Unix milliseconds, not `FDateTime` ticks. All intervals are whole milliseconds, so the arithmetic is exact.
- **Whitespace**: `FChar::IsWhitespace` calls the CRT's `iswspace`, whose table is platform-dependent. The port uses the
  Unicode White_Space set. **Lowercasing** uses JS `toLowerCase` instead of ICU (`FText::ToLower`). These match for all
  the game's content.
- **Item key validity**: `FSoftObjectPath::IsValid` is approximated as "starts with `/`".
- **Answers** are `string[][]` instead of `TArray<FAcceptedAnswer>`.
- **Scope of the ladder port**: `ApplyGrade` also does telemetry, mission tallies, audio, debrief and practice modes,
  and review de-duplication. These are not ported. The demo applies cover as in a conversation and records to the
  scheduler on every final answer.
- **Phrase strength lookup**: the game's `FindStrongestForPhrase` searches other conversations for the same phrase.
  The demo reads the item's own state.
- **Seeds**: the game seeds the recognition options with `GetTypeHash(key) ^ UtcNow ticks` and shuffles tiles with
  `FMath::RandRange`. The demo uses an FNV-1a hash of the key and a visit counter, so runs are reproducible.
- **Session errors** live on a `UWorldSubsystem`, so they reset when the level reloads. The demo has no levels: it
  clears them when the clock is fast-forwarded by a day or more ("you came back later").
- **Cover blown**: the game stops the conversation and drills the missed phrases. The demo says so and offers
  "Restore cover and continue" (`ResetCover`).
- **Per-word accent marking** (`__word--accent`) is demo-only presentation. The C++ grade has a single `bAccentOnly`
  flag, and the per-word marking uses the same fold on the closest answer.
- **Romaji** is always shown on Tokyo tiles. The game has a toggle, and the site can hide `__tile-reading` and
  `__reading`.
- **Not ported**: the 11 other UE tests (save migration, missions, debrief, handler, assessment, telemetry, fluency, NPC
  resolve). They don't cover the grader or the scheduler.

## Tests (70, all passing)

30 tests replicate, case by case, the 8 UE automation tests (out of 19) that cover the grader, scheduler, scaffold
policy and hints:

| UE test | Source | Port |
| --- | --- | --- |
| `LinguaSpy.Grader` | `Tests/SentenceGraderTests.cpp:44-95` | `grader.test.ts` (9) |
| `LinguaSpy.GraderLanguages` | `Tests/SentenceGraderTests.cpp:97-126` | `grader.test.ts` (3) |
| `LinguaSpy.GraderTolerant` | `Tests/Phase5Tests.cpp:113-138` | `grader.test.ts` (6) |
| `LinguaSpy.Srs.Schedule` | `Tests/LearningTests.cpp:11-89` | `leitner.test.ts` (3) |
| `LinguaSpy.Srs.ItemKey` | `Tests/LearningTests.cpp:91-112` | `leitner.test.ts` (1) |
| `LinguaSpy.Scaffold.Choose` | `Tests/Phase5Tests.cpp:40-63` | `scaffold.test.ts` (2) |
| `LinguaSpy.Scaffold.Material` | `Tests/Phase5Tests.cpp:65-111` | `scaffold.test.ts` (5) |
| `LinguaSpy.Feedback.Hint` | `Tests/Phase5Tests.cpp:140-166` | `scaffold.test.ts` (1) |

The other 40 tests are extra edge cases:

- grader (12): accents, punctuation, extra whitespace, word order, closest-answer choice, Japanese spacing
- scheduler (8): exact constants, the full box walk, boundary due times, demotion, the box-0 quirk, case-insensitive city ids
- scaffold (8): the typing cap (Japanese never types, even at box 5), multiset tiles, auto gaps, the RNG port
- ladder and cover (8): not in the UE tests at all, because `ApplyGrade` was only checked by the PIE driver
- `phrases.json` checks (4)

## Size

`npm run build` emits unminified ES modules. Gzipped (level 9):

- the whole `dist/` is about 15.2 KB as one stream, or 16.5 KB summed per file
- `phrases.json` is about 3 KB of that
- the code alone is about 13.4 KB summed per file, and less once the site's bundler minifies it

There are no runtime dependencies.
