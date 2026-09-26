Status: ready-for-human (implemented 2026-09-25)
Stage: SL-70 (P2, kernel entities; follows SL-64)
Spec: docs/kernel-rpc.md §11.5.7 (SL-64), §11.5.5 (SL-59 line-level), §87

# SL-70 — Several brand-new persons introduced in one batch all mint

## Evidence (ticket 29 batch-11 entry)
- With a non-empty roster, one `apply` batch introducing three names the campaign had never seen was refused whole, with a candidate list shaped by the existing roster. SL-64 was verified for one new name at a time; the batch case still refuses.

## Scope
1. Contract: §11.5.7 addendum: minting is per effect within a batch; each unmatched new name mints (SL-59's line-level rule applies to npc/person batches).
2. `kernel-ts/apply/entities.ts` `personOfEffect` / the batch path: evaluate each effect's candidates independently; tests, mutation-killable: three new names in one batch mint three ledger entries; a batch mixing one established and two new names resolves one and mints two; the b11 replay lands the batch.

## Comments

**2026-09-25, implemented (worker, branch `claude/sl69-20260925`, base `f305074c6`).**

- **The actual cause, found in the batch-11 t17 fixture (campaign `sl29ab11-xuese-2205`, 血色公路), was
  narrower than "personOfEffect doesn't evaluate independently": it already does. SL-64's own fix
  (`{roster: false}`) was verified correct for an *already-established* roster (persons minted on earlier
  turns); what it missed is that `ModuleGraph.addTablePerson` indexes a newly minted person into
  `this.names` -- the same pool `rankedCandidateIds`'s name-overlap/similarity ranking searches -- the
  moment it is established, whether that moment is an earlier turn or an earlier *effect of the batch
  being processed right now*. `{roster: false}` only skipped the roster list `candidates()` appends after
  ranking; it never excluded the ranked pool itself. So a person this table mints from effect 1 of a batch
  is still found by effect 3's own gating check, exactly as a book NPC would be.
- The t17 batch's own three names -- 柜台前的老男人 ("the old man at the counter"), 穿工装的年轻人 ("the
  young man in overalls"), 饭馆柜台后面的女人 ("the woman behind the diner counter") -- proved this
  precisely: `similarity('饭馆柜台后面的女人', '柜台前的老男人')` is exactly 0.5, the ranked pool's own
  clearing threshold, and 柜台前的老男人 was minted two effects earlier in the identical batch. None of
  the four *pre-existing* roster names from turns 7-8 came within 0.26 of that similarity; the refusal was
  specifically about the newly-minted sibling.
- Contract: `docs/kernel-rpc.md` §11.5.7 addendum (new subsection, no renumbering; amends §11.5.7/SL-64).
- `kernel-ts/read/module-graph.ts`: `rankedCandidateIds` now takes the same `{roster?: boolean}` options
  `candidates()` already threads to it, and excludes every id in `this.tableNames` from its search *pool*
  (not only from the appended roster list) when `roster: false`. `personOfEffect`'s own call
  (`kernel-ts/apply/entities.ts`) is unchanged; the exclusion now reaches everywhere that check searches.
  The exact-match path (`graph.npc`/`resolve`) is unaffected and still resolves a repeated name -- this
  batch's own or an earlier turn's -- to the same person before `personOfEffect`'s gating check is ever
  reached, so nothing here risks minting a name twice.

**Tests** (mutation-verified by copy-revert, never `git checkout --`):
- `tests/extension/a-person-this-table-has.test.mjs`:
  - `"three brand-new names in one batch mint three ledger entries, even when two of them are similar
    enough for one to shape the next one's candidates -- the batch-11 t17 shape"` -- the exact three
    names from the batch-11 t17 `apply`, verbatim, mint all three (`not_landed` absent) and land three
    `npc-ledger.json` entries after the turn closes.
  - `"a batch mixing one already-established name with two new ones resolves the established one and
    mints the other two"` -- an already-established name named again in the same batch resolves to the
    same person; the batch's other two new names each mint their own, independent of it and of each
    other.
  - `"the b11 t17 batch replay lands whole"` -- the batch's own three `npc` effects replayed verbatim
    land whole with three receipts and three table persons.
  - Mutation: reverted `rankedCandidateIds` to ignore its `opts` parameter entirely (searching the full
    pool regardless of `roster`, a copy-revert of `kernel-ts/read/module-graph.ts`, restored after). All
    three new tests failed exactly as the batch-11 evidence did (`饭馆柜台后面的女人` refused
    `unknown_entity`); the fifteen pre-existing tests in the same file were unaffected by either the fix
    or the mutation.

**Suites, on leehow-pc** (`~/.claude/skills/leehow-pc-tests/scripts/remote-test.sh`):
```
== ext on leehow-pc @ f305074c643e617ff0f8647bc9585f1d3d45659e: exit=0 wall=169s log=/home/leehow/leehow/code/wt/chatrpgv4-wt-sl69/remote-ext.log
```
(3184/3184.)
```
== loop on leehow-pc @ f305074c643e617ff0f8647bc9585f1d3d45659e: exit=0 wall=44s log=/home/leehow/leehow/code/wt/chatrpgv4-wt-sl69/remote-loop.log
```
(196/196.)
```
== py on leehow-pc @ f305074c643e617ff0f8647bc9585f1d3d45659e: exit=0 wall=181s log=/home/leehow/leehow/code/wt/chatrpgv4-wt-sl69/remote-py.log
```
(1730 passed, 2 skipped.)

**Replay.** "The b11 replay lands the batch" is delivered as a kernel-level replay: the three real `npc`
effects from the recorded batch-11 t17 `apply` call, verbatim (names and `why` text byte-for-byte from
that table's own telemetry), against an in-process kernel fixture. This is not a full live-Keeper/live-Jev
re-run of batch 11 (SL-70 is a pure kernel candidate-pool defect with no Jev or Keeper-model involvement
at all, so there is nothing a live rerun would exercise that this replay does not), but it is worth stating
plainly since other tickets in this series (e.g. SL-64) did run a full `gate-fixture.mjs`/`run.mjs --llm
replay` live-Jev replay for shapes that did involve model/Jev behavior.

**Left undone:** nothing in scope.
