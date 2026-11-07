# Portfolio v2 ("Converge")

Mohammad Mohammad's portfolio, rebuilt from the plain HTML version in `C:\GameDevCareer\portfolio\`. The concept comes from his path tracer: the home page opens on a real render (the LCP image), which hands over on idle to the tracer itself running live in the browser. Each project chapter then switches to its own project's look: a case-file dossier for LinguaSpy, the converging render for the Raytracer, and a profiler/terminal panel for TitanInfer. All copy and facts are carried over from the QA'd plain site and `facts/project_facts.md`, with the Raytracer rewritten for the `portfolio-fixes` branch.

## Stack

| | Version | Why |
|---|---|---|
| Astro | 7.3.8 | Static output, HTML first, per-island JS. Needs Node 22.12 or newer (tested on 24.20). |
| GSAP | 3.15.0 | ScrollTrigger, SplitText, Flip, CustomEase. Free Standard License. Loaded on idle, never blocks first paint. |
| @astrojs/sitemap | 3.7.4 | `sitemap-index.xml` |
| Fonts | Fraunces (display, opsz axis) and Atkinson Hyperlegible Next (text) | Both SIL OFL 1.1, self-hosted from `@fontsource-variable` 5.3.0, Latin subsets only. Licences in `src/fonts/`. Code, HUD and terminal text use the system monospace stack; the dossier uses the system Courier. |

No UI framework, no Lenis (native scroll), no Three.js. Islands are plain TypeScript modules booted by `src/scripts/main.ts` when they come within 800 px of the viewport. Page transitions are native cross-document View Transitions (`@view-transition`); Firefox navigates instantly.

## Structure

```
astro.config.mjs        site/base placeholders for GitHub Pages (SITE_URL / BASE_PATH env vars)
.github/workflows/      official withastro/action@v6 workflow, manual trigger only (not activated)
public/
  media/linguaspy/      linguaspy-trailer.mp4 (720p30, 4.8 MB), linguaspy-loop.mp4 (12 s, muted, 0.2 MB)
  media/raytracer/      progressive.mp4
  resume/               Mohammad Mohammad - Gameplay Programmer.pdf
scripts/
  budget.mjs            measures first-load HTML/CSS/JS from dist/ (npm run check:budget)
  encode-media.sh       re-encodes the LinguaSpy trailer and loop from C:\GameDevCareer\trailers\linguaspy
src/
  assets/               renders, before/after pairs, 1-256 spp frames, LinguaSpy stills (Astro converts to AVIF/WebP)
  components/           Hero, WorkIndex, Chapter{LinguaSpy,Raytracer,TitanInfer}, BeforeAfter, BvhChart,
                        ConvergeScrub, MatmulViz, LeitnerBoxes, LoopVideo, ProjectHead, CodeFigure, Bar, Footer, About
  data/site.ts          links, project index data, module flags (TRACER_INSTALLED, LINGUASPY_DEMO_INSTALLED)
  data/bvh.ts           BVH timings copied from Raytracer renders/bvh_timing.txt (raw file alongside)
  data/media.ts         every LinguaSpy video path and poster (one place to swap in the v2 trailer)
  layouts/Base.astro    head, motion pre-paint script, bar, footer
  pages/                index, projects/{linguaspy,raytracer,titaninfer}, 404
  scripts/              main.ts (entry), motion-state.ts, gsap-kit.ts, reveal.ts, islands/*.ts
  styles/               global.css (tokens, type, motion gating), project.css, ls-demo.css
  vendor/tracer/        live path tracer from C:\GameDevCareer\web-modules\tracer (wasm + workers)
  vendor/linguaspy-demo/ grader/scheduler demo from C:\GameDevCareer\web-modules\linguaspy-demo
```

Emberling is not on this site (draft, IP cleanup pending). Its draft page still lives in the plain site at `C:\GameDevCareer\portfolio\projects\emberling.html`.

## What is on the pages

