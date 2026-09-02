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

## The clean trial: run, recorded, verdict pending

The first A/B pair in this document was not clean — different NPCs in different
scenes — and is left below as the flawed sample it was. A controlled one has
since been run.

**Design.** Same scenario, the **same shipped pregen** (`thomas-hayes`, so the
investigator is identical rather than separately generated), byte-identical
player inputs in the same order, arms run sequentially. Which arm declared
which register was randomised into
`.coc/playtests/register-trial-KEY.json` by a script that reads it and never
echoes it. Both arms confirmed `play_register` set and produced three settled
turns each. Evidence: `.coc/playtests/register-trial-arm-{alpha,beta}/`, paired
text in `register-trial-pairs.json`.

**Verdict: not yet read.** The pairs are recorded so the reading can happen at
any time, by anyone who has not seen the key.

### Two things that weaken it, stated because they would otherwise be invisible

**The author is not fully blind.** An earlier failed attempt surfaced one arm's
model thinking in an error log, naming its register. The key was reshuffled and
the arms renamed afterwards, and the extraction script masks the register words
before printing — but a prior mapping was seen, so the author's reading of
these pairs should not count as the blind one.

**The first roll diverged.** Arm alpha's opening first-impression check
succeeded (50 against 50) and beta's failed (52 against 50). A first beat that
lands versus one that does not can set the tone of everything after it, which
is a difference between the arms that is not the register. Any difference a
reader finds is therefore attributable to register OR to that roll, and telling
them apart needs several pairs with the opening outcome held equal.

So even a correct blind identification would establish "these two arms read
differently", not "the register caused it". That is a weaker claim than the
node's `falsifiable_by` asks for, and it is the honest ceiling of this trial.

### Three failures before it ran, two of them misdiagnosed

1. **`undelivered_settle_with_tools` on every turn.** Diagnosed as two arms
   contending on a shared `PI_HOME` and changed to run sequentially. It failed
   again: the real cause was `OpenAI API error (403): You have run out of
   credits`. The error message was in the events the whole time.
2. **No campaign created, after credits were restored.** The campaign ids
   `register-trial-A-20260902` carry a single-letter segment, which the
   model-facing identity grammar refuses — `campaign_id must use its closed
   semantic form: multi-token semantic slug`. Renaming the arms to
   `register-trial-arm-alpha` fixed it.

Both failures carried a result worth keeping. The refused call shows the Keeper
passing `"play_register": "pulp"` correctly, so the parameter path works and
was blocked downstream of it. And the refusal itself came from the identity
grammar extended earlier the same day for `ruling_id`/`scope_id` — working as
intended, with an actionable message.

## How to finish this

The trial is set up and the data is on disk. What remains is not code:

1. Read `.coc/playtests/register-trial-pairs.json` — three pairs, alpha and
   beta — WITHOUT opening `register-trial-KEY.json`, and write down which arm
   reads as pulp.
2. Then open the key.
3. If the reading is wrong or a coin toss, the node's own standard applies:
   *"a register that readers cannot tell apart is not carrying anything"*, and
   `play-register` should be retired rather than kept as a field nobody can
   feel.
4. If it is right, run more pairs with the opening roll outcome held equal
   before calling the register the cause.

The author cannot do step 1 — a prior arm-to-register mapping was seen, and
that disqualifies the reading regardless of how the pairs are masked now.

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
