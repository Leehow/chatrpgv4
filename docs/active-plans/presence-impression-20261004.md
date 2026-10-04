# Blood Road first-meeting roll (§178): handoff for integration

Status: ready for integration. Branch `claude/presence-impression-20261004`, head `f0516d346`. Not merged into 0.9.6a, not packaged, not pushed. The packaging owner is the "Pipicoc 大模型流量与 Gork 缓存问题" session. Existing user campaigns are untouched.

## What the owner asked, and what was decided

- **Ask (2026-10-04).** On the App's Blood Road table the owner saw no Appearance / Credit Rating roll when the investigator first met an NPC.
- **Diagnosis.**
  - The Keeper never called `resolve` for the first impression: 0 calls on two tables.
  - The single loop's clerk offered it under the generic "did the player declare this operation" question, so Jev answered `later` unless the player traded names.
  - Of the App's 17 tables of 10-02..10-04 with three or more turns, 3 rolled any first impression.
- **Ruling.** The owner chose the kernel rolling it mechanically when a person first shares a scene with an investigator: 「确实，按照你的推荐吧，这个不需要语义判断…投骰子也是随机数，其实挺机械的吧」.
- **Coordinator (2026-10-04).**
  - Finish, merge locally, hand to the integration.
  - No separate packaging, and no change to existing campaigns.
  - No new paid calls, and no new heavy suites.
  - Re-check the merged head reproducibly, keeping old live evidence apart from new-head facts.

## Commits

| commit | what |
| --- | --- |
| `d147c8644` | feat(§178): the kernel rolls on meeting; natural-npc 1.5.0 (`trigger: "presence"`, `checks.presence.v1`); card label, `first_impressions`, clerk_did, `pending_contacts` without presence pairs, confluence union, per-pair seed; contact-path tests pinned to a 1.4.4 fixture |
| `9368c68c7` | fix(§178.4): a first impression is no ledger interaction (`isImpressionRoll`); pytest fixture opens the table before the opening; kernel suites count the meetings |
| `852d8b2f6` | merge 0.9.6a@81fcfea70: natural-npc 1.4.5 (intent reading, §179) carried into 1.5.0 |
| `f0516d346` | merge 0.9.6a@7b83acc22: §183 sections. 1.5.0 is rebuilt on 1.4.6, with no `brief.md` and `sections.json` kept as is. Only the "First impression" section text is new. |

**Diff over 0.9.6a@7b83acc22** (what integration takes): 56 files, +1277/−148. Of these, 19 are product files:
- `docs/kernel-rpc.md` (§178);
- the kernel: `kernel-ts/apply/index.ts`, `kernel-ts/mods/{presence,impression-receipt,resolve}.ts`, `kernel-ts/modules/obligation-shape.ts`, `kernel-ts/npc/act-options.ts`, `kernel-ts/read/{mechanics,mods,obligations}.ts`, `kernel-ts/worldline/confluence-plan.ts`, `kernel-ts/write/{contributions,index}.ts`;
- the package: `mods/natural-npc/{CHANGELOG.md,agent.md,mod.json}`;
- the host and UI: `pipicoc/mechanics.js`, `runtime/jev/hybrid-engine.ts`, `Electron/packages/ui/src/coc-mechanics.test.tsx`.

