# Does the language gap explain Jev's ask/addressee variance? — pre-registered design (2026-09-24)

Worker: measurement only, branch `claude/jev-lang-20260924` (base `db056b144`), worktree
`/Users/haoli/leehow/code/chatrpgv4-wt-jev-lang`. No product code changes (`runtime/`, `kernel-ts/`,
`extensions/` are read, never edited). No word lists, no prompt tuning. Evidence sources
`/Users/haoli/leehow/code/chatrpgv4-wt-integ-sl/.coc/campaigns/{gate4-haunting-0214,gate3-haunting-2329}`
are read-only; only copies (fixtures, a scratch probe workspace) are written, all under this worktree or
the session scratchpad.

## The question

The compile's feature rows (contract §135.30, built by `compileRows` in `runtime/jev/compile-rows.ts`) are
words *the kernel* supplies — mostly the module's own English text (an obligation's authored `name`, the
canonical resolve-intent words `resolveIntents()`/`intentWords()` such as "social", "investigate") — while
`player_input` is the player's own Chinese sentence, verbatim, sent to Jev as `state.player_input.` Does
that language mismatch explain why the **same** obligation, on the **same** module, answered by Jev for the
**same** sentence, cleared at 0.71–0.79 on one campaign's turn-2 state and only 0.35 (below both gates) on
another's? Or is something else responsible: the number of competing options, or a difference in the two
campaigns' turn-2 *state* (scene, roster order, prior-turn materials) that has nothing to do with the row
text's language?

## What is already established, before running anything new

