Status: ready-for-human (implemented 2026-09-25)
Stage: SL-68 (P3, character creation; follows SL-66)
Spec: docs/kernel-rpc.md §98 (selection ranges; SL-66's addendum 7)

# SL-68 — A selected name starts at the name: a leading verb or particle in the range is not part of it

## Evidence (ticket 29 batch-11 entry)
- SL-66 stopped the trailing comma, but the stored name became `叫雷·卡特`: the selected range began one grapheme early on the verb 叫 ("called"), which is not punctuation, so the word-boundary trim kept it. The range itself, chosen by the setup lane from the player's sentence, is the fault.

## Scope
1. Contract: §98 addendum: the name is the name the player gave; the setup lane's selection is checked by a per-row Jev question when the range's first or last token is not part of any candidate name form (structural: ask, never a list of verbs), and the card records the trimmed range.
2. `runtime/jev/setup-input-references.ts` / the setup lane: the range check; tests, mutation-killable, with the b11 setup fixture yielding `雷·卡特`; a range that starts on the name is unchanged.

## Comments

**2026-09-25, implemented (worker, branch `claude/sl69-20260925`, base `f305074c6`).**

- Contract: `docs/kernel-rpc.md` §98 addendum 8 (new subsection, no renumbering; amends addendum 7/SL-66).
- `runtime/jev/setup-input-references.ts`: `boundaryTokens` reads a (SL-66-trimmed) range's own first and
  last grapheme unit -- nothing, when the range is one unit wide (nothing left to shrink without emptying
  it). `dropBoundaryTokens` removes whichever unit(s) a decision says to drop and re-runs
  `trimToWordBoundary` once more (dropping a verb can expose a space or comma that stood between it and
  the name). `selected()` calls both, plus an injected `checkBoundary` (`NameBoundaryChecker`) between
  them -- only for a `profile.name` *range* selection (never a whole-field selection or `pending_action`,
  both still T14's byte-exact contract, unamended). Any outcome short of a clear `no` -- `yes`, `unclear`,
  an incomplete result, no checker supplied, or a checker that throws -- keeps the token exactly as
  selected: the fail-safe default, matching every other named-fallback typed check in this codebase.
  `materializeSetupInputs` is now `async` to thread this through (the only production caller,
  `extensions/onboarding/index.ts`'s `bindInputParams`, and the one test file that calls it directly, are
  both updated to `await` it).
- `runtime/jev/setup-name-boundary-domain.ts` (new): the typed family, `setup-name-boundary`, mirroring
  `person-resolution-domain.ts`'s shape exactly -- one `choice` question per boundary in question
  (`yes`/`no`/`unclear`), `rowClears`'s own SL-52 margin deciding a drop, never a hard-coded verb/particle
  list (the structural requirement the ticket names explicitly).
- `extensions/onboarding/index.ts`: `bindInputParams` is now `async`; `checkNameBoundaryFor` wires the
  check exactly as `extensions/kernel/index.ts`'s `resolveScenePerson` wires SL-62's own fan-out
  (`readJevApiKey` gate, `createDecisionAdapter`, `preparationBudget`, a bounded `TaskLease`, a named
  timeout default `PI_COC_NAME_BOUNDARY_TIMEOUT_MS`, 2 500 ms). An unconfigured Jev key, an expired
  budget, or any other failure returns the same "keep every token" default `setup-input-references.ts`
  already applies on its own -- setup is never blocked by this check.
- Found and fixed in passing: the new `createDecisionAdapter` call site tripped
  `tests/extension/control-flow-inventory.test.mjs` (contract SL-00's closed inventory of every call that
  can drive a model run); added the corresponding row to
  `docs/specs/pi-native-single-loop-tickets/inventory-SL-00.json` and `.md`
  (`extensions/onboarding/index.ts#checkNameBoundaryFor`, kind `jev-adapter`).
- Found and fixed in passing (twice): `tests/extension/system-language.test.mjs` (contract §16.1, no CJK
  in `extensions`/`runtime`/…) caught two doc-comment examples that spelled out the literal Chinese
  characters from the b11 fixture; reworded both to describe the shape in English only ("a leading verb
  meaning 'called'") without changing what they document.

**Tests** (mutation-verified by copy-revert, never `git checkout --`):
- `tests/extension/jev-setup-input-references.test.mjs`, `"§98 addendum 8 (SL-68) a boundary token the
  punctuation trim keeps is checked before it stands as part of the name"`: the b11 setup turn-4 fixture
  (`名字叫雷·卡特`, a range starting on the leading verb) yields `雷·卡特` when an injected fake checker
  answers the leading row `no`; the identical range is unchanged when the checker answers `yes`, is
  omitted entirely (the default), or throws (the fail-safe); a range one unit wide asks no question at all
  (a checker that would throw if called is never invoked); `pending_action` and a whole-field
  `profile.name` selection are never checked even with a checker supplied.
  - Mutation: `selected()`'s call to `checkBoundary` gated behind `if(false && ...)` (copy-revert). The new
    test failed exactly as expected (the leading verb was never dropped); the pre-existing SL-66 test in
    the same file was unaffected.
- `tests/extension/jev-name-boundary-domain.test.mjs` (new, mirroring
  `jev-person-resolution-domain.test.mjs`'s own shape): the batch asks exactly one row per boundary
  actually passed in, never a row for one that was not; `interpretNameBoundary`'s SL-52-margin fail-safe
  default (only a clean `no` drops a token; `unclear`, a below-margin `no`, an incomplete result, or a
  boundary never asked about all keep it); `checkNameBoundary`'s named fallbacks (nothing to ask about, a
  foreign lease, an incomplete result, a throwing port).
  - Mutation: `interpretNameBoundary`'s row check flipped from `answer.choice === NO` to
    `answer.choice === YES` (copy-revert of `runtime/jev/setup-name-boundary-domain.ts`, restored after).
    Both of the file's behavioral tests failed; the batch-shape test (which asserts no drop decisions) was
    unaffected.

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

**Left undone: no live Jev/live-Keeper replay of the b11 setup fixture.** The ticket's own evidence names
a *setup-lane* fixture (turn 4's sentence), and this implementation is verified with an injected fake
`NameBoundaryChecker` (unit + kernel-level, no real Jev call), exactly the discipline
`jev-person-resolution-domain.test.mjs` already uses for SL-62's sibling check. A live replay through
`converse`/`create-investigator` with a real Jev key was not attempted in this pass: it would need a live
Jev credential (available only via the vault, `.pi/coc-agent/`, gitignored) and a live setup session, and
the ticket's own scope line asks for "tests, mutation-killable" rather than a live gate. If a live
confirmation that Jev's real answer for this exact sentence says "no" on the leading verb is wanted, that
is the next step and is not done here.
