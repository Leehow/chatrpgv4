# Jev decides, the LLM writes: turn on the clerk's reach, take graph checking off the vision reader, move setup onto the driven run

Status: ready-for-agent (owner go 2026-09-28: 「你就都做吧，to spec skill做spec然后实现就行」)
Date: 2026-09-28
Baseline: `0.9.6a` at `bc3979088`. Integration branch: `claude/jev-reach-20260928`.
Contract: §150 of `docs/kernel-rpc.md` (written with this spec, before code). Links: §22.2–§22.4.8, §135.32, §147–§149.
Related specs: `jev-driven-steps.md` (Stage 2/3, D4–D6 acceptance lines stay binding), `jev-pdf-demand-reading.md` (D4/D5/D8), `pi-native-single-loop.md` (clerk/boss rulings).
Load the `typesafe-jev` skill before writing or reviewing any Jev question in this spec.

## Problem Statement

The owner's Pi was rebuilt around a run driver that can put Jev (a closed-set typed chooser that never generates text) in front of every step, so that the host enumerates, Jev chooses, and a language model only writes the words a player reads. The owner expected that shape to be what the product does. It mostly is not, and the reasons are specific (read 2026-09-28 on `0.9.6a`):

1. **The switches are off.** The hybrid engine became the play default only at `ea97173ee` (2026-09-28 12:38); until then every product table ran the model-first legacy loop, including that morning's Blood tables. A setup session always runs legacy. The consequence classes (`clue_follow_up`, `npc_reaction`, `time_cost`) default to shadow: the env reader ignores the data file's own default, and no launcher sets `COC_JEV_STEPS`. So `clue_follow_up`, which the owner opened for execution on 2026-09-26 after gates #14–#16 (6/6, 6/6, FP 0/0/1) and which executed with zero false positives on gates #17/#18, does not execute in the product.
2. **The Keeper still chooses its own reads and writes.** Its compose step keeps `apply/resolve/look/lookup/recall`; the narrator-only catalog (SL-79) was never built. The best hybrid run so far (40.5 s, one Keeper request) still carried time bookkeeping inside the "writing" request; packaged-App turns mostly needed 2–3 main calls.
3. **Background graph work uses Jev almost nowhere and redoes work it already paid for.** Measured on the retained Blood05 background reads (Grok 4.5 / low):
   - A two-page source unit is located structurally, not by Jev; its author is a vision Pi agent (57–155 s, median ≈ 100 s); its independent review is 4–6 vision Pi children in parallel (20–70 s wall).
   - The review cache key contains the whole draft and the whole task. On pages 19–20 the review refused 3 of 29 claims (a relation the page does not state); the job paid a full re-author (156 s, longer than the first author) and re-reviewed every unit.
   - Pages 15–16 were authored seven times across two campaigns: an interrupted author leaves a draft but no checkpoint, so each resume re-reads the images and rewrites; a second campaign on the same PDF re-reads the same pages.
   - Need-driven detail reads (the existing "close this link" path: a fragment's `source_needs` become `detail` reads) outnumbered fragments 8 to 5. They re-located the same candidate sets (identical cached page lists), ran twice for the same person under different question wording (Steve Brown: two jobs, six attempts), and spent a full author+review on speculative deferred questions ("a later appendix combat profile, if printed separately").
   - Across the 4,633 review verdicts retained in this checkout, 97.9% are `supported`; the vision reviewer spends almost all of its time confirming what was right. Jev is not asked whether a claim's cited original text states it, although that is a closed pair judgement.
4. **Character creation never reaches the driven run.** (See D-E below for the measured setup path.)

A product that "has Jev" but runs the model-first loop, keeps the clerk in shadow, and re-authors whole fragments to fix three claims is not the product the owner described. The hollow delivery to avoid: flipping defaults or adding Jev calls without the measured gates, or claiming speed from isolated component timings.

## Solution

Five parts, each moving a decision the host can enumerate from the language model to Jev, while every word the player reads stays the model's.

- **A. The clerk executes by default.** The data file's `jev_steps` default decides the mode when no env is set; the shipped default is execute for the listed classes (`clue_follow_up` only). Unlisted classes keep routing and pairing in shadow exactly as today.
- **B. Background graph work: check with Jev, redo only what changed.** Review is reused per record, not per draft. A refused fragment is repaired record by record. An interrupted author's checked work is salvaged instead of rewritten. Each checkable claim is first asked of Jev against its cited original page text; Jev-cleared claims skip the vision reviewer once a calibration on the retained verdicts meets a pre-registered bar (shadow until then). Need-driven reads locate first and read only what is new: a need Jev finds already answered by accepted material closes without a reader; a need whose located pages add nothing new is retained as unlocated; a need whose pages fall inside an unread source unit is carried by that unit.
- **C. NPC reaction and time keep collecting shadow evidence.** Every hybrid table (including the installed App) now writes the shadow rows; the report reads any home and prints each class against D6 2a. Promotion stays the owner's decision on those numbers.
- **D. The narrator-only Keeper exists as a setting.** SL-79 is built behind a setting that defaults off: the compose step's catalog narrows to `narrate/ask/say/propose`, where `propose` names an offered candidate key. Turning it on stays gated on `jev-driven-steps.md` D6 3.
- **E. Setup runs on the driven engine.** (See D-E.)

## User Stories

1. As a player, I want a clue my declared action reaches to be filed for me, so that the Keeper's turn is spent on telling me what I found.
2. As a player, I want the same clue never filed twice, so that the investigation record stays trustworthy.
3. As a player, I want a clue I did not reach never filed, so that the mystery is not given away by bookkeeping.
4. As a player, I want a clerk-filed clue to appear in the Keeper's prose or be reversed with a receipt, so that nothing happens off-page.
5. As the owner, I want the product default to match my per-class ruling, so that a ruling is not silently void because no launcher set an environment variable.
6. As the owner, I want an explicit environment value to still override the data default, so that experiments and long gates stay reproducible.
7. As the owner, I want `npc_reaction` and `time_cost` to stay shadow under the new default, so that only the class I opened executes.
8. As a maintainer, I want the effective mode recorded in the run's startup/route telemetry, so that a table's evidence says which mode produced it.
9. As a player importing a PDF, I want background preparation to finish more of the book sooner, so that later chapters are ready when I reach them.
10. As a player, I want a small review finding to cost a small repair, so that background capacity is not spent rewriting a whole fragment.
11. As a player, I want a fragment interrupted by closing the App to resume where it stopped, so that reopening the App does not restart the same pages.
12. As a Keeper, I want accepted records untouched by a repair, so that a fix to one relation cannot silently change another fact.
13. As an independent reviewer, I want to review only records that changed or whose dependencies changed, so that my verdicts stay independent without being repeated.
14. As an operator, I want every Jev-cleared claim to carry the page text digest, extraction version and distribution it was judged on, so that the evidence is auditable.
15. As an operator, I want claims whose meaning lives in images (maps, handouts, image regions) and claims on pages without usable native text to keep the vision review, so that text-only checking never stands in for visual evidence.
16. As an operator, I want omission review (`/coverage`) to stay with the vision reviewer, so that "what is missing" is never answered by a chooser that cannot generate.
17. As the owner, I want Jev to clear claims but never refuse them alone, so that a Jev miss costs a vision review, not a lost fact.
18. As the owner, I want the Jev check calibrated on the retained reviewer verdicts before it replaces any review, so that the evidence standard changes only on measured precision.
19. As the owner, I want the calibration bar written before the calibration runs, so that the threshold is not chosen after seeing the numbers.
20. As a maintainer, I want the calibration to report false accepts against the reviewer's negative verdicts separately from coverage, so that a high pass rate cannot hide a precision loss.
21. As a Keeper, I want a need already answered by accepted material closed without another reading, so that background capacity reaches unread chapters.
22. As a Keeper, I want a need whose located pages add nothing new retained as unlocated rather than re-read, so that the same failed candidate set is not judged again as progress.
23. As a Keeper, I want a need whose pages fall in a not-yet-read source unit answered by that unit, so that the book is not read twice for one link.
24. As a Keeper, I want an unresolved or unlocated need to stay visible as such, so that "not located" is never reported as "the book lacks it".
25. As an operator, I want each background read's author time, review time, Jev calls, reuse and salvage recorded, so that savings are measured on the real path.
26. As the owner, I want NPC reaction and time shadow rows collected from every hybrid table, including the installed App, so that the promotion decision has enough data.
27. As the owner, I want a report that reads any home and prints each class against D6 2a, so that I can decide promotion from numbers.
28. As a maintainer, I want the report to separate executed rows from shadow rows and to name duplicate rows, so that execute mode cannot inflate or hide agreement.
29. As the owner, I want a narrator-only Keeper setting, so that tables can test Stage 3 before it becomes the default.
30. As a Keeper in narrator-only mode, I want `propose` to request one more clerk step by an offered candidate key, so that I can still ask for a consequence the run offered.
31. As a Keeper, I want `propose` with a free handle refused with the offered keys, so that free-text handles cannot return through a new door.
32. As a player, I want narrator-only turns to deliver prose with zero Keeper tool calls when the run already settled everything, so that the turn is one writing request.
33. As a maintainer, I want the narrator-only setting default off and its acceptance gated on D6 3, so that the switch follows the pre-registered line.
34. As a player creating an investigator, I want choices I already stated (occupation, era, the entrance I picked, skills I named) filled for me, so that creation does not spend a model request per field.
35. As a player, I want every creation choice still mine, so that the host never picks my character for me.
36. As a player, I want the creation dialogue's words written by the model in my language, so that faster creation does not read like a form.
37. As a player, I want card arithmetic (points, credit, derived values) done by the kernel, so that no model guesses a number.
38. As a maintainer, I want setup to run on the driven engine with its own policy, so that it is never passed to a play policy that needs a live world.
39. As a maintainer, I want a Jev outage during setup to fall back to today's model-led setup, so that creation never blocks on Jev.
40. As a maintainer, I want every new decision family inventoried with owner, budget, gate and fallback, so that Jev's reach stays auditable.
41. As a tester, I want acceptance through the canonical RPC driver with the main session as the only player, so that the change is measured on real turns.
42. As the owner, I want failed or partial results preserved with their evidence, so that a regression is visible rather than relabelled.

## Implementation Decisions

### D-A. Clerk execute mode follows the data default

- The mode resolver reads the env switch first; when it is absent or empty, it takes the host budget data's `jev_steps` default (a boolean `shadow` today). The shipped data sets `shadow: false`, so the default is execute for `jev_steps.execute` (`["clue_follow_up"]`) and shadow for every other class, exactly SL-78's `on` semantics. `off` stays reachable only by the env switch.
- The effective mode and its source (`env` or `data`) are recorded once per run on the existing route/residual telemetry; the residual row now exists on every default table.
- No change to gates, admission on compile evidence (§32.12), the "clerk did" projection line, or per-class thresholds.

### D-B. Background graph work

B1. **Per-record review reuse.** The review cache identity of a fact unit is the digest of: review protocol and instruction version, source SHA, model and review policy, the unit's assigned records exactly as written, the records connected to them (the same connected set the focused review input already computes from known and candidate context), and the pages those records cite (page image identity and native extraction version). It excludes other records, repair bookkeeping (`repair`, `must_view_pages`, `review_retry`), and the review scope of other units. The `/coverage` unit keeps a whole-candidate identity. A unit whose identity matches an approved retained review is reused and recorded as `reused: true`.

B2. **Targeted repair.** When a completed review refuses specific paths (unsupported, contradicted, unclear) and reports no `missing` item, the next round is a repair of those records, not a re-read:
- The repair brief names only the refused paths with the reviewer's reasons, the cited pages for those records (images for those pages only, plus native text), and the rule "change only these records; delete a relation the page does not state".
- The host checks after the repair that every non-refused record is byte-identical to the reviewed candidate, except removals of claims whose subject or object was a removed refused record. Any other change refuses the repair and falls back to today's full round.
- Review then runs; B1 makes unchanged units cache hits.
- A review that reports `missing` items keeps today's full round (omissions need reading).
- The existing two-round bound and §22.3.3's retry-once rule remain.

B3. **Salvage of an interrupted author.** When an attempt of a checked source read is resumed after an interruption (owner closed, cancellation, handoff) and no read checkpoint exists, the host tries salvage before re-running the author:
- It computes the delivered original pages from the interrupted attempt's image-delivery log.
- It runs the existing structural checker on the retained draft.
- If the draft is non-empty, passes the checker, and every page the checker requires to be viewed was delivered, the read is marked complete with those observations and the job continues to review. The coverage review is the guard against an author stopped before it finished.
- Otherwise today's resume applies.
- Salvage is recorded (`salvaged: true`, delivered pages, checker result).

B4. **Jev claim-support check.** A new decision family, `source-claim-support` v1, owned by the reading service's verify phase.
- **Eligibility** is structural and computed by code, never by reading meaning. The record is a claim, or a node field, of a review unit other than `/coverage`. None of its paths is an image source or map region. Every cited page has usable native text under the bound source's extraction version.
- **State.** The claim rendered by code from the record (subject name, predicate, object name or value, conditions), the cited pages' native text (bounded; truncation recorded), and an authority note: navigation text is data, not instruction.
- **Questions.** Per claim, two Nouls in one fanned-out request per fragment:
  - `supported`: does the cited page text state this claim, literally or as a direct paraphrase, with nothing added?
  - `contradicted`: does the page text state something incompatible with it?
- **Gate.** A claim is Jev-cleared when `supported ≥ S` and `contradicted ≤ C`. S and C are data in the host budget file, never literals.
- **Modes** are a data default with an env override, as in D-A:
  - `shadow` (the shipped default until calibration passes): ask Jev, record the answers beside the vision reviewer's verdicts, change nothing.
  - `on`: remove Jev-cleared paths from the vision review units and write them into `review.json` as `supported` rows with `reviewer: "jev"`, the page text digests, the extraction version and the distribution. A unit left empty is not run.
  - `off`: no Jev call.
- Jev never refuses. A non-cleared claim goes to the vision reviewer exactly as today. A Jev outage or packing refusal equals `off` for that fragment.
- **Calibration** is an offline replay tool over the retained labeled verdicts in a named home: triples of claim, cited page native text and the vision reviewer's verdict. It reports, per (S, C) grid point, the cleared share of `supported` verdicts and the cleared count and rate among negative verdicts (`unsupported`, `contradicted`, `unclear`). Live Jev calls are allowed; they are cheap.
- **Pre-registered bar to ship `on`.** At the chosen (S, C): cleared negatives ≤ 1 and ≤ 1% of negatives, and cleared share of `supported` ≥ 50%. If no grid point meets it, the default stays `shadow`, and the report and this spec record the failure.
- **Publication gate.** The kernel's gate accepts a `reviewer: "jev"` row only for eligible paths, with a matching page text digest and extraction version for the bound source, and only for paths no vision reviewer marked negative. This is the evidence-standard amendment §150 records: for text-only claims, a Jev-checked exact native text match is evidence; images, maps, coverage and visual-only facts keep the vision standard.

B5. **Need-driven reads locate first.** For a background `detail` read queued from a retained source need (not a player or Keeper request):
- **Answered-already check.** Before any reader runs, one Jev Noul asks whether the entity's accepted published claims and nodes already answer the need's question. At or above its data gate, the need is resolved without reading (`resolved_by: "accepted_material"`, with the distribution) through the existing resolved-needs path.
- **Locate.** The existing native locate runs (sections, then page leads).
- **Nothing new.** If every located page is already among the pages accepted material for this entity was read from, and no page lead cleared on a new page, the need is retained as `unlocated` with the locate evidence, and no author runs. It stays eligible when a new source unit publishes (a later unit can add pages).
- **Carried by a unit.** If all located pages fall inside source units not yet read, the need is attached to those units' tasks as an extra question (the unit's reader answers it from the same pages), and no separate read is queued.
- **Otherwise** today's read runs, with the located pages.
- **Deferred needs** are read ahead only after the source units ahead of the reading frontier are queued: coverage first, speculative links second.

