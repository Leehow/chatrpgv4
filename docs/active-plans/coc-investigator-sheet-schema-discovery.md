# Investigator sheet schema discovery — architecture debt

Status: **recorded debt, not yet scheduled**. This note captures the root
cause, evidence, and the correct migration exit discovered during live
pi-coc KP testing (2026-07-23). It is a design starting point for a future
ruleset-migration task, not an approved plan.

## Symptom (observed in real play)

A self-driving KP calling `investigator.create` through the gateway could
not see the required sheet shape. `coc_discover` exposes `sheet` and
`creation` as `{"type":"object","additionalProperties":true}` empty shells,
so the KP learned the schema only by repeated failure. In one opening run
the KP failed `investigator.create` six times before succeeding, walking
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

Three commits (`2b85f91`, `40d75bf`) made the aggregate error messages list
the full required structure at once, which lets a KP self-correct faster
within a layer. But this is treatment of symptoms: each layer the KP clears
exposes the next, because the KP still has no upfront schema to consult.

## Root cause

The investigator sheet schema is **implicitly hard-coded in
`plugins/coc-keeper/scripts/coc_character.py`** (a kernel directory), not
declared as machine-readable data on the coc7 ruleset package, and
`investigator.create` calls it directly, **bypassing the ruleset dispatch
path** the contract already defines.

Two facts compound:

1. The sheet fields are coc7 rules living in kernel code.
   `coc_character.py:19` `REQUIRED_CHARACTERISTICS = ("STR","CON","SIZ","DEX",
   "APP","INT","POW","EDU")` and `coc_character.py:281`
   `required_derived = ("HP","MP","SAN","Luck","DB","Build","MOV")` are
   Call of Cthulhu 7th Edition fields. `coc_character.py` imports
   `coc_rules` (`coc_character.py:12-16`), which binds the default coc7
   package (`coc_rules.py:7-13`). AGENTS.md (`plugins/coc-keeper/...` single-
   track law) and `docs/ruleset-contract.md:170` require the kernel to stay
   ruleset-agnostic and the actor sheet schema to be package-defined.

2. `investigator.create` does not dispatch through the ruleset resolver.
   `coc_runtime_ops.py:3412-3435` calls
   `coc_character.materialize_quick_fire_create_sheet` and
   `coc_character.validate_character_create_sheet` directly. There is no
   `get_campaign_ruleset_id` / `get_resolver` call on this path. By contrast
   `actor.create` (`coc_runtime_ops.py:3366-3385`) does dispatch correctly:
   `resolver = get_resolver(campaign)` → `resolver.public_api_index()` →
   `resolver.validate_actor(sheet)`.

The contract acknowledges this as established history:
`docs/ruleset-contract.md:112-116` —

> Optional `validate_actor(sheet)` … CoC7 preserves its established
> `investigator.create` path and **does not advertise this optional
> operation**.

And `docs/ruleset-contract.md:170`:

> Actor sheet schema (characteristics/stats/qualities) is package-defined.

So today the coc7 resolver advertises no `validate_actor`
(`rulesets/coc7/resolver.py` has zero occurrences of `validate_actor`;
`public_api_index` at `resolver.py:405` does not list it), and the only
machine-executable sheet definition lives in kernel Python that the gateway
never surfaces to the KP.

## Why the empty discover shell is intentional (and why that is fine)

`coc_discover` returns the hash-bound, build-time
`references/mcp-operation-contracts.json` archive (`mcp/server.py:346-384`,
`coc_mcp_contract_archive.py`). `setup.invoke` is a single flattened contract
whose `payload.sheet` / `payload.creation` are deliberately
`additionalProperties:true` because the toolbox must stay ruleset-agnostic —
it must not hard-code coc7 fields into a kernel-owned contract. So the empty
shell is correct *for the kernel*; the missing piece is that the **coc7
ruleset never publishes its own sheet schema** for the KP to read.

## Correct migration exit (already in place, unused)

The ruleset-agnostic dispatch path `actor.create` uses already exists and is
the intended home for this:

1. Declare a machine-readable coc7 investigator sheet schema under
   `rulesets/coc7/` (JSON or JSON-Schema) covering the fields
   `coc_character.py` currently validates in code: `id`, `name`,
   `characteristics` (the eight), `derived` (HP/MP/SAN/Luck/DB/Build/MOV),
   `skills` (dict, must include `Credit Rating`, canonical-English keys,
   non-negative integers), optional `age`, optional `creation`
   (`method` + per-method constraints from
   `rulesets/coc7/rules-json/characteristic-dice.json`).
2. Implement `validate_actor(sheet)` on the coc7 resolver and advertise it in
   `public_api_index()` (`rulesets/coc7/resolver.py:405`), returning the
   contract shape `{ "sheet": {...}, "resources": {...} }`.
3. Route `investigator.create` validation through
   `get_resolver(campaign)` → `validate_actor`, mirroring `actor.create`
   (`coc_runtime_ops.py:3366-3385`), instead of the direct
   `coc_character.*` calls.
4. Surface the published sheet schema to the KP — e.g. a read-only
   `setup.sheet_template` operation, or a `coc_discover` extension that
   returns the active ruleset's sheet schema — so the KP can construct a
   valid sheet without trial and error.

After this, `coc_character.py`'s field literals become coc7 package data,
the kernel stays agnostic, and the KP sees the schema upfront regardless of
host.

## Why this is not a quick fix

This is a multi-file migration across the ruleset contract boundary
(schema file + resolver + runtime dispatch + discover surface), with
non-trivial regression surface: `investigator.create` is on every campaign's
opening critical path, coc7's Quick Fire materialization
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

These reduce, but do not eliminate, KP trial-and-error. Each cleared layer
still exposes the next until the schema is published upfront.

## Evidence index

- Symptom run: `.coc/campaigns/amaranthine-desire/logs/toolbox-calls.jsonl`
  (six `investigator.create` failures then success, 2026-07-23; cleaned up
  after capture).
- coc7 sheet fields in kernel code: `plugins/coc-keeper/scripts/coc_character.py:19`,
  `:281`, `:242-358`, `:114-185`.
- `investigator.create` bypass: `plugins/coc-keeper/scripts/coc_runtime_ops.py:3412-3435`.
- Correct dispatch (the exit): `plugins/coc-keeper/scripts/coc_runtime_ops.py:3366-3385`.
- coc7 resolver does not advertise `validate_actor`:
  `plugins/coc-keeper/rulesets/coc7/resolver.py` (0 occurrences),
  `public_api_index` at `:405`.
- Contract acknowledgment: `docs/ruleset-contract.md:112-116`, `:170`.
- Discover returns flattened contract only:
  `plugins/coc-keeper/mcp/server.py:346-384`,
  `plugins/coc-keeper/scripts/coc_mcp_contract_archive.py`,
  `plugins/coc-keeper/references/mcp-operation-contracts.json`.
- coc7 generation-method data (per-method constraints to carry into a schema
  file): `plugins/coc-keeper/rulesets/coc7/rules-json/characteristic-dice.json`.
