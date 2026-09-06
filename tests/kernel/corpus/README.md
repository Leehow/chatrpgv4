# resolve regression corpus

Each file is one recorded `rules.settle` payload from the old repo
(`tests/fixtures/rules-settle-recorded/`) translated into an equivalent `table.resolve` action.
`test_corpus.py` replays each through the RPC seam and asserts the same decision is selected, the
effect/event kinds match and the session transitions match; dice are random and never compared.

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
