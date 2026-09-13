# Adaptation routing, scene commitment and pending preparation — implementation and acceptance

Date: 2026-09-12 (evidence run timestamps 2026-09-13 UTC). Current Mods: narration-audit 1.2.8 and enhanced-items 1.1.9. Contract: ../kernel-rpc.md section 36.15. Plan: ../plans/story-continuity-and-adaptation.md. Human UI and packaging remain pending; integration is complete (merge `5a193568`). No package, deployment or remote publication was performed, and all `.coc` evidence is retained.

## Confirmed failure class

Two defects compounded in ordinary play. First, ordinary fiction was misrouted into persistent graph authoring: a module-name miss advertised adaptation even when the player only touched a side door, a passerby or a same-locus detail. Second, the foreground `prepare` call waited synchronously over a tool-enabled creator and an independent reviewer, so the whole turn blocked on model work that could have continued in the background.

Old live waits (retained as failed-performance evidence, not passes):

- Ordinary side-door-key adaptation: **118.185 s**; whole turn **185.814 s**.
- Milk-can-neighbor adaptation lookup: **120.813 s**, plus a status wait of **64.974 s**; whole turn **223.371 s**.

## Final design

- **Purpose-scoped routing.** `lookup kind module` accepts an optional `expected_kind` from the closed graph kinds; only an explicit `expected_kind: scene` miss returns a new-destination preparation. Other misses explain that ordinary physical objects use `define`/`object`/`item`, that compatible first-appearance NPCs and scenery may stay narrated campaign detail, and that a later recurring NPC can be promoted through a reviewed adaptation. No regex or language-specific semantic classifier is added.
- **Closed adaptation purposes.** `lookup kind adaptation action prepare` requires `purpose: new_destination | persistent_npc | source_rebinding | handout | rebase`, structurally validated by the kernel against the closed change set before acceptance. Creator and reviewer still decide open semantics from player input and evidence.
- **Focused creator/reviewer.** Each task starts with a bounded `focus.json`, inlined into the child prompt when small; the child reads a full retained file only for a named evidence gap. This remains a tool-enabled Pi creator followed by an independent tool-enabled reviewer — no zero-tool lane and no auto-accept.
- **Bounded foreground and pending status.** `prepare`'s foreground wait is bounded (default 12 s); `status` is read-only and nonblocking and never opens another wait. Pending returns an honest service status and retry guidance, authorizes no arrival/change, and the retained task continues in the background.
- **Destination identity admission.** Existing target handle/display/summary are projected into admission so a label cannot substitute a different persistent locus.
- **Pending preparation owns the turn.** A retained background preparation owns the rest of that turn. Only a short `narrate` that honestly says preparation is pending may close it; all other Keeper tools are blocked; and the ordinary `agent_end` floor must not restart ordinary work.

## Persistent gameplay locus vs coordinates

`active_scene` is a **persistent gameplay locus**, not physical coordinates. A distinct place is promoted to a registered scene only when it becomes the ongoing context for subsequent player action or durable location-bound state — its own affordances, discoverable clues, NPC/object presence, or intended return. Otherwise it stays same-locus detail or transition and needs no scene. Spatial wording, distance, scale, entering/exiting, or crossing a named boundary never decides promotion.

This is **one semantic test, not an enumeration** of doors, balconies, cabinets, vehicles, rooms or any other noun. The noun and its size never decide; the future gameplay role does. A newly chosen locus routes through `expected_kind: scene`, reviewed adaptation, acceptance, then move. Continuity emits `locus_review` using the same test, with no physical-location exception list.

## Implementation seams

- Kernel routing and purpose validation in the `lookup kind module` / `lookup kind adaptation action prepare` handlers; closed purpose/change-set structural checks before acceptance.
- Focus assembly and the bounded creator → independent reviewer pair over the Mod job/accept bridge, with per-run provider-request and wall-time limits.
- `prepare` bounded foreground wait plus read-only, nonblocking `status`; retained background task continues across the pending return.
- Host pending-preparation turn state: unrelated tools blocked, one honest `narrate` closes the turn, and the `agent_end` fallback does not restart ordinary work.
- Destination identity admission from existing target handle/display/summary.
- Continuity `locus_review` using the same promotion test.

