# Two ledgers — tickets

Spec: `docs/specs/two-ledgers.md`. Contract: `docs/kernel-rpc.md` §194. Integration branch
`claude/two-ledgers-20261008` (worktree `~/leehow/code/chatrpgv4-wt-two-ledgers`).

## TL-01 Contract §194 and spec
Status: done (lead)

## TL-02 The truth ledger: the request carries book names
Status: done (claude/two-ledgers-a-20261008)

- `extensions/table/context-runtime.ts`: the request no longer renames untold people's book names (every
  `renameUntold` call site). Handle rows (§176.8, `handle: true`) are still renamed to the table's word wherever they
  stand; `untoldNote` is added only when a handle was renamed. The rename judge (§177.15) is no longer asked about book
  names in the request (it still serves the exit gate through `table.untold_spans`).
- `extensions/kernel/untold-view.ts` `untoldView`: an untold row keeps `name` = the table's word and gains
  `book_name` (the book's display name); `UNTOLD_VIEW_USE` becomes the §194 line (the player has not heard it; you know
  it; prose calls them `name`; `{{name:<name>}}` where the fiction says it). Remove the "you do not have it" wording
  from `untoldNote` and `prompts/keeper.md`'s writing paragraph, and from the narrate `text` field description.
- Tests: update `tests/extension/untold-request.test.mjs`, `tests/extension/untold-names-held.test.mjs` and any other
  test asserting no book name reaches the request; add a real-entry case: a capsule and a tool result carrying an
  untold person's book name reach the Keeper's request unchanged, a handle is still shown as the word, and a delivery
  printing that name is still refused by §177.11 the first time. Mutation-check each.

## TL-03 The player ledger: `player_knows`
Status: ready-for-agent

- Kernel capsule (`kernel-ts/read/capsule.ts`, the section order of §184.2 — a stable section): `player_knows:
  {people: [{word, name? | (untold: true, book_name)}], documents: [{label, turn}]}`. People = book people with a
  `person_labels` entry, a `toldTurn`/`castToldTurn`, or a first-sight/meeting record; documents = handouts delivered
  (the receipts the handout effect writes). Point, don't copy: `known.discovered_clues` and `memory` stay where they are.
- Bound it under the capsule budget (§115): newest first, a count of the rest.
- Tests: kernel-in-process capsule shows a told person by name, an untold one with `book_name`, a delivered handout;
  pytest pin if the capsule schema has one.

## TL-04 A document tells its names
Status: ready-for-agent

- When a delivery (`table.narrate` / `table.ask` / `apply` with `narrate`) carries a handout effect whose document text
  is known to the kernel, every untold cast person whose printed name occurs in that text becomes told at that delivery,
  through the told path `{{name:}}` uses (`person_labels[handle].name`, `toldTurn`, `castToldTurn`). Find places with
  §177.15's `prosePlaces`; a place the host's Jev check clears (`untold_cleared`) tells nobody.
- Where the handout's text lives (graph handout node, §155 handout reading, the source page) is for the implementer to
  find and record in the contract; a handout with no text tells nothing.
- Tests: the real kernel with a fixture handout printing an untold name → told after delivery, sidebar/capsule show the
  name; a place cleared as another word tells nobody; no text → nothing told. Mutation-check.

## TL-05 The epithet lane sees one person at a time
Status: ready-for-agent

- `kernel-ts/cast` (`first.sentence`, §177.2): cut an unread person's entry from their printed name to the start of the
  next printed name of a different cast person on that page, or the end of the paragraph, in the page's reading text
  (§191 transcript `text` when stored, else native). Bump `CAST_VERSION` only if stored rows must be recomputed; else
  recompute at `epithets.job` time.
- `kernel-ts/epithets/index.ts`: a graph person's `looks` = `personDescribed`, else `relationship_to_investigators`;
  never `node.summary`. Instruction: the word is what an investigator sees or is told at first meeting; never a secret,
  a cause, or what the book reveals later.
- Tests: Cold Harvest's page-10 shape (a list of residents without sentence ends): each resident's `looks` holds only
  their own line; a graph person with only a summary gets no summary in `looks`. Mutation-check.

## TL-06 Acceptance TR-F2
Status: blocked on TL-02..TL-05, merge and packaging (lead)
