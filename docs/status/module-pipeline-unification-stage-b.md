# Module pipeline unification — Stage B status

> **Status:** FORWARD PATH PROVEN / NATURAL PLAY PARTIAL — a real module was
> compiled to a ModuleGraph, projected deterministically into the seven-file
> Scenario IR, installed as a complete scenario, and opened at a live
> Pi-Coc RPC table by Grok 4.5, which played one investigation turn with real
> dice. Deeper play stopped at a pre-existing fumble/roll-handle engine defect
> (§5), not at anything module-projection owns.
> **Date:** 2026-09-01
> **Track:** `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`
> **Spec:** [pi-coc-module-source-pipeline-unification.md](../specs/pi-coc-module-source-pipeline-unification.md)
> **Module:** 《不息的渴望》(An Amaranthine Desire), Chinese translation,
> 41 pages, `source_language: zh-Hans`.

## 1. What ran

```
source bundle (external, unchanged bytes)
  -> 9 prepare packets (whole book: identity, personae, background, time loop,
     opening+woods, mill, town, church climax, edge+epilogue)
  -> 9 model-authored v3 shard candidates
  -> deterministic check (source-bound) -> independent semantic review
  -> 9 accepted shards -> module graph: 86 nodes / 91 claims / 91 relations
  -> projection packets -> runtime records -> digest-bound sidecar
  -> deterministic projection into 8 Scenario IR documents
  -> complete-scenario install into a fresh campaign
  -> live pi-coc RPC table with Grok 4.5 as Keeper
```

The independent reviewer rejected 5 of 9 candidates on the first pass — every
rejection the same class, **cross-section leakage** (content true in the book
restated in a shard whose own packet cannot evidence it), plus one citation-less
title string. Bounded repairs addressed exactly those findings; the second pass
accepted all nine. No fabricated stat values: all 11 stat blocks were verified
against the appendix spans, and `—`/`Varies` cells stayed in `stats_absent`.

## 2. Deterministic evidence

- `coc_scenario_compile.validate_compiled_scenario` on the projected IR:
  **0 errors, 0 warnings**.
- `coc_module_projection.py parity`: **equal** for all 8 documents against the
  installed campaign.
- Per-document `validate-records`: 0 findings.
- Keeper/player search isolation on the built graph: a Keeper query for 莎拉
  returns her neighbourhood; the same query as player returns nothing.
- `tests/test_module_projection.py` + `tests/test_starter_graph_projection.py`
  + `tests/test_plugin_metadata.py`: **49 passed**.
- `tests/pi/structured-pressure-move-projection.mjs` (new): authored pressure
  move survives projection; a machine-shaped id still fails closed.

## 3. Live table evidence

Evidence root (retained, not committed): `.rpc-evidence-stageb/` in this
worktree — `rpc-events-run1/2/3.jsonl`, per-turn `turn-*.json`, `pi-stderr.log`.
Campaign `amaranthine-table3`, `play_language: zh-Hans`, Grok 4.5 as Keeper,
one player (this session), one turn at a time through the repo's own
`tests/pi/_lib/rpc-driver.py` against `pi-coc --campaign … --mode rpc`.

- **Turn 1 (opening).** The Keeper opened on the module's own scene and clock:
  `【开场时间】1895年1月25日 凌晨2点`, the Dunwich shore, the Dutch tobacco
  landing, the cliff-top lantern — all projected content, none invented.
- **Turn 2 (investigation).** The Keeper resolved a Spot Hidden check against
  the projected sheet (`掷骰 52 / 基础值 60 / 成功`) and answered from the
  scene's own material.
- **Turn 3 onward.** Blocked by §5.

## 4. Findings fixed in this stage

1. **Structured pressure moves never reached the Keeper.**
   `story-graph-schema.md` §2 lets a scene author pressure moves as objects
   named by a bare `id`, but that field was undeclared in the `scene.context`
   and `session.resume` identity tables, so the entire canonical result failed
   closed as `semantic_identity_unavailable` — the Keeper got no scene at all
   and fell back to a generic opening. The committed starter only uses the
   string form, so nothing had ever exercised the documented object form.
   Fixed by declaring the field; the value grammar still rejects machine ids.