B6. **Accounting.** Every background job row gains: author ms, review wall ms, units run and reused, Jev calls/ms/tokens by family, salvaged, repair kind (`targeted` or `full`), and need disposition (`answered`, `unlocated`, `carried`, `read`). The existing reading telemetry lane carries them; no new lane.

### D-C. Shadow collection for NPC reaction and time

- No product change to the classes; under D-A's default they are routed and paired in shadow on every hybrid table.
- The shadow report accepts a PipiCOC App home (and several homes at once) in addition to a repo checkout. It aggregates across campaigns and prints, per class, the D6 2a line (agreement ≥ 0.9 where the Keeper acted, false positives ≤ 1 per table, added Jev ms per turn ≤ 1.5 s) as met or not met, with the table count. It never edits the execute list.
- How the report reads D6 2a (`tests/play/jev-steps-report.py`; read-only; homes are a repo checkout, a PipiCOC App home `<userData>/pi-coc`, or the App userData directory `~/Library/Application Support/Pipi/pipicoc`, all with `.coc/campaigns/<cid>/`):
  - A table is a campaign with at least one consequence route row.
  - Agreement is `tp/(tp+fp)` over the cleared rows the Keeper's receipts can judge (`keeper_did` true, false or `other`; `tp` is `true`), the reading SL-77 gave "6/6" and SL-78 opened `clue_follow_up` on. Recall `tp/(tp+fn)` is printed beside it as information and is not part of the verdict.
  - False positives are the cleared rows with `keeper_did` false or `other`, counted per table; the worst table decides. The only automatic exemption is the label/handle pairing artifact of a pre-SL-83 row (proven by the turn's own person and roll receipts). Reading a false positive against the transcript stays the owner's.
  - Added Jev ms per turn is the per-table mean over the turns that made a shadow call, inclusive at 1.5 s, every table.
  - Not counted, and printed: stranded turns, `executed` rows, `direct` rows, unanswered rows (no confidence), rows with no `keeper_did` verdict, and duplicate `(turn, class, key)` rows (the last written is kept).
  - A class with no cleared row the receipts can judge, or no cost row, reads not met (no evidence), never met.
  - A further section, "executed steps not in the prose" (D6 2b), lists per table the executed `clue_follow_up` rows whose turn carries no Keeper-placed `{{clue:<handle>}}` marker in its delivered `text` (`marked_text` is not read: the kernel appends a marker for every unplaced receipt). Reversal is printed `n/a`: no receipt kind reverses a clue.

### D-D. Narrator-only Keeper (SL-79) as a setting

- Implement SL-79's scope behind a setting (env and data default, default off):
  - In compose steps, the Keeper's tool catalog is `narrate`, `ask`, `say`, `propose`.
  - `propose {key}` requests one more clerk step from the run's offered candidate set, through the same gateway and admission. An unknown key is refused with the offered keys. At most N per turn (data).
  - `adjudicate` and `bind` steps keep their current catalog, because a genuinely open parameter is still the Keeper's.
- Before narrowing, read the SL-78 residual rows for which reads remained and make sure §135.31's carried views cover them. Record any view gap as a finding; do not work around it in the prompt.
- Default stays off. The switch is gated on D6 3 (delivery 20/20, median ≤ 30 s, `propose` ≤ 3 per table) on real tables.

### D-E. Setup on the driven engine

**What setup is today (surveyed 2026-09-28).**
- A setup session is launched with the setup prompt, always on the legacy loop. The Keeper's only tool is `setup{step, ...}`.
- Before the first request, Jev already does three things:
  - picks a PDF path the player selected (`setup-source-intake`), after which the host runs choose-source/prepare-module/create-campaign itself;
  - bounds names (`setup-name-boundary`);
  - selects source excerpts for the guide.
- Every card choice is the model's. Blood05's delegated full-card turn took 200.9 s in 13 setup calls and 14 model turns; tool time was ≈ 3 s.
  - Three create-investigator calls: two were refused, one for an incomplete profile and one because the occupation 摄影记者 is not in the catalog.
  - Five revise calls: one was refused because Credit Rating was passed as a skill.
  - Most of the draft's arguments already come from closed sets the kernel issues:
    - occupation (catalog);
    - occupation and interest skills (catalog skill list);
    - era (finance periods);
    - aptitude (the nine characteristics);
    - backstory keys and printed weapons;
    - source kind, starter or module id, `start_scene`, `register`;
    - name (a selection over issued input aliases), library id, consent.
  - Open: age, sex, concept, own language, backstory text, equipment names, custom skills, generated names. Numbers are kernel arithmetic within catalog limits.

**Decision: a setup policy on the same RunDriver, never the play policy.**

E1. **Engine.** The engine selector returns the driven engine for setup when Jev is available, with its own policy (`coc-setup-v1`) and ports. Legacy stays reachable by the env switch and whenever Jev is unavailable. The play step policy, the table read, consequence candidates, prescreen and NPC scan are not used in setup; none of them runs without a world.

E2. **Read.** The setup read is the existing setup state:
- the current step and allowed next steps;
- the kernel's setup catalog (occupations, skills, eras, characteristics, backstory keys, printed weapons);
- the current draft card, if any;
- the module guidance and opening candidates;
- the player's latest input with its issued input aliases.

The read binds Jev scope to the setup session (the campaign id when it exists; otherwise the setup session id), not to a table.

E3. **Decide (Jev), one fanned-out request per player input:**
- `setup-input-route`: what the latest input does, as a Choice over the host-issued setup moves that are legal now, plus exits:
  - moves: choose a listed source; pick an opening candidate; state or revise card fields; approve the shown card; load a library investigator;
  - exits: `ask_llm`, meaning a question, a discussion, a delegation that needs invention, or anything else; and `none_of_above`.
  - One Noul per move, per D2 of `jev-driven-steps.md`, with the exit Choice.
- `setup-card-fields`, asked when the route clears a card-field move:
  - `occupation`: a Choice over the catalog plus `not_stated`, with a `stated?` Noul. A trade outside the catalog maps to the closest catalog occupation, and the player's own words go to `occupation_stated` by host copy from the input alias, never retyped.
  - `era`: a Choice over finance periods plus `not_stated` (direct when the campaign or module fixes it).
  - `aptitude`: a Choice over the characteristics plus `not_stated`.
  - One Noul per catalog skill: "did the player name this skill as one the investigator has?"
  - A `stated?` Noul per open field (age, sex, name, concept, backstory, equipment), which only decides whether the bind step needs to run.
- Gates are data.
- Approving a card is never executed by Jev. `setup.confirm` stays the player's (the App button) or the Keeper's under an `ask_llm` route, because it creates the world.

E4. **Operate (direct).** The host calls the existing setup step executor with the Jev-bound closed fields. Numbers are never guessed:
- characteristics, spread and credit rating are left to the kernel's existing defaults (reroll, auto spread, the occupation's range);
- a stated number is copied from the input alias only when the player wrote it.

