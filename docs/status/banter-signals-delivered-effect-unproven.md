# The banter signals reach the Keeper. Whether they change the writing is unproven.

> **Status:** mechanism verified in live play; effect not demonstrated.
> **Date:** 2026-09-02
> **Track:** `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`

## What was asked for

More wit in play, in the way *The Witcher 3* has it. The proposal was a
collected library of quips, graph-ified and matched to moments.

## What was built instead, and why

Not a quip library. Four reasons, each measured rather than argued:

1. TextGraph T4 had just deleted exactly that shape — a 13-pair substitution
   table seeded from one playtest sentence, which silently rewrote Keeper
   prose. It only ran for zh-Hans and was unreachable on the pi-coc path.
2. A shared pool makes every NPC crack the same joke. The per-NPC `voice`
   field already carries character-specific register and already reaches the
   Keeper — `Pompous, clipped` appears 155 times in preserved runs,
   `basement-warm` 86, and Dooley's reads literally `Salesman banter`.
3. "Which quip fits this moment" is the most open-ended semantic question
   there is; the standing rule forbids a table for it.
4. The model has read more witty dialogue than any library assembled here.
   What it lacked was permission and cues, not material.

So: four signals, no lines.

| signal | answers | source |
| --- | --- | --- |
| NPC `voice` | how this person talks | module author (pre-existing) |
| `npc_reaction_openings` | when there is an opening | a publicly witnessed failed check |
| `npc_rapport` | how well they know this table | live trust/fear/suspicion |
| `beat_frame.types` | what this beat is FOR | Robin D. Laws, *Hamlet's Hit Points* (2010) |
| `beat_frame.play_register` | what register this table plays in | Chaosium's Purist/Pulp styles |

## Verified in live play

Three real sessions, live KP, one player reply at a time, transport-only
driver. All four signals reach the Keeper through `turn.output_context`:

```json
"banter_signals": {
  "npc_reaction_openings": [{"skill": "初印象", "outcome": "failure",
                             "witness_npc_ids": ["npc-dooley"]}],
  "npc_rapport": [{"npc_id": "npc-dooley", "trust": 0, "fear": 0, "suspicion": 0}],
  "beat_frame": {"play_register": "pulp", ...}
}
```

The witness in that turn is Dooley — a failed first-impression roll in front of
the module's own banter NPC, with all three signals landing on the same moment.

An A/B pair confirmed the register survives the whole path: one table declared
`pulp` and one `purist`, each received its own value back, neither received
`undeclared`.

## Not verified: that any of this changes the writing

This is the honest gap, and it is the whole point of the feature.

The two arms produced these, and a reader is invited to say which is which:

> **A.** 他看了一眼证件，眉头皱了皱，像是被你钉在了事实上。「麦卡里奥一家。」他吐出这个姓氏，声音短促……

> **B.** 杜利先生啐了口烟沫，嗓子却松了半寸。他压低音量说，街坊都叫它科比特宅——里头不太平……

**That sample does not settle it, and it is not offered as though it does.**
The two turns have different NPCs in different scenes, so any difference is as
easily explained by Knott versus Dooley as by pulp versus purist. A clean test
needs the same NPC in the same scene, and the reading has to be done by someone
who does not know which arm produced which text — which excludes the author of
the feature.

The graph node's `falsifiable_by` already states the test:

> run the same scenario for one arm declared purist and one declared pulp, and
> ask readers who are not told which arm a turn came from to say which game it
> reads as. A register that readers cannot tell apart is not carrying anything.

That test has **not** been run. What has been shown is that the signals arrive,
which is a precondition for the effect and not evidence of it.

## Four wrong diagnoses on the way here, recorded because they cost the most

The signals were built onto `narration.brief` and delivered nothing. Finding
out why took four attempts, three of them wrong:

1. **"`narration.brief` is never called."** True, and still true — but reached
   by counting string matches in `rpc-events.jsonl`, which counts mentions in
   tool catalogs and prompt prose, not calls.
2. **"Migrate to `turn.output_context`, which has 58 calls."** It has 4. Same
   counting error, and the Keeper mostly calls `coc_turn_output_context`
   rather than the generic envelope, so one spelling misses the real path.
3. **"No finalization has run since 8/31."** `glob.glob` does not match hidden
   directories mid-path, and the evidence lives under `sandbox/.coc/`. Three
   quarters of the corpus was invisible: 136 records rather than 508.
4. **"The second narration pass needs reopening."** Unrelated to any of these
   changes. Withdrawn.

The actual cause was none of them: `coc_mcp_wire`'s model projection is built
field by field, and an unregistered field is dropped between the operation and
the model while the operation still returns `ok: true`. This repository had
already recorded that exact gap once before.

Two standing rules came out of it, both in `AGENTS.md`: count calls from
`tool_execution_start`, and check an operation's real reachability before
building anything onto it.
