# Project Rules

## Pi home isolation (binding)

Pi is fully isolated inside this repository. Never use `~/.pi/agent`,
`~/.pi/coc-agent`, or another project's `.pi/`.

- Coding (`pi` / PipiUI): `{this-repo}/.pi/agent`
- COC play (`pi-coc`): `{this-repo}/.pi/coc-agent`

Find this project's own home. Do not `pi install` the COC package into a
global `settings.json`, and do not symlink this home back to `~/.pi`.

## Text Work Runs As A Pi Agent (Binding, Ask Before Any Exception)

**Any model work over document or module text runs as a pi agent with tools.**
Not `--no-tools`. Not a single completion. Not a raw provider call, not an HTTP
request to an API, not a subprocess that takes a prompt and returns one string.

If you believe a task needs anything other than a tool-using pi agent, **stop
and ask the user in the current turn.** Do not decide this yourself, do not
decide it "just for an experiment", and do not decide it because a one-shot
channel is easier to wire. Silent adoption of a non-agent path is what this
rule exists to prevent.

### Why (measured, not preference)

A single completion has to fit its whole answer in one assistant message. On
this project's channel that ceiling sits near 47,000 characters -- 31 accepted
extractions, none above 47,226, and every truncation reported `stopReason:
error` rather than a clean stop. Everything downstream deforms around it:

- Sections get cut to four pages so the answer fits, which multiplies model
  calls -- the cost of a build is generation time, and a build already spends
  2.5 rounds per section.
- Density falls as the ceiling binds: ~11 nodes per thousand source characters
  on the sparse half of sections, ~3.6 on the dense half. The book is being
  compressed to fit a message, not read.
- The whole evidence packet has to be pushed through the prompt (60-70 KB)
  because the reader cannot open a file.
- Findings have to travel back out to a driver and in again, because the
  reader cannot run the validator itself.

An agent with `read/write/edit/bash` has none of those limits: it opens the
packet, writes the shard to a file across as many turns as it needs, runs the
gates itself, and fixes its own findings. The ceiling stops being a design
constraint on the pipeline.

### What this does not license

The agent still writes only what the source says, still cites real spans, and
is still judged by the same deterministic gates. Agent mode removes a length
limit; it removes no obligation. `--approve` grants tools, not trust: the gates
remain the authority on whether a shard is accepted.

## Authority And Required Routing

This is the always-loaded invariant kernel; detailed procedures live below.
When a task matches, read that `SKILL.md` fully, then only its routed references.
Skills own procedure; this file owns product law and cannot be relaxed.

| Work | Required canonical source |
| --- | --- |
| Activate, create, or resume COC mode | `plugins/coc-keeper/skills/coc-main/SKILL.md` |
| Run live Keeper turns or change KP craft | `plugins/coc-keeper/skills/coc-keeper-play/SKILL.md` |
| Import a scenario or compile authored source | `plugins/coc-keeper/skills/coc-scenario-import/SKILL.md` |
| Ingest a PDF source bundle | `plugins/coc-keeper/skills/trpg-pdf-ingest/SKILL.md` |
| Inspect or mutate campaign state | `plugins/coc-keeper/skills/coc-campaign-state/SKILL.md` |
| Export the final readable report | `plugins/coc-keeper/skills/coc-export-battle-report/SKILL.md` |
| Add or alter a ruleset | `docs/ruleset-contract.md` and that ruleset package |

Do not duplicate a workflow into a new engine, facade, plugin tree, harness, or
policy source. If a required source is missing or conflicts with this file,
stop and report the boundary instead of improvising a replacement.

## Codex And Pi-Coc Development Track Lock

This repository has two distinct host development tracks:

1. **Codex track** — the Codex-hosted COC workflow.
2. **Pi-Coc track** — the Pi-hosted workflow launched through `pi-coc`.

They share one canonical plugin and rules kernel, but they are separate
development scopes. Never treat work requested for one track as permission to
modify, repair, synchronize, or redesign the other track.

The standing default is `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`. Declare that
lock and proceed. Do not ask which track to use for ordinary work.

Ask the user exactly `继续开发 Codex 版还是 pi-coc 版？` only when the user
explicitly names the Codex track, or the requested work is confined to
Codex-host implementation, adapters, prompts, launchers, tests, or
documentation. Do not treat prior conversation, a dirty tree, a worker
handoff, an apparently obvious target, or a request to “继续” as a Codex
switch. After an explicit Codex switch, declare
`ACTIVE_IMPLEMENTATION_TRACK=codex`; otherwise keep `pi-coc`. Keep the
declared track locked for the entire task:

