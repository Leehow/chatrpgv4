# Open-turn recovery anchor v2 and prompt-order revision

- Active track: `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`
- Base: `6c55be9847a56e4f60ed2cea653e0b276332a3fa`
- Branch: `codex/pi-coc-open-turn-recovery-anchor-20260830`
- Codex-host track: off-limits and unchanged
- Rules, RuleGraph, damage, finalization kernel, Pi core patch, rewind, and
  campaign evidence: off-limits and unchanged

## Standards findings fixed

1. The Pi prompt still instructed an impossible closure-first sequence:
   `turn.output_context` before `state.journal`, while code correctly exposes
   pre-journal acting and forbids output/review/finalize until the journal.
2. The v1 host cache was keyed only by campaign. Its stored source session and
   player epoch were audit fields, so a valid-looking open turn on another
   timeline or a later turn in the same campaign could consume stale text.

## Implementation

### Prompt and skill order

The host prompt, `coc-keeper-play` recovery pointer, and its typed-operations
reference now use one order:

1. recover semantic scene/action context;
2. reuse successful receipts and settle only missing mechanics;
3. `state.journal` with the retained exact player input;
4. `turn.output_context`;
5. `narration.review` when returned, then `turn.finalize`.

This restores general KP acting judgment. It does not encode a First Aid or
other rule-family workflow. New player input and setup remain closed while the
accepted turn is recovered.

### Anchor v2

`session.resume` now builds a host-only `open_turn_anchor` from canonical facts:

- semantic active `timeline_id`;
- `prior_finalized_turn`;
- exact prior finalization `source_digest` (or null only for turn zero);
- `next_turn_ordinal`;
- a canonical cross-language digest over those fields.

The MCP wire retains this for the Pi host. The final Pi model-content projector
removes it; the model sees only the hydrated keeper-only semantic player-input
card. Python and Pi canonical-digest output is locked by a literal cross-runtime
test.

The operational cache schema is now v2 and embeds that full anchor. Load and
clear require exact campaign + anchor equality. Timeline changes, later turns,
prior-source drift, fake digests, tampering, already-journaled windows, and old
v1 records all fail closed with zero recovery authorization. Source session and
host player epoch remain audit-only and are deliberately not used as recovery
identity.

After a successful journal the exact anchored cache is cleared. A successful
finalization clears it again and rolls the host anchor forward from the
authoritative journal turn number and finalization source digest. The next
natural player message therefore records under the next turn anchor without a
per-turn `session.resume`. If a reliable anchor is unavailable, durable caching
is skipped while the current in-memory player message can still complete its
ordinary live turn.

External precedent was checked proportionally: LangGraph time travel binds a
resume to both thread and checkpoint identity, while Git resolves history from
an explicit ref/revision. This supports the local timeline + turn/source anchor
rather than a campaign-only cache key:

- https://docs.langchain.com/langsmith/human-in-the-loop-time-travel
- https://git-scm.com/docs/gitrevisions.html

## RED -> GREEN evidence

- Prompt constitution RED: recovery section had no acting-first capability and
  contained the old output-before-journal sequence. Focused test is now green.
- Cache RED: no `createOpenTurnAnchor`; cross-worldline/next-turn/source cases
  could not be distinguished. Cache suite is now 6/6 green.
- Production-shaped Pi recovery proves:
  - one exact semantic player-input card;
  - anchor absent from model content;
  - same-anchor restart succeeds;
  - cross-timeline anchor receives no card and no acting authorization;
  - scene RuleDecisionCard reaches `coc_rules_settle`;
  - next finalized turn rolls the cache anchor forward.

## Verification

- Focused Pi/prompt pytest group: **11 passed in 4.67s**.
- `tests/pi/open-turn-player-input.mjs`: **6 passed**.
- `tests/pi/tool-working-set.mjs`: **19 passed**.
- `tests/pi/tool-affordance-extension.mjs`: **43 passed**.
- `tests/pi/turn-processing-fault-gate.mjs`: **21 passed**.
- `tests/pi/recovery-kp-guidance.mjs`: passed.
- `tests/pi/startup-resume-table-opening.mjs`: passed.
- `tests/pi/normal-model-id-boundary.mjs`: passed.
- `tests/pi/system-instruction-protocol.mjs`: passed.
- `tests/test_continuation_resume.py`: **14 passed in 38.38s**.
- MCP resume projection + plugin metadata: **36 passed in 3.48s**.
- Open-turn quarantine/setup continuation checks: **2 passed in 6.79s**.
- `git diff --check`: passed.

The full prompt/skill-budget suite still has three pre-existing baseline failures:
the setup/play constitution blocks were already divergent, the main Keeper skill
was already 525 lines against its 500-line budget, and the typed-operations
reference was already over 60 KiB. All three reproduce unchanged on clean base
`6c55be98`; this revision did not expand into that independent cleanup.

## Integration note

This is a clean-slate runtime-cache schema change. Existing v1 cache files are
rejected, never migrated. The branch is ready for serial review/cherry-pick onto
the exact RuleGraph integration head; no preserved campaign needs mutation.
