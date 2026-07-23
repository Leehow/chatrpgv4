# Investigator sheet schema discovery — architecture debt

Status: **discoverability slice implemented; validator migration deferred**.
Commit `fdedca8` publishes and connects the package-owned construction
contract without changing `investigator.create` persistence or enabling coc7
`actor.create`. The remaining package-boundary migration is recorded below
but is not yet scheduled.

## Symptom (observed in real play)

A self-driving KP calling `investigator.create` through the gateway did not
use an upfront machine-readable request shape. `coc_discover` exposes `sheet`
and `creation` as `{"type":"object","additionalProperties":true}` empty
shells, so that run learned the schema by repeated failure. In one opening
run the KP failed `investigator.create` six times before succeeding, walking
the validation layers one at a time:

```
1. investigator_id not a safe id
2. missing id / name / characteristics
3. Quick Fire creation.method mismatch
4. missing skills
5. missing canonical skill Credit Rating
6. skill value not a non-negative integer
7. (success)
```

Two commits (`2b85f91`, `40d75bf`) made the aggregate error messages list
the full required structure at once, which lets a KP self-correct faster
within a layer. But this is treatment of symptoms: each layer the KP clears
exposes the next.

The incident also exposed a separate skill-adoption problem. Pi loads the
active coc7 skill pack, `coc-main` routes character creation to
`coc-character`, and that skill already carried the full human/agent-readable
checklist. The new machine contract is a necessary host-neutral construction
surface, but it does not erase the need to verify that the canonical skill is
loaded and followed in real play.

## Root causes and remaining debt

Three facts were previously conflated:

1. The generic gateway deliberately cannot publish coc7 fields. Before
   `fdedca8`, the coc7 package had no separate machine-readable construction
   contract, so a gateway-only KP had no typed payload source to query.
2. The executable investigator validator/materializer remains in
   `plugins/coc-keeper/scripts/coc_character.py`.
   `coc_character.py:19` `REQUIRED_CHARACTERISTICS = ("STR","CON","SIZ","DEX",
   "APP","INT","POW","EDU")` and `coc_character.py:281`
   `required_derived = ("HP","MP","SAN","Luck","DB","Build","MOV")` are
   Call of Cthulhu 7th Edition fields. `coc_character.py` imports
   `coc_rules` (`coc_character.py:12-16`), which binds the default coc7
   package (`coc_rules.py:7-13`). AGENTS.md (`plugins/coc-keeper/...` single-
   track law) and `docs/ruleset-contract.md:170` require the kernel to stay
   ruleset-agnostic and the actor sheet schema to be package-defined.
3. `investigator.create` does not dispatch validation/materialization through
   a package capability.
   `coc_runtime_ops.py:3470-3493` calls
   `coc_character.materialize_quick_fire_create_sheet` and
   `coc_character.validate_character_create_sheet` directly.

The contract acknowledges this as established history:
`docs/ruleset-contract.md:112-116` —

> Optional `validate_actor(sheet)` … CoC7 preserves its established
> `investigator.create` path and **does not advertise this optional
> operation**.

And `docs/ruleset-contract.md:170`:

> Actor sheet schema (characteristics/stats/qualities) is package-defined.

The previous draft proposed advertising coc7 `validate_actor`, but that is not
a valid shortcut: `actor.create` treats that advertisement as permission to
use the generic actor persistence path, while `coc_state.create_ruleset_actor`
explicitly rejects coc7. In addition, the reusable `investigator.create`
payload has no `campaign_id` or `ruleset_id`, so it cannot simply call
`get_resolver(campaign)`.

## Why the empty discover shell is intentional (and why that is fine)

`coc_discover` returns the hash-bound, build-time
`references/mcp-operation-contracts.json` archive (`mcp/server.py:346-384`,
`coc_mcp_contract_archive.py`). `setup.invoke` is a single flattened contract
whose `payload.sheet` / `payload.creation` are deliberately
`additionalProperties:true` because the toolbox must stay ruleset-agnostic —
it must not hard-code coc7 fields into a kernel-owned contract. So the empty
shell is correct *for the kernel*. `fdedca8` keeps it unchanged:
`coc_discover` now exposes only the small static input contract for
`setup.investigator_contract(campaign_id)`, while executing that read-only
operation returns the active ruleset's full construction contract.

## Chosen staged exit

### Phase A — discoverability vertical slice: Done

- `rulesets/coc7/investigator-create-contract.json` owns a versioned JSON
  Schema for the complete `investigator.create` payload, not merely `sheet`.
  It distinguishes deterministic Quick Fire input from the complete-sheet
  path and states that executable arithmetic/validation remains authoritative.