2. **Graph-backed modules had no complete-scenario install path.**
   `scenario.bind_pdf` puts a campaign on the raw-PDF progressive lane, whose
   opening-projection coordinator must answer questions a graph-backed module
   has already answered, so `campaign.complete` refused with
   `opening_source_not_prepared`. `install_projected_scenario` now lands such a
   module the way a starter does (materialize views, take the module's era and
   start clock, activate the opening scene).
3. **The module's authored start clock was ignored**, leaving the table on the
   era default (`1890-09-15`). The installer now routes `module-meta.start_clock`
   through `reset_campaign_time_state`, the same path starters use.
4. **Consumed fields were missing from the projection registry** — the six-field
   scene contract, structured threat affinity, time-loop signals,
   `foreign_dialogue`, and `player_safe_summary` are all read by the compiled
   archive and `scene.context` but could not be carried. Registered after
   confirming each against its consumer.

5. **An installed projection could leave the graph unreachable.** The
   projection installed the materialized views but bound nothing to the graph's
   asset root, so `module.context` answered `unbound` on exactly the campaigns
   this pipeline produces — the Keeper had the scenario but no graph to consult.
   The projected `module-meta.json` now carries the canonical
   `module_graph_asset_root_id` pointer (the same one starters use), and the
   installer fails closed when no installed graph answers there. Verified on
   the real campaign: Keeper search for 莎拉 returns her neighbourhood and a
   `concept-time-loop` expansion returns the loop's rules and reset event.

6. **Extracted stat blocks reached no consumer.** The projection carried the
   numbers in `npcs[].stats` — the extraction pipeline's own shape, which
   nothing in the repository reads. Combat resolves an NPC through
   `agenda["mechanics"]["profile"]` (`coc_operation_combat`, validated by
   `coc_mechanics`), so a module with a fully extracted appendix still had zero
   combat-ready NPCs. `mechanics` is now registered in the projection field
   registry, and the module's own appendix values were authored into it:

   | NPC | page | combat participant built from source |
   | --- | --- | --- |
   | 莎拉·布劳恩 | 32 | Brawl 30 / Dodge 45 / HP 11 / DEX 70 / MP 16 |
   | 凯瑟琳·唐宁 | 32 | Brawl 30 / Dodge 40 / HP 11 |
   | 克莱尔·布恩 | 32 | Brawl 35 / Dodge 50 / HP 10 |
   | 纳撒尼尔·哈尔 | 32 | Brawl 40 / Dodge 45 / HP 10 |
   | 塔昆 | 32 | Fighting 50 / Dodge 70 / armour 2 / SAN 0-1D3 |
   | 威廉姆·莱维特 | 33 | Brawl 25 / Dodge 30 / HP 13 |
   | 拉尔夫·霍金斯 | 33 | characteristics + skills only (see gap below) |
   | 约瑟夫·芬彻 | 33 | Brawl 25 / Dodge 25 |

   Every value is copied from the printed appendix; what the source does not
   print stays in `fields_not_authored`, which the contract requires to close
   over the full actor schema. Two honest gaps remain and were not filled:

   - **拉尔夫·霍金斯** — the appendix prints his characteristics and
     `Skills: Intimidate 40%, Listen 45%, Spot Hidden 45%` but no Brawl or
     Dodge line, so the runtime falls back to Brawl 25 / DEX-half Dodge. The
     fallback is silent; the missing lines are a source fact, not an oversight.
   - **芬彻的鬼魂** — printed as `STR — CON — SIZ —` (no body) and fights by
     opposed POW, so it cannot satisfy the actor profile's required
     STR/CON/SIZ/DEX/POW. No numbers were invented for it; a ghost-shaped
     mechanics path is a separate question.