A refusal from the kernel is a normal refusal. The policy then routes to `ask_llm` with the refusal (no retry loop).

E5. **Infer.**
- **`bind`:** only when a stated or required open field remains. The model receives the card and the open keys and writes only those keys through a `setup` tool narrowed to revising open keys. A closed key it sends is refused with the candidates.
- **`compose`:** the model writes the reply to the player with no setup tool (plain assistant text, as setup delivers today).
- **`adjudicate`:** the `ask_llm` exit. The model gets today's full `setup` tool for this step (questions, delegated invention, confirm).

After an LLM step, the next step is direct or finish (the existing anti-loop guard).

E6. **Fallback and accounting.**
- A Jev outage, packing refusal or budget exhaustion means adjudicate with the full tool, exactly today's behaviour.
- Each setup run records the engine, the families asked, bound fields and their paths (`jev`, `stated`, `rule-default`), model steps by purpose, and refusals, on the existing setup telemetry.

**Setup acceptance, pre-registered.** A cold Blood PDF setup through `driver.py --launcher bin/pi-coc-setup --expect-engine`, the main session playing, with the same kinds of inputs as Blood05: a stated occupation outside the catalog, a delegated card, then a revision naming skills.
- Zero kernel refusals caused by the same two classes (unknown occupation, credit rating as a skill).
- The delegated full-card turn takes ≤ 100 s (half the 200.9 s legacy measurement), with ≤ 3 model requests.
- The card's closed fields each carry their binding path.
- Failures are recorded as failures.