Home:
- **Bar** (sticky): name (monogram on phones), Résumé PDF, GitHub, Email, and a Motion on/off toggle. A CSS scroll-driven progress line runs under it where supported.
- **Hero**: name, one line on the work, availability, links, and `hero_materials` at 1024 spp as an AVIF (the LCP image, `fetchpriority=high`). On desktop-class devices (4+ cores, fine pointer, no Save-Data, motion on) the live tracer starts on idle: 6 Web Workers run the C++ tracer compiled to WebAssembly at 480×270, with spp, rays/s, workers, BVH state and time in the HUD, a BVH on/off toggle (brute force for comparison), Pause and Reset, and drag to orbit. Phones and reduced motion get a "Render it live on this device" button. It pauses off screen and in hidden tabs and stops at 512 spp.
- **Work index**: the three projects as plain HTML rows (name, pitch, role/tech/dates, links), with a shorter pitch at phone width. Thumbnails and titles carry `view-transition-name`s that morph into the project page.
- **LinguaSpy dossier**: manila case file, stamps that land, briefing paragraphs whose redaction bars slide off line by line (SplitText), field facts, the 12 s muted loop (plays only on screen, Pause button), city tabs Paris/Madrid/Tokyo/Rome (ARIA tabs; the ink marker moves with Flip), and the playable grader/Leitner demo, labelled "TypeScript port of the game's C++ grader and scheduler, tested against the same cases".
- **Raytracer**: the same scene at 1, 2, 4 ... 256 spp, scroll-scrubbed while the frame sticks for 1.2 viewports (a slider does the same without scrolling); a before/after slider for three real fixes (RNG range, transposed TBN, direct light 1/π) with commit links; the BVH timing table as a log-scale bar chart (bars grow, speed-ups count up) plus the end-to-end render time.
- **TitanInfer**: terminal/profiler panel with a cache-blocking visualizer of `matmul_avx2`'s loop nest on 16×16 matrices: A, B and C grids, the current 8-wide FMA, the block outlines, a 24-line LRU cache strip, hits and lines loaded, and a Blocked/Unblocked switch (unblocked 1,152 lines loaded vs blocked 592 in this toy model). It's labelled as a model, not a measurement. No performance numbers are quoted because none are recorded in the repo.
- **About** and footer with plain email, résumé, GitHub, LinkedIn.

Project pages: a TL;DR (role, dates, tech, links, three things worth a look), then the long-form write-up with code excerpts linked to file and line. LinguaSpy has the trailer and the interactive Leitner box rule (`LeitnerBoxes`, which highlights the line of `USrsScheduler::Update` that ran). Raytracer is rewritten for the fixes branch: every fix with its commit, the maths, before/after, BVH build and traversal excerpts, OpenMP, and what is still open. TitanInfer carries the visualizer at the top.

Motion: one easing curve everywhere (`cubic-bezier(.2,.7,.1,1)`, also registered in GSAP as `converge`). Headings resolve character by character in random order, like samples landing. Nothing is hidden before the scripts run (content is complete without JS), nothing already on screen is hidden, and turning motion off reverts every split and tween, stops the loop video, unpins the scrub and pauses the live render. Default follows `prefers-reduced-motion`; the toggle is stored in `localStorage`.

## Run, build, deploy

```bash
npm install
npm run dev            # http://localhost:4321
npm run build          # -> dist/
npm run preview        # serves dist/ (or: python -m http.server 4329 --directory dist)
node scripts/budget.mjs
```

Deploy (GitHub Pages). The repo is local only and has never been pushed.
1. Create the GitHub repo. For a user site name it `HamoodiM.github.io`; for a project site any name works.
2. In `.github/workflows/deploy.yml`, set `SITE_URL` and `BASE_PATH` (`/` for a user site, `/<repo>/` for a project site), and uncomment the `push` trigger.
3. Settings > Pages > Source: GitHub Actions. Push to `main`.
All internal links go through `url()` in `src/data/site.ts`; a test build with `BASE_PATH=/portfolio/` produced no unprefixed links. In Git Bash, prefix `MSYS_NO_PATHCONV=1` when setting `BASE_PATH` on the command line, or the path gets rewritten.

