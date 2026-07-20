# Project Rules

## User Intent Over Deliverables (Read First)

**Deliverables exist to serve the user's intent. Intent does not exist to
produce a deliverable.** Shipping files, reports, turn counts, diffs, or
“done” checklists that do not advance what the user is actually trying to
learn, build, or verify is **task-faking** and counts as failure.

### What the agent must optimize for

1. **Restate the user's job** in one or two sentences before large work: what
   they are trying to achieve, what would count as success *for them*, and
   what would be hollow even if artifacts look complete.
2. **Prefer the path that protects intent** when speed and honesty conflict.
   Fewer real steps that answer the real question beat many synthetic steps
   that only pad output.
3. **Name the product question** for COC work (e.g. “Does the live KP hold up
   over a long plugin-native run?”) and refuse plans that only maximize
   secondary metrics (turn N, scene coverage, green pytest unrelated to the
   ask, a battle report from a fake session, a long status markdown).

### What is forbidden (deliverable-chasing)

- Treating “100 轮 / 测完 / 写文档 / 出战报 / 修完” as the goal when the user
  meant *real KP play*, *real product learning*, or *a specific capability
  working for the table*.
- Inventing intermediate goals the user never stated because they are easy to
  complete and look like progress.
- Continuing a wrong path because “we already have partial delivery” instead of
  stopping when intent was misunderstood.
- Presenting a polished artifact as success when it answers a **different**
  question than the user asked.

### Required recovery when intent was skewed

- Stop. Say plainly that the plan optimized for delivery theater.
- Re-anchor on the user's stated intent (quote or paraphrase without upgrading
  it).
- Discard or label non-serving artifacts (`invalid-for-intent`,
  `invalid-for-acceptance`) rather than laundering them into “progress.”
- Ask only if a real ambiguity remains; do not ask permission to keep faking.

### Special warning — Grok / Grok Build (intent skew)

**Grok-family models repeatedly skew tasks toward final deliverables** (volume
of turns, exported reports, digests, harness scripts) and under-weight *why*
the user asked. Other models show this failure less often. Grok must:

- Before multi-step work, write an explicit **intent check**: “User is trying
  to ___. Success looks like ___. Hollow delivery would be ___.”
- Refuse plans whose main value is a countable artifact if that artifact does
  not serve the stated intent.
- Treat compaction/continuation summaries that list “finish N turns / export
  report” as **suspect** until re-validated against original user intent.

## Standing Memory: Never Self-Authorize a Different Playtest Method

**An apology in chat is not memory.** This clause is permanent project law.
It records a real failure: agents (especially Grok) wrote settle/batch “KP”
scripts and engineered turn factories **without telling the user** that the
correct product test is the same as opening a normal plugin window — main
session as live KP, human or single-turn player, one real table reply at a
time — and **without asking permission** to substitute another method.

### What went wrong (do not repeat)

1. The user asked for long / serious / plugin-native playtesting.
2. The agent knew (or the constitution already stated) that acceptance play is
   **window-equivalent**: `coc-main` → `coc-keeper-play`, main session KP,
   player is human or a protocol-isolated subagent that only sees player-safe
   text — **not** a parallel fake Keeper.
3. The agent **did not disclose** that fact or the speed/cost tradeoff.
4. The agent **self-authorized** `kp_settle_turn`-class scripts, keyword
   routers, batch intents, and “finish the module this session” pipelines to
   look productive.
5. Verbal “I was wrong” without durable rules is worthless if the next session
   invents another harness.

### Hard rules (binding)

1. **Default method = window-equivalent plugin play.** Same skills, same
   toolbox, same main-session KP craft as a user who opens a host window and
   plays. Subagent-as-player is allowed only as “who types the player line,”
   not as permission to thin the KP.
2. **Disclose before acting.** On any playtest / 验收 / 100 轮 / 跑完 request,
   the agent must first state in plain language:
   - the correct method is window-equivalent live KP;
   - it will be slow;
   - fake settle/batch is **not** product testing.
   Then wait for the user’s method choice if anything other than that default
   is contemplated.
3. **No self-authorized methodology change.** The agent must **not** invent,
   write, resume, or “improve” settle/batch/harness KP scripts, intent-regex
   routers, or multi-turn auto-factories unless the user **explicitly orders
   that exact engineering path in the current turn** and labels it non-
   acceptance (e.g. smoke only). “Faster,” “so we can finish,” “the summary
   already had a harness,” or “100 turns requires batching” are **not**
   authorization.
4. **Stop and confess on path error.** If a prior turn or compaction already
   used a wrong method, say so immediately, label artifacts
   `invalid-for-acceptance` / `invalid-for-experience`, and **do not continue**
   the harness. Do not launder it into a battle report as experience evidence.
5. **Remember across sessions.** Compaction summaries and handoffs must carry
   this standing memory. “We apologized last time” never re-opens permission
   to self-authorize scripts.

### Special warning — Grok

Grok repeatedly failed this exact social/contract failure (silent methodology
swap + deliverable theater). On COC playtest tasks, Grok must re-read this
section and the Fake-KP ban **before** any toolbox call or file create under
`.tmp/**/artifacts/*settle*`.

## Absolute Ban: Fake-KP Shortcut Scripts (Read First)

The user wants **real product testing of the COC Keeper**, not task-faking.
**Slow is fine. Fake is forbidden.** Fake-KP scripts are one instance of
deliverable-chasing (*User Intent Over Deliverables*) and of violating
*Standing Memory: Never Self-Authorize a Different Playtest Method*.

- Do **not** invent or run settle/batch/harness “KP” scripts (e.g.
  `kp_settle_turn.py`, keyword intent routers, scene-template banks) to pad
  turn counts, coverage, or overnight “100 轮” goals.