### Inventory and contract

Every new Jev call site is added to the Jev inference inventory with owner, family, version, budget, gate and fallback: `source-claim-support`, `source-need-answered`, plus the setup families. Contract §150 records A–E, including the B4 evidence amendment and the setup policy.

## Testing Decisions

- **Good tests assert what an owner or consumer observes, never helper internals.** Examples: which units ran versus were reused; which records changed; what the publication gate accepted; which mode a run recorded; what the Keeper's catalog contained; whether a need produced a reader run. Each fix carries a case that a mutation of the fix fails (memory: product fixes need a mutation-killable case).
- **Highest seams, all existing:**
  - A and D: the hybrid engine through its existing single-loop driver tests (the SL-76/78 consequence tests, the SL-79 catalog tests). Mode resolution through the host budget loader.
  - B1–B3 and B6: the reading service's job runner with a fake runtime, and the reviewer with a fake `run`. Prior art: the existing reading-service and reader-review extension tests, including resume, the review-only resume path and the transport retries.
  - B4: the reviewer and publication gate with a fake decision adapter. Prior art: the source-reader-driver tests' fake adapter and the Jev audit reference tests. The kernel publication gate through the TS kernel module tests. Calibration is a script run on the Mac (live Jev); its output is evidence, not a unit test.
  - B5: the kernel read-ahead and request path in the TS kernel module tests, plus the source driver's locate with a fake adapter.
  - C: the report's own test with fixture telemetry, including an App-home layout.
  - E: the setup driver seam (see §150.5) with a fake decision adapter and the existing setup tests.
