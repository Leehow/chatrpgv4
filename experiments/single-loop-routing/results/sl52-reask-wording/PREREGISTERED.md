# SL-52 stage 2: re-ask wording probe, pre-registered 2026-09-25 before the calls

Stage 2's replay (`sl52-longgate6-t1-stage2`, commit c88c7f5a1) re-asked the office's clue rows once in run 1 (the other two
runs never settled: the leads `yes` was 0.55 / 0.53, under the gate on confidence alone) and Jev answered the keys `no` 0.72
(yes 0.05) against the cue "Accept the commission explicitly and take the key, address, and cash advance."

Probe (`experiments/single-loop-routing/sl52-reask-probe.mjs`): the re-ask batch the product builds for gate #6 t1 (the
sentence, the office, the leads as the settled step with the Globe it opens, the commission / Macario / keys rows with the
book's cues), 5 live Jev calls per arm:
- V0: the committed question ("with the settled step done, does the declared action do what a cue describes");
- V1: the ruling's own framing ("does settling that step, as the player declared it, yield this clue as the book's cue for it
  states; the cue is how the book says the clue is obtained here").

Decision rule, written before the calls: V1 replaces V0 only if the keys clear `yes` (confidence >= 0.6) in >= 4 of 5 and the
commission and the Macario summary never clear `yes`. Otherwise V0 stays and the result goes to the owner.

## Result (appended after the calls)

V0: the keys `no` 0.83–0.87 in 5/5 (commission `no` 0.88–0.91, Macario `no` 0.85–0.87). V1: the keys `no` 0.53–0.58 in 5/5
(under the gate either way; commission and Macario `no`). Neither arm files the keys; by the rule V0 stays and the result goes
to the owner. Raw answers: `answers.json`.