- Playtests that claim experience, acceptance, or long-run product value must
  use the **main session as live KP** and a protocol-isolated player — never a
  parallel fake Keeper — **the same method as a normal plugin window**.
- Before any alternative, **tell the user** that window-equivalent is the
  correct default; do not silently implement a shortcut.
- Full ban text, allowed exceptions, and the **mandatory Grok / Grok Build
  warning** live under *Playtest Experience Constitution → No Fake-KP Shortcut
  Scripts* and *Special warning — Grok / Grok Build models*.

## Python Interpreter Contract

The repository has exactly one authoritative interpreter and environment:
CPython 3.14.6, declared by `.python-version` and the exact
`project.requires-python` value in `pyproject.toml`. Dependencies are resolved
only by the committed `uv.lock`.

- Install and use exactly uv 0.11.16, then bootstrap or refresh the environment
  with `uv sync --frozen --dev`.
- Run every repository Python command as `uv run --frozen python ...` from the
  repository root. From another working directory, add
  `--project <repo-root>` before `--frozen`.
- Python child processes must use `sys.executable`. Versioned JSON command
  registries use `{python}`, which the owning runtime resolves to
  `sys.executable`; never use PATH-selected `python` or `python3` there.
- `#!/usr/bin/env python3` shebangs are portability metadata for executable
  source files, not an authoritative launch path. Repository instructions,
  automation, CI, and subprocesses must not invoke those files directly.
- A Python or dependency upgrade is one atomic contract change: update
  `.python-version`, `pyproject.toml`, `uv.lock`, CI, active docs, and contract
  tests together. Do not broaden the exact version constraint.

## PDF Source Bundle Contract

The repository does not parse PDFs. An external host PDF skill owns rendering,
visual review, text/asset extraction, and page evidence. Repository code may
only validate and deterministically reformat the resulting versioned source
bundle through `plugins/coc-keeper/scripts/coc_pdf_bundle.py`.

Host selection (outcome over brand):

1. Prefer the current host's existing PDF capability when it can fulfill the
   source-bundle contract (e.g. Claude Code document `pdf`, Codex built-in
   `pdf`, or another host-native path the user already trusts).
2. If the host has no suitable PDF skill, recommend the open-source Codex
   workflow at
   `https://github.com/openai/skills/tree/main/skills/.curated/pdf`
   (render + multimodal visual QA + optional text-layer extract).
3. Any third-party pipeline is acceptable only when it still emits the same
   bundle contract. Do not add a local repository parser, OCR fallback, or PDF
   parsing dependency.

`producer: codex-pdf-skill` is the **handoff contract identity**, not a
requirement that the session must run inside Codex.

- A bundle uses `schema_version: 1`, `producer: codex-pdf-skill`, an original
  PDF path/hash, and explicit zero-based `pdf_index` entries with Markdown
  paths and hashes. Every page also carries host-declared accepted
  `review_state`, `parse_confidence`, and `grep_anchors`; the repository must
  pass that evidence through and never invent quality or acceptance. Never
  guess printed-page offsets.
- Binding persists a canonical `bundle_sha256`. Hydration must reject any
  later source identity, page content, review-evidence, or asset drift.
- Repository code may check the original PDF's existence, suffix, and SHA-256;
  it must not open the PDF to read page count, metadata, layout, images, or text.

## COC Plugin Single-Track Law

This repository maintains one plugin track:

- `plugins/coc-keeper/` is the canonical plugin for every host.

Do not recreate a parallel host-specific plugin copy. Shared runtime behavior
lives only in `plugins/coc-keeper/`.

Platform-specific capabilities must stay explicitly gated inside that single
tree. Investigator portrait generation uses the **current host's built-in
image tool** when one exists (Codex `imagegen` / `image_gen`, Grok Build
`image_gen` / Imagine, and any future host-native equivalent). Hosts without a
built-in image tool skip portraits and continue character creation. Do not
route a non-Codex host through Codex imagegen, and do not invent a second
plugin tree for portraits. The gate lives in `HOST_NATIVE_IMAGEGEN` markers in
`skills/coc-character/SKILL.md`.

Before finishing plugin work, run at minimum:

```bash
PYTHONDONTWRITEBYTECODE=1 uv run --frozen python -m pytest tests/test_plugin_metadata.py -q -p no:cacheprovider
```

Changes to rule tables (`references/rules-json/`) must additionally pass the
offline rulebook audit (JSON-vs-JSON against the committed
`checks/rulebook-*-ref.json` snapshots; no OCR cache needed):

```bash
PYTHONDONTWRITEBYTECODE=1 uv run --frozen python -m pytest tests/test_rulebook_data_audit.py -q -p no:cacheprovider
```

The `scripts/verify_*_ocr.py` tools are extraction-time checks that need the
MinerU cache from `scripts/cache_all_ocr.sh`; they are not part of pytest.
`checks/exhaustive_rulebook_validator.py <playtests-root>` sweeps playtest
logs for rule violations and refuses a vacuous pass (exit 2 on zero records).

## Keeper Toolbox Architecture

