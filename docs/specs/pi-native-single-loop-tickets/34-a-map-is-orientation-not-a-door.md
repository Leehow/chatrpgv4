Status: ready (filed 2026-09-24 from SL-29A; batch 4)
Stage: SL-34 (P0, PDF play; blocks SL-29)
Spec: docs/kernel-rpc.md §107 (amend), §22.4, §39.2; docs/specs/pi-native-single-loop.md ruling "Reading never holds a turn"

# SL-34 — A map is orientation, never a door: the move lands, the map arrives when it lands, a refused review settles the focus

## Evidence (SL-29A 血色公路, 2026-09-24, `claude/pdf-a-20260924`@0ce3f174a; ticket 29's book A entry; fork `.coc/playtests/sl29-a-run2/home/.coc/module-campaigns/sl29a-xuese-1436/modules/book-1/deepen-queue.json`)
- Nine moves into the town in 20 turns (the compile selected `apply:move:welcome-to-abattoir` on t4, t6, t12; the Keeper retried on six more turns). All nine refused by `requireArrivalMapMaterial` (`kernel-ts/modules/reading.ts:298`, called from `kernel-ts/apply/index.ts:125`): the scene's text (`read-2`) was ready before the first move; the scene's map (`read-3`) ran 17 min and 79 calls (2.12M input tokens) and then failed visual review (`invalid_params: visual review did not support ['/nodes/0/properties/map_regions', …]`: three region boxes judged off the printed markers). §107 settles only "a false candidate may settle as no usable map"; a real candidate whose review refuses never settles, so every later move re-raised `material_pending` and re-read the map (`read-4`, 14 calls, 549K tokens, `ok: false` at 120 s).
- Five turns over 60 s (156, 174, 158, 164, 212 s) were each the 120 s foreground wait on that job; four of them delivered the player nothing but the host's reading notice (`reading_wait` drop). The town, the book's whole play space, was never entered.
- After the table stopped, `read-4` stayed `running` in the queue with no process behind it; a later table on that campaign inherits an entry nobody owns.

## Ruling (owner, 2026-09-24; spec Rulings)
A map is orientation material. It never gates a move. The move lands with the scene's text; the map job runs in the background and the reviewed map is delivered on the first turn after it is published; a refused review or a failed read settles the focus as unusable once and is not re-raised.

## Scope
1. Contract first: amend §107 (the consumer of the marker is no longer `apply move`'s gate; it is a background request raised at the first move and delivered by the first-arrival path when published), §22.4 (foreground reading waits are for text material only), and record the settlement (`meta.reading.materials += {material: "map", focus, status: "unusable", reason}`; a rebase/manual read may replace it).
2. `apply move`: `requireArrivalMapMaterial` no longer throws; it queues the map job (one live job per focus, like `queueAdjacentReading`) and returns. The text-material gate (`requireMaterial`) is unchanged.
3. Delivery: when a reviewed `depicts` map is published after the arrival, the first-arrival receipt (§39.2, `world.maps_presented`) is minted on the next turn, once, and the clerk's note on that turn says the map arrived; the player-safe derivative reaches the player as today.
4. Settlement: a map job whose review refuses, or whose read phase fails, writes the unusable material row once; later moves into the scene neither wait nor re-read. A job whose owner process is gone is marked failed (or re-queued) on the next open, never left `running`.
5. Tests, mutation-killable: the §107 arrival-descriptor test in `tests/extension/ts-kernel-modules.test.mjs` flips to "move lands, map job queued, no `material_pending`"; a refused-review settlement test (second move: no read raised); a late-delivery test (map published on turn N, presented on N+1, receipt minted once); an orphaned-job reopen test; `tests/kernel/test_map.py` derivative pins unchanged. Then the manual check on 血色公路's existing fork (SL-29A evidence): the first move into the town lands; report what the player saw on that turn and on the map's turn.

## Comments
