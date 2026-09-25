Status: ready-for-human (implemented 2026-09-25)
Stage: SL-64 (P1, kernel entities; predates batch 9)
Spec: docs/kernel-rpc.md §87 (table persons), §11.5.4/§11.5.6 (SL-51/SL-62 name resolution), the `unknown_entity` refusal

# SL-64 — A campaign mints as many table persons as the Keeper introduces; existing table persons are resolution candidates, never a bar to minting

## Evidence (ticket 29 batch-9 entry, `claude/sl29a-b9-20260925`@017aaa4a5; campaign `sl29ab9-xuese-1922`)
- Once one Keeper-introduced (table) person exists, `kernel-ts/read/module-graph.ts` `candidates()` appends every existing table person to the candidate list of any npc-kind name, and `kernel-ts/apply/entities.ts` `personOfEffect` then refuses `unknown_entity` instead of minting a second table person. Reproduced five times on one table (t11, t14, t15, t17, t18); `npc-ledger.json` holds exactly one table person here and in the batch-8 campaign: the defect predates batch 9 and only surfaced because this Keeper names more people.

## Ruling (owner, 2026-09-25)
The table persons a campaign already holds are candidates for resolving a name (SL-62's question), never a reason to refuse a new one: when the name clears no candidate, a new table person is minted (§87) exactly as the first one was.

## Scope
1. Contract: §87 addendum (minting is not limited by the count of existing table persons; existing ones are SL-62 candidates only).
2. `kernel-ts/read/module-graph.ts` `candidates()` / `kernel-ts/apply/entities.ts` `personOfEffect`: an unmatched npc-kind name with existing table persons mints; a name that clears an existing candidate (exact, or SL-62's Jev question on the host) resolves to it.
3. Tests, mutation-killable: two distinct Keeper-introduced persons in one campaign both mint with two ledger entries; the same person named twice resolves to one; the batch-9 t11 replay mints.

## Comments

**2026-09-25, implemented (worker, branch `claude/sl64-20260925`, base `43e9af08f`, commit `8bf96d62`).**

- Contract: `docs/kernel-rpc.md` §11.5.7 (new subsection, no renumbering, amends §87.4).
- `kernel-ts/read/module-graph.ts`: `candidates()`'s ranking (name overlap, then similarity) split into
  a private `rankedCandidateIds`; `candidates()` gains `{roster?: boolean}` (default `true`, so every
  existing caller -- `resolve()`'s own `unknown_entity` refusal, `recall`'s -- is unaffected and still
  sees this table's roster in `details.candidates`).
- `kernel-ts/apply/entities.ts`: `personOfEffect`'s gating check alone calls
  `graph.candidates(name, ['npc'], 6, {roster: false})` -- whether to refuse now asks only the
  book/graph's own ranking, never this table's own established people. Minting (`establishPerson`,
  `world.table_people[]`), the exact-match path (`graph.npc(name)`, tried first) and §11.5.6/SL-62's
  host-side Jev resolution (which never consulted `candidates()`) are all unchanged.
- Found and fixed in passing: `tests/extension/passage-person.test.mjs`'s
  `"SL-59: a batch with one unnamed person lands two and refuses one line with unknown_entity"` was
  unwittingly asserting this exact bug -- its third name (`Zeb Okonkwo-Marchetti`, chosen specifically
  to have *no* near-name book candidate) only refused because the batch's first two effects had already
  established two table people earlier in the same batch, filling the roster `candidates()` used to
  fold in unconditionally. Fixed to name a genuine near-name book candidate (`Steven Knot`, one letter
  short of the-haunting's authored `Steven Knott`), which still refuses under the fix and now tests what
  SL-59 (§11.5.5) actually documents: a name the graph's own ranking has something to say about, refused
  isolable beside two landings.

**Tests** (mutation-verified by copy-revert, never `git checkout --`):
- `tests/extension/a-person-this-table-has.test.mjs`:
  - `"a batch placing two distinct people this table meets mints them both, the batch-9 shape"` -- the
    exact t11 batch shape (two `npc` + two `person` effects, one name already established mid-batch
    beside a second, unrelated one) lands whole (`not_landed` absent) and both mint their own table
    person.
  - `"two people this table meets each land their own npc-ledger entry once the turn closes"` -- after
    `table.narrate` closes the turn, `npc-ledger.json` holds two `npc-table-*` entries (filtered against
    the fixture's own seeded authored NPC, which already has one from the setup turn).
  - Mutation: reverted `personOfEffect`'s gating call from `graph.candidates(name, ['npc'], 6,
    {roster: false})` back to `graph.candidates(name, ['npc'])` (copy-revert of
    `kernel-ts/apply/entities.ts`, restored after). Both new tests failed exactly as the batch-9 evidence
    did: the batch refused `unknown_entity` on 霍默 with `details.candidates: ["卡尔"]`, and the ledger
    held one table-person entry, not two. The existing `"the same person established twice is one
    person"` test (unamended, satisfies the ticket's second bullet) continued to pass under both the fix
    and the mutation, since it never depends on this gate.
  - `tests/extension/passage-person.test.mjs`'s renamed-name fix, run against the same
    mutated/restored pair, showed the same shape: mutated, its batch's third line minted instead of
    refusing (`not_landed` empty, three table people); restored, it refuses one line as asserted.

**Suites, on leehow-pc** (`~/.claude/skills/leehow-pc-tests/scripts/remote-test.sh`, worker commit
`8bf96d62`):
```
== ext on leehow-pc @ 43e9af08fb05816d3a901fddd8905c6655042810: exit=0 wall=168s log=/home/leehow/leehow/code/wt/chatrpgv4-wt-sl64/remote-ext.log
```
(3162/3162; a first run at the pre-fix-passage-person commit showed one failure, the SL-59 test above,
diagnosed and fixed as described, then rerun clean.)
```
== loop on leehow-pc @ 43e9af08fb05816d3a901fddd8905c6655042810: exit=0 wall=43s log=/home/leehow/leehow/code/wt/chatrpgv4-wt-sl64/remote-loop.log
```
(196/196.)
```
== py on leehow-pc @ 43e9af08fb05816d3a901fddd8905c6655042810: exit=0 wall=177s log=/home/leehow/leehow/code/wt/chatrpgv4-wt-sl64/remote-py.log
```
(1730 passed, 2 skipped.)

**Replay finding (batch-9 t11, recorded Keeper, live Jev, `--reader none`).** Fixture built from the
live gate's own campaign with `experiments/single-loop-routing/gate-fixture.mjs --home
<sl29a-b9 playtest home> --campaign sl29ab9-xuese-1922 --playtest <sl29ab9-xuese-1922-20260925T192559Z>
--turns 11 --name sl64-t11 --fork` (`--fork` because this is a PDF-imported module with a private
`module-campaigns` reading fork), then replayed with `node experiments/single-loop-routing/run.mjs
--fixture sl64-t11-t11 --runs 1 --llm replay --reader none --keep-workspace`. One run: `status:
"delivered"`, `reason: "delivery_accepted"`, `executed: ["M:look","M:lookup","M:lookup","M:lookup",
"M:apply","M:narrate"]` -- the `apply` line that refused live (`not_landed` on 霍默) now lands whole,
`match` reporting both `"npc here: yes(model)"` rows and both `"person 卡尔"`/`"person 霍默"` rows
matched. The kept workspace's `world.json` confirms `table_people` holds both 卡尔 and 霍默 (turn 11,
their recorded `why`), `npc_presence` has both in `welcome-to-abattoir`, and `npc-ledger.json` holds both
`npc-table-*` handles. Kept workspace (per `--keep-workspace`, the fork this ticket asks to keep):
`/var/folders/wn/8ly53x4n6sq3jkvkptvtkrsm0000gn/T/single-loop-routing-WFpDnc` on this Mac -- not synced
anywhere, not under git (the module is a real imported PDF book; its `.coc/modules/book-1` and this
run's `world.json`/`npc-ledger.json` are book-derived data and stay off this repository, per the standing
rule against committing book text). The fixture's own `workspace.tar.gz` and the run's `results/`
directory were generated in this worktree during the investigation and deleted afterward for the same
reason (a real imported PDF's module content, ~320 MB); the command above reproduces them.

**Left undone:** nothing in scope. The `--reader none` flag this ticket allowed meant no reading-service
material was fetched during the replay turn (`reads: ["welcome-to-abattoir:prepared/3m/5j"]` shows the
scene's material was already prepared from the original live run, carried in the fixture's workspace),
so this replay did not exercise a fresh read; that was never in scope here (SL-64 is about minting, not
reading).
