# One thing, one node — tickets (NR-07)

Survey and decisions: `docs/specs/reading-duplicates-survey.md`. Contract: `docs/kernel-rpc.md` §192. The contract is the
source of truth.

Integration branch: `claude/reading-duplicates-20261007`, in the lead-owned worktree `chatrpgv4-wt-dups`. It was cut from
`2f908729d` (0.9.7a@e238e29c4 + §188). Worker branches are `claude/reading-duplicates-20261007-<topic>`. The test box is
leehow-pc (owner, 2026-10-07).

Waves:
- Wave 1, in parallel: DUP-01, DUP-02.
- Wave 2: DUP-03.
- Then DUP-04.

---

## DUP-01 — The landing check and the reader packet roster

Status: done — fa5db2f3f, 37ccb8891, 9980eae18 (merged)

- **The `duplicate_of_published` check, in two places:**
  - `checkDraft`, against the claim-time view, so the reader's own check and `submit_reading` report it;
  - `module.read.finish` inside the module lock, against the landing generation.
- **The trigger:** same kind plus the symmetric own-name clause under `normalize`; for npcs, also a both-ways cast-row
  join.
- **The fix text:** reuse the published id, or declare `distinct_from`.
- **`distinct_from`:** goes into `required_review`; if unsupported, it is refused as `review_unsupported`.
- **The verdict:** recorded in `module.json` `reading.identity`, so the same pair is never raised again.
- **The packet roster:** a compact roster first in the reader packet (host side).

Acceptance:
- Replay generation 55's landing on a clone of the acceptance home's fork at generation 54. The landing refuses and names
  the five published nodes, and `coc-read-check` agrees. Reverting the check publishes the orphans (mutation by copy).
- Concurrency: two readings on one generation; the second is refused at finish.
- `distinct_from` supported by review is accepted and the verdict is recorded; unsupported, it is refused.
- The packet starts with the roster.
- ext, py and loop on leehow-pc.

## DUP-02 — One survivor map and carry

Status: done — 040336734, ee09af3b9 (merged)

- **The relation:** kernel identity relations `rel-identity-<later>-to-<earlier>`, written as `writeVariants` writes them.
- **One survivor map in `ModuleGraph`:**
  - built from those relations, §152.4's visual survivors and §188.2's cast fold;
  - NR-02's `individuals` becomes a view of it;
  - for non-visual kinds, only kernel-written identity hops count.
- **Every reader in §192.3 reads through survivors.** Each one is recorded under §192.8 with a test.
- **Carry:** aliases, `source_refs` and missing properties go to the survivor through `mergeValue`. A contradiction stays
  on the variant.
- A variant's handle and node id still resolve, to the survivor.

Acceptance: a fixture (and a clone of the generation-60 fork, with identity relations written by the test) shows:
- `resolve` of the store scene gives one node, and both handles resolve;
- `materialReady` is true;
- presence, the brief and `cluesHere` show one store with both copies' clues;
- a reader-authored `variant-of` (a state) does not collapse.

Mutation evidence for each reader. ext, py and loop on leehow-pc.

## DUP-03 — Repairing graphs that already have duplicates

Status: done — db623f2d2…5721ae612, incl. DUP-03b `unsure` never splits (merged)

- **Candidates:** found from the published graph by the 192.1 trigger.
- **Same kind, same own name and overlapping pages:** the kernel writes the identity relation directly, with
  `identity_review {by: "kernel", rule: "same-name-same-page"}`. This is the owner ruling.
- **Every other candidate:** a background identity job, a tool-using Pi reader opening both nodes' pages, answers `same`
  or `different`; the verdict is recorded.
- **When:** when a book loads, for the library and for live campaign forks.

## DUP-04 — Real table and merge

Status: done — table nr07-blood-road-1 passed S1–S7 (acceptance home NR07-PREREG.md)

- A new campaign on the repaired library, with the pre-registered lines of §192.7.
- Then merge into the mainline and package, on the owner's word.

## Comments
