---
name: coc-host-bootstrap
description: >-
  Passive host bootstrap for the canonical COC Keeper plugin. Use only to route
  explicit COC activation into the canonical coc-main skill tree.
---

# COC Keeper host bootstrap

This is a passive router, not a second Keeper implementation. Do not start a
campaign, roll dice, mutate state, or narrate a turn from this skill alone.

When the user explicitly activates COC mode, load the canonical skill tree in
this order:

1. `skills/coc-main/SKILL.md`
2. `references/mode-protocol.md`
3. `skills/coc-keeper-play/SKILL.md`
4. `skills/coc-story-director/SKILL.md`

Use the host's native COC Keeper MCP tools first when available. Discover and
call the canonical operations there so the host consumes the bounded working
set and authoritative result envelopes without repeated shell/file JSON
round-trips. If MCP is unavailable, use the equivalent operations from
`scripts/coc_toolbox.py` as a fallback. Do not mix MCP and shell execution for
the same state mutation or retry.

During ordinary play, never use host file reads/searches over scenario JSON,
module assets, character files, tool logs, transcripts, or prior finalization
examples to prepare a turn. Use the typed working set and exact invocation
cards. For travel, call the exit's `state.move_scene` card first and then its
returned `scene.context` card; that query reads only the active scene.

On activation, process reopen, campaign switch, or context compaction, make
`session.resume` the **first campaign operation**. Use its bounded checkpoint,
current-turn receipts, semantic capsule, scene packet, and pending-finalization
packet; do not rebuild context by rereading `.coc`, relisting the whole toolbox,
or asking the player to repeat established facts. If it returns
`pending_finalization`, finish that already-journaled turn without new dice or
state writes. If delivery is unconfirmed, replay only the returned exact Keeper
text byte-for-byte when the player cannot see it. A continuation checkpoint is
a hash-bound, rebuildable projection; rules receipts and canonical state remain
the truth.

Preserve the player's exact delivered message as the authoritative turn input;
do not paraphrase, normalize, translate, or repair it in evidence. Never edit
`.coc` saves, journals, logs, `toolbox-calls.jsonl`, receipts, or other toolbox
evidence by hand. If finalization reports an ordering or integrity error, stop
and surface the blocker. Repair only through an available typed, transactional,
idempotent operation; if no such operation exists, fail closed. Never create a
host-specific rules, state, narration, or evidence path.