- With `ACTIVE_IMPLEMENTATION_TRACK=codex`, Pi-Coc implementation, adapters,
  prompts, launchers, tests, and documentation are off-limits.
- With `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`, Codex-host implementation,
  adapters, prompts, launchers, tests, and documentation are off-limits.
- Shared kernel, state, registry, contract, or skill files are **cross-track
  scope**. They are off-limits by default after either selection. If the chosen
  track cannot be completed without changing a shared file, stop, name the
  exact file and reason, and obtain explicit user authorization before editing
  it.
- Every worker prompt, handoff, review, and validation report must state the
  active track and its off-limits opposite track.
- Tests may inspect the opposite track only for non-regression when necessary;
  they must not update its fixtures, expectations, snapshots, or behavior.
- Never switch tracks mid-task. If a new request appears to target the other
  track, stop and ask the user to confirm a new track lock before continuing.
- If the worktree already contains unknown or concurrent edits from the
  opposite or cross-track scope, do not absorb, clean, revert, complete, or
  commit them. Report the conflict and wait for direction.

Any result that edits the opposite track, or that edits shared files without
explicit authorization, is `invalid-for-integration` for both tracks, even if
component tests pass. Ordinary pi-coc work does not require a spoken
per-task track choice.

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

### Pi subprocess mode evidence

Do not infer that a Pi image/tool workflow requires RPC merely because the
model performs several internal tool calls. A single `pi -p` task may run its
own model-tool loop, including reading a local image, before returning one
terminal result. Use `-p` only when one initial prompt can complete the closed
job and the outer controller needs only that terminal result. Evaluate and
test `--mode rpc` when the controller must append images or instructions after
launch, observe structured progress or state, steer or follow up, or request a
protocol-level abort. Every mode choice requires executable evidence for the
needed behavior; terminology such as “multi-turn” is not evidence by itself.

### Counting Calls In Playtest Evidence (Binding)

A string count over `rpc-events.jsonl` counts MENTIONS, not calls. Operation
names appear in tool catalogs, discovery payloads, JSON schemas, prompt prose
and error messages, so `grep -c '"turn.finalize"'` can report a hundred for an
operation that was called once.

Count calls from `tool_execution_start` events, reading `toolName` and
`args.operation`:

```python
name = row.get("toolName") or ""
op = (row.get("args") or {}).get("operation")
called = op or name
```

**The Keeper mostly uses the direct tool names, not the generic envelope**, so
an operation invoked as `coc_turn_finalize` is invisible to a search for
`turn.finalize`. Count both spellings or you will under-count the direct path
and over-count the generic one.

This was violated three times in one session, each time producing a decision:
`agency_review_operation` "1111 occurrences" (mostly prompt prose),
`turn.output_context` "58 calls" (4 real), `turn.finalize` "109 calls" (9
real). One feature was built onto an operation with zero real calls, then
migrated onto another believed to have 58 and actually having 4.

Before building anything the Keeper is meant to receive, count its host
operation's REAL calls in preserved evidence first. An unreachable operation
is a feature that does not exist, and this repository has now found four:
`output_instruction` (no readers), `localized_terms` (no writer),
`narration.review` (not offered in normal play), `narration.brief` (never
called).

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

## Parallel Lines And The Operation Surface

Three lines develop against this repository at once — rules, director, text —
and the operation surface is the seam all three touch. Two failure shapes come
out of that seam. Both are mechanical; neither is a judgement call.

**A conflict in a generated projection.** `references/mcp-operation-contracts.json`
and `pi/lib/operation-policy.generated.ts` are derived from the canonical
operation registry and committed. Any two lines that add an operation conflict
on `operation_count` and `content_sha256`, every time. Both sides are equally
wrong and equally right, because both are output. Resolve it the same way
every time:

```bash
git checkout --ours plugins/coc-keeper/references/mcp-operation-contracts.json
uv run --frozen python plugins/coc-keeper/scripts/coc_mcp_contract_archive.py build
```

Then stage both generated files. `tests/test_generated_projections.py` fails if
you forget the second command, so a hand-resolved projection cannot reach a
table.

**A frozen count in someone else's suite.** Never assert the size of the
operation surface against a literal. Four separate suites had done it, at three
different values, and one deliberate addition turned them red hours apart in
suites their authors were not editing — each looking like an unrelated
regression. Assert what the test is about instead: self-consistency
(`archive["operation_count"] == len(archive["operations"])`) or the membership
the test actually needs. `test_no_test_hardcodes_the_operation_count` keeps the
constant from coming back.