7. **The whole structured conversation surface was empty.** The projection
   field audit (added with these fixes) reported that no NPC record populated
   any of `facts`, `known_fact_ids`, `revealable_fact_ids`, `disclosure_order`,
   `lie_options`, `deflect_options`, `leverage_ids` or `active_reactions` —
   the A21 contract the disclosure engine reads. The Keeper had NPCs and
   agendas but no structured fact any of them could be made to give up, so
   every conversation was improvisation.

   Authored from the module's own text for the nine NPCs who actually talk,
   each fact bound to exactly one authored clue: Lucas answers anything once
   alms are given; Henry Scott names the loop and the ageing; Holt opens with
   "the master is not at home" and yields the attic under intimidation;
   Hawkins denies everything until subdued; the three hunters warm up only
   when Sarah or the relic is mentioned; Fynche keeps his revelation to
   himself until persuaded. `coc_npc_state.validate_a21_contract` reports
   **0 findings**, and the deflect/lie lines and leverage ids reach the
   Keeper through the ordinary `npc.query` surface.

   The audit now reports only `foreign_dialogue` (for NPCs who speak no
   foreign language) and `source_refs` (deliberately kept out of runtime
   records; the evidence lives in the graph) as unpopulated.

8. **The scene never moved, because nobody owned its idempotency key.**
   `decision_id` is declared host-owned for `state.move_scene`, so the model
   schema hides it — but unlike `state.journal` and `state.advance_time`,
   nothing supplied a value. On a live table the Keeper called the operation
   four times, each rejected with `missing_param`, was then repeat-blocked,
   and narrated the crossing into 1287 anyway: the fiction moved while the
   authoritative scene stayed on the 1895 opening. The host now supplies the
   key, named after the destination so two different moves in one turn stay
   distinct and a repeated identical move stays idempotent.

   Verified by re-running the table: the Keeper still sends only `scene_id`
   (it cannot see the field), `state.move_scene` succeeds first try, and
   `world-state.json` moves to `scene-the-woods` with the opening marked
   exhausted. Evidence: `.rpc-evidence-run2/` (the failure) and
   `.rpc-evidence-run3/` (the fix).

9. **A restart mid-turn bricked the campaign permanently.** The durable
   open-turn player-input cache is only written when an anchor already exists,
   and a fresh process has none until its first `session.resume` — so the first
   message after a restart was never persisted. If that turn stayed open, the
   next resume reported `player_input_binding_unavailable`, the startup gate
   stayed pending (an `open_turn_recovery` disposition never clears it), the ACL
   held the phase at `recovery`, and `state.journal` was denied for want of a
   recovery binding. Exiting recovery needed the journal; the journal needed the
   input; the input could no longer exist. A new session did not help: the dead
   end is in campaign state, so the table was unplayable for good.

   The host now keeps the live player message in memory regardless of phase and,
   when a resume finds the durable cache empty, adopts it as the open turn's
   input — recorded durably so the next restart recovers it the ordinary way,
   and audited as `adopted_live_message` rather than a cache recovery, because
   the provenance differs. Verified against the campaign this bricked: it
   resumed and played on into the mill fire. Evidence: `.rpc-evidence-run3/`.

10. **A committed write was reported to the Keeper as a failure.** Paying the
    beggar for local news made `state.cash_grant` return
    `semantic_identity_unavailable`: its result carries the shared `game_time`
    block, whose `location_id` was declared per operation and never for the
    cash family. The ledger shows the money moved; the Keeper was told it did
    not — the worst direction for this error class, since it invites a second
    write or prose that contradicts state. `location_id` is now globally
    declared alongside `civil_segment_id`, for the same stated reason: it is
    operation-neutral vocabulary of a block many results carry. The
    identity-declaration sweep's outstanding ledger shrank by the three
    progressive operations this paid down. Verified live: the next alms
    deducted correctly (5.00 → 4.99).

11. **The conversation the module is built around could not be recorded.**
    `state.record_npc_engagement` had no identity declaration at all, so the
    first real talk with an NPC failed closed on `route_completion.scene_id`
    — after the engagement had already been written. Declared from the fields
    its own canonical result carries: authored slugs semantic, the
    registry-backed identity and receipt refs host-only.

