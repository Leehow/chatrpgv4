# Project Rules

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

The repository does not parse PDFs. Codex's `pdf` skill owns rendering, OCR,
layout recognition, text extraction, and asset extraction. Repository code may
only validate and deterministically reformat the resulting versioned source
bundle through `plugins/coc-keeper/scripts/coc_pdf_bundle.py`.

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
- Other hosts must provide the same source-bundle contract. Do not add a local
  parser, OCR fallback, or PDF parsing dependency.

## COC Plugin Single-Track Law

This repository maintains one plugin track:

- `plugins/coc-keeper/` is the canonical Codex plugin.

Do not recreate a parallel host-specific plugin copy. Shared runtime behavior
lives only in `plugins/coc-keeper/`.

Platform-specific capabilities must stay explicitly gated in the Codex plugin.
In particular, investigator portrait generation is Codex-only and must remain
inside `CODEX_ONLY_IMAGEGEN` markers in `skills/coc-character/SKILL.md`. Other
hosts should skip that capability rather than invent a second plugin tree.

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
host agent (Codex, Claude Code, Cursor, Kimi, or Pi) reads the canonical skills and
calls tools from the single registry:

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_toolbox.py list
uv run --frozen python plugins/coc-keeper/scripts/coc_toolbox.py <tool> --root . --campaign <id> --json '<args>'
```

Exactly three hard rules are enforced inside tools; everything else is
advisory (`warnings` / `hints` in the tool envelope):

1. Dice and HP/SAN/skill arithmetic are deterministic (`rules.*`); the keeper
   never invents or adjusts roll numbers.
2. State writes are transactional and idempotent (`state.*` with
   `decision_id`); saves are never hand-edited mid-play.
3. Module truth is read-only; tools mark keeper-only material as
   `secret: true` and the keeper reveals it only through play.

Do not reintroduce blocking narrative gates (scene-transition state machines,
clue-reveal gates, storylet eligibility suppression, narration output audits)
into the turn path. Narrative legality belongs in tool warnings, not in
exceptions.

## COC Keeper Product Constitution

These clauses define the product identity of COC Keeper and are
non-negotiable for repository work. They constrain agents, implementations,
documentation, and validation. They do not create a fixed runtime workflow or
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
  mechanical results. State tools own persistent mutations. Module truth and
  secrets remain read-only. The KP must not recompute, adjust, or contradict
  those authoritative results.

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

### Table text is player-facing

- Transcripts must preserve the exact player-facing Keeper prose delivered at
  the table, in the session play language, with action uptake and readable
  public-roll wording. Do not paste tool envelopes, clue-id dumps, or raw
  toolbox English enums (`failure`, `regular`, `hard`, `extreme`) into
  player-visible narration as if they were table results.
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
