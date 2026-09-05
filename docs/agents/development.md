# Development and integration

For authorized implementation/integration only. Existing scope and worktree ownership gates remain in force.

Paths and commands below are relative to the repository root unless absolute. Read only this route when the task requires it; it does not expand authorization.

## Parallel Lines And The Operation Surface

Three lines develop against this repository at once — rules, director, text —
and the operation surface is the seam all three touch. Two failure shapes come
out of that seam. Both are mechanical; neither is a judgement call.

**A conflict in a generated projection.** `references/mcp-operation-contracts.json`
and `pi/lib/operation-policy.generated.ts` are derived from the canonical
operation registry and committed. Any two lines that add an operation conflict
on `operation_count` and `content_sha256`, every time. Both sides are equally
wrong and equally right, because both are output. Resolve it the same way
every time:

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_mcp_contract_archive.py build
```

After regenerating from the reviewed canonical registry, inspect both generated files. Stage them only within the authorized integration/commit scope; this recipe does not authorize discarding either lane’s source changes. `tests/test_generated_projections.py` fails if
you forget the second command, so a hand-resolved projection cannot reach a
table.

**A frozen count in someone else's suite.** Never assert the size of the
operation surface against a literal. Four separate suites had done it, at three
different values, and one deliberate addition turned them red hours apart in
suites their authors were not editing — each looking like an unrelated
regression. Assert what the test is about instead: self-consistency
(`archive["operation_count"] == len(archive["operations"])`) or the membership
the test actually needs. `test_no_test_hardcodes_the_operation_count` keeps the
constant from coming back.

**Sync direction matters more than either.** Merge the integration branch into
your branch often, rather than saving it for the end. Five small merges during
one session were all trivial; the one time the branch was left to drift 39
commits, the generated projection conflicted. Layers are how the code is
organized, not how branches should be: a long-lived branch per layer diverges
by construction.

## Feature Integration And Repair Discipline

### Feature Integration Is Part Of Implementation

A feature is implemented only when:

1. its user/KP problem and canonical consumer are named;
2. normal play exposes it through canonical skills, registry, or typed gateway;
3. the KP discovers its purpose/applicability without hidden code or a harness;
4. its result reaches KP judgment, canonical state, or visible output;
5. real plugin-native play exercises the normal path; and
6. visible effects and authoritative changes survive in normal evidence.

Otherwise label it `experimental` or `unintegrated`; do not advertise support,
completion, parity, or release readiness. Component tests prove component
contracts, never discoverability or integration.

### No Speculative Production Features

- Before coding, inspect canonical skills, registry, runtime, scripts, tests,
  docs, plans, and history. State whether work reuses, repairs, reconnects,
  composes, extends, or replaces what exists.
- Prefer completing an existing path. A replacement requires an explicit reason
  the current path cannot serve and a retirement plan for the duplicate.
- Name value, caller, trigger, I/O, integration, consumer, evidence, and
  real-plugin validation before production code. Unknowns stay in design.
- Registry exposure, skill guidance, consumer integration, and evidence change
  together. Do not ship test-only or host-parallel functionality.

### Thin Code, No Paper Loops, And Actual-Play-First Repair

- Repository code owns deterministic mechanics, transactions, task boundaries,
  schemas, provenance, and cache/delivery bookkeeping. Semantic understanding,
  direction, NPC craft, clue interpretation, pacing, and table prose stay with
  the live KP.
- Every new helper, state field, receipt, cursor, phase, queue, or adapter names
  its canonical caller/consumer, observed failure, why an existing path cannot
  carry it, and the real play that will exercise it. Otherwise simplify.
- Prompts, plans, schemas, and reviews are preparation, not product progress.
  After one design pass and one adversarial review, unresolved complexity means
  shrink or implement the smallest vertical slice. Two consecutive paper-only
  cycles require stop-and-simplify; a third needs explicit current-turn user
  authorization.
- Default loop: **observe in real play → identify the smallest systemic failure
  → implement the thin fix → run proportional deterministic checks → replay the
  same normal plugin path**.
- Return to window-equivalent play as soon as the narrow safety checks pass. If
  repair expands, state the blocker, added mechanism, complexity cost, and why
  play cannot resume; never silently authorize a broad architecture program.

### System Gap Before Instance Patch (修/补/Fix 先看全局)

For a fix, patch, fill, deepen, or “补” request:

1. Name the product/runtime failure class.
2. Inspect the existing skill, registry, progressive/module, state, test, and
   plan paths for that class.
3. Repair or extend the systemic path so the next similar case works.
4. Add one-off instance content only when explicitly requested, or as a labeled
   thin sample after the system path exists.

Do not treat one thin location, NPC, clue, or save as permission to hand-author
only that instance. Clarify only when system repair versus instance content is
genuinely ambiguous.