The rest is tests, plus the 1.4.4 fixture (`tests/extension/fixtures/natural-npc-1.4.4`, 1.4.4's own bytes from 60d5afc55).

## When the roll happens, and when it reaches the Keeper and the player

**What gets rolled.** One function, `presenceRolls` (`kernel-ts/mods/presence.ts`). It covers every active package's `presence` check × each investigator × each `npc` node the ledger has in the active scene, skipping:
- a pair with a record (including an adopted legacy file);
- creatures (`node_kind` is not `npc`);
- a person the book preordains (§134.5).

The roll is the higher of APP and Credit Rating at Regular difficulty, on its own stream (`<turnSeed>:presence:<pair>`).

**Three moments:**
1. **`table.apply`, after a batch lands.** This covers a Keeper's `apply npc … to here`, the clerk's source-presence seating, and any write that puts people together. The receipt is in that call's receipts; the result carries `first_impressions` and a note.
2. **`table.player_input`, before the capsule** (call id `t<N>-input`). This catches anyone present without a record.
3. **`table.open`, while turn 0 awaits its opening** (call id `t0-open`). This covers the start scene's people.

**To the Keeper:**
- the `apply` result (`first_impressions`);
- for a clerk's write, the `clerk_did` row (`result.first_impressions`);
- from the next capsule on, `mods.relationships` with `since_turn`.

**Limit:** when a Keeper's own `apply` embeds its narrate, that prose was written before the roll. The impression then shows from the next exchange.

**To the player:** a roll card in that turn's mechanics, delivered with the turn. The card carries `target_label`, the table's word for the person (`tableWord`), never an untold book name.

**Not rolled for** a campaign locked to natural-npc ≤ 1.4.6: there the `contact` check pends as before.

## Evidence: what is proven on the new head, and what is inherited

### Proven on `f0516d346`, reproducible, no model call (mechanism, not play)

The mechanism probe:
- **Script and output:** `/Users/haoli/leehow/code/chatrpgv4-wt-presence-impression/.coc/playtests/presence-impression-20261004/mechanism_probe.py`, output `mechanism-probe.json` beside it.
- **Kernel:** the emitted kernel built on the box at HEAD `f0516d346`; `build/kernel/rpc.mjs` sha256 `870d1ed5c4d9a0b9…`.
- **Table:** copy-on-write clones of the App table `game-45cd3976` (Blood Road / book-4, investigator 卡尔·里德), reset to its `turn 0:` commit `094ec1363`. The App home is only read.
- **What it replays:** the live table's own player lines and writes, then a move and the clerk's source-presence step.

| arm | result |
| --- | --- |
| P1, the table configured to natural-npc 1.5.0 | The station owner is staged at `t2-c1`: one roll, Appearance 50, rolled **71, failure, guarded/neutral**. This is identical to the live table's card, so the per-pair seed reproduces it. The card's `target_label` is 「穿干净工装服的加油站老板」, and `first_impressions` is on the result. The next capsule has `relationships` (`since_turn: 2`) and `pending_contacts: []`. The move to the station plus the clerk's source presence (`t3-c2`) rolls Nate (63, failure) and Steve (95, failure) in that one apply, with cards labelled 「有烂牙的退休卡车司机」 and 「手臂有海军纹身的退伍老兵」. No repeats. |
| P2, the table left at its 1.4.4 lock | The same writes roll nothing. The station owner is a `contact` row in `pending_contacts`, and the capsule carries 1.4.4's own instruction. Old locks stay compatible. |
| P3, a new campaign (the-haunting, pregen) in an empty home | It takes natural-npc **1.5.0** by default. The opening rolls Knott at `t0-open`. |

**Found by the probe, unrelated to §178:** the live table's exact turn-2 Keeper write (`{"kind":"npc","to":"here","mood":…}` in one effect) is refused on the merged head: `npc.mood is its own effect`, a mainline rule newer than the live table. The probe replays it as that refusal's own fix says, as two effects of one batch. A Keeper on today's head gets that refusal and its fix.

Other checks on the merged head:
- `Electron/packages/ui/src/coc-mechanics.test.tsx` at `f0516d346`: 9/9 (the backend projection, and the card drawing `investigator → person`).
- `tests/extension/presence-impression.test.mjs` and `presence-impression-clerk.test.mjs` are in the merged-head ext run below.

### Inherited from the old live table only (run before the merges; not re-run on the new head)

**The run:**
- Run `pi-L1-20261004`; evidence in `/Users/haoli/leehow/code/chatrpgv4-wt-presence-impression/.coc/playtests/pi-L1-20261004/`.
- `preregistration.md` and `results.md` are in `.coc/playtests/presence-impression-20261004/`.
- Home `homes/L1`: the same App table at its `turn 0:` commit, configured to 1.5.0.
- Runtime: this worktree's `bin/pi-coc` at the d147c8644-era tree.
- Keeper `flapcode/gpt-6-luna`, thinking low. Fast lanes `opencode-go/deepseek-v4.1-flash`, off. Jev key loaded.
- 5 player turns, 461.9 s.

**What it showed:**
- the Keeper never called `resolve` for the impression (0 of 5 turns);
- a Keeper-staged meeting produced the card in that live turn;
- every turn delivered;
- the turn-2 prose was written in the same apply as the staging, so it could not show the result. Turn 3 shows him slowing down and looking the investigator over: thin, compatible with "guarded".

The live table never reached a second scene with people (see blockers). Those live behaviours are **not** claimed for the new head: no paid call was made after the merges, by the coordinator's decision.

## Suites, failures and single-file rechecks

**Before the merges** (d147c8644 plus the 9368c68c7 tree, LAN box):
- ext 4501/4501, loop 298/298;
- pytest 2080 passed / 5 failed: 2 mainline baseline, 3 fixed in 9368c68c7 and green in single-file runs.

**Merged head `f0516d346`** (LAN box, leehow-pc WSL; local log copies `.tmp/box-m2-{ext,py,loop}.log`, gitignored):

| suite | result | the non-green, and its recheck |
| --- | --- | --- |
| ext | 4551/4552 | `tests/extension/expression-reference-preparation.test.mjs` "the first request waits for its existing selection…" (50 ms, expression cards, box under load). Mac: `node --test tests/extension/expression-reference-preparation.test.mjs`, 8/8 three times. |
| pytest | 2083 passed, 2 skipped, 2 failed | `tests/kernel/test_jev_resolve.py::test_options_is_read_only_and_uses_canonical_sheet_and_rule_vocabulary` and `::test_the_first_blow_row_names_who_can_be_fought_and_is_gone_once_the_fight_opens`: the mainline baseline (also red on a 60d5afc55 worktree). |
| loop | 298/299 | `tests/extension/single-loop-held-answers.test.mjs` §135.20.1 timed out at the box's 60 s. Mac: `node --test --test-timeout=120000 --test-name-pattern="an answer from turn N rides turn N\+1" tests/extension/single-loop-held-answers.test.mjs`, passed in 25 s. |

**Mutation checks** (pre-merge): every product change was mutated by copy, one line at a time, and each mutation turned a test red. That covers the apply/input/open sweeps, preordained, creature, label, the pending exclusion, the capability check, the card projection, the UI arrow, clerk_did, and the confluence union (three mutations).

## Blockers and notes for integration

- **No blocker to merging.**
- **Existing user campaigns** are locked to natural-npc ≤ 1.4.6 and keep the Keeper-called check until the owner upgrades them in the Mod panel. New campaigns take 1.5.0 (P3). The final package retest checks 1.5.0, the new-campaign default and the old-lock compatibility, which P2 and P3 show at kernel level.
- **§180 creature slice** (`claude/creature-kind-20261004`, not on mainline): `presenceRolls` already selects `node_kind === "npc"`. Whichever of §178/§180 lands second keeps the person filter (§180.3, §180.14).
- **Found during the live table, not this change's** (not fixed): a cash-rule refusal (`needs`) left a narrated move unlanded, no owed row named it, and the Keeper then wrote the bartender as the station owner.
- **The live Keeper's single-effect `npc to+mood` write** is refused on today's head (above). That is the mainline's rule, not §178's.
