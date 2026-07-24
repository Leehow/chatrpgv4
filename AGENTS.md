# Project Rules

## Authority And Required Routing

This is the always-loaded invariant kernel; detailed procedures live below.
When a task matches, read that `SKILL.md` fully, then only its routed references.
Skills own procedure; this file owns product law and cannot be relaxed.

| Work | Required canonical source |
| --- | --- |
| Activate, create, or resume COC mode | `plugins/coc-keeper/skills/coc-main/SKILL.md` |
| Run live Keeper turns or change KP craft | `plugins/coc-keeper/skills/coc-keeper-play/SKILL.md` |
| Run acceptance, playtest, “测完”, long play, or experience-parity work | `plugins/coc-keeper/skills/coc-playtest/SKILL.md` |
| Import a scenario or compile authored source | `plugins/coc-keeper/skills/coc-scenario-import/SKILL.md` |
| Ingest a PDF source bundle | `plugins/coc-keeper/skills/trpg-pdf-ingest/SKILL.md` |
| Inspect or mutate campaign state | `plugins/coc-keeper/skills/coc-campaign-state/SKILL.md` |
| Export the final readable report | `plugins/coc-keeper/skills/coc-export-battle-report/SKILL.md` |
| Add or alter a ruleset | `docs/ruleset-contract.md` and that ruleset package |

Do not duplicate a workflow into a new engine, facade, plugin tree, harness, or
policy source. If a required source is missing or conflicts with this file,
stop and report the boundary instead of improvising a replacement.

## Standing Memory: Never Destroy Playtest Evidence Without Authorization

This is permanent project law. A playtest run's campaign state, logs, tool
calls, transcripts, and session files are the **sole evidence** for battle
reports, bug diagnosis, and experience claims. Destroying them after a run
— by habit, by "clean-slate" reflex, or to tidy up — has repeatedly wiped
out the exact data needed to export reports and root-cause issues. **This
error has been made four separate times. It must not happen again.**

1. **Never `rm -rf` a campaign, its `.coc/campaigns/<id>/` directory, its
   logs, its investigators, or its module-assets root after a real run** —
   not even "to clean up for the next test." Keep it until the user
   explicitly says to delete it, or until a battle report has been
   successfully exported from it via `coc-export-battle-report`.
2. Module-assets (`source-bundles`, `module-assets/`) are reusable parse
   caches; deleting them invalidates `lookup_by_sha256` reuse and forces
   re-parse. Do not delete them to "start clean" unless the user asks.
3. If a new run needs a fresh campaign, **create a new campaign ID** (e.g.
   `amaranthine-16`) — do not destroy the previous one to reuse its slot.
4. The `coc-export-battle-report` skill is the **sole** final report owner.
   A hand-written Markdown summary is a draft, never a substitute. Before
   writing any report, confirm the campaign evidence still exists; if it
   was destroyed, state that honestly and do not reconstruct from memory.
5. This rule survives compaction and handoff. "I forgot" or "I was just
   cleaning up" is never an acceptable reason for missing run evidence.

## User Intent Over Deliverables (Read First)

**Deliverables serve intent; intent does not exist to produce deliverables.**
Before large work, restate the user's job, success condition, and what would be
hollow even if files, tests, turns, or reports look complete.

- Prefer fewer real steps over synthetic volume. Counts, coverage, tests,
  reports, and status files are evidence only after method matches intent.
- Keep user requirements, observed facts, inferences, and proposals distinct.
  Ask only when a real ambiguity would materially change scope or behavior.
- Never invent an easier goal, continue a known-wrong path because it has
  artifacts, or polish an answer to a different question.
- On intent skew, stop, name the mismatch, re-anchor on the user's actual job,
  and label non-serving artifacts `invalid-for-intent` and, when applicable,
  `invalid-for-acceptance`. Do not launder them into progress.
- Grok-family models must write before multi-step work: “User is trying to ___.
  Success looks like ___. Hollow delivery would be ___.” Summaries emphasizing
  “finish N turns” or “export a report” are suspect until rechecked.