- The coc7 resolver advertises the distinct read-only
  `investigator_create_contract()` capability. It does **not** advertise
  `validate_actor`.
- `setup.investigator_contract` accepts exactly `campaign_id`, resolves the
  active ruleset, verifies contract identity/version against the manifest, and
  returns an independent contract object.
- `coc-main` and `coc-character` direct custom creation to query and retain
  this contract once after campaign creation.
- `investigator.create`, generic `actor.create`, reusable investigator storage,
  Quick Fire materialization, and state writes are unchanged.

### Phase B — package executable validation/materialization: Deferred

If pursued, add a distinct coc7 investigator capability such as
`materialize_validate_investigator(sheet, creation)`. Do not reuse
`validate_actor` unless the project deliberately unifies generic actor and
coc7 investigator persistence as a separate migration.

Before moving behavior, freeze an exact accept/reject matrix. Current runtime
behavior is looser than a strict schema in several places: it checks trimmed
ASCII skill keys rather than catalog membership, allows extra sheet fields,
and does not apply identical age/derived validation in every creation variant.
The migration must preserve or explicitly change those semantics.

### Phase C — reusable investigator ruleset identity: Deferred decision

Reusable investigators are workspace-level and may be linked after creation.
Generalizing them beyond coc7 requires an explicit durable `ruleset_id` and
schema-version ownership design. Until that product decision is approved,
`investigator.create` remains the established coc7 path.

## Why this is not a quick fix

Phase A was intentionally small because it adds an upfront query without
changing the opening write path. Phase B remains a non-trivial migration:
`investigator.create` is on every custom campaign's opening critical path,
coc7's Quick Fire materialization
(`materialize_quick_fire_create_sheet`, `coc_character.py:114-185`) carries
deterministic rules-layer arithmetic, and the derived-consistency check
(`coc_character.py:335-357`) must survive the move. It should be designed,
adversarially reviewed, and migrated as a dedicated task — not patched
inside a playtest session.

## Interim mitigations already shipped

- `e7445ce` made the four `scenario.bind_pdf` error messages actionable
  (bind dead-loop resolved: 11 blind retries → 0).
- `2b85f91` made `investigator.create` derived / Quick Fire / missing-
  characteristics errors list the full required structure.
- `40d75bf` made the `missing skills` error list the full skills shape.

These remain useful fallback diagnostics. The package-owned construction
contract now supplies the upfront shape.

## Phase A validation

- Integrated commit: `fdedca8`.
- Focused runtime/MCP/ruleset selection: `11 passed`.
- MCP archive: `91` operations; `check` PASS; content SHA
  `sha256:a936db0a67d73494cf398e4608e83d1bbf917df4129a87e4d6c9a4aa29478ddf`.
- Required `tests/test_plugin_metadata.py`: `26 passed, 1 failed`. The same
  `test_cursor_thin_entry_requires_kp_craft_parity_with_codex` failure occurs
  unchanged at base `c7e9f3a`; it is inherited Pi README parity debt, not a
  Phase A regression.

## Evidence index

- Symptom run: `.coc/campaigns/amaranthine-desire/logs/toolbox-calls.jsonl`
  (six `investigator.create` failures then success, 2026-07-23; cleaned up
  after capture).
- coc7 sheet fields in kernel code: `plugins/coc-keeper/scripts/coc_character.py:19`,
  `:281`, `:242-358`, `:114-185`.
- `investigator.create` bypass: `plugins/coc-keeper/scripts/coc_runtime_ops.py:3470-3493`.
- Published payload contract:
  `plugins/coc-keeper/rulesets/coc7/investigator-create-contract.json`.
- Read-only query runtime/tool:
  `plugins/coc-keeper/scripts/coc_runtime_ops.py` (`investigator.contract`),
  `plugins/coc-keeper/scripts/coc_toolbox.py`
  (`setup.investigator_contract`).
- coc7 resolver advertises `investigator_create_contract`, not
  `validate_actor`: `plugins/coc-keeper/rulesets/coc7/resolver.py`.
- Contract acknowledgment: `docs/ruleset-contract.md:112-116`, `:170`.
- Static discovery remains archive-backed:
  `plugins/coc-keeper/mcp/server.py:346-384`,
  `plugins/coc-keeper/scripts/coc_mcp_contract_archive.py`,
  `plugins/coc-keeper/references/mcp-operation-contracts.json`.
- coc7 generation-method data (per-method constraints to carry into a schema
  file): `plugins/coc-keeper/rulesets/coc7/rules-json/characteristic-dice.json`.
