Status: ready-for-agent
Stage: SL-18 (after live gate #6; amends SL-10's admission work)
Spec: docs/specs/pi-native-single-loop.md (Rulings: "A turn is under 60 seconds", "Parameters-only steps never go to the LLM", "Routing asks what the player does, never whether a candidate is due")
Contract: docs/kernel-rpc.md §32.12 (amends §32.2, §32.4, §32.7, §32.10, §32.11 and §135.30's `basis.compile`)

# SL-18 — Admission within the turn: a bounded lane review, and the compile's evidence admits the clerk's write

## Evidence (live gate #6, campaign `gate6-haunting-0335`, turn 2, run `run-01a0d259-a833-7688-887c-ae3eddd58747`)

- The clerk's obligation check (`resolve:obligation:globe-clippings-access`) was selected by the compile: `ask` 0.91 on
  the gate's demand, `addressee` 0.55 on Arty Wilmot (cleared by the margin rule, 0.66 against `unclear` 0.32), `act`
  social 0.96. SL-12 bound it: `Persuade` Jev 0.68, `bonus` Jev 0.79, the rest `stated` or `composed`. It still went to the
  lane: authorized in 2 784 ms.
- Later the Keeper proposed a `resolve` against Ruth Blake. The lane answered `not_authorized` after 57 239 ms: response
  headers at 1.7 s, then the model streamed for 55 s. The 120 s cap never fired. The turn took 112 s.
- Across gates #3–#6 every clerk write went through the lane (2.5–7.7 s each; turn 3's clerk move 4.9 s), never `typed`:
  the typed reviewer is opt-in (`PI_COC_ADMISSION_REVIEWER=jev`, §32.10) and the fast path needs Jev ≥ 0.87 (§32.11);
  the clerk's moves were typed 0.72–0.80.

## Owner rulings (2026-09-24)

1. **The lane review is bounded inside the turn.** Default cap 12 s (`PI_COC_ADMISSION_TIMEOUT_MS` still overrides),
   measured from the request. Past it the review ends with verdict `review_timeout`: a refusal to the Keeper naming the
   cap, never an admit; the run continues; the row records `timed_out: true` with the ms. A streamed response that has
   produced no verdict by the cap is cut like a stalled one. The typed attempt's own 4 s cap stays.
2. **A clerk write the compile selected is admitted on the compile's evidence.** When the executing candidate carries
   `basis.compile` (a predicate fired with every feature it read cleared at the gate) and every bound parameter's path is
   `stated`, `composed`, `rule-default` or `jev` (SL-12 bind rows), the admission row records `path: "compile"`,
   `reviewer: "compile"`, the predicate and the feature confidences, and no lane or typed call is made. Keeper-origin
   writes and clerk writes not selected by the compile (route `need` selections, forced session steps) keep the current
   review. The exemption is refused (falls back to the lane) if any feature the predicate read was below the gate or if
   a bound parameter has no recorded path.
3. **Telemetry.** The admission row always carries `origin`, `path`, `ms`, and for the lane `first_byte_ms`; §32.7
   amended.

## Scope

- Contract first: §32.12, the dated addenda in §32.2 and §32.7, the `basis.compile` line of §135.30, and a dated comment
  on SL-10.
- `extensions/kernel/admission.ts`: the 12 s default; `review_timeout`; `compileAdmission` (pure).
- `extensions/lanes/subsession.ts`: the lane result carries `firstByteMs`.
- `extensions/kernel/index.ts` (`admitAction`): the compile path, the timeout refusal, `origin`/`path`/`ms` on every row.
- `runtime/jev/route-compile.ts`: each predicate declares the families it reads; `basis.compile.read_features`.
- `runtime/jev/hybrid-engine.ts` and `extensions/kernel/canonical-operation-dispatcher.ts`: the clerk's bind records
  travel on the host origin as `bindings`, computed before the dispatch.

## Acceptance

- (a) A lane review that streams past the cap ends `review_timeout` within cap + 1 s (a real socket that answers 200 and
  then trickles); (b) a compile-selected clerk write is admitted with `path: "compile"` and no provider call; (c) the same
  write with one feature under the gate goes to the lane; (d) a Keeper-origin write still goes to the lane.
- Mutations killed: the cap removed; the exemption applied without `basis.compile`; the exemption applied with an
  unrecorded parameter path.
- Replay: SL-13's `gate3-t2` fixture with live Jev, 3 runs: the obligation check's admission row is `path: "compile"`.
- Suites (leehow-pc): `test:ext`, the loop suites; pytest only if something the kernel reads changed.

## Comments

### 2026-09-24 — replay pre-registration (before any scored run)

**Reading of ruling 2 that the code implements (§32.12 (3)).** "Every feature the predicate read" is the families the
predicate turns on or guards with -- `obligation_check`: `ask`, `addressee`, `act` -- whenever the compile asked them,
cleared or not. The ruling's own refusal clause ("refused if any feature the predicate read was below the gate") only has
content under this reading: `interpretCompile` puts only cleared rows in `basis.compile.features`, and the obligation
check's addressee and act guards let it fire when they do not clear, so a guard under the gate is the one case where a
selection exists with a read feature below the gate. It is also the declaration live gate #4's admission refused ("said
nothing about Arty Wilmot"). "Cleared at the gate" is §135.2's gate, the margin rule included, so gate #6's addressee at
0.55 (0.66 against 0.32) clears and that check is admitted by the compile.

**Instrument.** `node experiments/single-loop-routing/run.mjs --fixture gate3-t2 --runs 3 --llm replay --seed 1 --out
experiments/single-loop-routing/results/sl18-gate3-t2` on this branch: product driver, replayed gate #3 Keeper, live Jev,
prescreen on (default), `--admission lane` (default), the recorded live verdicts for any lane review. The summary rows now
carry `predicate`, `features`, `binding_paths`, `compile_refused`, `first_byte_ms`, `timed_out`.

**Registered acceptance (the lead's):** in 3/3 runs the clerk's `resolve:obligation:globe-clippings-access` admission row
is `path: "compile"`, with no lane request for it.

**Registered prediction (mine), from SL-13's replays of the same fixture** (`results/sl13b-gate3-t2-prescreen-on`: the
compile's addressee on Arty cleared 3/5, at 0.54 / 0.59 / 0.54 by the margin rule, and did not clear 2/5, at 0.48 / 0.47;
`ask` 0.77–0.83 and `act` social 0.95–0.97 cleared 5/5): a run whose addressee clears is `path: "compile"`; a run whose
addressee does not clear is `path: "lane"` with `compile_refused: "feature_not_cleared:addressee"`. At SL-13's rate the
lead's 3/3 holds with probability about 0.2. If a run misses, it is the §32.12 (3) rule doing what it says, not a defect;
whether a guard that did not clear should be read at all is the owner's call.