12. **The first player turn after a restart got an empty reply.**
    `state.journal` declares `player_text` and `decision_id` host-owned, and
    the host arms that binding at message start — but that arming is skipped
    while the startup resume gate is still pending, which is exactly when the
    player's message reaches a freshly restarted process. Nothing re-armed
    once the resume was accepted. The Keeper spent eight minutes cycling
    `missing_param` → `nonretryable_repeat_blocked` and the player received
    nothing; the turn only recovered because the Keeper eventually opened a
    turn and the `open_turn_recovery` path adopted the live message. The
    accepted-resume path now arms the binding for the message that owns the
    turn. Verified live: the next restart turn journaled on its first attempt
    and the player got a full reply. `tests/pi/startup-resume-journal-binding.mjs`
    pins it (and fails without the fix).

13. **The core social rule was missing from every Keeper's rules context.**
    A decision card's `possible_continuations` names whatever its `continues-as`
    relation points at, and the coc7 rule graph authors two node kinds there —
    11 decisions and 3 dedicated `continuation` nodes. Both consumers accepted
    only `decision:`, and both fail destructively rather than partially: the
    Python wire returns `None` for the whole list and its caller then drops the
    entire card; Pi reports the field unmapped and the extension replaces the
    entire envelope with `semantic_identity_unavailable`. Since
    `decision:coc7:social:adjudicate-difficulty` continues as
    `continuation:coc7:push-luck:after-fail-push`, the Keeper asking for social
    rules mid-conversation was told the tool had failed. Both sides now share
    one prefix set, and `tests/test_rule_continuation_namespaces.py` reads the
    authored graph plus both consumers' own declarations, so a new continuation
    target kind fails there instead of deleting a rule card in play. Verified
    live: `rules.context` returned the social card and the next social settle
    succeeded.

14. **The Keeper could not read its own memory of the previous loop.** The
    identity-declaration ledger stood at 35 operations and 122 fields, and two
    of them reached the table in one evening: `memory.recall` and
    `transcript.locate` both returned `semantic_identity_unavailable` for the
    whole result when the Keeper asked what it remembered of the loop before
    this one — which a time-loop module cannot survive. Every field was
    classified from the value its producer actually emits in the sweep corpus,
    paying the ledger down to three entries. Those three are proved to be a
    fixture artifact rather than debt: the corpus campaign is named
    `toolbox-test`, and `toolbox-` is a machine prefix the value grammar
    refuses by design, so no declaration can close them and loosening the
    grammar would be the wrong trade.

15. **A whole scene was lost to two of the most ordinary slugs in the system.**
    `state.npc_presence` had no declaration, so placing Henry Scott in the
    scene failed closed on `npc_id` and `scene_id`; the social roll that
    followed was then refused as `social_candidate_stale`, because the scene
    had nobody in it to talk to. The operation was not in the sweep corpus at
    all — and neither are 88 of the registry's 147 operations, so the sweep was
    watching 40% of the surface while the other 60% waited to fail at a table.
    That is the actual root cause of findings 11, 14 and 15.

    The systemic repair does not require capturing 88 more envelopes. A result
    echoes the identity-shaped fields of its own input, and every keeper-facing
    contract's `inputSchema` is already in the registry, so
    `tests/pi/operation-input-identity-coverage.mjs` projects each one as if
    echoed. That found 19 operations that would fail closed, each now
    classified from the value its own contract description names. The test also
    asserts the declared fields accept their documented value shapes and still
    refuse entropy, UUIDs and digests — a disposition says what a field means,
    it does not wave it through. It is a companion to the corpus sweep, not a
    replacement: a result also names fields that were never inputs
    (`active_scene_id`, `lie_id`, `possible_continuations`), and only a real
    envelope shows those. Verified live: the presence write succeeded and the
    following intimidate roll settled through the rules path.

