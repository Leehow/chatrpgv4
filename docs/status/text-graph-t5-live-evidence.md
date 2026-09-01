# TextGraph T5 — live play evidence

> **Status:** in progress. Updated as runs happen, not at the end.
> **Track:** `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`

Every run is preserved under `.coc/playtests/`, including runs that fail or
produce no usable turn. A run that goes nowhere is still evidence.

## Method

Real `pi-coc --mode rpc`, live KP (grok-4.5) inside the plugin, this session as
the sole player, one natural reply at a time. The driver
(`play_rpc_driver.py`, copied from the DirectorGraph smoke run and
re-pointed at this worktree) is transport only: it launches the real launcher,
sends one player prompt per invocation, and records events. It never settles a
turn, never renders, and never decides anything. No batch settle, no synthetic
turns, no scripted player.

## Runs

| run | path | language | purpose | outcome |
| --- | --- | --- | --- | --- |
| `textgraph-t5-en-20260901` | `.coc/playtests/textgraph-t5-en-20260901/` | requested `en`, campaign is `zh-Hans` | T5 gate 1 (live non-zh session), gate 2 (real play), gate 4 (`findings` measurement) | in progress |

### Setup notes for `textgraph-t5-en-20260901`

The worktree needed two gitignored trees symlinked from the main checkout
before the launcher would run — `node_modules` and
`runtime/adapters/keeper/node_modules` (the bundled Pi the launcher requires
and refuses to substitute with a global install). The plugin source itself is
this worktree's, so the session exercises the T4 code.

One false start is recorded here because it cost real time: the launcher's
"bundled Pi is missing" message in `pi-stderr.log` was **stale**, appended by
an earlier attempt, and the session that appeared to fail had in fact come up
("COC 已激活 · MCP 已预热"). A subsequent `stop` then killed the working
session. Read `rpc-driver.log` timestamps, not the tail of an append-only
stderr file.


## Findings from this run, recorded as they happened

### 1. There is no supported way to create a non-`zh-Hans` table

Asked, as a player, for an English table in the first message. The KP wrote its
free prose in English but the campaign was still created with
`play_language: zh-Hans`, and the sheet it returned carried Chinese labels
around English content.

That is not the KP ignoring the request. **No operation in the 147-op surface
accepts a `play_language` input.** `setup.quick_start` has no language
parameter; the only operations whose schemas mention `play_language` read it
(`narration.brief`) or read a related field (`setup.chargen_run.own_language`,
which is the investigator's language skill, not the table's).
`coc_language.DEFAULT_PLAY_LANGUAGE` is `zh-Hans` and the only writes in the
tree are read-side projections.

**Consequence for T5 gate 1:** its live half cannot be run as specified. The
only way to obtain an English campaign would be to hand-edit `campaign.json`,
which AGENTS.md forbids. The structural half of gate 1 stands on its own
evidence (no language parameter reaches the obligation derivation, no language
helper is reachable from it, and the craft contract differs by exactly one
register axis); the end-to-end half is blocked on a product gap that is not
TextGraph's to fix in this slice.

### 2. A player reply sent during the setup-to-play handoff is silently dropped

The second player message was forwarded at 11:22:04. Five seconds later the
setup session exited 42 — the documented setup-to-play handoff — and the
driver relaunched as the play role. The prompt had gone to the dying session
and was lost. Nothing errored: the submit simply waited, and would have waited
out its full timeout, while the play session sat idle with zero events.

Recorded as a product observation about the handoff window, not repaired here.
The player reply was re-sent to the play session and proceeded normally.

### 3. The table-opening turn does not exercise the text layer, and that is correct

The first settled play turn (`turn-p-3832dc09483d`) closed with
`settle_class=settled` and **zero** `turn.finalize`, `narration.review` or
`turn.output_context` calls. That is not a rule-4 violation and not a gate-4
measurement.

Its call sequence was `session.resume`, `memory.extraction_status`,
`npc.reaction`, `secrets.briefing`, `state.record_npc_engagement`,
`evidence.table_opening`, `progressive.status` — with **no `state.journal`**.
The opening is delivered through `evidence.table_opening`, not through the
settled-turn finalization path, so the obligation plane has nothing to close.
`turn-finalizations.jsonl` does not exist yet for this campaign.

Gate 4 needs a *played* turn — a player action that settles checks and
journals — before `findings` can be measured at all. Counting the opening as a
zero would have been a false measurement in the direction that flatters T4's
alternative, so it is recorded as not-yet-measured instead.

### 4. The first live finalization on T4 code, and a vocabulary value that had never fired

Turn 3 (`turn-p-25327d22a88a`) was a real played turn: `state.journal`,
`turn.output_context`, `turn.finalize`, all `ok=true`, one accepted revision.
It is the first settled turn produced entirely by the T2/T4 graph-driven
derivation, and it exercised the layer end to end:

| | |
| --- | --- |
| obligations | `roll:toolbox-textgraph-t5-en-20260901-000004` |
| coverage rows | 1, realization **`concealed_no_player_visible_beat`** |
| segments | `fiction` ×2, `asset_delta` ×1 |
| `narration_review` | `None` |

**`concealed_no_player_visible_beat` had never occurred before.** The T0
inventory measured it at zero across all 506 preserved finalization records,
and §10 finding 10 recorded it as possibly unreachable. It is reachable: a
concealed roll closed without a player-visible beat, and `validate_coverage`
accepted the row through the graph-derived vocabulary. The same turn placed a
`fiction` leading segment and an `asset_delta`, so the leading-segment law and
the mechanics placement order both ran on live T4 code.

`settle_class=not_settled` in the driver's own classification is a driver
verdict about its evidence probe, not a finalization failure: `turn.finalize`
returned `ok=true` and `turn-finalizations.jsonl` holds the accepted record.

### 5. A turn that ran twenty tools and delivered nothing to the player

Turn 4 (`turn-p-53f8a7db2e70`) classified `undelivered_settle_with_tools`: the
KP called tools, produced no player-visible output, and added no finalization.
The failures were repeats of the same error class:

| operation | failures | error |
| --- | ---: | --- |
| `rules.settle` | 4 | `invalid_semantic_input`, then `unknown_semantic_input` ×3 |
| `state.move_scene` | 3 | `missing_param` ×3 |
| `mechanics.ensure` | 1 | `mechanics_source_unavailable` |

The shape worth recording is the retry pattern: three identical `missing_param`
failures on `state.move_scene` and three identical `unknown_semantic_input`
failures on `rules.settle`, and the turn ended with the player receiving
silence.

**Correction to a first reading of this.** It was tempting to file this as an
error-actionability defect — the error not telling the KP enough to fix its
call. The receipt says otherwise:

```json
"error": "missing_param",
"error_message": "required parameter: decision_id",
"hints": ["the keeper may continue with a different in-fiction approach or corrected tool arguments"]
```

The error names the exact missing parameter. It is fully actionable, and the
KP omitted `decision_id` six times across two turns without ever adding it.
So this is a **KP behaviour** observation about grok-4.5, not a contract or
error-projection defect, and the earlier framing was wrong.

Either way it is not a TextGraph finding — none of these operations is in the
text layer, and the text layer's own calls in the same turn
(`turn.output_context`, `turn.finalize`) were among the ones that succeeded.
Recorded, not repaired.

### 6. Two consecutive undelivered turns, same root cause

Turn 5 (`turn-p-404f16a668d9`) classified `undelivered_settle_with_tools` as
well, with the identical `state.move_scene` / `missing_param: decision_id`
loop. Six failures of the same call shape across two turns, no delivery to the
player either time, and no new finalization: the run holds exactly one
finalized turn.
