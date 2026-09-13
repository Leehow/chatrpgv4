# Midgame causal re-entry handoff

Date: 2026-09-13

## User intent

Keep the work on the story mainline. The product must notice during ordinary midgame play when the player is acting on a wrong causal model or has chosen an ongoing direction detached from the unresolved core story. The Keeper must make the causal relation and present stakes unmistakable inside the player's chosen direction, while preserving player agency and source/state authority.

Success is a genuine-play chain that reconnects the player's understanding and lets play continue coherently. A turn count, generated scenery, an audit report, or static tests alone are empty delivery.

The user authorized `xai/grok-4.6` at low reasoning effort for the remaining live test. Do not use Astra.

## Git and workspace state

- Production is the TypeScript kernel in `kernel-ts/`. Do not restore, modify, or port the retired Python kernel.
- Core implementation commit: `ded4122cc8710d2ae86d8c5cba2f9d29523e3287` (`feat: reconnect active players to causal story`).
- Relation-direction repair commit: `3419df4c` (`fix: bind causal evidence direction`).
- Integration target: local branch `0.9.2a`.
- Retained evidence worktree: `/Users/haoli/leehow/code/chatrpgv4-wt-midgame-evidence`.
- The retained worktree contains ignored `.coc` evidence. Lock and retain it. Never close, remove, clean, reset, or delete its `.coc` directory.
- The shared checkout `/Users/haoli/leehow/code/chatrpgv4-wt-pi-coc-v2` contains unrelated work on `codex/session-maps`. Do not absorb or alter it.

For another live acceptance, create a fresh lifecycle-owned worktree from current `0.9.2a`, then create a new campaign and run ID. Never copy or resume a completed save as the new test. Preserve and lock the resulting evidence worktree.

## Implemented behavior

- The existing post-commit memory lane assesses one unresolved critical/core story thread as `aligned`, `unclear`, `misframed`, or `detached`, bound to exact player/Keeper excerpts and the active worldline/loop.
- Re-entry is projected only from the latest matching unresolved `misframed` or `detached` assessment.
- `clarify_known` uses one acquired evidence row and opens no adaptation. The Keeper states that row's `supports` or `contradicts` relation in its own direction, makes the current stakes explicit, and continues the player's chosen action.
- `introduce_evidence` chooses one undiscovered source-grounded bridge. Physical location does not select the mode.
- The effective graph owns bridge placement. If `authority.clue_here` is false, reviewed `source_rebinding` must settle before the carrier can appear.
- When placement is authorized but the player has not chosen to take or read the carrier, `bridge_offer` puts it within reach and leaves the choice open. This is an audit `defer`, mints no clue/handout receipt, and does not mark `bridge_delivered`.
- Once the player chooses to inspect or receive it, the minimal clue/source-handout receipt authorizes `bridge_receipt` and the causal explanation.
- A real pending preparation survives later player input and cold recovery. Only explicit status/cancel/nonpending results clear it.
- `narration-audit` 1.2.16 adds `relation` to `reentry_review`; the validator requires the selected known row or bridge relation exactly. `story-thread` is 1.2.6.

The detailed contract is `docs/kernel-rpc.md` section 37. The current plan is `docs/plans/story-continuity-and-adaptation.md` P5. The evidence report is `docs/research/midgame-causal-reentry-2026-09-13.md`.

## Accepted evidence

The core `clarify_known` mainline is accepted on retained campaign `midgame-reentry-live-20` and runs `midgame-reentry-live-20-run` / `midgame-reentry-live-20b-run`:

1. Ordinary play acquired `globe-unpublished-story`.
2. The next explicit wrong theory was stored as `misframed` for `house-haunted-by-corbitt`.
3. The 1.2.15 audit incorrectly accepted a supporting clue used in the opposite direction. That turn remains failed evidence.
4. Under 1.2.16 the wrong-direction draft was rejected, the corrected `supports` explanation passed `acquired_clarification`, and the following player response passed `player_discharge` and stored `aligned` without forcing a return to the house.

Retained campaign `midgame-reentry-live-19` is failed evidence: DeepSeek classified an active but repeatedly failed investigation as `introduce_evidence` too early. Treat this as a semantic-model failure unless it recurs with Grok 4.6 low.

The deleted `midgame-reentry-live-18` evidence is `invalid-for-acceptance`. Do not cite its missing paths as current evidence.

## Current validation

Closeout used Node 24.19.0 from `/Users/haoli/.local/bin/node`:

- `PATH=/Users/haoli/.local/bin:$PATH npm run check:kernel` — passed.
- Mainline continuity/adaptation/audit/turn selection — 59/59 passed.
- `tests/extension/continuity-audit.test.mjs` — 11/11 passed.
- `PATH=/Users/haoli/.local/bin:$PATH npm run test:ext` — 883/883 passed, exit 0.

Earlier adjacent validation passed the focused Python memory/driver selection 29/29 and `npm run build:runtime` before the relation-only change. They were not rerun at closeout. Do not run Python through a Node 22 PATH; that previously caused native-module ABI failures and proved nothing about the patch.

No Grok run was started during closeout. All retained live evidence named above used DeepSeek Flash.

## One remaining mainline gate

The only remaining implementation acceptance is a fresh genuine-play chain through:

`introduce_evidence` → reviewed `source_rebinding` → authority becomes true → unforced `bridge_offer` → player chooses acquisition → receipt-backed `bridge_receipt` → later coherent continuation.

The run must also show that a pending/reviewing rebinding survives a later player utterance and, after a process restart, is recovered through the unnamed adaptation status path. On restart, `session.resume` must be the first campaign operation.

Use `tests/play/driver.py` in RPC mode with the main session as the sole player, one natural utterance per turn. Before activation, set the ignored `.pi/coc-agent/settings.json` fields to `defaultProvider: "xai"`, `defaultModel: "grok-4.6"`, and `defaultThinkingLevel: "low"`; also pass `--model xai/grok-4.6` to `driver.py start`. Keep the Keeper model fixed for the whole run. Never print or commit credentials or the local Pi profile.

Before using Grok, write the repository-required intent check in the working notes: the user's goal, the success condition above, and what would be empty delivery. Do not substitute a scripted player, fake Keeper, batch settlement, keyword routing, or fixture for play.

During the run, verify structured evidence rather than trusting narration:

- `memory/story.jsonl` records the exact `misframed`/`detached` assessment and later feedback.
- The projected re-entry has `mode: introduce_evidence`, one source-grounded bridge, and the correct `relation`.
- Accepted adaptation changes the effective graph; no prose-only placement counts.
- `bridge_offer` has audit basis `bridge_offer`, verdict `defer`, no acquisition receipt, and no `bridge_delivered`.
- The player's later explicit inspection produces only the required clue/source-handout receipts and audit basis `bridge_receipt` with the exact bridge relation.
- A later player frame shows understanding or informed refusal and the story continues in the chosen direction.
- Preserve `.coc/campaigns/<id>/`, `.coc/playtests/<run>/`, adaptation jobs, Mod audit jobs, transcripts, events, telemetry, and KPI output.

If the same semantic failure recurs three times on Grok 4.6 low, classify it as a design issue and repair the existing system path. Do not add place/action enumerations or a parallel director. If a new problem does not block this chain, record it and leave it out of scope.

Human UI acceptance and packaging remain outside this handoff. Do not spend time on them before the extended live gate is complete.
