# Creature-kind acceptance handoff — 2026-10-05

**Verdict: the installed `0eabe8f4` package passes the checked creature mechanisms. Natural-play acceptance remains open.** No production repair was required by this audit. This document is an evidence candidate for the coordinator, not authority to replace the App or start another table.

`ACTIVE_IMPLEMENTATION_TRACK=pi-coc`; Codex-track implementation is off-limits. Production maintenance is TypeScript only.

## Ownership and preserved work

- Original owner: Claude “the-haunting 鼠群节点重复挂载问题”, session `50b4147c-41e8-4152-800e-95ba979b29f8`.
- Original worktree `/Users/haoli/leehow/code/chatrpgv4-wt-creature-kind`, branch `claude/creature-kind-20261004`, clean at `19fa1e7712e615042835bacf7469bfb6455825b7`. `19fa1e771` adds the original installed-App CK-G record only.
- CK-F2 repair `d51d23156` and integration `c4ba0872c` are ancestors of installed `0eabe8f4150ac04b48d23c0d1d0f004595f896a5`. `bd52d09801da3edb5c5761fa61747eae01c81c88` documents that repair and the three excluded limitations; it contains no production fix.
- Current independent branch `codex/creature-kind-acceptance-20261005`, worktree `/Users/haoli/Documents/Codex/2026-10-04/task-7/creature-kind-owned`, starts at actual mainline `b674373942910bfe0661ebebb3053681a44b71cd`. Lifecycle creation `41af92c3-29bd-4ff9-b57b-81b267ba816a`.
- Original worktrees, uncommitted mainline work, campaigns and failed attempts are preserved. No shared-mainline writes, App replacement, full suite or model call was made by this owner.

## Source, installed package and evidence are distinct

The current installed receipt still names `0eabe8f4150ac04b48d23c0d1d0f004595f896a5`, created `2026-10-04T22:14:23.078Z`. Bundled Pi is 1.0.0 and Node 24.19.0. The newer source `b67437394` contains name/cast reader changes and is not this installed package.

This owner's supplement runs `/Applications/PipiCOC.app/Contents/Resources/pi-coc/node/bin/node` and the actual `build/kernel/rpc.mjs`, using App content and Mods, `PI_OFFLINE=1`, isolated campaign state and no Pi session/provider. Kernel SHA-256 is `06c038a35ae04b7612d6fd1585fb81145a7311e1c557554184b2a36068ed09d2`. Fresh locks include `hostile-creatures` 1.0.0, `natural-npc` 1.5.0 and `narration-craft` 2.2.7.

| Gate | Actual evidence | Result and scope |
| --- | --- | --- |
| Original CK-G App default/indexed mechanisms | Original worktree `.coc/playtests/creature-kind-app-0eabe8f4/{default,indexed}/`; 50 archived RPC calls per arm; matching receipt | Default 25/25, indexed 28/28. Audited existing evidence; not rerun and not natural play. |
| Person-only consumers and table-creature reload | `/Users/haoli/Documents/Codex/2026-10-04/task-7/evidence/supplement-KXdE2P/summary.json`, adjacent per-call RPC records; driver `/Users/haoli/Documents/Codex/2026-10-04/task-7/ck-g-supplement.mjs` | 12/12 supplemental mechanism checks, exit 0. Social/Psychology, untold/epithet, personality, perspectives, voice and committed journal candidates exclude creatures. Person controls are nonempty where applicable. A fresh kernel reinstalls a table creature and dossier and offers body actions. |
| CK-F2 first-blow retention and MOV | Jev owner's main-worktree `.coc/playtests/jev-first-blow-app-0eabe8f4-20261004/attempt2/{report.md,summary.json,post-audit.json,rpc/}` | 21/21 mechanism checks with actual packaged host/kernel. Independently read the report/post-audit; did not duplicate its in-flight execution. This is the assigned Jev owner's evidence. |
| Installed package signing | Original package owner's verified installation record in `chatrpgv4-handoff/final-package-gate-20261004.md`; this audit's `codesign --verify --deep --strict` | This sandbox call returned `CSSMERR_TP_NOT_TRUSTED`; no fresh signature success is claimed. No bundle file was written. Package-owner host signature evidence remains the prior evidence. |

The original CK-G script's “first strike opens or is refused by preparation” assertion passes on an actual `needs.weapon` / `apply usage` refusal. It demonstrates actionable supply, **not a successful strike with the weakness means**. Both original arms archive that refusal in `020-table_resolve.json`. Partial-creature refusal and later combat success are separately archived in `048` and `050`.

Jev's first-blow raw record `023-table_resolve.json` succeeds after packaged policy retention, completion and refresh, with the original target/method/weapon and exactly one resolve. Its MOV before/after records `040/044`, `049/053` and `058/060` preserve the structured action; missing body MOV yields actionable completion, then a chase. `035` verifies combat without MOV and `065` verifies a driver using vehicle MOV. These close the two repair mechanisms on `0eabe8f4`, without proving a model naturally chose them.

## Limits and remaining gates

The three limitations explicitly excluded by `bd52d0980` remain recorded and their source paths remain unchanged. This supplement did not freshly reproduce them and does not claim they passed:

1. Chase-roster selection treats any non-null profile as available; partial runners receive completion needs at execution rather than earlier preparation.
2. An NPC's own partial first-blow option is offered and refused at combat execution.
3. Passenger-roster start has the older snapshot/internal-error defect. The driver checks above are not passenger support evidence.

Reader-produced quests, typed weakness/resistance settlement and other separately filed work remain outside this original slice. Weakness prose does not itself implement damage immunity/vulnerability.

Final product acceptance still requires the unique package queue to publish and verify the intended new common-head package, then the coordinator's sole-player queue to provide original-model/budget natural encounter evidence through `tests/play/driver.py`. Relevant natural gates include creature exclusion from person jobs/offers/journal, source-faithful fight and flight behavior, weakness supply adopted through ordinary receipts, and successful use of the held means. Prior idle/long runs that never encounter these paths contribute no pass.

No new paid table was started. No future-scene instructions or hidden clues are sent to the coordinating natural player. New package identity and shared-player/model queue are the remaining dependencies; a later package signal must be bound to fresh evidence before closing the full acceptance gate.