- **Suites:** `test:ext`, `test:loop` and pytest run on leehow-pc only. The Mac runs single files, live Jev calibration, and real tables.
- **Acceptance:** real tables through `tests/play/driver.py` with the main session as the only player:
  - (a) A Blood PDF import measured before and after for background author/review/reuse/salvage/need dispositions, same model and settings.
  - (b) A play table on the default engine showing clue steps executed with the mode recorded.
  - (c) A cold setup on the driven engine.
  - Failures are recorded, not relabelled.

## Out of Scope

- Promoting `npc_reaction`/`time_cost` to execute; turning the narrator-only setting on by default (both are the owner's decisions on D6 numbers).
- Reusing fragment work across campaigns (a library-level fragment store with campaign canon applied on top). It is measured waste (pages 15–16 read in two campaigns), but it touches campaign isolation and needs its own ruling.
- Replacing the vision reviewer for images, maps, coverage or scanned pages. Any OCR path.
- Generating graph records with Jev (it cannot generate). Any lexical pre-parser in front of Jev.
- Changing the Keeper model or thinking settings.

## Further Notes

- The owner asked for "按链索引 → LLM 批量生成保存 → Jev 索引和 check → 只重生成替换的". B1–B5 are that shape on the existing owners: the "chain" is the need-driven link path (B5), "save a batch" is salvage and checkpoints (B3), "Jev check" is B4, and "regenerate only the replaced" is B1 and B2.
- Measured evidence roots: `.pi/jpdf-ref-home-blood03/.coc/module-campaigns/jpdf-ref-blood-0{3,5}/modules/book-1/work/`; the reviewer verdict corpus is every `verify-*/unit-*/attempt-*/review.json` under `.pi/` and `.coc/` of this checkout.

## Comments
