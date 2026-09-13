# Midgame causal re-entry — implementation and genuine-play acceptance

Date: 2026-09-13. Branch: `0.9.2a` worktree. Contract: [../kernel-rpc.md](../kernel-rpc.md) section 37. Plan: [../plans/story-continuity-and-adaptation.md](../plans/story-continuity-and-adaptation.md). Spec: [../specs/story-continuity-and-adaptation.md](../specs/story-continuity-and-adaptation.md).

Current Mod versions: **story-thread 1.2.5**, **narration-audit 1.2.15** (with enhanced-items 1.1.9). All genuine play and model probes used **DeepSeek Flash only**; no Astra or Grok calls were made.

**Scope of this checkpoint.** The user's core midgame causal-logic mainline is **IMPLEMENTED and GENUINE-PLAY ACCEPTED**. The extended live gate for `introduce_evidence` / `source_rebinding` / `bridge_offer` — whose contracts and static seams are implemented — is **PENDING**, because no successful post-1.2.15 live chain through those stages was completed. Human UI acceptance, integration and packaging remain pending/out of scope as the current plan states. This document records only verified results and preserves every historical failed-evidence paragraph; it does not rewrite history.

## What was implemented

The detection rides the existing post-commit memory extraction lane (`memory.job` / `memory.submit`); no new lane, scheduler, foreground model call, Keeper verb, semantic regex/list, counter or forced convergence was added. The seven Keeper verbs do not change.

- **Post-commit memory story assessment over core authored threads.** `memory.job` carries a bounded keeper-only `story_context` whose candidate selection is causal: only unresolved `critical`/`core` authored threads when any exist, otherwise only the highest authored tier present, so a lower-importance procedure, hook, route or presentation conclusion cannot displace a core causal thread. The lane submits the existing `candidates` plus a closed `story` object with `status` in `aligned | unclear | misframed | detached`, the selected `thread`, and `bridge_delivered` / `delivery_quote`.
- **Exact player/keeper excerpts and worldline/loop binding.** `frame` must be an exact substring of that turn's `player_text`; `delivery_quote` an exact substring of that turn's `keeper_text`. The assessment binds turn, commit, worldline and loop; a mismatching worldline or loop yields no previous assessment. Storage appends `memory/story.jsonl` transactionally with the ordinary submission and replay is idempotent.
- **Reentry mode `clarify_known` vs `introduce_evidence`.** The `story-thread` projection emits at most one reentry row from the latest current-worldline `misframed`/`detached` assessment when no bridge was delivered and the thread is unresolved. The kernel writes `mode` deterministically from the acquired evidence on the selected thread plus prior same-worldline/loop/thread assessments: `clarify_known` when `known` is non-empty and no earlier assessment before the current one recorded `bridge_delivered: true`, otherwise `introduce_evidence`. Physical location never decides the mode.
- **Receipt-grounded handout carriers.** Acquisition is reconstructed from receipts through the assessed turn with one shared predicate: a clue is acquired when the clue itself was discovered **or** a shown handout connected to it by the closed `supports`/`depicts` graph roles was delivered. A shown handout is a carrier for causal understanding only; it does not add a clue receipt, rewrite `discovered_clues`, or collapse identities. The same predicate is used by thread ranking, `known`, missing-bridge selection, post-commit validation and next-turn reentry so audit and feedback agree.
- **Effective-graph bridge authority.** `causal_reentry.authority.clue_here` is a kernel-projected boolean stating whether the effective graph currently makes the bridge clue discoverable at the current scene, computed from the effective graph after accepted adaptations, never from model prose or the stale `source_scenes` list.
- **Two-stage `bridge_offer`.** Placement/offer and acquisition/delivery are separate stages, each with one authority. An authority-true unforced offer that shows the exact carrier, states its causal bearing and the current stakes and leaves the choice open is reviewed as a structural `defer`, needs no receipt, mints no receipt and never counts as `bridge_delivered`; quoting or realizing contents as learned requires the clue/source-handout receipt and is `bridge_receipt` pass.
- **Preparation wait retention.** Host-owned `preparation_wait` survives later explicit player inputs while the same background source/adaptation job remains pending or reviewing in the same live process; only an explicit `ready`/`failed`/`cancelled` status (or an explicit `cancel`/nonpending adaptation result) clears it. No second task registry, no inference from prose. This uses the adaptation surface of section 36.15.
- **Unnamed adaptation status cold recovery.** `lookup kind adaptation action status` takes an optional `name`; without one it returns the most recent retained current proposal under its semantic name (or `none`), exposing no hashes or task paths. On each explicit player input with no in-memory wait the host asks it once and restores the wait or a short host-owned control state — recovery routing only, no automatic acceptance or retry.
- **Compact story context.** The `story_context` thread rows are the existing compact continuity evidence projection (evidence name, `supports`/`contradicts` relation, `acquired` flag, latest `delivery_turn`); full source refs, claims, prose and NPC dossiers stay out. The per-context byte budget trims optional rows first and must never erase all acquired evidence from a selected thread.

