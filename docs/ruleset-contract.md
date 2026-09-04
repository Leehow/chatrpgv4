# Ruleset Contract

How a TRPG rule system becomes a loadable **ruleset package** for the
(formerly CoC-only) Keeper framework. This contract is the concrete form of
the three-layer paradigm in `docs/rulebook-abstraction-paradigm.md`:
a ruleset packages its L1 data, L1 resolver code, L2 behavioral material,
L3 index, state extensions, audit snapshots, and character creation under
one directory, and the kernel binds exactly one ruleset per campaign.

Status: contract v1. `coc7` is the reference production package. A deliberately
small test package proves the public multi-ruleset vertical without advertising
an unimplemented second game system. Everything here is binding on new
production rulesets; deviations require amending this document, not silent
exceptions.

## 1. Package layout

```
plugins/coc-keeper/rulesets/<id>/
├── manifest.json            # required; see §2
├── resolver.py              # required; L1 execution, see §4
├── rules-json/              # required; L1 data tables + metadata.json + rule-index.json
├── skills/                  # required; L2 skill pack (SKILL.md tree)
├── checklist.md             # required; L2 machine-checkable rule list with page anchors
└── charactergen/            # optional; package-owned character creation assets
```

`<id>` is lowercase ASCII (`coc7`, `cpr`, `tri`). Package ids are unique and
registered only by directory presence — there is no central registry file to
edit. The kernel discovers packages under `plugins/coc-keeper/rulesets/`.

Audit snapshots for a package live at repo level under
`checks/<ruleset>-*-ref.json` so the offline audit (`scripts/gap_audit.py`
successor) can sweep all packages uniformly.

## 2. manifest.json

Validated against `plugins/coc-keeper/references/ruleset-manifest-schema.json`
at conformance time. Required fields:

- `ruleset_id` — equals the directory name.
- `name`, `version` — human identity and package version.
- `resolution_model` — enum: `percentile` (CoC/BRP d100), `additive-vs-target`
  (CPR d10+STAT+SKILL vs DV), `d20-style`, `narrative-light` (TA). The kernel
  uses this only for UI/report wording; mechanics always come from the
  resolver.
- `schema_versions` — the campaign/actor state schema versions this package
  supports. Exact-match only, per the Clean-Slate Persistence Policy: no
  migrations, no dual readers.
- `entry_points` — `{ "resolver": "resolver.py", "skills": "skills/",
  "data": "rules-json/" }`. MAY additionally declare
  `"rule_graph": "rule-graph.json"` and
  `"rule_graph_manifest": "rule-graph-manifest.json"` for generated
  RuleGraph artifacts (§2.1). Absence is legal: a package that ships no graph
  defaults every rule family to `legacy` runtime ownership with a `visible`
  legacy Keeper surface.
- `resources` — the **resource registry** (§6).

Optional fields (absent means the documented default, never an error):

- `state_dirs` — package-owned campaign state directories under `save/`
  (§6). Every package declares exactly one semantic actor owner, for example
  `{ "name": "actor-state", "create_on_init": true,
  "role": "actor_state" }`; additional entries such as
  `{ "name": "sanity-state", "create_on_init": false }` are optional.
  `create_on_init` defaults to `false`: the kernel creates the dir at campaign
  creation only when flagged; otherwise the owning subsystem creates it
  lazily. A missing or ambiguous `actor_state` role fails conformance and
  runtime state resolution rather than selecting a directory by name.
- `boundary_terms` — ASCII machine-facing terms that table-language
  localization rewrites only on ASCII token boundaries (§6). Default when
  absent: the empty set (every term localizes by plain replacement).
- `rule_families` — per-family rule-graph runtime ownership (§2.2). Default
  when absent: every family keeps `legacy` runtime ownership with a
  `visible` legacy Keeper surface.
- Per-resource `projected` (inside `resources` entries) — when `true`, the
  kernel projects `current_<key>` into the runtime player-safe investigator
  surface. Defaults to `false` when absent.
- `optional_rules` — the package's rulebook-optional rules (§2.3). Default
  when absent: the package declares none, and no house-rule patch can
  switch anything.