Media: `scripts/encode-media.sh` re-encodes the trailer (720p30 H.264, CRF 22, capped at 4.5 Mbps, AAC 128k; the 33 MB 1080p60 source became 4.8 MB because the footage is mostly flat UI) and the hero loop. TODO-V2: when `trailers\linguaspy\v2\` is ready, run `SRC=/c/GameDevCareer/trailers/linguaspy/v2 scripts/encode-media.sh` and, if needed, change the poster imports in `src/data/media.ts`. Setting `youtubeId` there switches the page to a youtube-nocookie embed instead.

## Budgets (measured 2026-11-07 on this build)

| Budget | Target | Measured |
|---|---|---|
| First-load JS, home | ≤ 90 KB gz | **54.1 KB gz**: entry 1.7, GSAP core 26.5, ScrollTrigger 17.0, SplitText 3.2, CustomEase 3.3, reveal 0.8, gsap-kit 0.4, hero island 1.1. When the live render auto-starts on desktop idle, add tracer glue 5.2 KB (tracer 3.0 + worker 2.2), so 59.3 KB. |
| First-load JS, project pages | ≤ 90 KB gz | 52.9 KB gz |
| Loaded later on scroll | | about 19 KB gz of islands on the home page, plus the demo widget (10.9 KB) and Flip (9.0 KB) when the dossier comes near |
| Tracer WebAssembly | ≤ 400 KB brotli, lazy | 149 KB gz (122 KB brotli per the module README), plus 304 KB of brick textures (JPEG), only after idle on desktop or a tap |
| HTML + CSS, home | ≤ 60 KB gz | 13.1 KB HTML + 9.8 KB CSS |
| Fonts | ≤ 2 families, ≤ 120 KB | 2 families, 98.9 KB (Fraunces 65.7, Atkinson Next 33.2); only Fraunces is preloaded |
| Hero image (LCP) | ≤ 150 KB AVIF | 10.5 / 16.4 / 24.8 KB AVIF at 480 / 720 / 960 w |
| Projects within one phone scroll | | At 375×812 the three project rows end at y = 1,131 / 1,362 / 1,593 px, inside the first two screens (1,624 px). |
| No horizontal scroll at 375 px | | `scrollWidth` 375 on all four pages |
| Console errors | 0 | 0 on all pages |
| Live tracer | | 512 spp in 7.8 s at 480×270 in the built-in browser, 28.7 M rays/s, 6 workers |

Not measured: real LCP on a mid-range phone and Lighthouse. The built-in browser pane was hidden during testing, which throttles rendering and suppresses LCP entries, so run Lighthouse (mobile) on the deployed site.

## Integrated modules

- **Live tracer** (`src/vendor/tracer/`, copied from `C:\GameDevCareer\web-modules\tracer\`): `tracer.ts`, `tracer-worker.js`, `tracer-core.js`, `wasi-shim.js`, `tracer.wasm`, `textures/`. Vite bundles the worker, wasm and textures through `new URL(..., import.meta.url)`; no COOP/COEP needed. `tracer.ts` and the demo's `widget.ts` pass `tsc --strict` (TypeScript 5.9.3) together with all site scripts. To update: copy the folder again and rebuild. Set `TRACER_INSTALLED = false` in `src/data/site.ts` to fall back to the static render.
- **LinguaSpy demo** (`src/vendor/linguaspy-demo/`, from `C:\GameDevCareer\web-modules\linguaspy-demo\`): `grader.ts`, `leitner.ts`, `scaffold.ts`, `ladder.ts`, `widget.ts`, `phrases.json`. The `with { type: 'json' }` import works under Vite. Styled in `src/styles/ls-demo.css`; events animated in `src/scripts/islands/lsdemo.ts`. It has Paris and Tokyo content and its own city switch; the dossier's four city tabs are separate.
- **Trailer and loop**: wired from `C:\GameDevCareer\trailers\linguaspy\` (see Media above).

## TODO-USER

Find them all with `grep -rn "TODO-USER\|TODO-V2" src scripts .github astro.config.mjs`.

Before launch:
- [ ] Choose the AI-disclosure wording on each project page (search `[choose disclosure wording]`): LinguaSpy, Raytracer, TitanInfer. The options in the comments are updated for this site (the Raytracer fix commits say "Prepared with Claude Code for review"; the scheduler widget, cache visualizer and browser builds were written for the site).
- [ ] About: add one or two sentences only you could write. Confirm the Raytracer was not coursework.
- [ ] Raytracer: merge `portfolio-fixes` and push, or the commit and file links 404 and the page describes code that isn't public. Confirm the dates (git: Oct 21–22, 2025; old résumé: Dec 2024) and the "extended with" list. Optionally copy the newer smooth-shaded `hero_knot.png` from the branch.
- [ ] LinguaSpy: push the 7 local commits and make the repo public (the code links are pinned to `d5e3353`), then add `source` in `src/data/site.ts`. Rewrite or delete the inferred sentences (grader tradeoff, Leitner over SM-2). Upload a Windows build and link it, or delete the Build row. Capture a Rome screenshot.
- [ ] TitanInfer: record `matrix_benchmark` (Release, CPU named) before quoting any speed-up; add a clip or screenshot.
- [ ] Set `SITE_URL` / `BASE_PATH` (astro.config.mjs or the workflow) and activate the workflow.
- [ ] Update the "Last updated" line in `src/components/Footer.astro` whenever the site changes.
- [ ] Run Lighthouse (mobile) on the deployed site and test on a real iPhone and a mid-range Android.
- [ ] TODO-V2: swap in the polished trailer from `trailers\linguaspy\v2\` with `scripts/encode-media.sh`.

## Known limits

- Live tracer runs at 480×270 (upscaled); orbit drags render at about 320 wide. It is a CPU tracer, so on a 4-core laptop expect a fraction of the 28 M rays/s measured here.
- The cache visualizer is a toy model (LRU, 4-float lines, 24 lines) and says so on the page.
- View transitions were not visually verified (the pane was hidden); they degrade to normal navigation.
- The 1-256 spp frames are cut from `progressive.mp4` (H.264), so the noisiest frames are a little smoother than the raw render.