**Sync direction matters more than either.** Merge the integration branch into
your branch often, rather than saving it for the end. Five small merges during
one session were all trivial; the one time the branch was left to drift 39
commits, the generated projection conflicted. Layers are how the code is
organized, not how branches should be: a long-lived branch per layer diverges
by construction.

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
- Prose is **written in the player's language, not looked up**. `play_language`
  is a free-form tag, never an enum of supported languages, and there is no
  `language_profile` label bundle — it was removed after every one of its keys
  proved to have zero readers. Do not add one back; see
  `docs/status/play-language-layer-is-unnecessary.md`.
- The two surviving tables are not exceptions waiting to be cleaned up.
  `DEFAULT_LOCALIZED_TERMS` holds rulebook terminology, where cross-turn
  consistency is the point. `TABLE_MECHANICS_LABELS` holds chrome for
  deterministic mechanics blocks, which the host composes and hashes into
  `rendered_text_sha256` — the Keeper must not author them, so an output
  instruction cannot reach them.
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

## Model-Facing Identifier Law (Semantic IDs Only)

Large models mis-transcribe random identifiers — uuids, hex digests, hash
ids, base62 noise — at very high rates. This is a protocol-design law, not
a prompt-tuning problem; it binds code, schemas, prompts, worker
instructions, and reviews on every host.

- Any identifier a model must read, copy, echo, choose, or emit on a
  contract surface is a **semantic id**: human-readable, meaning-bearing
  tokens (kind, entity slug, page scope, ordinal) that stay stable across
  retries. Example: `deepen-handout:small-card-1:page-13`, never
  `job-75caedf23af6`.
- Random digests are **machine-internal integrity evidence**. Code owns
  their generation, attachment, and verification end-to-end. A protocol
  must never require a model to relay a random id between messages: the
  machine re-attaches identity after the model's semantic payload, and
  anti-drift is enforced by digest checks in code — never by asking the
  model to echo opaque bytes.
- Where an id is both machine-created and model-visible (job ids, dispatch
  keys, lease ids, packet ids), it is semantic by construction with a
  designed namespace — kind prefix + entity slug + scope + revision
  ordinal — so ids cannot collide across kinds, campaigns, or asset roots.
  Uniqueness comes from namespace architecture, not randomness.
- New contracts, schemas, prompts, and instructions must not introduce
  random-id transcription for models. Existing surfaces that demand it
  (`job-<hex>` ids, `source-lease-<hex>`, hash-derived dispatch keys,
  byte-equal receipt echoes) are technical debt: convert the lane
  systemically when it is touched, and never copy the pattern into new
  work.

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

## Pi-Coc Playtest Method

Pi-Coc 验收/体验测试的唯一方法：

1. 通过 pi-coc **RPC 模式**启动插件。
2. **Grok 当 KP**（Keeper），驱动全部 Keeper 判断、叙事、NPC、规则调用。
3. **主会话（或指定代理）当唯一玩家**，一次一句自然回复，从头跑到尾。
4. 沿途覆盖需要测试的能力点（建卡、开场、线索、战斗、SAN、结局等），
   不预设固定脚本，由 KP 正常推进。
5. 慢可以，假不行。不得用批处理、工厂、canned scene 制造回合数。
6. 跑完后用 `coc-export-battle-report` 出战报；战报是实际游玩证据。

此方法替代已删除的 `coc-playtest` skill。任何声称"测完"或"体验等价"
的工作必须匹配上述流程，否则标记 `invalid-for-acceptance`。

## GLM / Z.AI Thinking Control (measured 2026-09-02)

任何在本仓库里用 GLM（zai / zai-coding-cn）跑 Keeper 回合、造景诊断或长任务
的 agent，先读这一节。**传 `--thinking low` 不会减少思考，等于没省额度。**

Pi 对 `thinkingFormat: "zai"` 的实现（`pi-ai/dist/api/openai-completions.js`）：

```js
thinking = reasoningEffort ? { type: "enabled", clear_thinking: false }
                           : { type: "disabled" }
```

`reasoningEffort` 只要有值（`low` 也算）就走 **enabled** 分支。Z.AI 官方文档里
关闭思考的唯一参数是 `thinking: {"type": "disabled"}`，对应 Pi 的
**`--thinking off`**。

同一条造景 lane、同一个 180 秒预算的实测：

| 配置 | 思考字符 | 工具调用 |
| --- | --- | --- |
| glm-5.3 + `low` | 26,818 | 2 |
| glm-5.2 + `low` | 26,977 | 5 |
| **glm-5.2 + `off`** | **4,076** | **13** |

推理量降到 1/6.6，可用的工具调用翻 2.6 倍。

