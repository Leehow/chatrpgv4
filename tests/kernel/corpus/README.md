# resolve regression corpus

Each file is one recorded `rules.settle` payload from the old repo
(`tests/fixtures/rules-settle-recorded/`) translated into an equivalent `table.resolve` action.
`test_corpus.py` replays each through the RPC seam and asserts the same decision is selected, the
effect/event kinds match and the session transitions match. The existing assertions do not
hardcode dice faces. Differential mode additionally compares every seeded roll, response,
state value, canonical digest and Git history against a separate Python reference run.

## Runtime selection and differential mode

All tests run inside the locked uv environment. `COC_TEST_KERNEL_CMD` optionally
selects a kernel entrypoint as a JSON argv array; workspace/content arguments are
added by the harness. Without it, the child uses the current locked interpreter.
An invalid or unavailable explicit command fails rather than falling back.

For the existing corpus, `COC_TEST_COMPARE_CMD` selects a candidate entrypoint.
Each case then runs the original setup and assertions twice, sequentially, in
separate reference and candidate workspaces. The reference always uses Python.
Test-only Python and Node clock adapters and fixed Git dates make comparisons
reproducible without adding a production clock hook. Git environment overrides
are isolated. No receipt, seed, hash, state field or timestamp is filtered out.

`COC_RPC_EVIDENCE_DIR` selects a retained evidence directory; otherwise evidence
lives under the case's test directory. Every comparison receives a new directory
containing reference, candidate and difference JSON, including assertion failures.
Calibration against a second Python process validates the comparison method only;
it is neither a TypeScript pass nor genuine play acceptance.

The helper's `python_internal_tests` inventory reports tests importing kernel
internals. It never automatically skips them or claims they are runtime-neutral.
The response deadline currently uses POSIX pipe readiness, matching the initial
macOS target. Other platform acceptance remains separate.

Translated: 59 (all 55 recorded payloads; the combat and chase recordings each become one file whose
`setup` / `followups` replay the old multi-command settle as the kernel's separate resolves).

Case keys beyond `action` / `expect`:

- `setup.move_to`: scenes to `apply move` through first (the session families need Corbitt present).
- `setup.combat`: open a fight before the action (the investigator's attack and the NPC's defense).
- `setup.sanity`: overrides written into `save/sanity-state/thomas-hayes.json` (an underlying insanity
  makes any SAN loss of 1+ open a bout, which pins the recorded bout transition without pinning dice).
- `followups`: further `{action, expect}` pairs resolved in order after the main action.
- `expect.session` / `expect.session_after`: the 11.9 `session` echoed by the result / by `look` afterwards
  (`kind`, `kind_in`, `status`, `status_in`, `outcome`); `expect.pending_choice.for`; `expect.event_counts_min`
  for dice-dependent numbers of `roll-resolved` events.

The recorded sanity payloads did not keep their loss expressions; the translations use the recorded
loss to pick one (`1D8` for losses of 7+, `1D6` otherwise, success loss as recorded), and the recorded
`involuntary_action` verbatim.