16. **The host emptied turns the whitespace guard was meant to protect.** The
    guard bounds a stream that emits leading whitespace forever, and it aborted
    on either 32 whitespace deltas or 128 whitespace characters. A counted
    delta always carries at least one character, so the delta bound can only
    ever fire first — four times sooner when a provider streams one character
    at a time. Every abort in this run was exactly 32 deltas of 32 characters,
    and the Keeper, re-prompted by the empty-terminal recovery its own abort
    triggered, narrated correctly and immediately: the stream was padding, not
    runaway. Eight of 28 turns paid an extra model round trip, six of them
    consecutive. The character count alone now triggers, and every stream that
    leads with whitespace reports how much, so the bound stays chosen from
    measurements. A stream measured after the change led with 42 characters and
    finished normally — exactly the case the old bound destroyed.

17. **The module's central mechanic had no way to fire.** A scene's pressure
    moves name a `clock_id` and the segments they cost; `threat-fronts.json`
    defines that clock's segments, per-segment cues and `on_full`. The two
    halves live in different documents and `scene.context` projected only the
    first, so the Keeper held an id pointing at nothing. It never acted on it:
    across all three sessions `state.threat_tick` was called **zero** times and
    `clock-loop-doom` never left 0/6 — including ~30 turns inside
    `scene-church-climax`, whose dramatic question is literally "before the
    bell rings". The authored loop reset was unreachable the whole time.

    Delivering the resolved reading took all three projections, and each one
    was its own defect: the producer (new), the RPC wire whitelist (which
    nulled it — the third authored mechanic that whitelist has silently
    dropped), and the identity declarations (`front_id` would have failed the
    whole scene read closed, and `memory_id` was one impression memory away
    from doing the same, being declared on `npc.query` and not here). The
    first draft also put the actionable sentence in the Python envelope, where
    nothing could read it — Pi authors model-visible hints from structured
    fields and never relays canonical prose — so it moved to the consuming
    side. That is the same "field with no reader" defect this stage keeps
    finding, committed by this work and caught before it shipped.

    `tests/test_scene_context_wire_coverage.py` turns the whitelist into an
    accounting question: every key the producer emits is either carried or
    listed as deliberately withheld with a reason, so a fourth silent drop
    fails on the day it is written.

18. **A forward nudge nobody has ever received.** That accounting check
    immediately found a second one: `recommended_next_beat` has a single
    producer line, no consumer anywhere in the repository, and zero
    occurrences across every live transcript. Its comment promises the Keeper
    a beat "without a separate director.advise call"; the RPC path did not
    name it. Worse, its PRESSURE branch was unreachable in the scenes it was
    written for — the order is agenda NPC, then clues, then pressure, and an
    authored climax always has an NPC with an agenda, so the beat was
    NPC_MOVE every turn while the doom clock stood still. It is carried now,
    and a lethal pressure move on a clock that is still running outranks a
    routine agenda beat, recording what it superseded. Lethality and the tick
    are authored facts, not a pacing opinion.

    Verified live: both the clock block and the beat now reach the table with
    full content.

19. **A module asset root named with a digest.** Found by taking a second
    module through the real path rather than by another turn of play.
    Registering the prepared Cold Harvest bundle minted
    `asset_root_id: pdf-e4832eec4aa06a2a` — a 16-character hex token, which is
    exactly what the Keeper's closed grammar refuses. `asset_root_id` is
    declared semantic on `setup.phase`, `progressive.status` and
    `session.resume`, so a campaign rooted that way would have failed all three
    closed, `session.resume` being the one a host restart depends on. The root
    now derives from the bundle's semantic `source_id`
    ("pdf:cold-harvest" → "cold-harvest"), and a caller with neither a
    canonical module id nor a semantic source id is refused rather than handed
    an unreadable name. Roots already on disk resolve by file digest first and
    keep their names.

    That same module re-proved finding 0's bind gate against a different
    producer: `codex-pdf-skill` had minted `pdf:e4832eec4aa06a2a4946ac91`, and
    the gate refused it with the actionable message before any table time was
    spent.