**模型差异（Z.AI 官方文档）**：**GLM-5.3 与 GLM-5.3-FLASH 是强制思考，无法
关闭**；GLM-5.2、GLM-5.1、GLM-5、GLM-4.7 及更早可以关。所以省额度要用 5.2，
不要用 5.3——5.3 无论怎么设都会烧掉那两万多字符。
`models-store.json` 里五个模型只有 `glm-5.2` 的
`compat.supportsReasoningEffort` 为 `true`。

**边界**：`thinking off` 只解决「单次思考太长」，不解决「一个回合往返太多次」。
glm-5.2 + off 那条 lane 仍然把预算花在四次 `transcript.locate` 和四次
`discover` 上，回合没跑完。两者是不同的问题，别用前者的结论掩盖后者。

来源：<https://docs.z.ai/guides/capabilities/thinking-mode>

## Pi-Coc 两个进程（pi-coc-setup / pi-coc）

开局引导与上桌游玩是**两个命令、两个进程**，不是一个会话里的两个 role。
`COC_PI_SESSION_ROLE=setup` 已退休：`sessionRoleFromEnv` 会拒绝它并告警。

- **`pi-coc-setup --campaign <id>`** — 引导。加载 `pi/extensions/onboarding/`
  与 `pi/prompts/onboarding-system.md`，`--no-extensions` 所以它**不加载宿主扩展**：
  没有阶段机、没有游玩工具面、没有投影登记表。顺序由
  `pi/extensions/onboarding/steps.ts` 这一张表派生（工具面、拒绝语、下一步说明
  同源），每一步的 `done` 读战役目录而不是内存计数。做完 `setup.complete` 就结束。
- **`pi-coc --campaign <id>`** — 桌子。只开 `ready_for_table` / `active` 的战役；
  否则打印 `pi-coc-setup --campaign <id>` 并以 3 退出。它不会变成引导进程。
- **清单**：`plugins/coc-keeper/pi/session-roles.json` 只剩 `play` 半边。
- **交接**：`setup.complete`（幂等、`decision_id`）写 `ready_for_table` 与
  `setup_handoff`，引导进程结束；玩家另开 `pi-coc`，它 `session.resume` 后经
  `evidence.table_opening` 开场。**没有退出码 42、没有 re-exec、没有角色重判**。
- **建卡**照 `docs/methods/immersive-character-creation.md`；那份文档由引导扩展
  随步骤指令原文投送，因为引导会话没有 `read` 工具。
- **开场六项快速事实（`setup.adopt_source_facts` + opening source coordinator）
  已退休**：它读 3 页答 6 个字段，而模组真实结构由 ModuleGraph 负责。引导不再
  派任何子代理。

### Non-LLM Three-Second Diagnostic Rule

Any operation that does not involve LLM/model inference and exceeds 3 seconds is
an active diagnostic incident. Immediately inspect the exact command or test
node, whether real output is advancing, CPU/IO, locks, and child processes.
Wrapper or driver heartbeats and CPU activity alone do not prove healthy
progress; never merely report elapsed time and continue waiting. If real
progress is not demonstrated, split the work into smaller observable units,
repair or re-point the progress channel, or abort and resume the same
worker/worktree by a materially different route. Exceeding 3 seconds triggers
inspection; it does not require killing an operation whose exact node-level
progress is proven. LLM/model inference calls are the only timing exemption.

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

`web/` and the Electron shell in `desktop/` are the **UI of the pi-coc
interactive host**. The product turn channel is a `pi-coc` RPC session
(`pi --mode rpc` with the canonical COC package loaded): the browser/Electron
surface renders that host's event stream and sends player input, so character
creation, onboarding, steward dispatch, live turns, and output boundaries all
come from the same pi-coc host a terminal player gets — never from a second
keeper shell with its own prompt or turn contract. The legacy web turn path
over `runtime/sdk` + `runtime/adapters/keeper` (per-message finalization
transport gate, `web-char-setup-draft` shell, chargen kickoff prompt) is
**deprecated for the UI**: do not extend it, and retire it from web/desktop as
the pi-coc RPC bridge lands. `runtime/` remains the open headless interface
for unattended acceptance only, not the web/desktop turn channel. Campaign
management and read-only state projections may keep their file-level
implementations. See `web/README.md`.

This is clean-slate. Reject/delete campaign/runtime/cache state without an exact
current schema/version, then start fresh. Never add migrations, dual readers,
compatibility fallbacks, or old-ID remapping. Historical reports stay read-only;
same-version atomic crash backup/restore is allowed.

Coverage plans and cross-run visited unions are post-run evidence only. They may
identify gaps or motivate another fresh playtest, but never allow, deny, force,
reorder, or suppress scenes, clues, narration, actions, rewards, development, or
endings.
