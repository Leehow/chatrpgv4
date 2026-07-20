# COC causal check realization and final turn output

Work ID: `coc-causal-turn-finalization`
Status: `In Progress`
Last updated: `2026-07-18`

## Goal

Make every settled check reach player-facing fiction as a causally complete
resolution, while preserving exact public dice and player-visible mechanical
changes. Implement one shared final-turn contract in the canonical
`plugins/coc-keeper/` track and preserve equivalent behavior on direct
AI-coding hosts and Pi/headless.

## Approved product decisions

- The mandatory boundary is post-settlement output finalization, not a fixed
  Director, Storylet, NPC, or narration-tool pipeline.
- Abstract player intent may be safely realized from current fiction and PC
  portrayal; concrete player words/actions must be preserved.
- Every active/reaction check needs causal fictional uptake. Related rolls may
  share one beat, but every roll obligation must close exactly once.
- Concealed checks with no observable effect close internally without revealing
  that a roll occurred; observable concealed consequences are narrated without
  public roll details.
- Public dice and player-visible HP/SAN/MP/Luck, ammunition, items, conditions,
  and time changes are deterministic output owned by the finalizer, not LLM
  arithmetic.
- Deterministic ownership does not mean an end-of-turn mechanics dump. The KP
  places immutable mechanic sources at paragraph boundaries: action/risk,
  authoritative roll, fictional result, then any immediately relevant damage
  or state change. A public roll after its covered consequence is invalid.
- Structured investigator and scene factors such as APP, Credit Rating,
  SIZ/Build, occupation, visible equipment, and environmental scale become
  causal narration obligations only when they actually influenced an NPC
  reaction, access, feasibility, difficulty, or settled outcome. Unused sheet
  values are never recited merely because they exist. Every investigator–NPC
  first contact produces one exactly-once `context_effect` receipt showing the
  player-known APP and Credit Rating values and which value governed the first
  impression. The concealed d100 remains hidden, while the resulting manner or
  any authored/accumulated-disposition override is realized in fiction. A later
  encounter does not repeat that first-contact receipt. These attributes enter
  the `state_delta` category only if their stored values themselves changed.
- Required difficulty, achieved success level, pass/fail, and surplus levels
  are distinct structured facts. Surplus normally changes fictional quality,
  not the authorized goal; critical/fumble effects require an exceptional beat.
- Finalization repair never reruns settled rules or state mutations.

## Non-goals

- No mandatory Director/Storylet call order or scene/clue eligibility gate.
- No keyword/regex judging of natural-language meaning.
- No second host-specific Keeper engine or revival of a compatibility-only live
  turn path as the canonical product.
- No disclosure of hidden rolls, NPC private resources, Keeper-only state, or
  undiscovered module truth.
- No push, deploy, branch deletion, destructive git, schema migration, or old
  save compatibility layer.
- No unsupported claim that generic chat hosts have a physical output
  interceptor; bypass is contract-invalid there until such a hook exists.

## Acceptance items

| Item | Status | Acceptance |
|---|---|---|
| A35 Product-policy amendment | `In Progress` | Narrow fourth hard invariant is canonical and discoverable; optional advisory methods remain optional. |
| A36 Settled-turn scope and obligation ledger | `In Progress` | Contextual percentile facts and source-bound generic pushes are implemented; stable shared turn/source identity and obligation closure remain. |
| A37 Hash-bound causal coverage | `Not Done` | Exact draft/bundle hashes; closed semantic findings cover every check plus every adopted APP/CR/SIZ-Build/occupation/equipment/environment factor that materially shaped the ruling; bounded narration-only repair; no keyword matching. |
| A38 Deterministic public mechanics | `Not Done` | Four closed player-output categories render exactly once from authoritative receipts: `public_check`, `state_delta`, `context_effect` (including per-NPC first contact), and `concealed_consequence`; no hidden d100 disclosure. |
| A39 Shared final-output boundary | `Not Done` | Direct hosts use/echo the canonical finalizer; Pi withholds output without a valid receipt and never cold-replays settled state. |
| A40 Real-host evidence | `Not Done` | Component/adversarial checks plus fresh plugin-native Codex and Pi/headless journeys preserve exact transcript/finalization evidence. |

## Existing-work boundary

At intake, branch `0.4.0a` is ahead of origin by 11 commits and eight tracked
files already contain unrelated or adjacent user/worker changes. Implementers
must read and preserve those diffs, never revert or clean them, and stop on an
unresolvable overlap.

## Validation profile

- Early implementation uses thin contract tests only: exact schemas, arithmetic,
  idempotency, source identity, hidden-data projection, and one happy-path
  vertical slice. Do not repeatedly re-audit the same component boundary.
- As soon as first-contact context, causal finalization, and deterministic
  mechanics compose end to end, run a fresh real plugin-native Agent-player
  session. The exact delivered transcript and generated battle report are the
  primary product evidence.
- Iterate first on failures visible in that play evidence: causal prose,
  persona fit, NPC belief/response logic, success-tier quality, critical/fumble
  events, first-impression realization, and readable mechanical receipts.
- Before final handoff, retain the repository-required metadata checks and one
  canonical Pi/headless journey; broader component suites are supporting
  evidence, not a substitute for play.

## Planned worker lanes

1. Rules and contextual difficulty contract.
2. Authoritative mechanical receipts and player-safe delta bundle.
3. Canonical turn finalizer, policy/skill integration, and runtime output gate.
4. Thin contract validation, then early real-host play and battle-report-driven
   revision. Independent adversarial review is reserved for a concrete failure
   exposed by play or a genuinely high-risk authority boundary.

## Progress log

- `2026-07-19`: replaced the fixed `fiction -> all rolls -> all deltas` output
  order with closed `mechanics_placements`. Every bundle source is rendered
  exactly once at a declared paragraph boundary, and each public roll must
  precede its coverage excerpt. Host validators now accept interleaved fiction
  and mechanic segments while still verifying exact hashes and source
  completeness. Natural-Chinese style remains always on; `narration.review`
  is selective rather than a routine empty per-turn receipt.

- `2026-07-18`: contextual percentile resolver now separates base target,
  required level/target, achieved level, pass/fail, and surplus. Generic
  `rules.roll` requires an explicit contextual contract; generic `rules.push`
  is source-bound and rejects fumbled origins without writes. The canonical
  formatter shows contextual threshold and achieved level. Lead rerun:
  `344 passed`.
- `2026-07-18`: combat and subsystem percentile consumers now preserve the
  canonical contextual settlement and the lead's focused rerun passed
  `444` tests. Independent adversarial review found four integration blockers:
  stale/missing MP authority, an open `amount`/`percentile_check` event union,
  under-validated Luck raw/adjusted evidence, and the remaining old-shaped
  Toolbox Luck caller. Revision is in progress; the consumer lane is not yet
  accepted.

## Blockers and risks

- Direct coding-host chat has no platform output interceptor; enforcement there
  is a canonical hard contract plus auditable receipt, not physical withholding.
- Ammunition lacks a complete reserve ledger and several mutation paths lack
  exact before/after receipts.
- Current turn/source windows are not yet durable enough for a fail-closed
  completeness claim.
- Existing dirty files overlap policy and Pi integration surfaces and must be
  merged intentionally.

## Next action

Dispatch bounded implementation workers for the disjoint rules and mechanical
foundation, review their diffs, then dispatch the single finalizer/integration
owner against the accepted foundation.