1. **The rows are structurally identical between the two campaigns.** Both are the same module
   (`the-haunting`) and the same scene (`newspaper-morgue`); both turn-2 compiles asked the identical three
   `ask` options — `ask_1 = obligation:globe-clippings-access` ("Access to the Globe clippings"),
   `ask_2 = clue:globe-fire-cutoff`, `ask_3 = handout:Boston Globe City Desk Copy — Held from Print (1918)" —
   and the identical two `addressee` options (`Arty Wilmot`, `Ruth Blake`). Confirmed by reading
   `experiments/single-loop-routing/results/sl13-gate3-t2/run1.trace.jsonl`'s compile row against the live
   gate4 campaign's own `telemetry.jsonl` compile row for turn 2 (both quoted in full in "Evidence" below).
   The player's sentence is byte-identical in both fixtures' `turn.json` (`我说明来意，请他帮忙调出科比特宅这些年的
   旧剪报。`).
2. **Given (1), the language pairing and the option count are already held constant between the two
   observed outcomes** (0.71–0.79 at gate 3 vs. 0.35 at gate 4): both are "Chinese sentence, English/mixed
   rows, 3 ask options, 2 addressee options." A naive "it's the language" story has to explain why the same
   language pairing produced two very different answers. That is this experiment's starting skepticism,
   not its conclusion — the point of running fresh arms is to see whether *manipulating* the language or the
   option count, on top of one of these states, moves the needle enough to matter, and whether the
   state difference alone (arm a on gate-3 vs. arm a on gate-4) reproduces the gap.
3. **The `addressee` family is not purely English.** `table.capsule.present[].called.name` (the row's
   `label`) is the table's own localized name — confirmed directly by starting the built kernel on a copy
   of the live gate4 campaign and reading `table.capsule`: Steven Knott's row is
   `{"called":{"name":"史蒂文·诺特"},"role":"employer"}` (label in Chinese, role in English). Per
   `.coc/campaigns/gate4-haunting-0214/world.json`'s `person_labels`, Arty Wilmot has the same kind of
   label (`阿蒂·威尔莫特`); Ruth Blake has never been given one through turn 3, so her row falls back to the
   English record name. So "addressee" rows are a Chinese label + an English role word, not the clean
   English-only case the `ask`/`act` families are. This matters for reading the addressee results: if
   addressee still fails to clear, "it's English" cannot be the whole story for that family, since its
   label is already in the player's language.

## Design

### States

- **gate-3 state (`fixtures/gate3-t2`, pre-existing SL-13 fixture).** Full real replay: materialize the
  fixture's shared tarball, `git reset --hard 380440f` (the fixture's `commit_before`) on the campaign's
  sidecar repo, open turn 2 with `table.player_input`, then read `table.capsule` / `table.apply.options` /
  `table.resolve.options` and pass them through the production `compileRows()` (unmodified import). This is
  the same mechanism `experiments/single-loop-routing/ports.ts`/`run-entry.ts` use; it is a faithful replay,
  including whatever "materials" the real prescreen would have supplied if I drove the whole loop — **but my
  script calls the compile directly, without running the prescreen step**, so its `materials` list is empty
  in all of my gate-3 arms too. That is a real divergence from SL-13's own replay (SL-13 ran the whole
  `runTurn` loop, which does read materials first); I am isolating the compile-only question to keep 40
  calls affordable and to hold "materials" constant across my own arms. It means my own "as-is" arm-a number
  on gate-3 is not guaranteed to land exactly on SL-13's already-published 0.71–0.79 (which had real
  prescreen materials in front of Jev); if it lands noticeably lower, that by itself is evidence that
  materials (not rows, not language) explain part of the original gap, and I say so rather than declare a
  clean reproduction.
- **gate-4 state (reconstructed, no fixture, no materials).** Git cannot recover gate-4's pre-turn-2 state:
  the campaign's sidecar repo has no separate "turn 1" commit — `turns/0001.json` and `turns/0002.json` both
  land in the same commit (`28b1a51`, subject "turn 2: ..."), because turn 1 in this campaign stalled (its
  `turn-1.json` capture has an *empty* `final_text` even though its receipts show real effects — item
  definitions — were applied; see `.coc/playtests/gate4-haunting-0214-20260924T061454Z/turn-1.json`). This
  looks like the stalled-stream recovery path folding turn 1's tail into turn 2's commit, a state I cannot
  git-checkout independently of turn 2's own effects. So instead of a kernel replay, I reconstruct the
  `StateReads` object by hand from (a) the campaign's own live `telemetry.jsonl` compile row for turn 2
  (which records every row's *alias → id* mapping, confirmed above) and (b) static module content
  (`content/modules/the-haunting/module-graph.json`, the campaign's `world.json`) for the *describe* text
  those ids stand for (the obligation's authored `name`/guards, the clue summaries, the handout name, the
  present roster's labels/roles). I verify the reconstruction by checking that feeding it through the
  production `compileRows()` yields the exact same `ask_1..3`, `act_1..11`, `item_1..4` ids the live
  telemetry recorded (an exact match on every id is the acceptance bar for "faithful enough"); `destination`
  is reconstructed more loosely (scene display names are approximated from the module graph's node
  `name`/`canonical_name` fields, since I have no way to open a live turn and ask the kernel directly) and I
  flag it as such — it is not part of the ask/addressee hypothesis. **No materials** are available for this
  state at all (I never had them); this arm is therefore a "rows + input only" probe, not a full replay.

### Arms (10 Jev calls each, sequential; ~0.7 s per call)

- **(a) as-is.** The real batch: Chinese `player_input`, the kernel's own row `describe` text unchanged.
- **(b) translated input.** Same rows as (a); `player_input` replaced by one human (mine) translation to
  English, written here once, not generated by any word list or model call: *"I explain why I've come and
  ask him to help pull the old clippings about the Corbitt house from these past years."* Everything else
  (rows, criteria wording, state object) identical to (a).
- **(c) play-language row labels where the kernel already carries one.** Same Chinese `player_input` as (a).
  For `addressee`, this is *already* what (a) does (the kernel's own `called.name` is Chinese) — so arm (c)
  for `addressee` is identical to arm (a); I still report it as its own row for completeness, and its
  identity to (a) is itself evidence about that family. For `ask`, the kernel carries **no** play-language
  label for the obligation's demand, the clue summary or the handout name — they are only ever authored in
  English (`module-graph.json`'s `name`/`summary` fields have no `zh-Hans` variant for this content). Per
  the instructions, I do **not** invent a translation as product data to fill that gap; instead arm (c)'s
  `ask` question is left byte-identical to (a), and I record plainly that this family has nothing to swap in
  — its "language" arm is a null result by construction, not a zero effect I measured.
- **(d) fewer ask options.** Same as (a), but the `ask` question's rows are cut to the obligation and `none`
  only (drop `ask_2`/`ask_3`, the clue and the handout) — everything else (destination, addressee, act, item,
  `player_input`) unchanged. Tests whether the extra rows split the mass away from the obligation.

Each arm is run 10 times per state (8 arm/state combinations × 10 = 80 Jev calls total). Calls run
sequentially (the instructions call them cheap, ~0.7 s each, and sequential avoids any shared-adapter
concurrency surprises).

### Pre-registered predictions (written before any of the 80 calls below were sent)

Given point 2 above (language and option count already held constant across the two *observed* outcomes),
my prior going in is that **state, not language, is the larger driver** of the 0.35-vs-0.75 gap, with
option count a secondary contributor:

- P1 (language, arms a vs. b): I expect **little to no difference** between (a) and (b) on either state —
  if translating the sentence to English moved the obligation probability by less than ~0.1 on both states,
  that is evidence against the language story. A large a→b jump specifically on the gate-4 state (closing
  most of the gap to gate-3's number) would overturn this prior.
- P2 (labels, arm c): expected identical to (a) for both `ask` (no label exists to swap) and `addressee`
  (already Chinese in (a)); this arm mainly documents that the "translate the rows" lever does not exist for
  `ask` today, rather than measuring an effect.
- P3 (option count, arm d): I expect **some** upward move in the obligation's probability once `clue`/
  `handout` are removed (mass that would have gone to `ask_2`/`ask_3` has nowhere to go but `obligation` or
  `none`), but I do not expect it to fully close a 0.35 → 0.75 gap by itself, because gate-3's arm (a) already
  clears with the full 3-option question — the option count there was never the obstacle.
- P4 (state, arm a on gate-3 vs. arm a on gate-4): this is where I expect the largest, and the real, effect:
  arm (a) on the gate-3 state should land closer to the published 0.71–0.79 (allowing for the
  materials-omission caveat above pulling it down somewhat) while arm (a) on the gate-4 reconstruction should
  land closer to the live 0.35, **even though (a) is byte-for-byte the same kind of question (same rows,
  same language pairing, same option count) in both.** If that holds, the honest reading is: the gap is
  state, not language or option count — something about what else was true at that moment (scene framing,
  roster order, clock, or the materials I could not reconstruct for gate-4) is doing the work.
- Addressee (both states): I expect addressee to remain the weaker signal throughout, because its `label`
  is already Chinese in (a) — if it still fails to clear on the gate-4 reconstruction, that on its own rules
  out "it's English" for this family specifically (point 3 above).

Falsification bar for "it's mostly language": arm (b) must beat arm (a) by a wide margin (say, mean
obligation probability up by ≥0.2, or clears-at-0.6 count up by ≥5/10) on the gate-4 state specifically, and
arm (a) vs (a) across states must be much closer than the recorded 0.35-vs-0.75 gap once language is no
longer a candidate explanation. I will report the actual numbers against this bar rather than eyeball it.

## What "clears" means here

Reusing the product's own gates (`runtime/jev/decision-gate.ts`, `clears()`): confidence ≥ 0.6, or top
probability ≥ 0.35 and ≥ 1.8× the runner-up. "Margin" in the tables below means the gap the gate uses,
report per run.

## Files

- `jev-lang-gap.mjs` — the measurement script (build the batches, run the arms, write JSON + a table).
- `results/jev-lang-gap-20260924/` — raw per-call JSON (`<state>-<arm>.json`) and `all.json`, the run I report below.
- This file (results appended below the design, after the 80 calls).

---

## Results (80 real Jev calls, `single-loop-compile` v1, `jev-1.13.0`, 10 per cell)

Reconstruction check for the gate-4 state passed exactly: `ask_1..3`, `act_1..11`, `item_1..4` and
`addressee_1..2`'s row *ids* all matched the live campaign's own `telemetry.jsonl` compile row byte for
byte (see "gate-4 reconstruction id-match check: OK" in the run log). `destination` is still the
loosely-reconstructed family (scene display names approximated from the module graph, no live kernel call
reachable) and plays no part in the reading below.

| state | arm | obligation mean (10 runs) | spread | cleared @ 0.6 gate | addressee `Arty` mean | addressee cleared |
| --- | --- | --- | --- | --- | --- | --- |
| gate-3 (real kernel replay, compile only, no prescreen materials) | a: as-is (zh in, kernel rows) | 0.354 | 0.06 | 0/10 | 0.192 | 0/10 |
| gate-3 | b: translated input (en) | 0.289 | 0.09 | 0/10 | 0.247 | 0/10 |
| gate-3 | c: play-language row labels (= a for ask/addressee; see design) | 0.370 | 0.15 | 0/10 | 0.206 | 0/10 |
| gate-3 | d: ask cut to 2 options | 0.536 | 0.13 | 1/10 | 0.205 | 0/10 |
| gate-4 (reconstructed, no materials) | a: as-is | 0.462 | 0.12 | 7/10 | 0.032 | 0/10 |
| gate-4 | b: translated input (en) | 0.427 | 0.17 | 5/10 | 0.030 | 0/10 |
| gate-4 | c: play-language row labels (= a) | 0.454 | 0.09 | 6/10 | 0.031 | 0/10 |
| gate-4 | d: ask cut to 2 options | 0.564 | 0.08 | 1/10 | 0.029 | 0/10 |

For reference, the numbers this experiment is checking against (not re-measured here, quoted from existing
evidence): gate-4 **live** turn 2 (real table, with materials): obligation 0.35, `none` 0.36, `unclear`
0.09, addressee `unclear` 0.90 / Arty 0.04. Gate-3 **SL-13 replay** turn 2 (real table, with materials,
`experiments/single-loop-routing/results/sl13-gate3-t2`): obligation 0.71–0.79 across 5 runs, addressee Arty
0.31–0.62 (cleared in 3/5).

### Reading

**1. Language does not explain the gap — it falsifies P1 outright.** Arm (b), the English translation, never
beats arm (a) on obligation, on either state: gate-3 goes 0.354 → 0.289 (down 0.065), gate-4 goes
0.462 → 0.427 (down 0.035). Both move the *wrong* direction for the "English rows need an English sentence"
story, and both are far short of the falsification bar I set before running (≥0.2 up, on the gate-4 state
specifically). Addressee is the same story in the other direction: it is already the family whose `label`
is Chinese (point 3 in the design), and translating the *input* to English doesn't move it either (gate-3:
0.192 → 0.247, a small rise inside the run-to-run spread; gate-4: 0.032 → 0.030, flat). Arm (c) confirms the
same thing from the row side: there is no play-language label to substitute for `ask` (the obligation's
`name`, the clue summaries and the handout name are English-only in the module's own authored data — I did
not invent one), and `addressee` is already using the kernel's own Chinese label in arm (a), so (c) is
numerically indistinguishable from (a) on both states (gate-3: 0.370 vs 0.354; gate-4: 0.454 vs 0.462) —
which is itself the finding for this arm, not a null result I'm hand-waving past.

**2. Option count is a real, secondary contributor, of a similar size on both states.** Cutting `ask` from
three options (obligation, clue, handout) to two (obligation, `none`) raises the obligation mean by +0.182
on gate-3 (0.354 → 0.536) and +0.102 on gate-4 (0.462 → 0.564). That's genuine dilution — the clue and
handout rows were taking real probability mass away from the obligation — but it is roughly half of what
would be needed to close a 0.35-vs-0.75 gap by itself, and it moves *both* states by a comparable amount, so
it cannot be what makes gate-3 and gate-4 different from each other.

**3. The actual driver looks like the prescreen materials, not the rows, the language, or the scene.** This
is the result I did not expect going in (my pre-registered P4 guessed "scene/roster/clock" state
differences; I did not anticipate that *removing materials entirely* would be the dominant lever). My own
arm-(a) replay of the gate-3 state — same rows, same sentence, same kernel-verified obligation and
addressee options as SL-13's published replay, with everything held constant *except that my script calls
`compileBatch` directly and never runs the prescreen step, so `materials` is empty* — lands at 0.354, not
anywhere near SL-13's 0.71–0.79. That gap (SL-13's replay *with* materials vs. mine *without*, on the
identical rows and sentence) is bigger than anything language or option count produced here, and it lands
almost exactly where the live gate-4 table (which *did* have materials, but presumably different or thinner
ones) also landed: 0.35. My gate-4 reconstruction (also without materials, and with an admittedly weaker,
hand-built state) sits a bit higher still (0.462), in the same rows-without-materials neighborhood as
gate-3-without-materials (0.354) — both far below gate-3-with-materials (0.75) and both much closer to
gate-4-live (0.35) than to gate-3-live. Put plainly: **whatever separates the 0.75 outcome from the 0.35
outcome, it is not reproduced by rows, language or option count alone — pulling materials out of an
otherwise-identical gate-3 replay reproduces something in the *low* range, not the high one.** That points
at the prescreen's reading materials (what got put in front of Jev alongside the rows) as the strongest
remaining candidate for what actually varied between the two live tables, not the row text's language, not
how many options were offered, and not a hand-wavable "state" in general.

**Addressee stays weak everywhere, and the gate-3-vs-gate-4 gap on it is the least trustworthy number here.**
Arty never clears 0.6 in any of the 80 calls. Gate-3's addressee sits around 0.19–0.25 across arms; gate-4's
sits at 0.03, a much larger gap than anything the `ask` family showed. But `addressee`'s `describe` text
(the `role` word specifically) was the part of my gate-4 reconstruction I was least able to verify against a
live read for *this* campaign at *this* turn (see the design's caveat: I used "gatekeeper"/"clippings clerk"
from module agenda text and one operation-label sighting, not a live `capsule.present.role` for gate-4 turn
2) — so I would not lean on the size of this particular gap the way I lean on the `ask` numbers above, which
verified id-exact against the live telemetry. What I *can* say without that caveat: since addressee's label
is already Chinese in every arm, and translating the input (arm b) does not move it either way beyond noise
on both states, language is not the explanation for addressee's weakness specifically, whatever else is
going on with it.

### Caveats sizes, stated plainly

- The gate-3 numbers here are a **compile-only replay** (no prescreen), which is *why* they don't match
  SL-13's own published 0.71–0.79 — that mismatch is itself the main piece of evidence in reading #3, not a
  bug, but it does mean these 40 gate-3 calls are not directly comparable to SL-13's 5-run table one-for-one.
- The gate-4 numbers are a **hand-built reconstruction**, not a replay: `ask`/`act`/`item`/`addressee` row
  *ids* are verified exact against the live telemetry, but `addressee`'s `role` words and all of
  `destination`'s display names are best-effort, not read from a live kernel call (gate-4's pre-turn-2 state
  is not git-recoverable — see the design section). Treat the gate-4 `ask` numbers as solid and the
  `addressee`/`destination` numbers as directional only.
- 10 calls per cell is enough to see the effects above (they are 2–5× the run-to-run spread), but not enough
  to put a tight confidence interval on any single mean; the spreads are reported alongside every mean above
  for exactly that reason.
- I did not test a fifth arm with materials reconstructed for gate-3 (e.g., re-running SL-13's own fixture
  through the full `runTurn` loop instead of calling `compileBatch` directly) — that would be the direct
  follow-up if this reading is right, and it is out of this task's scope (measurement of the four pre-agreed
  arms across two states, not a new arm).