## Standing Memory: Never Self-Authorize A Different Playtest Method

This is permanent project law. **Slow is fine. Fake is forbidden.**

1. The default for playtest, acceptance, “100 轮”, “跑完”, long-play, and
   experience claims is window-equivalent play: the main session is the live KP
   using normal skills/toolbox; a human or exactly one isolated player supplies
   one natural table reply at a time.
2. Before acting, say plainly that this correct method is slow and that a
   settle/batch substitute is not product testing. If any alternative is being
   considered, wait for an explicit method choice.
3. Never create, run, resume, or improve a fake-KP settle/batch harness,
   intent-regex router, canned scene bank, parallel thin Keeper, or multi-turn
   factory to manufacture turns, coverage, or reports.
4. The only exception is an exact current-turn user order for that engineering
   path, explicitly labeled `smoke` or `engineering-probe` and forbidden from
   supporting acceptance, experience, or “played N turns” claims.
5. If a prior turn or compaction already used the wrong method, stop it
   immediately, disclose the error, mark its artifacts
   `invalid-for-acceptance` / `invalid-for-experience`, and do not export or
   repair them into experience evidence.
6. Carry this constraint through compaction and handoffs. An old apology, an
   existing `kp_settle_turn`-class script, speed pressure, or an overnight goal
   never restores permission.

Grok / Grok Build must re-read this and `Playtest Experience Constitution`
before any playtest toolbox call or `*settle*` / `*batch*play*` artifact. It
must refuse deliverable theater rather than silently change methodology.

## Python Interpreter Contract

The only environment is CPython 3.14.6, declared exactly by `.python-version`
and `project.requires-python`; dependencies come only from committed `uv.lock`.

- Install and use exactly uv 0.11.16; bootstrap with
  `uv sync --frozen --dev`.
- Run every repository Python command from the root as
  `uv run --frozen python ...`. From elsewhere, add
  `--project <repo-root>` before `--frozen`.
- Python children use `sys.executable`. Versioned JSON registries use
  `{python}`, resolved by their owning runtime; never select `python` or
  `python3` from `PATH`.
- `#!/usr/bin/env python3` shebangs are portability metadata, not an approved
  repository invocation path.
- A Python/dependency upgrade is one atomic contract change across
  `.python-version`, `pyproject.toml`, `uv.lock`, CI, active docs, and contract
  tests. Never broaden the exact version constraint.

## PDF Source Bundle Contract

The repository contains **no PDF parser**. An external PDF skill owns rendering,
review, extraction, and page evidence; repository code only validates/reformats
its bundle through `plugins/coc-keeper/scripts/coc_pdf_bundle.py`.

- Prefer the current host's suitable PDF capability. If none exists, recommend
  the open-source workflow at
  `https://github.com/openai/skills/tree/main/skills/.curated/pdf`.
- A third-party producer is acceptable only if it emits the same contract.
  Never add a repository PDF parser, OCR fallback, or PDF parsing dependency.
- `producer: codex-pdf-skill` identifies the handoff contract, not the host.
- Schema v1 records original path/hash, zero-based `pdf_index` Markdown
  paths/hashes, and host-declared `review_state`, `parse_confidence`, and
  `grep_anchors`. Pass it through; never invent quality or page offsets.
- Binding stores canonical `bundle_sha256`. Hydration rejects source identity,
  page content, review evidence, or asset drift.
- Repository code may check the original PDF's existence, suffix, and SHA-256;
  it must not open the PDF for page count, metadata, layout, images, or text.

## COC Plugin Single-Track Law

`plugins/coc-keeper/` is the sole plugin for every host. Never create a
host-specific copy, alternate toolbox, reduced Pi facade, or forked path.

- Rule systems are packages under `plugins/coc-keeper/rulesets/<id>/` per
  `docs/ruleset-contract.md`; `coc7` is the reference package. Kernel state,
  dispatch, advisory, module, and runtime machinery stays ruleset-agnostic.
