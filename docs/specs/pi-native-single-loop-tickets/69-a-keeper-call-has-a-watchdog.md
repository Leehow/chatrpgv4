Status: ready-for-human (implemented 2026-09-25)
Stage: SL-69 (P1, turn wall; the Keeper's own provider call)
Spec: docs/kernel-rpc.md §135.11 (turn close), §135.29 (stream progress, vendored patch 0003), the turn budget

# SL-69 — A Keeper provider call that outlives its cap is abandoned and retried once; the turn never waits minutes on one call

## Evidence
- Long gate #10 t20: one call of 155 s, response 200 with text and a tool call; the rest of the table's calls were 2–7 s. Batch-11 血色公路 t?: one call of 187 s, no error; 91 other calls p50 ~3.5 s. Both outliers set their table's max wall; nothing in the product waited on anything but the provider.
- §135.29's stream-progress watchdog covers a stream that stops producing; these calls were slow to start (no first byte for minutes) or slow throughout; there is no per-call cap on the Keeper's own call (memory: "主模型无看门狗").

## Ruling (owner, 2026-09-25)
A Keeper call has a cap, a named default derived from the table's turn budget (e.g. half the remaining budget, never below a floor); past it the call is abandoned and re-sent once with the same context; a second overrun ends the step with the SL-16 fallback. The cap is recorded on the run's telemetry with the call's phase (waiting for the first byte / streaming).

## Scope
1. Contract: §135.29 addendum (the per-call cap beside the stream-progress watchdog; the retry; the fallback).
2. `runtime/jev/hybrid-engine.ts` / the Keeper call site (vendored Pi's run driver hook from patch 0003): the cap and the one retry; telemetry `keeper_call_cap` rows.
3. Tests, mutation-killable, with a fake provider that stalls before the first byte and one that stalls mid-stream: the call is abandoned at the cap, retried once, and the turn delivers; a fast call is untouched.

## Comments

**2026-09-25, implemented (worker, branch `claude/sl69-20260925`, base `f305074c6`).**

- Contract: `docs/kernel-rpc.md` §135.29 addendum (new subsection, no renumbering; amends §135.29).
- **Mechanism (vendored patch `0004-keeper-call-cap.patch`, beside `0001`-`0003`, `vendor/pi/PATCHES.md`
  updated).** `watchCallCap`, a new function in the same file as §135.29's `watchStreamProgress`
  (`packages/coding-agent/src/core/stream-progress.ts`): a per-call TOTAL-duration ceiling, composed
  *outside* the idle-progress watchdog in `sdk.ts`'s stream function, so both apply to every attempt. Past
  the cap, the attempt ends exactly as an idle timeout does -- a provider `error` carrying whatever
  partial message had arrived (none, for `first_byte`) -- except `watchCallCap` never decides retryability
  itself: the caller's `onCap(phase)` supplies the exact error wording, and pi-ai's own retry-pattern
  matcher keys on that wording alone (this is the whole mechanism behind "abandon and retry once": no new
  retryability concept was invented). `sdk.ts` supplies a message matching pi-ai's own patterns
  (`"timed? out"`) on a step's *first* cap overrun (the session's existing auto-retry resends it once,
  under the same context) and a message matching none of them on a *second* overrun of the *same* step
  (the session's own retry check declines, and the step ends there, independent of the session's own
  larger `retry.maxRetries`). The count is a `WeakMap<AbortSignal, number>` keyed on the infer step's own
  outer cancellation signal (stable across that step's internal retries; a step's signal is never reused by
  a later step, so entries need no clearing).
- **Plumbing.** `CreateAgentSessionOptions.keeperCallCapMs`/`onKeeperCallCap` (`sdk.ts`), threaded through
  `MainOptions` (`main.ts`) and `CreateAgentSessionFromServicesOptions`
  (`agent-session-services.ts`) exactly as `runDriver` already is. `runtime/pi-hybrid.ts` supplies both
  from `createHybridEngine`'s own new `keeperCallCapMs`/`onKeeperCallCap` fields.
  `runtime/jev/hybrid-engine.ts` computes the cap once per process
  (`keeperCallCapMs(env) = max(keeperCallCapFloorMs(env), turnBudgetMs(env) / 2)`, both env-overridable:
  `PI_COC_KEEPER_CALL_CAP_FLOOR_MS` default 20 000 ms, the existing `PI_COC_TURN_BUDGET_MS`) and records a
  `keeper_call_cap` telemetry row (`{lane: "run", event: "keeper_call_cap", run, phase, cap_ms}`) each time
  the callback fires, tracking the current run id via the same `prepare()` hook that already builds the
  run's own state.
- `tests/extension/harness.mjs`'s `openTable` gained `keeperCallCapMs`/`onKeeperCallCap` passthrough
  (mirroring the existing conditional `runDriver` passthrough), needed for the full-session integration
  test below.
- **A real bug found and fixed while writing the first unit test.** My own fake-provider test helper called
  a hand-built stream's `.end()` with no result on abort, which left `EventStream.result()`'s promise
  unsettled forever -- a real `await source.result()` inside `watchCallCap` (the same pattern
  `watchStreamProgress` already uses, unamended) then hung permanently. This is a defect in the *test
  double*, not in `watchCallCap` or in any real provider path (a real aborted fetch/stream always settles
  its result one way or another), but it hung `node --test` for the whole `tests/extension/**` tree for
  690 s on leehow-pc before I found and fixed it locally (the fake now pushes a proper `error`/
  `reason: "aborted"` event on abort, exactly as a real provider adapter does). Recorded here because it
  cost real wall time and because the fix changed one test's own assertions (see below).

**Tests** (mutation-verified by copy-revert, never `git checkout --`; every mutation cycle run and
confirmed locally before re-spending a remote round-trip):
- `tests/extension/keeper-call-cap.test.mjs` (new): `watchCallCap` exercised directly against a fake
  `start` function (a hand-built `AssistantMessageEventStream`, never a real socket) imported from the
  built vendor package -- a fast call under the cap is untouched; a stall before the first byte is cut at
  the cap with phase `first_byte` and a synthetic error carrying no content; a stall mid-stream is cut with
  phase `streaming`, copying the last partial message that did arrive; `capMs <= 0` disables it; a caller's
  own outer abort is relayed through untouched and never asks `onCap`; `onCap`'s returned wording is used
  verbatim, attempt for attempt (the retryable/non-retryable seam the rest of the mechanism is built on).
  - Mutation: `watchCallCap`'s phase classification flipped (`last ? "first_byte" : "streaming"`, copy
    revert + local rebuild, restored after). The two phase-specific tests failed exactly as expected; the
    other four (which do not assert phase) were unaffected.