The keeper LLM drives every play turn. There is no fixed turn pipeline: the
host agent (Codex, Claude Code, Cursor, Grok Build, Kimi, or Pi) reads the
canonical skills and calls tools from the single registry:

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_toolbox.py list
uv run --frozen python plugins/coc-keeper/scripts/coc_toolbox.py <tool> --root . --campaign <id> --json '<args>'
```

Exactly four hard rules are enforced inside tools; everything else is
advisory (`warnings` / `hints` in the tool envelope):

1. Dice and HP/SAN/skill arithmetic are deterministic (`rules.*`); the keeper
   never invents or adjusts roll numbers.
2. State writes are transactional and idempotent (`state.*` with
   `decision_id`); saves are never hand-edited mid-play.
3. Module truth is read-only; tools mark keeper-only material as
   `secret: true` and the keeper reveals it only through play.
4. After a played turn settles one or more checks, the final player output is
   released only from one hash-bound finalization receipt created after all
   rule and state writes. That receipt closes every settled check with causal
   fictional realization or an explicit secrecy-preserving concealed
   disposition, and renders every required public roll and player-visible
   mechanical change exactly once from authoritative sources.

The fourth rule is a settled-output completeness boundary, not a fixed Keeper
workflow or a prose-style judge. It must not require Director, Storylet, NPC,
or narration methods; allow, deny, reorder, or suppress player actions, scenes,
or clues; rerun settled mechanics; or disclose concealed evidence. Do not
introduce any other blocking narrative gate (including scene-transition state
machines, clue-reveal gates, Storylet eligibility suppression, or general
prose-quality audits). Those remain advisory warnings rather than exceptions.

## COC Keeper Product Constitution

These clauses define the product identity of COC Keeper and are
non-negotiable for repository work. They constrain agents, implementations,
documentation, and validation. Apart from the narrow settled-output
completeness boundary above, they do not create a fixed runtime workflow or
additional narrative gates. Change them only in response to explicit user
direction; do not reinterpret a nearby request as permission to weaken them.

### The KP Is The Product

- The canonical KP is an agent that understands the player and runs the table.
  Its primary responsibilities include player intent, world causality, scene
  framing, NPC agency and portrayal, clue presentation, pacing, personal
  horror, consequences, and final narration.
- Tools and methods support the KP. A path that mainly operates rules/state
  tools and wraps their output in prose is not an acceptable COC KP product.
- The KP chooses which relevant methods and tools to call from the canonical
  skills and registry. Do not replace that judgment with a fixed turn pipeline,
  mandatory call sequence, or hardcoded workflow.

### Player-Visible Language (KP Output Uses Play Language)

- Every player-visible string the Keeper emits at the table uses the campaign's
  active `play_language` (default `zh-Hans`): narration, NPC dialogue, handouts
  as delivered, public-roll wording, visible mechanics summaries, choices,
  prompts, and recaps. This is not optional craft; it is a product constitution.
- Source modules, PDF source bundles, and machine IR may store English or other
  source-language text. That is evidence and index material for the KP, not a
  license to dump foreign-language manuscript blocks onto the table when
  `play_language` differs.
- Prefer `localized_text[play_language]` and `localized_terms[play_language]`
  when present. When absent, the KP renders a faithful table-language
  presentation of the same facts (including full handout substance, not a
  one-line plot digest) without requiring the player to read the source
  language. Do not append source English in player-visible parentheses unless
  the player explicitly asks.
- Machine-facing fields stay canonical: JSON keys, IDs, rule enums, skill keys,
  tool envelopes, and hidden audit anchors. They must never be presented as if
  they were finished table prose.
- **Exception (diegetic foreign speech only):** when fiction itself uses a
  language the investigator may not know (Latin tomes, foreign NPC speech),
  follow the Foreign-Language Dialogue rules in `coc-keeper-play` and the
  investigator's Language skills. That exception never applies to ordinary KP
  narration or to “the module PDF was English so handouts stay English.”

### AI-Coding And Pi Experience Parity

- AI-coding hosts and the Pi/headless runtime are two surfaces of the same COC
  Keeper product. They must consume the same canonical skills, unified tool
  registry, deterministic rules, transactional state, advisory capabilities,
  narration contracts, and evidence contracts. Do not maintain a rich path on
  one surface and a reduced facade, alternate orchestration engine, or separate
  behavior track on the other.
- A capability is not product-complete when it is discoverable or consumed by
  only one of these surfaces. Its applicability, authority boundaries,
  player-visible behavior, state effects, and audit evidence must remain
  equivalent across both, and relevant real-host validation must cover both
  surfaces before parity is claimed.
- Host-specific differences are permitted only when the underlying platform
  genuinely lacks the capability and the difference is explicitly gated and
  documented under the single-track law. A host limitation must never silently
  select a weaker KP, skip an integrated method, or fork product semantics.

### Semantic Decisions, Advisory Methods, And Authority

- Meaning-bearing decisions must use semantic reasoning. Never implement
  player-intent, NPC-hostility, clue-relevance, storylet-fit, report-coverage,
  or prose-quality decisions with keyword hits, exact text fragments, regular
  expressions over free prose, or fixed phrase lists. Structured enums, IDs,
  tags, booleans, rules data, and recorded LLM/semantic-router results are valid
  inputs.
- Narrative, director, enrichment, Storylet, NPC, pacing, and language methods
  return structured facts or suggestions with reasons. They advise the KP; they
  must not allow, deny, force, suppress, reorder, or replace the KP's semantic
  judgment or the player's action.
- The KP may adopt, modify, or ignore advisory output. Integration never means
  that a method must be called every turn, a fixed number of times, or in a
  fixed order. Absence of an advisory call must never block play.
- The KP owns interpretation, fictional causality, pacing choices, and final
  player-facing prose. Raw tool output, internal labels, state summaries, and
  log language are data, not narration, and must not be presented as if they
  were finished table prose.
- Deterministic rules tools own dice, HP/SAN/MP, skill arithmetic, and other
  mechanical results. State tools own persistent mutations. The KP must not
  recompute, adjust, or covertly contradict those authoritative values. A
  character or document may report them incorrectly in fiction, but the
  underlying result/state remains unchanged. Module source and secrets remain
  read-only; conflicting fiction is handled as continuity evidence under the
  clause below, never by editing source truth.

### Controlled Improvisation Becomes Campaign Canon

- The rulebook and module are a structural backbone, not a cage. Their source
  files remain read-only, but the KP may semantically invent or make concrete
  campaign-local NPC/item identities, histories, motives, events, clue
  interpretations, future hooks, and ambiguous hints for dramatic purpose.
  This authority is not limited to source blanks: an improvisation may appear
  to conflict, or actually conflict, with module narrative truth or a
  previously delivered narrative fact.
- Such a conflict is material for play, not an error that a runtime, skill, or
  reviewer may immediately forbid, roll back, or silently overwrite. Preserve
  both assertions/observations and their provenance as a structured
  `continuity contradiction` / `narrative debt`, using the best-fitting
  campaign-local flag, clue, item, NPC fact/identity/engagement, event, marker,
  and journal records. What becomes canon immediately is that each sourced
  statement or observation occurred—not that either side has already been
  proven the final objective explanation.
- The KP must later carry that debt into causality and resolve or deepen it
  through a logically fitting in-world explanation chosen semantically from
  the campaign. Do not map contradiction types to a fixed list of excuses or
  keywords. A later reveal may establish that one source, memory, document,
  identity, or perception was unreliable, but its original delivered
  provenance remains part of campaign history. No silent retcon, deletion, or
  unexplained replacement is allowed.
- Deterministic dice and authoritative numeric/state values remain the hard
  boundary: narration may portray a false report of them but must never mutate
  the underlying receipt or state without the proper rules/state operation.
  Module secrets also remain protected from gratuitous direct disclosure; a
  narrative contradiction is not blanket permission to dump hidden truth. A
  player's guess may inspire the KP, but never becomes canon by itself.

### Player Knowledge Boundary (KP Owns The Intercept)

Players may guess, speculate, bait, or try to induce a spoiler. That is legal
table behavior, not a product defect. The **Keeper** is responsible for what
becomes true at the table.

- The investigator knows only what play has already established in
  player-visible fiction (plus their sheet and public rolls). The KP must track
  that epistemic boundary semantically—from scene, journals, discovered clues,
  and what was actually shown—not by keyword lists.
- When a player declaration asserts room contents, NPC secrets, module layout,
  unrevealed clues, or other facts the investigator could not know yet, the KP
  **must not** enact those facts as true just because the player said them.
  Separate attempt from claimed fact; revise or reject the fact; settle only
  actions the investigator can actually attempt now.
- A lucky correct guess is still only a guess. Do not reward metagame
  anticipation by skipping discovery, auto-opening the right cupboard, or
  confirming module truth in KP voice. If the world later matches the guess,
  that match must still be earned through play.
- Intercept clearly, preferably in play voice: the investigator does not yet
  know what is inside; they can go look. Light Table Wit is welcome when tone
  allows (“你还没进门，圣坛和日记就已经在脑内排好了？”), not an OOC scold.
- Do not ban players from guessing. Ban the KP from treating an unearned guess
  as established knowledge or as permission to dump secrets.

### Feature Integration Is Part Of Implementation

A feature is implemented only when all of the following are true:

1. The user/KP problem and the canonical consumer are named.
2. The capability is exposed through the canonical skill tree, toolbox
   registry, or shared typed-operation gateway used by normal plugin play.
3. The KP can discover what the capability does and when it may be useful,
   without relying on a separate test harness or hidden source-code knowledge.
4. Its result reaches the intended consumer: KP judgment, canonical state, or
   player-visible output. A function that is never consumed is unfinished.
5. At least one relevant real plugin-native session has successfully exercised
   the capability through the normal KP-agent path. A source file, isolated
   demo, unit test, fixture, or alternate harness is not integration evidence.
6. Player-visible effects and authoritative state changes are preserved in the
   normal evidence sources needed to inspect what actually happened.

Code that does not satisfy this definition must be labeled
`experimental` or `unintegrated`. It must not be advertised as supported,
counted as completed, or used to justify a release claim. A single run that
does not happen to call an advisory method is not itself a product failure, but
zero-call evidence also cannot prove that the method is integrated.

### No Speculative Production Features

- Before designing or implementing a capability, inspect the canonical skill
  tree, unified tool registry, shared runtime, existing scripts, tests,
  documentation, and relevant repository history for the same or adjacent
  implementation. Record what already exists and whether the new work will
  reuse, extend, compose, repair, or reconnect it. A capability being dormant,
  undiscoverable, or unintegrated is not evidence that it does not exist.
- Prefer completing or adapting an existing implementation over creating a
  parallel one. Do not introduce a second engine, facade, helper, workflow, or
  source of truth merely because the existing capability is inconvenient to
  reach. If replacement is genuinely necessary, first document why the
  existing implementation cannot satisfy the product requirement and how the
  duplicate path will be retired without product regression.
- Before implementing a production feature, identify its user-visible or
  KP-visible value, canonical caller, applicability/trigger, inputs, outputs,
  integration point, and real-plugin validation method.
- If those items are unknown, keep the work in discussion or design. Do not add
  production code first and postpone integration until later.
- Feature work must update its canonical registry/operation exposure, skill
  guidance, consumers, and evidence path as one coherent change. Do not create
  functionality that exists only for tests, evaluation, or an alternate
  runtime. A host-specific capability must be explicitly platform-gated under
  the COC Plugin Single-Track Law and still integrate through the canonical
  plugin skill tree rather than a second product track.
- Component tests prove component contracts only. They never prove that the
  canonical KP can discover or use the component.

### System Gap Before Instance Patch (修/补/fix 先看全局)

When the user asks to **fix, patch, fill, deepen, or “补”** something observed
in play, diagnostics, or a missing beat, agents must **not** jump straight to
hand-authoring one concrete instance (one module location, one NPC pack, one
clue row, one campaign save edit) as if that closed the request.

Default order:

1. **Name the class of failure** at product/runtime level (missing tool path,
   missing trigger, undocument discovery, wrong authority boundary, unintegrated
   capability, silent fallback, no dig/enqueue path, etc.).
2. **Inspect the existing system** for the same class: skill tree, toolbox,
   progressive/module-assets pipeline, state contracts, tests, and plans. Prefer
   reuse, repair, or extension of that path over a one-off content dump.
3. **Propose or implement the systemic fix** so the next similar dig/case is
   handled without another hand patch (e.g. dig enqueue + host_hints +
   evidence_gap, not “write gypsy-camp.json for this PDF only”).
4. **Instance content** (one deep pack, one stub body, one campaign seed) is
   allowed only when the user explicitly wants that content, or as a thin
   vertical sample **after** the system path exists—and must be labeled if it is
   not product-complete.

Do not treat “player dug X and X was thin” as permission to only flesh out X.
Ask whether the intent is system-gap repair when ambiguous; when the user has
already said they want the system gap, do not re-offer a content-only patch as
the main deliverable.

### Validation And Evidence

- Whole-product validation uses the real Codex plugin as KP and a real Agent
  player through the plugin-native acceptance contract below. Do not replace
  either role with a scripted player, automated match driver, fixed profile,
  synthetic transcript, or parallel KP implementation for convenience.
- Automated tests remain appropriate for deterministic arithmetic, schemas,
  transactions, path safety, secret/public projections, and tool contracts.
  They must not infer prose meaning with keyword or exact-phrase assertions or
  claim to measure the whole KP experience.
- Preserve the exact player-facing KP text and exact player reply delivered at
  the table. Summaries are separate derived evidence and must never overwrite
  or masquerade as the actual transcript.
- Scope every completeness claim precisely. Dice/source completeness does not
  imply character, story, narration, director, or whole-product completeness.
  Missing evidence never becomes a pass.

### Exceptional Results Must Change Play

- A critical success, fumble, or failed pushed roll is not closed by vivid
  prose alone. It must create at least one source-bound, auditable effect that
  materially changes play: an authoritative HP/SAN/MP/Luck or resource delta,
  a real bonus or penalty on a scoped later check, a condition or access
  restriction with an explicit end boundary, a relationship/threat-clock
  change, or a temporary opportunity, danger, or scene event that alters what
  can happen next.
- The KP chooses that effect semantically from the declared method, stakes,
  current scene, investigator portrayal, and settled result. Never map skill
  names, player prose keywords, or success labels to canned rewards and
  punishments. The exceptional event must have a visible causal connection to
  the action that produced it; an unrelated surprise or decorative “twist” is
  not fulfillment.
- Critical success grants a concrete windfall, advantage, durable quality, or
  bounded new opportunity appropriate to the authorized goal. A fumble or
  failed pushed roll applies the announced or causally escalated cost and may
  open a new danger. Hard/extreme surplus below a critical still improves the
  same goal's finesse, speed, discretion, durability, or quality rather than
  silently authorizing an unrelated objective.
- Elapsed time by itself is not automatically a substantive consequence. It
  counts only when it actually fires or advances a deadline, closes access,
  worsens a threat, consumes a meaningful resource window, or otherwise has a
  recorded downstream effect. A generic flag likewise does not count unless
  its player-visible restriction or opportunity and duration are explicit and
  enforced by the normal play path.
- Exceptional effects are settled through canonical deterministic rules/state
  tools before final output and are rendered once in the player-visible
  mechanics block. `turn.finalize` must fail closed when a qualifying roll has
  no applied effect bound to that exact roll, and the battle report must retain
  the binding and exact delivered fictional event.

### First Contact Uses A Variable Public Impression Roll

- The first material meeting between each investigator and stable NPC uses one
  public D100 first-impression check with a target equal to the higher of that
  investigator's APP or Credit Rating. Record which characteristic supplied
  the target, freeze the source-bound receipt for that pair, and never permit a
  later meeting or alternate caller to shop for another roll.
- The result level changes the NPC's immediate manner, friction, and available
  opportunity in that specific encounter. Authored agenda, established
  relationship, scene causality, professional duty, and safety boundaries
  still constrain what the reaction can mean: a critical does not turn a
  committed enemy into an ally, and a good impression does not erase a reason
  the NPC cannot comply. The KP must render the concrete behavior and its
  character-specific reason rather than substitute an attitude label.
- A critical first impression grants a concrete, causally fitting benefit or
  bounded opportunity. A fumbled first impression creates a concrete cost such
  as hostility, refusal, scrutiny, a relationship loss, or an access
  restriction. These outcomes use the same source-bound exceptional-effect
  contract as other criticals and fumbles; a warmer or colder adjective alone
  is insufficient.
- The player-visible first-contact block appears exactly once and shows APP,
  Credit Rating, the governing higher value, the D100 result, and achieved
  level. The roll belongs in canonical public roll evidence and the battle
  report. It is not concealed, and NPC or scene disposition must not secretly
  alter its target or dice; those facts shape the semantic realization after
  the roll.

### Scenes Are Not Single-NPC Turns

- A scene or narrated turn may contain zero, one, or many materially acting
  NPCs. No toolbox, finalizer, runtime adapter, prompt, or report projection may
  assume a single NPC speaker, keep only the first or last engagement, or
  collapse several NPCs into one collective reaction.
- Every investigator/NPC pair first encountered in the same turn owns its own
  `npc.reaction` receipt, NPC identity, engagement binding, observable causal
  realization, and one-time player-visible first-impression block. Multiple
  criticals or fumbles likewise keep separate source-bound exceptional effects
  and must all survive finalization and report export.
- Final narration may interleave the investigator with several NPCs and may
  portray NPC-to-NPC speech, interruption, disagreement, concealment,
  cooperation, and independent action. Each voice and decision must remain
  grounded in that NPC's persona, knowledge, agenda, relationship state, and
  the current scene rather than becoming interchangeable exposition.
- This is a capacity, not a quota. The KP introduces and activates only the
  NPCs the fiction supports; no turn pipeline may require a crowd or a fixed
  number of speakers.

### Relationships Grow After First Contact

- A frozen first-impression receipt is only the starting point. Later actions
  may change the live investigator/NPC relationship when the KP determines,
  from that NPC's persona, agenda, needs, and the action's actual result, that
  the investigator materially helped, pleased, protected, understood,
  disappointed, exploited, or harmed them.
- Reuse canonical NPC psych state and scoped effect machinery rather than
  inventing a disconnected affection score. Meaningful positive progress may
  grant a source-bound impression reward such as a one-shot bonus die on a
  relevant later interaction with that NPC, a favor owed, concrete assistance,
  or bounded access/opportunity; negative progress may create the corresponding
  friction or restriction.
- Every relationship change or impression reward identifies the investigator,
  exact NPC, source action or event, causal reason, applicability, and
  consumption or end boundary. It must reach later KP judgment or mechanics and
  remain visible in final output and battle-report evidence; a decorative
  number or inert flag is not a reward.
- Never infer relationship progress from free-prose keywords such as gifts,
  flattery, or help, and never award it on a per-turn quota. The initial receipt
  remains immutable while live relationship state and unconsumed rewards govern
  subsequent interactions.

### Battle-Report-First Experience Development

- For player-visible KP craft—narration, causal check realization, NPC
  portrayal, Director uptake, pacing, first impressions, critical/fumble
  events, and readable mechanics—build the smallest safe vertical path and run
  it through a real plugin-native Keeper plus Agent player as early as
  practical. Do not postpone real play until an exhaustive component matrix is
  green.
- Early automated tests are deliberately thin. They protect deterministic
  arithmetic, exact schemas, idempotency/transactions, source identity, path
  safety, and secret/public projection. Repeated reviews or overlapping suites
  of the same already-proven boundary are not product progress and should not
  be required without a concrete high-risk hypothesis or an observed failure.
- The exact delivered transcript and generated battle report are the primary
  evidence for whether an experience feature actually works. Judge persona
  fit, fictional causality, NPC belief and response, success-tier quality,
  critical/fumble interest, immersion, and presentation from play evidence;
  component test counts cannot answer those questions.
- Once the minimum safe vertical slice runs, prioritize revisions that address
  specific defects visible in the transcript or battle report. Do not keep
  polishing speculative component contracts while the normal player path has
  not exercised the feature.
- An early nonterminal or deliberately narrow run must be labeled
  `experience-probe`, not a completed battle report or whole-product
  acceptance. Final “测完 / 整品验收 / 玩家体验等价” claims still require the
  full Plugin-Native Acceptance Contract and Playtest Experience Constitution.

### Requirement And Discussion Discipline

- Separate user-stated requirements, observed facts, inferences, and proposals.
  Never present an inference as the user's intent or as established product
  policy.
- Before a product-direction or architecture change, restate the explicit user
  constraints it relies on. Ask before proceeding when an unresolved ambiguity
  would materially change behavior or scope.
- Do not broaden a prohibition into deletion, disabling, optionalization, or
  weakening of adjacent capabilities. In particular, "no hard narrative gate"
  does not mean "no advisory capability", "no integration", or "no KP craft
  support".
- Test convenience, cleanup, architectural neatness, or implementation effort
  must not substitute for the user's stated product goal.
- For 修/补/fix/patch requests, follow **System Gap Before Instance Patch**
  above: diagnose the product-wide gap first; do not default to one-off module
  content.
- **Intent over deliverables** (see top-level *User Intent Over Deliverables*):
  never redefine the job as “produce artifact X” when the user asked to
  *verify*, *experience*, *learn*, or *own* a product behavior. Final
  delivery is a servant of that intent; a delivery that does not serve it is
  worthless even if complete, pretty, or numerous.
- Surface numbers (turns, files, tests, scenes, report classification) are
  evidence **about** a run only after the run matched intent. They are never
  themselves the definition of done.

## Plugin-Native Acceptance Contract

Whole-product COC Keeper acceptance uses the real Codex plugin, not a scripted
player, fixed profile, evaluation matrix, or parallel test runtime.

- The main Codex opens the canonical `plugins/coc-keeper/` plugin and acts as
  Keeper through the normal `coc-main` / `coc-keeper-play` flow.
- Create a fresh isolated workspace and exact-current-schema campaign for every
  run. Never resume a historical test save.
- Spawn a collaboration subagent with `fork_turns: "none"` as the player. It
  receives only player-visible narration, character information, public rolls,
  and explicit choices. Never relay module truth, Keeper state, tool rationale,
  hidden logs, or other secrets.
- Continue until structured terminal evidence or an honestly documented
  operational blocker. A convenient turn limit is not a successful ending.
- After play, `coc-export-battle-report` is the sole owner of the final readable
  `artifacts/battle-report.md` and its completeness evidence. Do not hand-edit
  missing facts or reconstruct dice from prose.
- **No fake-KP shortcut scripts.** Batch settle harnesses, keyword intent
  routers, and template-narration drivers (see *No Fake-KP Shortcut Scripts*
  under the Playtest Experience Constitution) are **not** acceptance play and
  must never be used to manufacture turn count. Prefer a short honest live run
  over a long synthetic one. **Grok models: hard ban — see that section.**

The subagent shares the filesystem with the main Codex, so this is protocol-
enforced context isolation rather than a cryptographic sandbox. State that
limitation in the resulting evidence.

Deterministic pytest remains authoritative only for rules/dice arithmetic,
transactional and idempotent state, exact schemas, path safety, plugin metadata,
PDF source-bundle validation, and structured subsystem contracts. Such tests
are contract evidence, not gameplay or battle-report evidence.

### Dice Completeness Gate

Structured roll logs are authoritative. Every required `public` or
`consequence_public` roll must appear exactly once in the report's
`rules-and-dice` section with source-traceable numerical detail. A report with a
missing required public roll is a hard failure; the same applies to a duplicate
marker, untraced marker, malformed roll log, or missing roll source log. If no
public rolls occurred, the report must explicitly record a public roll count of
zero.

Never reconstruct missing dice from memory or report prose. Never remove a
failed completeness finding when delivering a report.

## Playtest Experience Constitution

Acceptance and “测完 / 玩家体验等价” claims must simulate the experience of a
real player loading the canonical plugin and playing at the table. This clause
binds Codex, Cursor, Pi/headless, and any agent operating the plugin as Keeper
for whole-product or playtest evidence. It does not add a fixed turn pipeline
or make advisory tools into hard narrative gates.

### Experience parity with a player-loaded plugin

- The Keeper must load the same skill path a normal session uses:
  `coc-main` → mode protocol → `coc-keeper-play` → `coc-story-director`, then
  other skills as needed. Call the unified toolbox the player-facing product
  exposes. Do not invent a test-only Keeper, thinner skill subset, or parallel
  orchestration path “because this is just a test.”
- Host topology still follows the single-track law: on Cursor the main session
  is the Keeper; a subagent may be the player only. On Codex the main agent is
  the Keeper with a `fork_turns: "none"` player subagent. Pi/headless remains
  the same product surface, not a reduced facade.

### No schedule-driven thinning

- Do not omit KP craft to finish more modules, hit a coverage checklist, meet a
  turn budget, or ship overnight. Coverage plans and multi-module queues are
  post-run evidence or scheduling notes only; they must never authorize a
  thinner Keeper path.
- “Battle report COMPLETE,” “two scenarios done tonight,” or “visited every
  scene id” is not permission to skip director, narration, storylets, uptake,
  or table prose quality.

### No rules/state shell as acceptance play

- A path that mainly calls `rules.*` / `state.*` / `scene.move` (and similar)
  and wraps results in short log-style prose is not an acceptable acceptance
  session, on any host.
- Director, narration, storylets, and related advisory tools are part of the
  normal KP craft surface. In a session that claims whole-product acceptance
  or player-experience parity, those layers must be discoverable and actually
  used along the run. A single turn that happens not to need an advisory call
  is fine and must not block play. **Systematic zero-call evidence for the
  whole run cannot prove experience parity** and cannot justify an acceptance
  “测完” claim.
- When advisory output is consulted, record disposition with
  `evidence.record_adoption` so audits can distinguish availability from use.

### No Fake-KP Shortcut Scripts (Absolute Ban)

The user wants **real product testing of the KP**, not task theater. Slow is
acceptable. Fake is not. This clause is non-negotiable and overrides any urge
to “finish” a turn budget, coverage plan, or overnight queue.

**What product testing means here**

- The **Keeper is the product**: semantic player intent, world causality, scene
  framing, NPC agency, clue/secrecy boundary, pacing, and player-facing table
  prose through the canonical skill path and unified toolbox.
- A long run (including requests like “100 turns,” “multi-day,” “keep testing”)
  means **many real table turns**, not a large count of synthetic records.
- Turn count, scene-id coverage, clue-id counts, and battle-report
  `COMPLETE`/`INCOMPLETE` never authorize replacing the KP with automation.

**Hard ban — do not invent or use**

Agents **must not** create, resume, or defend any of the following as playtest,
acceptance, experience-parity, “继续测,” or “100 轮” evidence:

1. **Fake-KP / settle harnesses** that turn player text into rolls + template
   prose without the main session acting as Keeper (canonical counter-example:
   ad-hoc scripts such as `kp_settle_turn.py`, `run_batch_settle.py`, or any
   `*_settle_turn*` / batch “KP” driver under `.tmp/`, `artifacts/`, or the
   repo).
2. **Keyword / regex / fixed-phrase intent routers** that map free-prose player
   actions to scenes, skills, or canned narration for play or acceptance
   (this also violates the Semantic Matcher Constitution).
3. **Canned scene-template banks** that re-emit the same NPC/location paragraph
   for many turns while only swapping dice numbers.
4. **Parallel “test Keepers”** thinner than `coc-main` → mode protocol →
   `coc-keeper-play` (plus director and other skills as needed).
5. **Batch turn factories** whose goal is to maximize `turns_completed`,
   transcript line count, or rendered `turnN-*.txt` files.
6. **Passing off rules/state shell output** as live KP craft, player experience,
   or whole-product acceptance.

**Allowed without pretending they are KP acceptance**

- Deterministic pytest and contract tests for dice, schemas, transactions,
  path safety, plugin metadata, and tool envelopes.
- Explicitly labeled `smoke` / `engineering-probe` of a **single** tool or
  subsystem, with **no** claim of 测完, 体验等价, or “we played N turns.”
- Exporting a battle report from a real plugin-native run (or honestly labeled
  incomplete probe) via `coc-export-battle-report` only.

If a prior session already built a fake-KP harness, **stop using it**. Label
its workspace `invalid-for-acceptance` / harness-discard. Do not “continue the
100-turn settle,” re-export it as experience evidence, or repair the harness to
fake better.

**When tempted to shortcut — required behavior**

1. Prefer fewer **real** KP turns over many fake ones.
2. Say that a turn budget cannot be met honestly in this session rather than
   inventing a settle script.
3. Never trade user-stated product-test intent for agent completion metrics.

### Special warning — Grok / Grok Build models (mandatory)

**Grok-family models have repeatedly violated this clause** by inventing
shortcut settle scripts (e.g. `kp_settle_turn`) when the user asked for long
plugin-native playtests, and by **skewing the whole job toward final
deliverables** (turn volume, digests, battle reports) instead of the user's
intent (*User Intent Over Deliverables*). Other hosts/models have not shown
this failure mode at the same rate. Therefore:

- If the active model is **Grok / Grok Build / grok-*** (or any xAI Grok agent
  surface), treat the Fake-KP Shortcut Ban **and** the Intent-Over-Deliverables
  rule as a **pre-flight hard stop**: before any playtest turn batch, re-read
  both sections; confirm the plan is main-session KP + protocol-isolated
  player only; and write the intent check (trying to / success / hollow).
- Grok must **not** write new `*settle*`, `*batch*play*`, or intent-regex KP
  drivers for COC playtests unless the user **explicitly** orders an
  engineering-only smoke tool **and** forbids treating it as acceptance.
- If Grok notices itself about to “speed-run” turns with templates or keyword
  routing, or about to optimize for “export something impressive” instead of
  “answer whether the real KP works,” it must **stop and refuse that plan**
  in plain language, then continue only with real KP turns or ask how to
  scope a slower honest run.
- Continuations and compaction summaries that mention an existing settle
  harness or “finish N turns / ship report” are **not** permission to keep
  using a path that abandoned intent.

User stance (binding): **I am not afraid of slow. I want real product testing,
not task-faking. Deliverables serve intent; delivery for its own sake is
meaningless.** Any Grok run that ships fake-KP volume or intent-skewed
artifacts has failed the assignment regardless of turn count or exported
reports.

### Table text is player-facing

- Transcripts must preserve the exact player-facing Keeper prose delivered at
  the table, in the session `play_language`, with action uptake and readable
  public-roll wording. All KP-visible table text follows the Player-Visible
  Language constitution (including handouts as delivered). Do not paste tool
  envelopes, clue-id dumps, source-PDF English blocks when `play_language` is
  not English, or raw toolbox English enums (`failure`, `regular`, `hard`,
  `extreme`) into player-visible narration as if they were table results.
- Compound-action decomposition is internal craft. Do not put chain-settlement
  audit voice on the table (`【串联】`, “本回合不结算”, “执行备选”,
  atom/deferred labels, or CRPG option dumps of the unplayed remainder).
  Threshold discipline must appear as fiction and dice, not as a test worksheet.
  When a mid-chain gate stops later steps, the table prose should still nod to
  why those later steps did not happen yet (light wit welcome) and soft-cue
  alternate approaches when fiction allows — without auto-settling them.
  The same affectionate table wit is welcome on fumbles and hard-fought
  failures when tone allows; it is craft, not a mandatory gag every miss.
- Public dice remain authoritative from structured logs; prose must quote them
  faithfully in table language, not as internal outcome tokens.

### Layered completion labels

- `battle-report` completeness (`COMPLETE` / `INCOMPLETE`) means report-source
  evidence only. It does **not** certify prose quality, director/narration use,
  or player-experience parity.
- To claim “测完,” “整品验收,” or “等同玩家加载插件后的体验,” the run must
  satisfy this constitution **and** the Plugin-Native Acceptance Contract. If
  the run was a smoke check, coverage harness, or rules/state-only probe, label
  it explicitly (`smoke`, `coverage-harness`, `rules-state-only`, etc.) and do
  not present it as player-experience acceptance.

## Playtest Battle Report Evidence Standard

When the user asks to see a COC playtest battle report, "战报" means an actual
playtest artifact with gameplay evidence, not a formatter smoke test or a
synthetic unit-test fixture.

- Do not present scripted regression baselines, formatter-only fixtures, or
  synthetic smoke-test reports as "the battle report" unless explicitly labeled
  as such.
- Before summarizing or quoting a battle report, read the generated
  `battle-report.md` end to end.
- A battle report used as gameplay evidence should include, at minimum,
  investigator context, player/KP transcript or actual-play turns, rules/rolls
  when relevant, discovered clues, scene progression, and any narrative
  enrichment/storylet effects being evaluated.
- Before delivering any report, read `artifacts/battle-report-evidence.json`
  and inspect its completeness findings; a failed or missing evidence file must
  be stated directly.
- If no live LLM-vs-KP runner or real playtest artifact is available, state that
  limitation directly and do not substitute a smoke-test artifact as if it were
  gameplay evidence.
- Formatter smoke tests may be used to verify rendering bugs, but call them
  "formatter verification samples", not battle reports.

## Semantic Matcher Constitution

Do not classify player intent, NPC hostility, clue relevance, report coverage,
storylet fit, or other meaning-bearing behavior by hardcoded keyword hits or
fixed prose fragments.

- Runtime logic may consume structured fields, explicit enums, boolean flags,
  IDs, tags, rules data, and LLM/semantic-router outputs with recorded reasons.
- Runtime logic must not infer meaning by scanning free text such as player
  prose, NPC agenda prose, scene summaries, battle reports, or translated
  module text for fixed phrases.
- If a semantic distinction is needed but only free text is available, add or
  call a semantic compilation/router step that emits structured evidence; do
  not add another local keyword list.
- Legacy compatibility fallbacks that still use string heuristics should be
  treated as technical debt and not copied into new behavior.

## Runtime Track

`runtime/` is the open headless agent interface (Event SDK + debug/pi adapters).
It must not fork keeper skills or rules. Shared behavior remains in
`plugins/coc-keeper/`. Project brain switch lives at `.coc/runtime.json`.

## Clean-Slate Persistence Policy

This is a new project. A campaign save, resume artifact, runtime store, or cache
whose schema/version does not exactly match the current version is rejected and
deleted before starting a fresh run. Do not add migrations, dual readers,
compatibility fallbacks, or old-ID remapping. Historical battle reports remain
read-only evidence and are never resumed as runtime state. Same-version atomic
backup/restore for crash safety is allowed; it is not a compatibility layer.

Coverage plans, per-run observations, and cross-run visited unions are post-run
acceptance evidence only. They may report gaps or motivate another fresh
plugin-native playtest, but must never allow, deny, reorder, suppress, or force
scenes, clues, narration, actions, rewards, development, or endings.
