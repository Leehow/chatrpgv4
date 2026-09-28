# JPDF-03: Minimal module brief unlocks character creation

Status: ready-for-agent
Execution: authorized; waiting on declared blockers.
Parent: [Jev PDF demand reading](../jev-pdf-demand-reading.md), D0–D3/D9.

## Required prototype evidence

Read the [mandatory prototype-use gate and ticket 03 evidence map](../jev-pdf-demand-reading-tickets.md#required-prototype-evidence) before implementation or acceptance work. [Prototype report](../../research/jev-playable-entry-prototype-20260927.md).

Read the minimal brief task, native navigation code and author/review runs. Carry forward the missed car/Driving constraint, parent/child directory-range fix and field-level completeness checks.

## What to build

Import an original PDF and deliver the small reviewed brief needed to start character creation: era, place, premise, investigator suitability advice or warnings and necessary opening choices. Reusable native-source/Jev navigation supplies exact leads and retains access to the whole bound source.

## Blocked by

- [JPDF-10 — Native source driver](10-native-source-driver.md).

## Acceptance criteria

- [ ] Before work, record the pinned prototype commit/files, an observed case/outcome and its production mapping in this ticket; include them in any delegated assignment.
- [ ] At review, provide prototype decision/case → implementation location → verification evidence, with reasons/evidence for deviations. Missing correspondence or an unexplained deviation fails acceptance.
- [ ] Amend the source navigation/cache/index contract and register model call sites before implementation. Reuse existing source, Jev and task owners.
- [ ] Actual creation becomes usable while unrelated chapters and profiles remain pending. The gate neither waits for all-page semantic classification nor requests a full first-scene/NPC dossier; measure PDF-to-creation time.
- [ ] Check each required creation field against source instructions, including constraints omitted from an otherwise truthful draft. Retain the observed Blood Road car/Driving requirement as a grounded regression. Native parent-section ranges include descendants; source navigation caps are not completeness flags.
- [ ] Carry source-backed creation advice and warnings from the tool-enabled reader and independent original-page review into actual setup guidance before card confirmation. In the live regression, present Blood Road's car/Driving 55% advice with its source while allowing the player to confirm the vehicle-owning Drive Auto 21 card and continue play. Missing guidance fails source fidelity; player disagreement with guidance never blocks card confirmation.
- [ ] Account for every physical page and exact source ranges; distinguish usable text, empty/error/uncertain text and unresolved visual coverage. Preserve physical-page/printed-label distinctions.
- [ ] A fresh source with no prepared entity graph can locate an authored opening and a distant topic using bounded batches of actual source content. No lexical prefilter or page-role hard filter silently removes recall candidates.
- [ ] Retain partial-answer/context leads and uncertain results under a calibrated policy. Closed candidates are host-owned; Jev does not generate facts, names or source locations.
- [ ] The real skeleton/index consumer uses navigation output. It reopens required original pages and publishes through existing independent review; Jev labels alone cannot satisfy viewed-source/index-complete gates.
- [ ] Reader-built section names and relationships remain tool-enabled text work. Ordinary fallback works when Jev is absent, times out or returns incomplete batches; gaps survive in telemetry/state.
- [ ] Cache identity includes source and relevant extraction/model/policy versions, supports cancellation/restart and does not rebuild merely because a new job ID was minted. Source mutation or another edition rejects reuse.
- [ ] Repeated unchanged navigation reuses results. First-setup and background indexing costs are separately visible, including fallback and partial coverage.
- [ ] Native source policy offers actual structural scopes and whole-source fallback. Jev may choose cited/adjacent/section material before a whole-book pass; failed local coverage expands without claiming absence.
- [ ] Located but unselected candidates and unsearched ranges remain available with provenance. A fixed top-k selection is not the scope-complete flag.

## Verification

Exercise fresh PDF preparation through the public host service and real TypeScript publication with deterministic boundary cases, then real Jev and tool-enabled readers on the two bound books. Trace navigation producer → reader task → accepted skeleton/opening choices. Report locating quality separately from end-to-end latency.

## Scope boundary

This slice establishes the creation gate and reusable navigation. Full index completion is separate background work. It preserves the existing visual fallback; improved mixed/scanned discovery belongs to JPDF-04 and first-scene preparation to JPDF-05. No full authoritative graph, OCR service or new retrieval framework.

## Comments

2026-09-27: The current fresh navigator is optional and skeleton-only; acceptance requires a demonstrated consumer path, not merely enabling its flags.

Prototype-to-production mapping before this slice's code: minimal-entry commit `0a7a63ad8117f80a301c80c515e91245ab084b52`, `experiments/jev-playable-entry/run.mjs` and `source-driver.mjs` measured 49.2/73.1 s source-only Blood Road/Masks briefs, then found Blood Road physical page 8's car/Driving advice missing from an otherwise true first brief. The same prototype fixed a parent-outline range that ended before its children and made source/runtime/deferred needs explicit. Native Pi commit `4ba527fdf06bb0429b3984ac4ceab4e95ea38ec2` proves real RunDriver source decisions, while its whole-book dossier input warns against default all-page Jev fan-out. Production mapping: the already tested JPDF-10 source child gains a guidance purpose and section-first navigation; `ReadingService.prepare` exposes source binding before reading; RPC `prepare-module` uses the same `guidanceFingerprint`/accepted guidance as the frontend worker, then creates the campaign without waiting for an unrelated full opening. The source reader and independent reviewer retain original-page/`module.read.finish` authority, the Blood Road advice becomes a warning the player may decline, and the result is verified through the actual setup RPC path and frozen 24-case evidence rather than prototype dossier rows.

First cold production attempt, retained `.pi/jpdf-guidance-home-blood01` and `.coc/playtests/jpdf-guidance-blood-01/`: the real `prepare-module` bound the original PDF and requested `guidance` rather than skeleton/opening. The first usable creation question arrived after 129.4 + 10.9 = 140.3 s of model/transport time, versus the retained old-path 298.5 s. This is meaningful improvement but **fails** the 60 s target. The source reader's author used 7 model answers and its reviewer 5; chapter Jev selected all 21 top-level sections, so 101 text pages and 134,737 Jev input were still scanned. The accepted module draft cited physical page 8 and carried car/Driving-55 advice, but the setup guide did not say the advice to the player before inviting confirmation. A player-chosen ordinary-Driving card was confirmed without a hard gate, as required. At setup handoff the prologue was ready while Esso detail `read-4` remained underway; one natural play turn lasted 59.3 s and explicitly said its next Esso details were still being read. This run is not a passing first-scene or source-cost acceptance. All source jobs, card, setup and play evidence remain. The next revision changes section ranking to three focused closed choices, batches original-page reads, and instructs a concise player-language warning before confirmation; those changes require a fresh cold validation.

The second fresh Blood Road run `.pi/jpdf-guidance-home-blood02` / `.coc/playtests/jpdf-guidance-blood-02/` used three focused section choices: six selected top-level ranges, 36 of 101 native-text pages, nine page batches and 53,188 page-decision input plus 11,097 section-decision input. The author/reviewer each needed one original-page call and one submission, and the first creation question arrived in the first turn at 82.0 s. This still fails the 60 s cap. The reviewed draft retained page 8 advice. It proves that section scoping and direct short-object submission reduce old 140.3 s waiting and Jev work, but no paired controlled attribution or full-book saving is claimed.

The third fresh run `.pi/jpdf-guidance-home-blood03` / `.coc/playtests/jpdf-guidance-blood-03/` projected eight original images before inference. The first author submission failed because `node_refs` was missing; the repair call and four passive host-image resends increased new input and the first question took 114.0 s. The fourth run `.pi/jpdf-guidance-home-blood04` / `.coc/playtests/jpdf-guidance-blood-04/` used a closed top-level submission schema and successful source-bound image receipts: author and reviewer each submitted in one model answer with no manual PDF tool call. Independent review correctly contested an invented `present-in` claim for a radio announcer, so the retained semantic repair pushed the first creation question to turn 2 (130.5 + 11.2 = 141.7 s). This is an integrity success and latency failure. The source prompt now states the physical-presence relation; repeat navigation is cached by source/prompt/model/scope identity so the repair need not rescan Jev. The projected-image policy is separately tracked in JPDF-02. All four runs are retained; no speed or completeness pass is promoted from the shortest one.

Masks source runs in `.pi/jpdf-guidance-home-masks02` through `masks06` and `.coc/playtests/jpdf-guidance-masks-02/` through `-06/` retain the adverse iterations: the first brief wrongly forced Peru, later briefs correctly exposed the optional 1921 Peru prologue and the independently playable 1925 New York start. The section-first navigator reduced the selected brief from a pathological all-669-page fan-out (`masks04`: 168 Jev calls, about 652k input) to `masks06` (35 pages, nine Jev calls, about 29.5k page-decision input). The actual first choice in `masks06` still required 131 s, and selected New York then spent 104.8 s in another guidance read. Those costs fail the 90 s cold cap and the selected-wait goal; the graph and source choice were correct.

Selected-entrance reuse was then tested against the already reviewed `masks06` graph. A reproducible `coc-read-check` probe proved that a one-scene unchanged shard with `properties:{}` requires only the scene's original pages and causes no graph re-transcription. `ReadingService.selectedGuidanceProjection` now issues it when the exact source-backed entrance is present, while the independent guidance reviewer sees the scene, public-advice and alternate-entrance pages. `masks08` reached that branch, but a new submit tool file-comparison bug made seven `submit_reading` calls fail; the Pi author kept trying for 99.9 s and consumed 373,111 input tokens. The reading owner had also accepted files despite no checked submission receipt. Both faults are fixed with a direct tool regression and host-verified native completion receipts for the author and reviewer. This failed run remains `invalid-for-acceptance` as speed evidence.

After the fixes, a live source-only selected New York guidance run on the same 669-page PDF and accepted graph, retained at `.pi/jpdf-selected-live-20260928.jsonl` and `.pi/jpdf-guidance-home-masks06/.coc/modules/book-1/work/read-7/attempt-1/`, completed in 47.3 s: author 15.3 s, independent original-page reviewer 30.8 s, both with one successful checked submission; author input 27,795 tokens over five physical pages. This validates the reuse path and receipt gate but is **not** a cold import or card-confirmation-to-play measurement. `masks07` retained another real setup failure: a Chinese paraphrase was sent as `start_scene` instead of the issued source handle, falling back to a normal read. The setup guide now explicitly requires the exact `candidate.scene` field. A fresh real run must still prove that behavior and the overall readiness target.
