# Pi-Coc SAN involuntary-action evidence handoff

- Active track: `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`
- Opposite track off-limits: Codex-host implementation/adapters/prompts/tests/docs were not changed.
- Failure class: failed `rules.sanity_check` settlements omitted the Keeper-chosen p.154/166 involuntary action from canonical roll/result/event evidence, producing validator F5.
- Root cause: the flat operation neither exposed nor forwarded the existing `SanitySession` involuntary-action inputs; the session action was not mirrored onto the owning SAN roll/event.
- Repair: `rules.sanity_check` now requires `{involuntary_action: {kind, summary}}`, restricts `kind` to the five rulebook values, rejects an empty summary, forwards the semantic choice before settlement, and persists the same source/rule-bound block on the SAN roll, returned check/result, compatibility event, session event, and session snapshot.
- Generated contract: rebuilt `plugins/coc-keeper/references/mcp-operation-contracts.json` from the canonical toolbox registry.
- Focused validation: `2 passed` for the new evidence regression and SAN fumble regression. A broader SAN run reached `66 passed, 1 failed`; the only failure was the old fumble fixture missing the newly required field, which was then updated and rerun green.
- Original pressure evidence remains preserved and unchanged; it is pre-fix evidence and therefore still reports the historical five F5 findings.
