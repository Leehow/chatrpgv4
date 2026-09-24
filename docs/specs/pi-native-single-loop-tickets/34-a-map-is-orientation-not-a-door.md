Status: ready-for-human (filed 2026-09-24 from SL-29A; batch 4; implemented 2026-09-24 on claude/sl34-20260924)
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

- **2026-09-24, implementation (claude/sl34-20260924 @ 3e0e50838 on base 1660ec0fd).**
  - Found: `requireArrivalMapMaterial` (`kernel-ts/modules/reading.ts`) ran as a pre-gate in `table.apply` before
    staging and threw `material_pending` for every move into a marked scene whose `depicts` map was not published; the
    only settlement it read was a `materials` row with `material: "map"`, which only a *completed* map read wrote. A
    failed finish wrote nothing but the queue row, and `request` answered a failed identity with `blocked` + "retry",
    which the host's §22.4 single repair turned into `read-4`. Nothing ever recovered a `running` job whose owner was
    gone except a later `claim`, which never came once the table stopped.
  - Contract (first): §107.1 (move lands; background map job, one per focus, via `deepen_queued` and
    `world.map_arrivals_pending`; late §39.2 card on the first `table.player_input` after publication, `late: true`,
    `scene`, `call_id t<N>-input`, once; unusable settlement row and `request` answering `state: "unusable"`; only
    `retry: true` or a completed publication replaces it; orphan recovery in `module.read.ahead` by dead `host-<pid>` +
    free job lock; three ends) and §22.4.5 (foreground waits are text-only; `look focus=map` queues in the background and
    answers `map_preparing` / `map_unusable` at once). One-line pointers added to §107 and §39.2; nothing renumbered.
  - Changed: `reading.ts` (`queueArrivalMap`, `settleMap`, `mapSettlement`, `recoverOrphans`; finish(failed) settles a
    map; a completed map replaces the row; `request` unusable branch and `job_state`/`failed_job` on a blocked reply);
    `apply/index.ts` (pre-gate removed; post-stage queue + pending + `deepen_queued`); `read/maps.ts`
    (`presentPublishedArrivalMaps`; §39.2 presentation clears the pending entry); `write/index.ts` (`table.player_input`
    mints the late card, returns host-only `map_views`); `read/assemble.ts` (`turn.map_arrived`); `modules/index.ts`,
    `registry.ts` (wiring, asset reader for the writer); `extensions/kernel/index.ts` (`prepareMapViews` on the
    player-input result; the `material: "map"` branch of the `material_pending` catch); `runtime/jev/hybrid-engine.ts`
    (`map_arrived` + note in the run's first `coc-clerk` note).
  - Tests: `tests/extension/ts-kernel-modules.test.mjs` (the §107 arrival case flipped: move queues one background map
    job, joined on a second arrival, `none` for an unmarked scene; refused review settles once, pre-rule failure settles on
    first meeting; orphan re-queued, live owner left alone, failed-identity orphan failed+settled);
    `tests/kernel/test_map_arrival.py` (emitted kernel: move lands and queues, nothing before publication, late card on
    t3 once with `map_views`/`map_arrived`/mechanics row, absent on t4, one `map-revealed`; refused review settles, return
    move reads nothing, `request` answers `unusable`, `retry` replaces); `tests/extension/map-arrival-late.test.mjs`
    (seam, hybrid-v1 + faux Keeper: card in turn 2's `coc-mechanics` entry rendered, clerk note once on the first step,
    no source path or `map_views` in any Keeper request; `look focus=map` answers `map_preparing` without a wait and the
    job is background). `tests/kernel/test_map.py` unchanged and green.
  - Mutations (copy-revert runner, 16/16 killed): M1 map job foreground (TS arrival); M2 no pending entry (py, seam);
    M3 failed finish does not settle (TS, py); M4 `request` answers settled as ready (py); M5 pre-rule failure retried
    (TS); M6 no late presentation (py, seam); M7 `maps_presented` skip removed (test_map "returning"); M8 live owner
    treated as gone (TS orphan); M9 orphan left running (TS orphan); M10 failed-identity orphan re-queued (TS orphan);
    M11 no `map_arrived` row (py, seam); M12 clerk note omits it (seam); M13 host skips the map hop after player_input
    (seam); M14 `look focus=map` foreground wait (seam); M15 map job not in `deepen_queued` (py); M16 pending kept after
    presenting (py).
  - Suites (leehow-pc, @3e0e50838): py `1721 passed, 2 skipped in 556.26s (0:09:16)`; loop `# tests 152 / # pass 152 /
    # fail 0`; ext first run `ℹ tests 2989 / ℹ pass 2984 / ℹ fail 5` under box load 14–40 from other workers' suites --
    `bounded-recall`, `jev-source-domain` x2 ("source task deadlocked"), `reading-intent` (reading-timeout telemetry
    `job_id` undefined at a 50 ms wait), `keeper-support-lookup-host` ("operation was aborted due to timeout"); none
    touches a map path, and all four files pass locally at the same HEAD (`ℹ tests 21 / ℹ pass 21 / ℹ fail 0`).
    Rerun of ext on the same HEAD once the box was freer: `ℹ tests 2989 / ℹ pass 2989 / ℹ fail 0` (exit 0, 241 s).
  - Manual check (book A fork copied to `.coc/playtests/sl34-book-a/home`, driver run `.coc/playtests/sl34-book-a-run`,
    grok-4.7-build-fast low, hybrid-v1, `PI_COC_JEV_PRESELECT=1`, zh-Hans; no re-import). On open, `module.read.ahead`
    recovered the orphan: `read-4` (owner `host-88218`, process gone) became `failed` and, because its identity had
    already failed as `read-3`, the town's map focus settled `unusable` with `read-3`'s refusal as the reason
    (`modules/book-1/build.jsonl` row `orphan-recovered`, `module.json` `reading.materials`). Turn 21, the same sentence
    that took 156.6 s and was refused at SL-29A t4 ("到了土路口我停车看了看那两块木头路标，然后拐上土路，往阿巴托尔开。"):
    28.6 s, the clerk's `apply` (93 ms) landed `move:welcome-to-abattoir-t21-c1` (prologue -> welcome-to-abattoir), the
    Keeper added `clue:abattoir-sign-outdated-t21`, `clue:men-stare-from-station-t21`, `time:t21-c2`; zero
    `material_pending` and zero `reading_wait` rows on t21; no map job queued (settled), no pending entry. The player saw
    the drive over the hills and the old bridge, the "欢迎来到阿巴托尔 / 人口850" sign, the abandoned houses, the Esso
    station, Mather's store, the bar and the church spire, and the men at the station watching the truck
    (`turns/0021.json`, `turn-1.json`). **The map's turn did not happen and should not:** the town's map review was
    refused in SL-29A and, under the ruling, that settles the focus; the only way to a map card for the town now is an
    explicit `retry: true` read (17 min / 2M tokens last time), which I did not run. The adjacent `esso-gas-station`
    read started in the background during that turn; stopping the driver left it `running` (owner `host-6983`), and a
    following `module.read.ahead` re-queued it (`recovered: [{job_id: "read-5", owner: "host-6983", to: "queued"}]`) --
    the orphan path on a real stop.
  - Left: the late-card path is proven on fixtures (py + seam), not on a live book, because book A's map is settled; a
    live proof needs a book whose map review passes after the arrival. `claim`'s own lock-probe recovery still re-queues
    any orphan it meets (unchanged); only the open path applies the failed-identity rule.