No new Keeper verb, lane, semantic regex/list, counter or forced convergence was introduced.

## Static validation

| Gate | Observed result |
| --- | --- |
| `npm run check:kernel` | Passed |
| Targeted continuity/adaptation/audit/turn suite | 52/52 passed |
| Full `npm run test:ext` | 883/883 passed, exit 0 |
| Targeted Python `tests/kernel/test_memory.py` + `tests/play/test_driver.py` | 29/29 passed |
| Runtime build (`npm run build:runtime`) | Passed |

All model probes and genuine play used DeepSeek Flash only; no Astra or Grok was used.

## Genuine play — primary acceptance

Primary acceptance was campaign **`midgame-reentry-live-18`**, runs **`midgame-reentry-live-18b-run`** and **`midgame-reentry-live-18c-run`**, with the main session as sole player through `tests/play/driver.py`, one natural utterance per turn. Evidence is in `.coc/campaigns/midgame-reentry-live-18/` and `.coc/playtests/midgame-reentry-live-18b-run/`, `.coc/playtests/midgame-reentry-live-18c-run/`.

- **Turn 1** accepted the commission and acquired the clue `globe-unpublished-story` at the newspaper morgue (the 1918 held-from-print Globe feature).
- **Turn 2** the player explicitly misframed `house-haunted-by-corbitt` as unrelated bad luck: the story memory stored `misframed` for that thread with the exact frame `这份扣发稿最多说明马卡里奥一家出过事，其他住客也只是各自倒霉，不能说明科比特的意志造成了什么。` (`memory/story.jsonl`, commit `f08ef48`).
- **Turn 3** projected mode `clarify_known` with known evidence `globe-unpublished-story` and no bridge (the row carried `known` evidence and no `bridge`). The first candidate was revised (settle_class `undelivered_with_tools`, 28.866 s). The explicit retry then delivered in **15.948 s** with only `narrate` — no `lookup`, no adaptation. Audit job **`43b4ee5adc70603314f3384d3ea895f687639d27b9d06b8a52d0047d701da872`** passed `acquired_clarification` and quoted the sentence connecting "the house not being bad luck" to something remaining inside, while continuing the player's Athens-copying action. That turn's post-commit memory extraction failed and remains in the backlog (`memory/backlog.jsonl`, `job_id` `extract:midgame-reentry-live-18:t3`, reason `model_error`) because the old full continuity packet had already been created before the compaction fix; this is retained as failed evidence.
- **Turn 4** retested with the compact packet. The player explicitly stated the cross-era same-address pattern, a lingering will, and the lease stakes, while choosing the central library. Audit job **`3df2c7a86eb4eb5b6529aa57e44b5481c430e4eebfecd146caaa3b770b2b72d6`** passed `player_discharge` (quote: `互不相识、年代不重叠的住客却在同一门牌反复以不同方式遭难，这更像有一种留在房子里的意志在选择受害者，而不是各自倒霉；这会决定诺特能否把真相写进租约。…`). Post-commit story then stored `aligned` for `house-haunted-by-corbitt` with the exact player frame (`memory/story.jsonl`, commit `bf1d140`). The Keeper did not force the house route; the player stayed free to continue at the library.

This completes the user's core midgame causal-logic mainline: an explicit midgame misframe was assessed, a `clarify_known` reentry connected already-held evidence to the core claim and its stakes, and the next explicit frame was assessed `aligned` without forced convergence.

## Performance

- The decisive `clarify_known` delivery was **15.948 s** and **avoided adaptation** (only `narrate` in that turn).
- The later aligned/library turn was **89.542 s** and included **10 `lookup` calls** (run `midgame-reentry-live-18c-run`, turn 1). This is repeated lookup/model behavior, not dynamic graph adaptation, and it remains a material performance limitation. No claim is made that all turns meet the ordinary-investigation 30 s target.

## Extended live gate — pending

Earlier Greece / off-script runs remain retained failures and are the evidence that drove bridge authority (1.2.12), the two-stage `bridge_offer` (1.2.13), the stage separation (1.2.14), preparation-wait retention, cold-resume recovery and the no-clue-scene fix (story-thread 1.2.4). Their contracts and static seams are implemented. **A successful post-1.2.15 live `introduce_evidence` → `source_rebinding` → `bridge_offer` chain was not completed.** This extended live gate is **PENDING** and is tracked separately from the now-complete core midgame mainline. The retained failed runs include `midgame-reentry-live-15`, `midgame-reentry-live-15f-run`, `midgame-reentry-live-15h-run`, `midgame-reentry-live-16-run`, `midgame-reentry-live-16b-run`, `midgame-reentry-live-16c-run`, `midgame-reentry-live-17b-run`, and the `midgame-reentry-live-18` turn-3 backlog failure; each preserved above in the plan and contract with its historical meaning.

## Human UI acceptance, integration and packaging

Human UI acceptance, integration and packaging remain pending / out of scope as the current plan and spec state. No package, deployment or remote publication was performed. All `.coc` campaign, playtest and mod-job evidence is retained; nothing was deleted.
