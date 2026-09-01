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
