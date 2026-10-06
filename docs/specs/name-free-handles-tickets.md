# Name-free handles — tickets

Spec: `docs/specs/name-free-handles.md`. Contract: `docs/kernel-rpc.md` §185. The contract is the source of truth; where a
ticket and the contract disagree, the contract wins and the ticket gets a comment.

Integration branch: `claude/name-free-handles-20261006` (lead-owned worktree `chatrpgv4-wt-nfh`), cut from `0.9.7a` at
`89291d97a`. Worker branches are `claude/name-free-handles-20261006-<topic>`, one worktree each. The lead merges in order.

Waves:
- Wave 1, in parallel: NFH-01, NFH-02.
- Wave 2, after NFH-02 is merged: NFH-03, NFH-04.
- Then NFH-05.

---

## NFH-01 — References compare by identity; legacy campaigns undo the rename on a miss

Status: ready-for-agent

Contract: §185.2, §185.3. Branch: `claude/name-free-handles-20261006-identity`.

What to build:
- **Intentions.** Resolve the owner segment through the §87.8 junction, including the table's word. Compare people as nodes.
  Search the ledger by `(owner node, digest)`, parsing both the given reference and the stored refs. Store and show the
  canonical form.
- **Quotes.** Compare the settlement's `with` with the stored `with_id` by resolved person. Fall back to spelling only when
  either side is not a person.
- **The sweep.** Find every other input field that names a person or entity and is compared to stored state by spelling, and
  move it to identity. Find the one place references are resolved, and record both under §185.11. If resolution is spread
  across tools, record the places and stop before writing per-tool copies.
- **Legacy undo on a miss.** Run it only after a miss, using the inverse of `untoldRoster`'s handle rows.

Acceptance:
- A legacy round-trip test through the kernel in process and the installed context runtime (seam of
  `tests/extension/untold-name-path.test.mjs`). The fixture has untold people whose handles begin other handles, and an
  intention on a card. Copy the renamed intention reference, scene handle and clue handle from the Keeper's assembled request
  into tool calls: each resolves to its original, and the intention settles.
- Quote tests: settle by handle, by a new word and by the told name are accepted; another person is refused. Prior art:
  `purchase-settlement.test.mjs`, `purchase-recovery.test.mjs`.
- Each fix has a test that fails when the fix is reverted. Revert by copy, never `git checkout --`. Report the red run.
- `test:ext` green on the test box, compared with the integration branch's own baseline (same failing set or smaller).

Out of scope: anything in §185.4–185.7.

---

## NFH-02 — Scheme, handle map, interim handle, fold, and the kernel side of the lane

Status: ready-for-agent

Contract: §185.1, §185.4, §185.5 (kernel methods and `handles.json`), §185.6, and §185.7's first bullet (no handle rows in
`table.untold` for name-free campaigns). Branch: `claude/name-free-handles-20261006-map`.

What to build:
- `campaign.json.handles`, written by `campaign.create`. It is `name-free` for a reader-built book; legacy otherwise and when
  absent.
- `world.node_handles`, consulted by `ModuleGraph.handle()` in the contract's precedence, and applied before
  `projectSourcePlaces`.
- The interim handle `<kind>-<6 hex of sha256(node_id)>`.
- The names index carrying the mapped handle, interim handle, node id and old slug. The last three are input-only.
- `handles.job` / `handles.submit` with the closed refusals, and `handles.json` in the shared library module directory under
  the library lock, first writer wins.
- `foldNodeHandles` at `campaign.create`, `table.open` and `table.player_input` (§176.1's moments), including the per-kind
  ordinal for a `given_up` node or a handle not free in this campaign.
- No handle rows from `untoldRoster` in name-free campaigns.

Acceptance:
- Kernel tests in the style of `tests/extension/graph-epithets.test.mjs`. They cover:
  - every refusal reason, including a notes rendering under `carries_name`;
  - first-writer-wins;
  - the fold's three outcomes;
  - an interim handle copied before a fold resolving after it;
  - a folded handle surviving a told name, a new word from `apply person`, and a grown cast;
  - a campaign without `handles` read as legacy, and a starter campaign created as legacy;
  - `table.untold` without handle rows in a name-free campaign.
- No change in legacy behaviour: the existing untold tests stay green unmodified, unless a fixture is shown to pin a
  name-free behaviour (say which, and why).
- `test:ext` green on the test box against the baseline.

Out of scope: the lane runner (NFH-03); node-id egress (NFH-04); anything in §185.2–185.3.

---

## NFH-03 — The handle lane

Status: needs-triage (starts after NFH-02 is merged into the integration branch)

Contract: §185.5 (the lane bullets). Branch: `claude/name-free-handles-20261006-lane`.

What to build: `extensions/node-handles/`, shaped like `extensions/npc-epithets/`.
- It runs in setup and at a table: once when the bridge and session are up, and after every committed turn.
- Zero tools, on the fast model (`PI_COC_HANDLES_MODEL`), a few jobs per trigger.
- One retry per refused entry, alone, with its refusal verbatim. Refused again or unanswered: `given_up`.
- One telemetry row per round.
- Mounted in `COC_EXTENSIONS`, emitted by `build:runtime`.

Acceptance:
- Lane tests in the style of `npc-epithets-lane.test.mjs`, with a stubbed subsession: a job written, a refusal retried
  alone, `given_up` after the second refusal and after no answer, and telemetry.
- One end-to-end test with the kernel in process: a name-free campaign, a stubbed lane answer, then the fold, and the
  Keeper's assembled request shows the lane's handles.

---

## NFH-04 — No node id or old slug reaches the Keeper

Status: needs-triage (starts after NFH-02 is merged into the integration branch)

Contract: §185.7. Branch: `claude/name-free-handles-20261006-egress`.

What to build:
- A request-scan test. Use a name-free campaign whose node ids carry cast names. Drive the Keeper-facing surfaces: capsule,
  look, lookup, tool results with receipts, host messages, and lane output folded into the request. Assert the assembled
  request contains no node id, no old slug and no `avoid` form inside any identifier, compared as exact strings the kernel
  holds.
- Then convert each egress the scan finds to `handle()`, recording the list under §185.11. Two candidates are already known:
  the dossier receipt's `npc` and the memory recall reference.

Acceptance:
- The scan is red before the conversions and green after.
- `test:ext` green on the test box.

---

## NFH-05 — Integration, packaging and the real table

Status: ready-for-human (the owner gives the word for merging into the mainline, packaging and the table)

- Merge NFH-01..04 into the integration branch, and run ext, loop and py on the box.
- Report to the owner. On their word: merge into the current `0.x.xa` line, package from its exact head, and play a real
  table.
  - The table is a new campaign on a PDF book (Blood Road, book-4), with a live Keeper, one sentence per turn, per
    Agents.md.
  - It passes when there are no owner or unknown-reference refusals on kernel-written references, no identifier in the
    Keeper's requests carries a cast name, and lane telemetry shows handles written rather than mostly given up.

## Comments