### 2.1 RuleGraph artifacts (optional)

A graph-backed ruleset package MAY add exactly two artifacts, referenced as
optional `entry_points` keys:

```
plugins/coc-keeper/rulesets/<id>/rule-graph.json
plugins/coc-keeper/rulesets/<id>/rule-graph-manifest.json
```

`rule-graph-manifest.json` carries the machine-owned identity fields:

- `contract_id` — the rule-graph build manifest contract id
  (`coc.rule-graph-build-manifest.v1`).
- `schema_version` — the contract schema version.
- `ruleset_id` — equals the package directory name; `ruleset_version` the
  exact package version.
- `source_bundles` — accepted source-bundle identity + machine digest.
- `graph_content_digest` — the graph's deterministic content digest.
- `shards` — accepted shard identities (`shard_id`) and digests.
- `family_coverage` — per-family source coverage
  (`accepted/partial/unresolved/absent`).
- `family_promotion_eligibility` — per-family runtime promotion status. R1
  always records `promotion_eligible: false` for every family.
- `data_table_dependencies` and `resolver_capability_dependencies` — exact
  rules-json data tables and resolver capabilities the graph references.
- `compiler_identity`, `reviewer_identity`, `review_status` — compiler and
  review status.
- `findings` — deterministic findings, including any source-vs-derivative
  mismatches.

Digests are machine-owned integrity fields; a model-visible projection exposes
semantic graph/rule/decision/source refs but never requires a model to relay a
manifest or content hash.

Absence of the graph artifacts is legal and default: a package that ships no
`rule_graph` / `rule_graph_manifest` entry points keeps every rule family at
`legacy` runtime ownership with its legacy Keeper surface `visible`. A package
that declares one graph artifact must declare both and keep them consistent;
`ruleset_conformance` validates contract id, ruleset identity match, and an
accepted review status.

A campaign records its bound ruleset at creation: public `campaign.create`
accepts `ruleset_id` (default `coc7`), `campaign.json` persists it, and the
kernel resolves all rules-data paths
through the single registry in `scripts/coc_rulesets.py`
(`known_rulesets` / `ruleset_data_dir` / `get_campaign_ruleset_id`).
Campaign-less contexts (char-gen previews, rule lookups before a campaign
exists) resolve the default package. Every schema-v2 campaign must contain a
non-empty registered binding whose manifest declares campaign schema 2;
missing/unknown/incompatible bindings fail closed and never select another
package's tables.

### 2.2 Rule family runtime ownership (optional)

A package MAY declare per-family rule-graph runtime ownership:

```json
{
  "rule_families": [
    {
      "family_id": "healing",
      "runtime_owner": "shadow",
      "legacy_surface": "visible"
    }
  ]
}
```

- `family_id` — one of the rule-graph contract's `rule_families` ids
  (`healing`, `combat`, `core-check`, ...).
- `runtime_owner` — `legacy` | `shadow` | `graph`:
  - `legacy` — the existing Keeper-visible path owns execution; the RuleGraph
    is not consulted (default when absent).
  - `shadow` — the legacy path stays the sole execution owner; the
    RulesRuntime compiles a candidate plan before RNG/mutation and the
    comparator records exact semantic differences to a host-internal shadow
    log (never canonical receipts, never player-visible). Missing/invalid
    graph skips the comparison and never blocks or alters the legacy op.
  - `graph` — the RulesRuntime settlement path is the sole Keeper-visible
    owner for the family (spec §14.3 cutover; requires all promotion gates).
- `legacy_surface` — `visible` | `hidden` | `removed`:
  - `visible` — the legacy operations remain Keeper-discoverable.
  - `hidden` — the legacy adapter may remain host-internal but is absent
    from Keeper discovery and working sets.
  - `removed` — the obsolete descriptor/adapter has been deleted.

Rules:

- One family cannot have `runtime_owner: "graph"` while its
  `legacy_surface` remains `visible` (spec §7.7).
- `shadow`/`graph` owners require the paired `entry_points.rule_graph` and
  `entry_points.rule_graph_manifest` (the R1 entry-point rule).
