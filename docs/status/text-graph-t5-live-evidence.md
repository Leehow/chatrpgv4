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