20. **No characteristic check could be settled, ever.** `actor_check_ref` and
    `combined_target_refs` declare `characteristic:` an allowed namespace — the
    core-check adapter partitions on exactly `skill:` / `characteristic:` — but
    the closed grammar required four characters after the namespace and granted
    a three-character floor only to `roll:`, whose own comment already names
    the reason ("three-letter CoC characteristics"). Every CoC7 characteristic
    abbreviation is exactly three letters, so the allowance contradicted itself.

    At the table the Keeper rolled POW against the ghost, sent
    `characteristic:POW`, was told the value "must use its closed semantic
    form: namespace `skill:`, `characteristic:` only", retried with exactly
    that form as `characteristic:pow`, and was refused again — an error
    instructing it to do what it had just done. It abandoned the opposed check
    and improvised, which is how §5.1 was reached. `characteristic:` now
    carries the same floor, verified live: the same ref passed the grammar on
    the next attempt. The floor is three, not zero — `characteristic:x` and
    entropy stay refused.

21. **A field that was never an input.** `mechanics.ensure` echoes its resolved
    archetype back as `profile.archetype_id`, and ensuring the ghost's combat
    profile mid-fight failed the whole result closed on it. The input is named
    `fallback_archetype_id`, so the input-echo sweep from finding 15 could not
    have found this one — exactly the limit that check's own documentation
    states. Both sweeps are needed, and neither subsumes the other.

22. **A stat could not be changed during play, by anyone.** §5.1 recorded this
    as an open authority question; it was not one. `rules.resource_delta`
    declares only the four coc7 pools and is host-only,
    `state.exceptional_effect` requires a critical/fumble/pushed failure, and
    the compiled rule graph has no decision node touching a characteristic --
    but characteristics were also never written after chargen by any code path
    at all. It was a missing capability, not a closed permission, so there was
    nothing to open.

    `state.characteristic_delta` is on the KP's state surface and takes any
    stat name, because which stats exist is the table's call: a core
    characteristic re-derives everything reading from it; a derived value
    (Luck included) becomes an override that survives later recomputation, so
    a house rule is not reverted the next time any characteristic moves; any
    other name is a house-rule stat, stored and reported and never allowed to
    feed a derivation it was not part of. DB is a string and is refused with
    its value named rather than coerced. Pools clamp only when a maximum drops
    below them.

    Verified live: the ghost drained 12 POW, the Keeper found and called the
    operation unprompted, and POW 60 → 48 carried MP 12 → 9 and SAN 60 → 48
    with both pools clamped. The first live use also proved the delivery half
    was missing -- the write landed and the turn's visible state block said
    nothing, because `_project_state_deltas` did not know the operation.

23. **A failed operation lookup pointed nowhere.** The capability existed, was
    on the KP surface, and the Keeper still could not reach it: `coc_discover`
    answered an exact miss with `unknown_operation` and nothing else. It
    guessed `state.characteristic_adjust` -- one word from
    `state.characteristic_delta` -- gave up, and recorded the drain as HP
    damage it then had to undo. An earlier turn burned four guesses and
    narrated nine points of STR torn away while the sheet still read 40.
    Listing the namespace is not a fallback: the busy ones are over the
    discovery budget.

    A miss now names the closest loadable operations, matched structurally on
    shared name tokens -- no synonym table, no guess at intent -- ranking a
    token past the namespace above a bare namespace match, and offering only
    operations this session could actually load.

24. **Naming for the reader, not the taxonomy.** Between those two, the
    operation was briefly renamed `state.stat_delta`, which is the more
    accurate name and made the capability unreachable in one live turn. It
    went back to `state.characteristic_delta` -- the word the Keeper reaches
    for -- with the width moved into the argument description. Discoverability
    is part of a capability; an operation the consumer cannot name is one it
    does not have. That instance fix was not sufficient on its own, which is
    what produced finding 23.

## 5. Open defect that stopped deeper play (not owned by this work)

On a fumbled STR roll the turn could not settle:

```
rules.settle (fumble) -> receipt written
state.exceptional_effect -> unknown_semantic_handle
                            ("refresh the current turn context")
state.journal -> canonical: substantive_exceptional_effect_required
              -> model sees: semantic_identity_unavailable
```