- A package that ships no `rule_families` keeps every family at
  `legacy`/`visible` — the runtime is a strict no-op for it.

### 2.3 Optional rules and house-rule patches (optional)

A rulebook separates core rules from optional ones (coc7: Spending Luck and
Luck Recovery, Keeper Rulebook p.99). A package declares each optional rule
once, in `optional_rules`:

```json
{
  "option_id": "luck-spend",
  "display": "Spending Luck",
  "enabled_by_default": true,
  "rule_refs": ["rule:coc7:push-luck:luck-spend"],
  "decision_refs": ["decision:coc7:push-luck:luck-spend"],
  "operation_gates": ["rules.luck_spend"],
  "settlement_gates": [],
  "source_note": "Keeper Rulebook p.99 ... why the package default is on"
}
```

- `rule_refs` / `decision_refs` must resolve to `rule` / `decision` nodes of
  the package graph when one is declared (conformance item 6). They are also
  the only patch targets that can switch the option.
- A disabled option projects its `decision_refs` cards as `not_applicable`
  with `disabled_by_optional_rule`, `rules.context` lists them under
  `disabled_by_optional_rules`, and `rules.settle` on one of them fails
  closed with `optional_rule_disabled`.
- `operation_gates` name canonical operations a disabled option refuses;
  `settlement_gates` name settlement steps it skips as a recorded skip row
  (coc7: `development.luck_recovery`).
- `enabled_by_default` is the package's product profile, not the rulebook's
  word: when a rulebook-optional rule defaults to `true`, `source_note`
  states why.

What decides an option is a **confirmed house-rule patch**, and only that.
Patches have one store and one path, `scripts/coc_house_rules.py`
(`save/house-rules.json`; spec `pi-coc-rule-override-and-session-rulings`
§5): the table's sentence is compiled through a semantic step into a
`RulePatch` with positive, negative and boundary cases, and the user confirms
the cases. `scripts/coc_rule_options.py` reads the confirmed patches back and
enforces the subset it can:

- relation `disables` / `enables` on a target inside a declared option's
  `rule_refs` or `decision_refs`, at layer `house_rule` or `campaign_patch`,
  scope `campaign`;
- precedence is the `coc_house_rules.LAYERS` ladder; two confirmed toggles at
  the winning layer that disagree are a `rule_conflict`, and every gate they
  touch fails closed until one is superseded;
- `overrides` / `augments`, non-campaign scopes and targets outside the
  declared options are reported (`toggles_from_patches`, `applicable:
  false`) and not enforced. Enforcing a replacement rule body is compiler
  work (spec slice R2), not campaign state.

A session ruling (`coc_session_rulings`) is precedent, never authority over
results: it cannot switch an option.

## 3. L1 data — rules-json/

Package-owned tables in package-owned shapes (the kernel imposes no
cross-ruleset table schema). Hard requirements:

- `metadata.json` with `schema_version` and `ruleset` (this activates the
  seam that was dormant in the CoC-only layout).
- `rule-index.json` (§5).
- Every table extracted from a book carries source notes with printed-page
  anchors. The repo never parses PDFs; extraction follows the PDF Source
  Bundle Contract.
- Keys ASCII English; string tokens only for genuinely computed values
  (the `half_DEX` pattern).

## 4. L1 execution — the resolver interface

`resolver.py` is the only kernel-facing execution surface of a package.
Toolbox `rules.*` handlers never import ruleset modules directly; they fetch
the active campaign's resolver through the kernel registry
(`get_resolver(campaign)`). A resolver must expose:

- `check(...)` — resolve one skill/ability check end-to-end: dice, target
  arithmetic, modifiers, success-level/quality result, and a
  source-traceable receipt dict. Deterministic; the Keeper never recomputes.
- `resource_delta(...)` — apply and validate arithmetic on the package's
  resources (HP/SAN/MP/Luck; HP/Humanity/SP; ...) with receipts.
- `public_api_index()` — discoverability of supported operations, so the
  toolbox can refuse cleanly when a ruleset does not implement an optional
  subsystem (chases, sanity, netrunning).