- `tests/extension/keeper-call-cap-integration.test.mjs` (new): a driven Keeper call to a real socket that
  never answers at all is capped, retried exactly once under the same context, and a second overrun ends
  the step (`run_end undelivered`, the §38.7 terminal notice) without exhausting the session's own larger
  `retry.maxRetries` -- exactly two provider requests, one `auto_retry_start`, two `keeper_call_cap`
  telemetry rows (phase `first_byte`, since no header ever arrived); `keeperCallCapMs(env)`'s own
  floor-vs-half-budget arithmetic, including an explicit-floor override.
  - Mutation: `sdk.ts`'s overrun wording collapsed to always return the retryable message (copy-revert +
    local rebuild, restored after). The session's own `retry.maxRetries: 3` then allowed four total
    attempts instead of two; the test's own request-count assertion (`4 !== 2`) failed exactly as
    expected.
- `tests/extension/provider-stream-stall.test.mjs` (existing §135.29 suite, unamended): re-run to confirm
  no regression to the idle-progress watchdog when `keeperCallCapMs` is absent (the default for every
  caller that does not opt in) -- all three tests pass unchanged.
- `tests/extension/vendored-pi.test.mjs`: pins the series (patch `0004` alongside `0001`-`0003`;
  "the patch series, PATCHES.md and the digest in the built package agree" passes, confirming the new
  patch file, `PATCHES.md`'s rows and the freshly-built package's stamped digest are all consistent).

**Suites, on leehow-pc** (`~/.claude/skills/leehow-pc-tests/scripts/remote-test.sh`; the first `ext` run
hung on the test-double bug above (killed after 690 s at my own end; not a product defect) -- the runs
below are after that fix):
```
== ext on leehow-pc @ f305074c643e617ff0f8647bc9585f1d3d45659e: exit=0 wall=169s log=/home/leehow/leehow/code/wt/chatrpgv4-wt-sl69/remote-ext.log
```
(3184/3184; an intermediate run at the same commit, before I also fixed `tests/extension/
control-flow-inventory.test.mjs`'s SL-00 registration and `tests/extension/system-language.test.mjs`'s two
CJK doc-comment examples -- both incidental to SL-68, recorded in that ticket's own Comments -- showed
those two failures alone; this run is clean.)
```
== loop on leehow-pc @ f305074c643e617ff0f8647bc9585f1d3d45659e: exit=0 wall=44s log=/home/leehow/leehow/code/wt/chatrpgv4-wt-sl69/remote-loop.log
```
(196/196.)
```
== py on leehow-pc @ f305074c643e617ff0f8647bc9585f1d3d45659e: exit=0 wall=181s log=/home/leehow/leehow/code/wt/chatrpgv4-wt-sl69/remote-py.log
```
(1730 passed, 2 skipped.)

**Left undone: no live-table replay of long gate #10 t20 or the batch-11 187 s call.** Reproducing either
outlier live would need a provider that actually stalls for minutes on a real table, which is exactly what
the fake-provider tests substitute for deterministically and without spending the wall time or the
provider cost; the ticket's own scope line asks for mutation-killable fake-provider tests, not a live
gate. If a live confirmation that a real slow/hung call is capped and recovered on an actual table is
wanted, that is the next step and is not done here.
