Status: ready-for-human
Stage: SL-15 (extends SL-11; independent of SL-13/SL-14)
Spec: docs/specs/pi-native-single-loop.md (Ruling: "The Keeper is shown what the run has read"; SL-11 §135.20–24)

# SL-15 — The clerk projection carries what the Keeper would otherwise look up

## Evidence (live gate #3, campaign `gate3-haunting-2329`, turn 3; driver evidence `.coc/playtests/gate3-haunting-2329-20260924T032940Z/turn-3.json`)

- Three `look` calls, each its own model round: `{focus: "scene"}` right after the clerk executed `apply:move:commission-briefing` (the model step before it took 15.4 s and produced only that look); `{focus: "npc", name: "Steven Knott"}` before the attack; `{focus: "session"}` after `session:combat-start`.
- Kernel time for the three: 7, 4 and 6 ms. Model time around them: 15.4 + 5.6 + 3.4 s.
- The run's own read step ran after the move (s4, 102 ms) and after the combat start (s15, 216 ms); the Keeper never sees the read, only the `coc-clerk` projection of what the clerk did.
- Telemetry records the look with `call_id: null` and no arguments; the turn record keeps only `params_sha256`.

## Scope

1. **Projection.** Before each model step the `coc-clerk` message (runtime/jev/hybrid-engine.ts, SL-11's issued section) also carries, from the run's fresh read: the scene view when the active scene changed during this run; the card of each person that an executed or pending candidate targets or names (attack target, pending defence actor, obligation meeting); the session view whenever a session is active. Same shapes the `look` tool returns, so nothing new is invented; budgeted by SL-11's ceilings and truncated the same way.
2. **Telemetry.** A model-origin `look`/`lookup` row records its arguments (`focus`, `name`, …) and the step it came from. The turn record keeps the arguments beside the hash for read-only calls.
3. **Contract.** §135.31 in docs/kernel-rpc.md, contract first (what is carried, when, its ceiling, the telemetry fields).

## Acceptance

- Driver tests (fake model engine) asserting the projection content after a clerk move, at a pending defence, and with an active session; ceiling respected; mutation-killable (scene omitted after move, person omitted, session omitted, ceiling ignored).
- Replay `fight-round` and a fixture from the gate-3 turn-3 state, live Keeper, 3 runs each: report `look` count per run before and after (before = this branch's parent). Not a pass line, a measurement; the pass line is the projection tests.
- `test:ext`, loop suites, pytest green on the branch and after merging 0.9.5a.

## Comments

### 2026-09-24: implemented on `claude/sl15-20260924`

Branched from `0.9.5a` at `ef8efdf97`. Not merged; no push, no package, no live table.

**Commits**

| commit | what |
| --- | --- |
| `c450d26bf` | contract §135.31, committed before the code |
| `f631e9de5` | §135.31 amended while coding: the Keeper's prose arguments are withheld (below) |
| `14115858f` | kernel: a delivery's `keeper_reads` become the turn record's `reads` (`kernel-ts/write/delivery.ts`, `write/index.ts`) |
| `33544230a` | kernel extension: look/lookup rows keep `args` (and `run`/`step` on hybrid-v1); the turn's reads ride on its delivery (`extensions/kernel/index.ts`) |
| `ee8e56823` | engine: the `coc-clerk` note's `carried` section (`runtime/jev/carried-views.ts`, `runtime/jev/hybrid-engine.ts`); the projection port is now async, so three direct `project()` calls in older tests await it |
| `6886e33e0` | `tests/extension/single-loop-carried-views.test.mjs` (8 tests) |
| `c38deabda` | the `gate3-turn3` fixture |
| this commit | the ticket, the manifest, the measurement results |

**What landed (contract §135.31).**

- Before each model step the `coc-clerk` message carries `carried: {head, views, omitted?}`:
  - **scene**: `look focus=scene`'s `{where, present}` once the latest fresh read's scene differs from the run's first read's; once per scene per run.
  - **person**: `look focus=npc` (without `kind`) for each person a candidate names, read off closed structure only (`bound.target/actor/who`, the variants', an npc-family `bound.name`, closed unbound `target`/`actor` options, a carried meeting's `who`, a pending-defence row's `actor`/`attacker`). The candidates: this run's executed clerk steps, the latest fresh read's issued candidates, the policy's pending items, the operation handed to the Keeper. Investigators excluded; once per person per run; a person already shown as an issued body (§135.20) is not repeated.
  - **session**: `{session, pending_choice}` from the fresh read's `table.resolve.options` context, byte-identical to `look focus=session` (tested on the emitted kernel), whenever a session is active and it differs from the last one carried.
- Ceilings and cuts are §135.20's unchanged: 1 KiB per view (`fitBody`, over a wrapper's inner fields for `where`/`session`), 8 KiB per message, served session → people → scene; cuts named, `omitted` with `budget`/`read_failed`/`not_found`.
- Telemetry: `lane: "run"`, `event: "carried"` per message that carries (views, bytes, reads, ms). A look/lookup row now has `args` (strings cut at 200 code points, `args_cut`), and a model-origin one on hybrid-v1 has `origin: "model"`, `run`, `step` (the engine announces `coc:model-step` before each model tool call).
- The turn record: `reads: [{tool, args, params_sha256, withheld?, ok, run?, step?}]`, carried as host-only `keeper_reads` on the delivery (explicit narrate/ask and the implicit narrate), outside the delivery's idempotency digest.

**Decisions the owner should confirm.**

1. **Where it rides.** In the `coc-clerk` message (one per model step), not in the run's packet: the packet is written only by a read step (first read, and after a scene change), so the session after a write and the people an executed step names would never reach it.
2. **"Pending candidate" = the latest fresh read's issued candidates**, not the policy's filtered list. At the Globe the obligation check that carries Arty's meeting is consumed by the route (`unknown`, a Keeper-only row for the rest of the run), and the policy's list no longer has it; the fresh read still issued it, and it is the Keeper's to do, so Arty's card is carried.
3. **The ruling does not cover the gate's Knott look.** At the step where the Keeper looked at Knott, no candidate named him (the fresh read after the move issued exits and the ordinary check; with no fight open there is no attack candidate; he was already introduced, so no person candidate). His card is carried from the fight's first fresh read on. Whether a person present in a scene the run moved into (or the addressee SL-13's typed features will read) should be carried is not in §135.31.
4. **The 1 KiB cut is lossy for these views.** *(Superseded by the follow-ups below: the owner raised the ceilings, and these sizes were wrong, from a fresh campaign and a 4 KB-truncated driver text; on the gate state the scene view is 7.8 KB and the card 8.3 KB.)* Measured on the gate state: scene view 4.5 KB, Knott's card 4.0 KB, session view 0.6-0.9 KB. Cut to 1 KiB (trailing fields first):
   - Knott's office kept 354 bytes (`scene`, `display_name`, `summary`, `dramatic_question`, `pressure_moves`) and dropped `exits` onward and `present`, because `exits` alone is about 1 KB. That is roughly what the capsule's `where` already says. At the Globe (the seam test) `exits` and `back` fit and `affordances` onward went.
   - A card keeps identity and dossier (role, wants, fears, hides, voice) and drops `mechanics` and the combat fields; on the live campaign also `knows`, `keeper_note` and the reunion.
   - In every replay run of both arms the Keeper's first `resolve` on Knott was refused `needs: Steven Knott has no stat block` (one model call per run). The card's `mechanics: null` is the field that says so, and it is cut (and at that step his card is not due anyway, item 3).
   - A per-view ceiling of about 4-5 KiB would carry these views whole. Not changed here: the ruling fixes SL-11's ceilings.
5. **Prose is withheld (a conflict found by the suite).** §22's #65 rule says the Keeper's `question` is prose and is not written to telemetry (`reading-intent.test.mjs` asserts it). The ticket asks for the arguments; the row and the record keep every selector argument and withhold the three prose parameters the schema declares (`question`, `request`, and `query` of `kind: support`), naming them in `args_withheld` / `withheld`. §135.31 says so.
6. **The turn record path.** Read-only calls never entered `calls` (only writes get a call id), so "arguments beside the hash" is a new `reads` list, carried by the host on the delivery and hashed by the kernel with the same `jsonDigest` as `calls`. A stranded turn (§73) has none.

**Tests** (`tests/extension/single-loop-carried-views.test.mjs`, 8; emitted kernel, vendored driver, faux provider, stub Jev where a table runs):

- after a clerk move to the Globe: the scene view is `fitView(look focus=scene)`, cut and named; Arty's and Ruth's cards (the obligation's carried meeting, the Mod's first-impression target); no investigator; each view ≤ 1 KiB, the message ≤ 8 KiB; one `carried` row with 3 reads;
- at a pending defence (the Knott fight): the session view deep-equal to `look focus=session`; Knott's card cut and marked (`mechanics` among the omitted); served session then people;
- with a session active over three model steps: carried before the first step (session + Knott), again before the step after the Keeper's punch changed the fight (session only, round + 1, equal to `look`), not before the step after the Keeper's own `look`; that look's row has `args`, `origin: "model"`, `run` and the `step` of its `operation_prepared`; the turn record's `reads` with the canonical digest;
- the legacy engine: the row's `args` (no run/step), a 260-character `query` cut to 200 and named, the record's `reads`;
- the kernel alone: a `recall` in `keeper_reads` is `invalid_params`; a replay of the same call id with other reads is `replayed`, not an idempotency conflict; the digest is the sorted-key one; `calls` does not keep `keeper_reads`;
- the ceilings over stub reads (session first, a wrapper's fields cut in order, budget/not_found/read_failed listed, a shown person not re-read); who a candidate names; the read arguments (host keys out, prose withheld).

**Mutations** (each applied, `single-loop-carried-views.test.mjs` run alone, restored; the two kernel ones rebuilt the runtime before and after). All 12 killed:

| mutation | file | tests failed |
| --- | --- | --- |
| M1 scene omitted after a move | `hybrid-engine.ts` | after a clerk move |
| M2 people omitted | `hybrid-engine.ts` | after a clerk move; at a pending defence; with a session active |
| M3 session omitted | `hybrid-engine.ts` | at a pending defence; with a session active |
| M4 per-view ceiling ignored | `carried-views.ts` | after a clerk move; at a pending defence; ceilings |
| M5 message budget ignored | `carried-views.ts` | ceilings |
| M6 session repeated when unchanged | `hybrid-engine.ts` | with a session active |
| M7 look arguments not recorded on the row | `extensions/kernel/index.ts` | legacy engine; with a session active |
| M8 model step not announced (no `run`/`step`) | `hybrid-engine.ts` | with a session active |
| M9 reads not carried on the delivery | `extensions/kernel/index.ts` | legacy engine; with a session active |
| M10 prose written to the row | `extensions/kernel/index.ts` | read arguments |
| M11 kernel writes no `reads` on narrate | `kernel-ts/write/index.ts` | kernel alone; legacy engine; with a session active |
| M12 `keeper_reads` inside the idempotency digest | `kernel-ts/write/index.ts` | kernel alone |

**Measurement** (not a pass line). Live Keeper `grok-build/grok-4.7-build-fast`, `low`, product driver (`run.mjs --llm replay --keeper live`), 3 runs per arm, one replay process at a time. Before = the parent `ef8efdf97` in a detached worktree with its own build; after = this branch. Pre-registered before the first run (below). Results under `experiments/single-loop-routing/results/sl15-{before,after}-{fight-round,gate3-turn3}-live/`. The gate3 runs used a fixture `gate3-turn3` (`gate3-haunting-2329` before turn 3), since dropped in favour of SL-13's `fixtures/gate3-t3` (the same campaign and commit; `gate3-t3` has a baseline and lacks the campaign's scoped module copy under `module-campaigns/`, which differs from `modules/the-haunting` only by `deepen-queue.json` and `module.json` metadata). A re-run uses `--fixture gate3-t3`; the result directories keep the name they were run under.

| fixture | arm | look/lookup calls per run | model calls per run | LLM steps per run | carried per run (focus) |
| --- | --- | --- | --- | --- | --- |
| fight-round | before | 0 / 0 / 1 (`look session`) | 4 / 5 / 5 | 4 / 5 / 5 | - |
| fight-round | after | 0 / 0 / 0 | 4 / 6 / 5 | 4 / 6 / 5 | session+Knott, then session 1-2 more times |
| gate3-turn3 | before | 0 / 0 / 0 | 6 / 7 / 6 | 6 / 7 / 6 | - |
| gate3-turn3 | after | 0 / 0 / 0 | 7 / 7 / 6 | 7 / 7 / 6 | scene (354 B), then session+Knott, then session (run 1) |

- **The gate's looks did not reproduce in the replay, in either arm.** The live gate turn made three looks; the six gate3 replay runs made none. Every replay's first model call went straight to `resolve` (and was refused for Knott's missing stat block). The replay starts a fresh in-memory session: the Keeper sees the capsule and the run's notes but not the table's two earlier turns of conversation, which the live Keeper had. So this measurement cannot show whether §135.31 removes the gate's looks; the one look that did occur (fight-round, before, run 3: `look session` batched with an `apply`) is gone in the after arm, which is one run and inside the pre-registered noise.
- **Model calls: no shift** (fight 14 vs 15 total, gate3 19 vs 20), within the noise pre-registered (±1 per run).
- **Cost of carrying:** 0.6-1.9 KB of views per carrying step, 0-1 kernel reads, 0-15 ms (one 1.3 s read while the machine was at load 50). First-call input tokens (uncached + cached): fight-round 45.1K / 45.1K / 46.1K before, 47.3K / 42.2K / 47.2K after; gate3 43.2K / 47.3K / 43.2K before, 47.7K ×3 after. The carried bytes (about 0.2-0.6K tokens) explain only part of that spread; it is not attributed further.
- Pre-registered expectations that held: fight-round 0 → 0; Knott's card not carried at the step after the move. That did not: gate3 before 2-3 looks per run (it was 0).

Pre-registration (written before the first run): gate3 before 2-3 looks per run, after 1 (0-2), the Knott look staying because no candidate names him there; fight-round 0 → 0 and model calls within ±1; a difference of 1 look or 1 call per run is noise; only a consistent shift across all three runs reads as an effect.

**Suites** (with `--test-concurrency=2` under the machine-wide `heavy.sh` lock, after the coordinator's throttle):

| suite | branch before the merge (`c38deabda`) |
| --- | --- |
| `npm run build:runtime` | exit 0 |
| `node --test --test-concurrency=2 "tests/extension/**/*.test.mjs"` (test:ext) | 2829/2829. The parent is 2821 (2829 minus the 8 new tests; derived, not run). An earlier full run at default concurrency had one failure, `reading-intent.test.mjs` ("a reading timeout shows the Keeper the focus and question…"): the first version wrote the Keeper's `question` into the row; fixed by decision 5. |
| `experiments/single-loop-routing/loop.test.mjs` | 12/12 |
| `uv run --frozen python -m pytest tests/kernel tests/play -q -p no:cacheprovider` | 1699 passed, 1 skipped, exit 0 (after `build:runtime`, the tree untouched while it ran) |
| `npm run check:kernel` | exit 0 |

**Not done / left open.**

- The parent arm's worktree (`scratchpad/sl15-parent`, detached at `ef8efdf97`) is left in place; removing worktrees was out of this ticket's permissions.
- The live-Keeper home: the harness copies the App's grok-build credential (without its refresh token) itself, reading it from the App's agent directory; `PI_CODING_AGENT_DIR` was pointed at a copy of the integ-sl `.pi/coc-agent` (`.pi/coc-agent-sl15`, gitignored), but the harness sets its own per-run agent directory, so the copy was not what authenticated. The token had over five hours left.
- SL-13's integration branch carries its own gate #3 fixtures (`fixtures/gate3` + `gate3-t1..t3`, with baselines). `gate3-turn3` here is the same campaign before turn 3 without a baseline; one of the two can go.

**After merging `claude/integ-single-loop-20260923`** (0.9.5a + SL-13, `721812cac`; merge `4cde94400`). Conflicts: `docs/kernel-rpc.md` (SL-13's §135.30 first, then §135.31) and `runtime/jev/hybrid-engine.ts` (the fresh read keeps both the compile's `rows` and `run.issued`). The carried-views seam test now counts routes rather than decisions, since the §135.30 compile is the first decision (the same change SL-13 made to the SL-02 seam test). Suites on leehow-pc (the coordinator's box), at `4cde94400`:

```
== loop on leehow-pc @ 4cde94400c35bf26719b48c4e89d890c42cb265d: exit=0 wall=35s   (101/101)
== ext on leehow-pc @ 4cde94400c35bf26719b48c4e89d890c42cb265d: exit=0 wall=113s   (2838/2838)
== py on leehow-pc @ 4cde94400c35bf26719b48c4e89d890c42cb265d: exit=1 wall=278s    (1695 passed, 2 skipped, 3 failed)
```

- The three pytest failures are the play driver's process lifecycle, not this ticket: `test_driver.py::test_status_reports_alive_then_dead` and `::test_stop_terminates_both_processes_and_writes_final` fail on the box with the file alone too, and pass on the Mac at the same HEAD (`test_driver.py` 63/63); `test_persona_bench.py::test_the_bench_never_steals_the_default_run_pointer` reads the shared current-run pointer another parallel test moved (`-n 12`), and passes alone on the box (32/32). Nothing in this branch touches `tests/play/driver.py` or process handling. The Mac's full serial pytest before the merge was 1699 passed, 1 skipped.
- The 12 mutations re-run on the merged tree: all killed, by the same tests.

### 2026-09-24: follow-ups (owner decision on the ceilings; integration branch `a79655ced`; fixture)

**Commits:** `ef05a5f24` (merge of `claude/integ-single-loop-20260923` at `a79655ced`, clean), `74e7ad088` (contract), `03c73eb8b` (ceilings + tests), `95e4126c4` (fixture dropped), `2fa9ed194` (the pointer test's isolation).

**Carried views have their own ceilings** (owner decision): `CARRIED_VIEW_BYTES` 4 KiB per view, `CARRIED_VIEWS_BYTES` 12 KiB per message (`runtime/jev/carried-views.ts`); §135.20's 1 KiB / 8 KiB stay for the issued section. Cuts are unchanged and still marked. §135.31 says so.

**On the gate state they do not all travel whole.** Measured on `fixtures/gate3` reset to before turn 3, the clerk's move applied, emitted kernel (`fitView` as the engine runs it):

| view | whole | after the 4 KiB cut | after 1 KiB (before) |
| --- | --- | --- | --- |
| scene, Knott's Office | 7,817 B | 2,929 B, `present` omitted (4,877 B: the dossiers of the people there) | 354 B |
| card, Steven Knott (after the move; the same with the fight open) | 8,299 B | 3,981 B, omitted from `deflect_options` on: `mechanics`, `combat_*`, `properties`, `recent_speech`, `reunion` | 794 B |
| session, fight open | 886 B | whole | whole |

- The office view now keeps exits, affordances and keeper notes, and loses only `present`.
- Knott's card still loses `mechanics`. On a campaign two turns in, `mechanics` sits after about 5.5 KB of `in exchange`, `personality`, `knows`, `ledger` and `keeper_note` fields. The card is 8.3 KB whole.
- Carrying both whole needs about 8.5 KiB per view and about 17 KiB per message (scene, card and session together).
- On the seam tests' fresh campaign, cards (about 3.9 KB) and the Globe's scene view now travel whole, and the tests assert that.
- Owner to decide: raise the per-view ceiling again, or put `mechanics` (and the combat fields) ahead of the dossier in the card's field order. The second option is a kernel read order change; §135.20's cut drops trailing fields first.

**Mutations for the limits** (on the file, each killed):

| mutation | tests failed |
| --- | --- |
| M4 per-view ceiling ignored | ceilings |
| M5 message budget ignored | ceilings |
| M13 carried view back to 1 KiB | after a clerk move; at a pending defence; ceilings |
| M14 carried section back to 8 KiB | after a clerk move; ceilings |

M1-M3 and M6-M12 were re-run on the same tree: all killed, the same tests as before.

**The third box failure: `tests/play/test_persona_bench.py::test_the_bench_never_steals_the_default_run_pointer`.**

- **Verdict: parallel-unsafe, shared path; not timing.** It asserts that the checkout's `.coc/playtests/.current-run` is unchanged across `bench.start_table`. Under xdist, `test_driver.py`'s `start` (no `--no-default-run`) writes that same file from another worker.
- **Reproduced 3/3** on leehow-pc with `tests/play` at the default `-n auto --maxprocesses=12`: `{'run_id': 'fixture-9ea5cf65f8'} != {'run_id': 'fixture-eb8f54d521'}`, the other test's run id.
- **Fix: one line.** The test points `driver.CURRENT_RUN_FILE` at its own `tmp_path`. `driver.main` runs in process and reads the module global, so the property is still tested.
  - Mutation check: with `--no-default-run` removed from `bench.start_table` the test fails, and it passes with the flag restored.
  - After the fix: 3/3 green on the box.
- The two `test_driver.py` failures were the daemon's Linux `accept()` bug, fixed on the integration branch; they pass now.

**Suites on leehow-pc at `2fa9ed194`** (the script printed no parse error):

```
== loop on leehow-pc @ 2fa9ed194bd4e4cdcf7ab9f219bd4c65a2aea6d7: exit=0 wall=24s   (101/101)
== ext on leehow-pc @ 2fa9ed194bd4e4cdcf7ab9f219bd4c65a2aea6d7: exit=0 wall=111s   (2838/2838)
== py on leehow-pc @ 2fa9ed194bd4e4cdcf7ab9f219bd4c65a2aea6d7: exit=0 wall=170s    (1709 passed, 2 skipped)
```