- Optional `validate_actor(sheet)` — package validation/normalization for the
  public `setup.invoke` / `actor.create` path. It returns exactly
  `{ "sheet": {...}, "resources": {...} }`, with one integer value for every
  manifest resource. CoC7 preserves its established `investigator.create`
  path and does not advertise this optional operation.
- Optional `social_difficulty(request, npc_defense)` — package-owned social
  difficulty ladder, motive/leverage adjustments, tactical dice policy, and
  approach-skill mapping. The kernel resolves stable commitment identity and
  canonical provenance before calling it.
- Optional `social_skill_names()` — package-owned list of NPC social skills
  whose `rules.roll` calls require and consume a canonical social adjudication.
- Optional `psychology_check_contract(npc_psychology)` — package-owned hidden
  observation skill, opposing-value ladder, difficulty basis, and stakes.
- Optional `psychology_policy(check_result, question_kind)` — package-owned
  concealed-observation inference ceiling and fumble policy. The kernel owns
  one-window identity, concealed persistence, and player-safe realization
  binding.
- Optional subsystem session types (combat/chase/sanity equivalents) behind
  the same context/execute/end tool pattern the kernel already exposes.

The cross-ruleset MCP/toolbox primitives are `rules.check` and
`rules.resource_delta`. Each accepts a required canonical `actor`, a
package-defined keyword `request`, an optional kernel-injected deterministic
`seed`, and an exact non-empty string `decision_id`. Request objects may not
supply kernel-owned identity, RNG, receipt, actor, or `current` fields.
`rules.check` persists a canonical version-bound roll source receipt and
public `logs/rolls.jsonl` row consumed by `turn.output_context` /
`turn.finalize`. `rules.resource_delta` reads current from canonical actor
state, atomically writes the new resource plus its version-bound receipt, then
materializes the toolbox ledger; replay repairs a missing roll row or ledger
without rerolling or reapplying arithmetic. Package-specific tools remain
available only when
`public_api_index()` advertises their resolver capability; otherwise the
toolbox returns `unsupported_ruleset_operation` rather than raising a missing
attribute error or substituting CoC behavior.

Dice and all numeric authority stay inside the resolver — this is hard rule
#1 of the toolbox architecture, unchanged. Resolvers must be pure functions
of their inputs plus an injectable RNG; no global state, no campaign I/O
(state writes remain kernel-owned, transactional, `decision_id`-idempotent).

The CoC reference implementation wraps the existing `coc_rules.py` /
`coc_roll.py` / `coc_sanity.py` / ... modules rather than rewriting them.

## 5. L3 index — rule-index.json identity

Each package's `rule-index.json` keeps the existing record shape (`id`,
`category`, `source_table`, `source_note`, optional `numeric`). Record ids are
package-local today; selection of the package is carried separately by the
campaign binding and by generic rules receipts (`ruleset_id`, version).
Cross-package rule-ref resolution is not yet a kernel API, so callers must not
claim `<ruleset_id>.<record_id>` namespacing or `resolve_rule_refs()` enforcement
until that API is implemented.

## 6. State extension and the resource registry

Kernel-owned campaign state stays generic: scenes, clues, flags, decisions,
NPC psych/presence, threat clocks, time, memory cards, journals, logs.
Package-owned state is declared, not hardcoded:

- `resources` in the manifest: a list of
  `{ "key": "san", "display": "SAN", "kind": "pool|score|clock",
    "reset": "daily|session|never", "projected": true,
    "recovery_rule": "<text+ref>" }` (`projected` optional, default `false`).
  This registry replaces every literal resource tuple in finalization,
  state-gateway projections, and reporting (today: HP/SAN/MP/Luck). Declared
  order is load-bearing: player-visible mechanics enumerate resources in
  manifest order. The runtime state gateway projects exactly the
  `projected: true` resources as `current_<key>` investigator fields
  (coc7: hp/san/mp project; luck deliberately does not).
- Actor sheet schema (characteristics/stats/qualities) is package-defined
  and versioned in `schema_versions`; kernel validation only checks the
  envelope (id, ruleset_id, version), never the sheet's internal fields.