The canonical error names the exact missing thing, but its message embeds a
machine roll id (`roll:toolbox-…`), so the identity projector replaces the
actionable message with a generic identity error. The Keeper therefore looped,
then correctly stopped, told the player it was a processing fault, rolled back
a mistaken HP write, and refused to advance the fiction on an unfinalized turn.
Campaign state stayed consistent. A retry with a different action was correctly
refused while the prior turn remained open.

This is a rules/turn-domain defect (roll-handle lifecycle plus error masking),
independent of module projection, and is left for its owning track rather than
patched from here.

### 5.1 An authored consequence with no canonical path: POW drain

The module authors "与鬼魂交战损失 POW" as a scene failure mode, and on
2026-09-01 the table reached it: the ghost struck, the investigator failed an
ordinary POW check (92 vs 60), and the Keeper had no operation that could
record the loss.

- `rules.resource_delta` is the generic characteristic arithmetic and is
  `audience: host`, `kp_surface: none`.
- `state.exceptional_effect` does carry `effect_kind: resource_delta`, but its
  `source_roll_id` must be a critical, fumble, failed pushed check, or
  exceptional first impression. An ordinary failure does not qualify.
- The compiled rule graph has **zero** decision nodes touching POW, and none of
  its ten families is characteristic drain, so `rules.settle` cannot reach it
  either.

What the Keeper did instead is the diagnostic: it applied `rules.damage` with
`kind: damage, amount: 2D10` and the source note "POW 被抽走", taking HP 11 → 0
with `dying` and `major_wound`; noticed its own category error; and issued a
compensating `kind: heal, amount: 11` labelled "纠正：幽灵之击抽走的是意志而非
肉体生命". HP came back and `dying` cleared, but `major_wound` stayed — a heal
is not a retraction, and correctly does not clear a major wound. The
investigator now carries a major wound from damage that was withdrawn.

The residue is a symptom, not the defect. The defect is that an authored
consequence has no canonical path, which leaves the Keeper choosing between the
wrong operation and narrating state that never lands.

**Resolved — see finding 22.** This was written as an authority question, and
the premise was wrong: characteristics were never written after chargen by any
code path, so there was no permission to widen. The owner's call was "the
Keeper should have every parameter, tables run house rules", and
`state.characteristic_delta` implements that.

## 6. Honest boundary

- Proven: graph → deterministic projection → complete install → live Keeper
  opening and one investigation turn on the real product path.
- Not proven: a full natural playthrough (the module's crossing into 1287, the
  loop reset, clue discovery through play, the church climax). Blocked by §5.
- Not claimed: the external `coc-pdf-pipeline` extract waves are not retired;
  per the spec's freeze rule they remain the operating route until Stage D.
- Bundle note: the external producer's `source_id`
  (`pdf:COC--An-Amaranthine-Desire`) was legal under the repository's PDF bundle
  contract but not a semantic slug, and the Pi identity grammar drops it —
  which first surfaced as `semantic_identity_unavailable` on every Keeper read.
  The bundle was relabeled `pdf:an-amaranthine-desire` (labels only; page and
  file hashes unchanged) and the graph rebuilt from the same candidates.

  That relabel was only the instance. The systemic repair now lives in the
  bundle contract: `coc_pdf_bundle.semantic_source_id_problem` refuses a
  non-projectable `source_id` **at bind time**, naming the exact defect and the
  fix, so the failure can no longer wait until the table. `scenario.bind_pdf`
  on the original bundle now stops with that message, and the relabeled bundle
  binds. `tests/test_pdf_bundle_source_id.py` parses the consumer's own regex
  and namespace set out of `tool-contract-projection.ts` and asserts the
  invariant *everything the bundle accepts, the Keeper can read* — so the two
  contracts cannot drift apart again without a red test. Test fixtures that
  used `pdf:Demo-Module` were renamed to the semantic form; nothing was
  exercising uppercase support.
