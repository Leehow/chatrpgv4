# Ruleset Contract

How a TRPG rule system becomes a loadable **ruleset package** for the
(formerly CoC-only) Keeper framework. This contract is the concrete form of
the three-layer paradigm in `docs/rulebook-abstraction-paradigm.md`:
a ruleset packages its L1 data, L1 resolver code, L2 behavioral material,
L3 index, state extensions, audit snapshots, and character creation under
one directory, and the kernel binds exactly one ruleset per campaign.

Status: contract v1. `coc7` is the reference package; `cpr` (Cyberpunk RED)
is the proving second package. Everything here is binding on new rulesets;
deviations require amending this document, not silent exceptions.

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
  "data": "rules-json/" }`.
- `resources` — the **resource registry** (§6).

Optional fields (absent means the documented default, never an error):

- `state_dirs` — package-owned campaign state directories under `save/`
  (§6). Entries: `{ "name": "sanity-state", "create_on_init": false }`.
  `create_on_init` defaults to `false`: the kernel creates the dir at campaign
  creation only when flagged; otherwise the owning subsystem creates it
  lazily. Default when `state_dirs` is absent: no package directories.
- `boundary_terms` — ASCII machine-facing terms that table-language
  localization rewrites only on ASCII token boundaries (§6). Default when
  absent: the empty set (every term localizes by plain replacement).
- Per-resource `projected` (inside `resources` entries) — when `true`, the
  kernel projects `current_<key>` into the runtime player-safe investigator
  surface. Defaults to `false` when absent.

A campaign records its bound ruleset at creation: `campaign.json` persists
`ruleset_id` (default `coc7`) and the kernel resolves all rules-data paths
through the single registry in `scripts/coc_rulesets.py`
(`known_rulesets` / `ruleset_data_dir` / `get_campaign_ruleset_id`).
Campaign-less contexts (char-gen previews, rule lookups before a campaign
exists) resolve the default package; an unknown or unregistered id never
silently selects a different package's tables.

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
- Optional subsystem session types (combat/chase/sanity equivalents) behind
  the same context/execute/end tool pattern the kernel already exposes.

Dice and all numeric authority stay inside the resolver — this is hard rule
#1 of the toolbox architecture, unchanged. Resolvers must be pure functions
of their inputs plus an injectable RNG; no global state, no campaign I/O
(state writes remain kernel-owned, transactional, `decision_id`-idempotent).

The CoC reference implementation wraps the existing `coc_rules.py` /
`coc_roll.py` / `coc_sanity.py` / ... modules rather than rewriting them.

## 5. L3 index — rule-index.json namespacing

Each package's `rule-index.json` keeps the existing record shape (`id`,
`category`, `source_table`, `source_note`, optional `numeric`). At load the
kernel namespaces ids as `<ruleset_id>.<record_id>`
(`coc7.core.percentile_check`, `cpr.combat.dv_table`). Play-log `rule_refs`
must resolve within the campaign's ruleset namespace;
`resolve_rule_refs()` enforces this. Cross-ruleset references are invalid
by construction.

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
`ruleset_campaign_init_dirs`, `ruleset_boundary_terms`).

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
   directory name; resources are well-formed.
2. `resolver.py` exposes the required interface (`check`, `resource_delta`,
   `public_api_index`) with call signatures the toolbox can invoke.
3. `rules-json/metadata.json` matches the manifest id; `rule-index.json`
   records are unique and resolve to existing tables.
4. Offline audit snapshots referenced by the package exist and the audit
   run is clean for that package.
5. Skill pack parses (frontmatter `name`/`description` present) and every
   kernel protocol skill that references the pack resolves its path.

A deliberately broken fixture package must fail the suite (vacuous-pass
protection, same philosophy as the playtest-log validator).

## 10. Product boundaries (unchanged)

The Kernel Toolbox Architecture's four hard rules, the KP-craft constitution,
the parity law (AI-coding hosts and headless runtime are the same product —
a ruleset must load through both surfaces), the Plugin-Native Acceptance
Contract, and the Semantic Matcher Constitution all bind every ruleset.
A ruleset package adds *rules authority*, never a second KP, never a
narrative gate, never a keyword router.