- The directory carrying `role: "actor_state"` is the sole kernel-resolved
  actor state owner. Package-neutral actors use an identity/version-bound
  envelope with opaque normalized `sheet`, manifest-keyed integer `resources`,
  and state mutation `decisions`. CoC7 maps the same role to its existing
  `investigator-state/` shape; generic resource writes update its authoritative
  `current_<resource>` field and retain the state-bound receipt there.
- Package-specific state directories (e.g. CoC's `sanity-state/`) are
  declared by the package in `state_dirs` and created under the campaign
  workspace by the kernel — kernel code contains no package directory names.
  The kernel creates a declared dir at campaign init only when the entry sets
  `create_on_init: true` (coc7: `investigator-state`); unflagged dirs are
  created lazily by their owning subsystem (coc7: `sanity-state`).

Terminology localization (`coc_language.py` machinery) reads boundary term
lists from the package `boundary_terms` field (CoC's STR/CON/.../SAN/LUCK list
lives in the `coc7` manifest). Kernel machinery resolves all three registries
through `scripts/coc_rulesets.py` (`ruleset_resources`,
`ruleset_projected_resource_fields`, `ruleset_state_dirs`,
`ruleset_actor_state_dir`, `ruleset_campaign_init_dirs`,
`ruleset_boundary_terms`).

## 7. L2 behavior — skill pack and checklist

- `skills/` holds the package's rule-craft skills (for CoC: rules-engine,
  sanity, combat, chase, magic, character, development, mythos-reference).
  Generic protocol skills (mode activation, play loop, director, campaign
  state, export, bootstrap, scenario import, pdf ingest) remain kernel-level
  and load the active ruleset's skill pack by reference.
- `checklist.md` keeps the machine-checkable predicate format established
  by `checks/coC7_rule_checklist.md`: rule name, printed-page + PDF-index
  anchor, predicate over structured fields, verbatim source quote.
- Semantic Matcher Constitution applies unchanged: triggers use structured
  enums/IDs/thresholds, never keyword matching over prose.

## 8. Audit contract

- Extraction-time verifiers per package (`scripts/verify_<ruleset>_*_ocr.py`)
  against the host-PDF-skill cache; not part of pytest.
- Offline snapshots `checks/<ruleset>-*-ref.json`, compared JSON-vs-JSON by
  the offline audit; wired into pytest from the package's first commit.
  New rulesets must not accumulate audit debt (no "verify later").
- Playtest-log validation sweeps each package's checklist predicates in
  play (the `exhaustive_rulebook_validator.py` pattern), refusing vacuous
  passes.

## 9. Conformance suite

`tests/test_ruleset_conformance.py` is parametrized over every directory in
`plugins/coc-keeper/rulesets/` and asserts, per package:

1. `manifest.json` validates against the schema; `ruleset_id` equals the
   directory name; resources are well-formed; exactly one state directory owns
   the `actor_state` role.
2. `resolver.py` exposes the required interface (`check`, `resource_delta`,
   `public_api_index`) with call signatures the toolbox can invoke.
3. `rules-json/metadata.json` matches the manifest id; `rule-index.json`
   records are unique and resolve to existing tables.
4. Offline audit snapshots referenced by the package exist and the audit
   run is clean for that package.
5. Skill pack parses (frontmatter `name`/`description` present) and every
   kernel protocol skill that references the pack resolves its path.
6. `optional_rules` ids are unique and every `rule_refs` / `decision_refs`
   entry resolves to a node of that kind in the package graph (§2.3).

A deliberately broken fixture package must fail the suite (vacuous-pass
protection, same philosophy as the playtest-log validator).

## 10. Product boundaries (unchanged)

The Kernel Toolbox Architecture's four hard rules, the KP-craft constitution,
the parity law (AI-coding hosts and headless runtime are the same product —
a ruleset must load through both surfaces), the Plugin-Native Acceptance
Contract, and the Semantic Matcher Constitution all bind every ruleset.
A ruleset package adds *rules authority*, never a second KP, never a
narrative gate, never a keyword router.