## Evidence

### Final frozen adaptation probes

`.coc/playtests/adaptation-routing-probes/run-2026-09-13T02-57-36-602Z/results.json`

- Ordinary key and first passerby: **no preparation** (correctly not routed to adaptation).
- Missing scene: routed to `new_destination`.
- Athens new destination: ready in **10.030 s**, focus **13,878 bytes / 11 nodes**.
- Recurring milk neighbor: ready in **8.119 s**, focus **14,767 bytes / 12 nodes**.
- Creator used **1** provider call and reviewer **2** in both cases.

### Paired semantic probes (the future role, not the noun, decides)

- Cabinet treated as detail: **2/2 pass** at run-`sBcKOX`.
- The same cabinet made a persistent base: **2/2 revise** at run-`X2qyrt`.
- Station treated as transition: **2/2 pass** at run-`4h3mUH`.
- The same station made a persistent base: **3/3 revise** at run-`W0E4Gp`.

These pairs prove that a door, a cabinet or a station is not promoted by its noun or size but by whether it becomes the ongoing locus of later play.

### Genuine play

- `adaptation-routing-live-fresh-v4`: prepared the Athens family pension in **11.590 s**, accepted it, then moved to that registered scene.
- `adaptation-routing-live-fresh-v5`: stayed there and inspected desk/window/lock in **18.5 s** with `look`/`apply`/`narrate` and **no new scene or adaptation**.

### Retained pending test (failed evidence, not a pass)

`adaptation-pending-live` returned status pending in **0.594 s** and authorized no move or payment, but the old host fallback restarted ordinary work until timeout. **This live run is failed evidence, not a pass.** The new preparation-wait state has a focused extension regression proving that an unrelated `apply` never reaches the kernel and that one honest `narrate` closes the turn.

### Validation

- `npm run test:ext`: **855/855 passed** after the pending-preparation regression; targeted adaptation-host + turn tests **19/19 pass**.
- `npm run check:kernel` and `npm run build:runtime` passed after the final edit.
- `tests/play/test_driver.py`: **14/14 passed**.
- An earlier full Python test run was **1244 passed, 1 skipped, 2 failed** after 1473.72 s; both failures are outside this slice and reflect current branch expectations for memory-projection keys and an older narration-audit heading. **No clean full Python suite is claimed.**

All `.coc` evidence is retained. Human UI and packaging remain pending.

## Integration result

Merge commit `5a193568` integrated `codex/story-continuity` with the prior 0.9.2a head `3ee1e4b0`. Conflict resolution preserved the mainline turn-illustration work as `docs/kernel-rpc.md` section 35 and renumbered story continuity/adaptation to section 36.

Post-merge validation passed: `npm run build:runtime`, `npm run check:kernel`, the complete `npm run test:ext` at **869/869**, and `uv run --frozen python -m pytest tests/kernel/test_apply_item_cash.py tests/kernel/test_memory.py tests/kernel/test_recall.py tests/play/test_driver.py -q` at **40/40 in 117.74 s**.

The earlier full Python-suite run remains historical evidence: **1244 passed, 1 skipped, 2 out-of-slice failures**. It is not rewritten into a clean full-suite claim; the post-merge Python run above is a bounded targeted selection, not the full suite. Human UI and packaging remain pending.

## Primary-source analogues

Official primary sources were used proportionally and did not override project constraints:

- [Anthropic, "Building effective agents"](https://www.anthropic.com/engineering/building-effective-agents) — routing distinct work types and simple composable patterns informed purpose-scoped routing and the focused creator/reviewer pair.
- [Microsoft Azure, asynchronous request-reply](https://learn.microsoft.com/en-us/azure/architecture/patterns/async-request-reply) — returning a pending/status result rather than holding a foreground request informed the bounded `prepare` wait and the `status` read.

Both informed the shape of the routing and the pending-preparation state; the repository's own contract, authority split and acceptance rules remain authoritative.