- CoC-specific SAN, Mythos, and dice craft bind `coc7` campaigns. Architecture
  rules—KP is the product, semantic authority, advisory boundaries, real
  acceptance, and no fake-KP—bind every ruleset.
- AI-coding hosts and Pi/headless are one product. A capability is complete only
  when its applicability, consumer, effects, and evidence are equivalent and
  validated across relevant surfaces.
- A platform limitation must be explicit and gated, never a silent weaker KP.
  Portraits use the current host's built-in image tool or are skipped; never
  route through another host. The gate is `HOST_NATIVE_IMAGEGEN` in
  `rulesets/coc7/skills/coc-character/SKILL.md`.

## Keeper Toolbox Architecture

The live Keeper drives every turn, choosing semantically from canonical skills
and the one registry; there is no fixed turn pipeline:

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_toolbox.py list
uv run --frozen python plugins/coc-keeper/scripts/coc_toolbox.py <tool> --root . --campaign <id> --json '<args>'
```

Exactly four tool-enforced rules are hard; everything else is advisory
`warnings` / `hints`:

1. `rules.*` owns deterministic dice and HP/SAN/skill arithmetic; the KP never
   invents or adjusts results.
2. `state.*` owns transactional, idempotent writes using `decision_id`; never
   hand-edit a live save.
3. Module truth is read-only. Keeper-only material stays `secret: true` and is
   revealed only through play.
4. After a played turn settles checks, player output is released only from one
   hash-bound finalization receipt created after all rule/state writes. It
   closes every settled check with causal fictional realization or an explicit
   secrecy-preserving concealed disposition, and renders every required public
   roll and visible mechanical change exactly once from authoritative sources.

Rule 4 is only a settled-output completeness boundary. It is not a prose judge
or permission to require Director, Storylet, NPC, or narration calls; rerun
mechanics; reveal secrets; or allow, deny, force, reorder, or suppress actions,
scenes, or clues. Do not add another blocking narrative gate. Scene transitions,
clue delivery, Storylet eligibility, pacing, and prose review stay advisory.

## COC Keeper Product Constitution

These product laws bind code, docs, review, and validation; only explicit user
direction may change them.

### The KP Is The Product

- The canonical KP is an agent that understands the player and runs the table:
  intent, world causality, framing, NPC agency and portrayal, clues, pacing,
  personal horror, consequences, and final narration.
- Tools support the KP. A rules/state shell wrapped in prose is not an
  acceptable Keeper.
- The KP chooses methods and final fiction. Never replace that judgment with a
  fixed call order, workflow, quota, or second orchestration engine.

### Player-Visible Language

- Every player-visible string uses active `play_language` (default `zh-Hans`):
  narration, dialogue, delivered handouts, rolls, visible mechanics, choices,
  prompts, and recaps.
- Source modules and machine IR may remain in source language. Prefer
  `localized_text` / `localized_terms`; otherwise faithfully render the full
  substance in table language. Do not append source English unless asked.
- JSON keys, IDs, enums, tool envelopes, and audit labels are machine data, not
  finished prose.
- Only diegetic foreign speech may remain foreign, governed by the
  investigator's Language skills and `coc-keeper-play` guidance.

### Semantic Matcher Constitution And Advisory Authority

- Meaning-bearing decisions—player intent, NPC hostility, clue relevance,
  Storylet fit, report coverage, and prose quality—must use semantic reasoning.
  Never infer them from keyword hits, regexes, exact free-prose fragments, or
  fixed phrase lists.
- Valid inputs include structured enums, IDs, tags, booleans, rules data, and
  recorded semantic-router/LLM results with reasons. If only prose exists, call
  a semantic compilation step; do not add a keyword list.
- Director, narrative, enrichment, Storylet, NPC, pacing, and language methods
  return reasoned facts or suggestions. The KP may adopt, modify, or ignore
  them. They never allow, deny, force, suppress, reorder, or replace the KP or
  player, and their absence never blocks play.
- The KP owns interpretation, causality, pacing, and prose; rules tools own
  arithmetic and state tools persistence. Raw outputs are data. Fiction may
  portray a false report but never alter authoritative results/state.
- Existing string-heuristic fallbacks are technical debt and must not be copied.

### Controlled Improvisation Becomes Campaign Canon

- Module/rulebook source stays read-only, but the KP may semantically create
  campaign-local identities, histories, motives, events, clue interpretations,
  hooks, and ambiguous hints—even when they appear to conflict with source or
  earlier fiction.
- Preserve both assertions and provenance as structured
  `continuity contradiction` / `narrative debt` in the best-fitting campaign
  records. What becomes canon immediately is that each assertion occurred, not
  that either is final objective truth.
- Carry the debt into later causality and resolve or deepen it semantically.
  Never use keyword-to-excuse mappings, silent retcons, or deletion.
- Dice/state authority and secrecy remain hard boundaries. Contradiction never
  permits numeric mutation or secret dumping; a guess is not canon by itself.

### Player Knowledge Boundary (KP Owns The Intercept)

Players may guess, speculate, or bait a spoiler. **KP owns the intercept.**

- Track investigator knowledge from player-visible fiction, sheet, public
  rolls, journals, and discovered clues—not keywords.
- Separate an achievable attempt from a player's unearned assertion about room
  contents, NPC secrets, module layout, or unrevealed clues. Never enact the
  assertion merely because the player said it.
- A lucky correct guess remains a guess; discovery must still be earned.
- Intercept clearly, preferably in play voice with light Table Wit rather than
  an OOC scold.
- Do not ban players from guessing. Ban the KP from treating a guess as
  established knowledge or permission to reveal module truth.

### Exceptional Results Must Change Play

- A critical, fumble, or failed pushed roll closes only when it causes a
  source-bound, auditable effect that changes play: authoritative resource
  change, scoped bonus/penalty, bounded condition/access change, relationship
  or threat change, or a concrete opportunity/danger/event.
- The KP selects the effect semantically from method, stakes, scene, portrayal,
  and result. Never map skills, prose keywords, or result labels to canned
  rewards. The causal connection must be player-visible.
- Elapsed time or a generic flag counts only when it fires a real deadline,
  restriction, threat, resource window, or downstream opportunity.
- Apply the effect through canonical rules/state tools before finalization,
  render it once, bind it to the exact roll, and preserve it in report evidence.
  `turn.finalize` fails closed when a qualifying roll lacks that binding.

### NPC Contact, Multi-NPC Scenes, And Relationships

- Each investigator/stable-NPC pair's first material meeting uses one public
  D100 check against the higher of APP or Credit Rating. Record the source and
  freeze the receipt; never reroll-shop.
- Agenda, relationship, duty, safety, and causality constrain realization. A
  critical cannot erase committed hostility; critical/fumble outcomes require a
  concrete benefit/cost, not an attitude adjective.
- Render the one-time public block with APP, Credit Rating, governing value,
  roll, and level; preserve it in canonical roll and report evidence.
- A scene may contain zero, one, or many materially acting NPCs. Never collapse
  several voices, receipts, engagements, or effects into a single-NPC turn.
- Each investigator/NPC pair owns its identity, reaction receipt, engagement,
  causal realization, and first-contact block. This is capacity, not a crowd
  quota.
- Later relationships change through semantic KP judgment and canonical NPC
  state/effects. Record investigator, NPC, source, reason, applicability, and
  end/consumption. Never use prose keywords or quotas; the first receipt stays
  immutable.

## Feature Integration And Repair Discipline

### Feature Integration Is Part Of Implementation

A feature is implemented only when:

1. its user/KP problem and canonical consumer are named;
2. normal play exposes it through canonical skills, registry, or typed gateway;
3. the KP discovers its purpose/applicability without hidden code or a harness;
4. its result reaches KP judgment, canonical state, or visible output;
5. real plugin-native play exercises the normal path; and
6. visible effects and authoritative changes survive in normal evidence.

Otherwise label it `experimental` or `unintegrated`; do not advertise support,
completion, parity, or release readiness. Component tests prove component
contracts, never discoverability or integration.

### No Speculative Production Features

- Before coding, inspect canonical skills, registry, runtime, scripts, tests,
  docs, plans, and history. State whether work reuses, repairs, reconnects,
  composes, extends, or replaces what exists.
- Prefer completing an existing path. A replacement requires an explicit reason
  the current path cannot serve and a retirement plan for the duplicate.
- Name value, caller, trigger, I/O, integration, consumer, evidence, and
  real-plugin validation before production code. Unknowns stay in design.
- Registry exposure, skill guidance, consumer integration, and evidence change
  together. Do not ship test-only or host-parallel functionality.

### Thin Code, No Paper Loops, And Actual-Play-First Repair

- Repository code owns deterministic mechanics, transactions, task boundaries,
  schemas, provenance, and cache/delivery bookkeeping. Semantic understanding,
  direction, NPC craft, clue interpretation, pacing, and table prose stay with
  the live KP.
- Every new helper, state field, receipt, cursor, phase, queue, or adapter names
  its canonical caller/consumer, observed failure, why an existing path cannot
  carry it, and the real play that will exercise it. Otherwise simplify.
- Prompts, plans, schemas, and reviews are preparation, not product progress.
  After one design pass and one adversarial review, unresolved complexity means
  shrink or implement the smallest vertical slice. Two consecutive paper-only
  cycles require stop-and-simplify; a third needs explicit current-turn user
  authorization.
- Default loop: **observe in real play → identify the smallest systemic failure
  → implement the thin fix → run proportional deterministic checks → replay the
  same normal plugin path**.
- Return to window-equivalent play as soon as the narrow safety checks pass. If
  repair expands, state the blocker, added mechanism, complexity cost, and why
  play cannot resume; never silently authorize a broad architecture program.

### System Gap Before Instance Patch (修/补/Fix 先看全局)

For a fix, patch, fill, deepen, or “补” request:

1. Name the product/runtime failure class.
2. Inspect the existing skill, registry, progressive/module, state, test, and
   plan paths for that class.
3. Repair or extend the systemic path so the next similar case works.
4. Add one-off instance content only when explicitly requested, or as a labeled
   thin sample after the system path exists.

Do not treat one thin location, NPC, clue, or save as permission to hand-author
only that instance. Clarify only when system repair versus instance content is
genuinely ambiguous.

## Plugin-Native Acceptance Contract

Whole-product acceptance uses the real canonical plugin, never a scripted
player, fixed profile, evaluation matrix, or parallel Keeper runtime.

- The **main Codex** is the live Keeper through normal `coc-main` and
  `coc-keeper-play`. One player collaboration agent uses
  `fork_turns: "none"` and receives only player-safe narration, its sheet,
  public rolls, and explicit choices. It never sees module truth, Keeper state,
  tool rationale, or hidden logs.
- Shared filesystem means protocol isolation, not a cryptographic sandbox;
  record that limitation honestly.
- Every run uses a fresh isolated workspace and exact-current-schema campaign.
  Never resume historical test saves or use old reports as runtime state.
- Continue one natural reply at a time until structured ending evidence or a
  true operational blocker. A convenient turn count, multi-NPC contact, or
  coverage target is not an ending.
- Preserve exact Keeper text and player reply; summaries never replace them.
- After play, `coc-export-battle-report` is the sole final report owner for
  `artifacts/battle-report.md` and
  `artifacts/battle-report-evidence.json`. Never hand-fill missing facts or
  reconstruct dice from prose.

Raw-PDF acceptance cannot start from a prebuilt bundle. It includes external
extraction/bundle creation, minimum opening parse, first playable opening, and
subsequent background parsing. Method mismatch invalidates acceptance even when
latency or coordinator evidence is useful.

### Dice Completeness Gate

Structured roll logs are authoritative. Every required `public` or
`consequence_public` roll appears exactly once in `rules-and-dice` with
source-traceable numbers; zero rolls requires an explicit zero count. Missing,
duplicate, malformed, or untraced markers/source logs are hard failures. Never
reconstruct a roll from memory or prose or remove a failed completeness finding.

## Playtest Experience Constitution

Acceptance and “测完 / 玩家体验等价” claims must match a real player loading the
plugin. The full procedure belongs to `coc-playtest`; these invariants remain
always active:

- Use the ordinary skill path and unified toolbox. The main session remains the
  full KP; the player agent only types player lines. Pi/headless and other hosts
  are the same product surface, not reduced acceptance facades.
- Never thin KP craft to finish modules, meet a schedule, hit turn/scene counts,
  or make a report `COMPLETE`.
- A path dominated by `rules.*` / `state.*` / `scene.move` plus log prose is not
  acceptance. Advisory capabilities must be discoverable and actually used
  where fitting across the run; one turn may need none, but systematic zero-call
  evidence cannot establish parity. Record consulted-method disposition with
  `evidence.record_adoption`.
- Table text stays in `play_language` with action uptake and readable public
  rolls. Never dump tool envelopes, source-language manuscript blocks, English
  outcome enums, chain-audit labels, or CRPG option lists as narration.
- The absolute fake-KP ban and Grok preflight near the top of this file apply
  without exception. Prefer a short honest live run to long synthetic volume.
- `battle-report` `COMPLETE` / `INCOMPLETE` describes report-source evidence,
  not prose, KP craft, advisory use, integration, or parity. Label probes
  precisely.

## Playtest Battle Report Evidence Standard

“战报” is actual-play evidence, not a formatter sample or fixture.

- Read `battle-report.md` end to end and inspect
  `battle-report-evidence.json` before quoting or summarizing.
- Evidence includes context, exact transcript, relevant rolls, clues,
  progression, and evaluated effects.
- State missing/failed evidence; never substitute a formatter sample, fixture,
  or unavailable run as “the battle report.”
- Scope claims precisely. Dice/source completeness is not whole-product
  completeness; missing evidence never becomes a pass.

## Validation And Evidence

Whole-product, UX, latency, Keeper-quality, integration, and acceptance claims
come primarily from window-equivalent play. Automated tests remain authoritative
for deterministic arithmetic, schemas, transactions/idempotency, path safety,
secret/public projection, plugin metadata, PDF bundle validation, and typed
tool/runtime contracts. They must not infer prose meaning with keyword tests or
claim to measure the whole Keeper.

Before finishing plugin work, run at minimum:

```bash
PYTHONDONTWRITEBYTECODE=1 uv run --frozen python -m pytest tests/test_plugin_metadata.py -q -p no:cacheprovider
```

Changes under `rulesets/coc7/rules-json/` additionally run:

```bash
PYTHONDONTWRITEBYTECODE=1 uv run --frozen python -m pytest tests/test_rulebook_data_audit.py -q -p no:cacheprovider
```

`scripts/verify_*_ocr.py` are extraction-time checks requiring the MinerU cache,
not pytest. `checks/exhaustive_rulebook_validator.py <playtests-root>` sweeps
play logs and exits 2 rather than granting a vacuous pass on zero records.

## Runtime Track And Clean-Slate Persistence Policy

`runtime/` is the open headless interface (Event SDK plus debug/Pi adapters).
It consumes canonical skills and rules from `plugins/coc-keeper/`; project brain
selection lives at `.coc/runtime.json`.

`web/` is a thin browser surface over that same SDK (React UI plus a stdlib
HTTP/SSE bridge; no rules or narration semantics of its own). Build with
`cd web/frontend && npm install && npm run build`, then serve via
`uv run --frozen python web/server/app.py --workspace . --port 8765`.
See `web/README.md`.

This is clean-slate. Reject/delete campaign/runtime/cache state without an exact
current schema/version, then start fresh. Never add migrations, dual readers,
compatibility fallbacks, or old-ID remapping. Historical reports stay read-only;
same-version atomic crash backup/restore is allowed.

Coverage plans and cross-run visited unions are post-run evidence only. They may
identify gaps or motivate another fresh playtest, but never allow, deny, force,
reorder, or suppress scenes, clues, narration, actions, rewards, development, or
endings.
