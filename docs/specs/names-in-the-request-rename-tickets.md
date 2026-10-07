# Names in the request rename — tickets

Spec: `docs/specs/names-in-the-request-rename.md`. Contract: `docs/kernel-rpc.md` §188. The contract is the source of
truth; where a ticket and the contract disagree, the contract wins and the ticket gets a comment.

Integration branch: `claude/names-rename-20261007`, in the lead-owned worktree `chatrpgv4-wt-names`. It was cut from
`0.9.7a` at `c66e3bfb5`, which already includes §185. Worker branches are `claude/names-rename-20261007-<topic>`, one
worktree each. The lead merges.

Waves:
- Wave 1, in parallel: NR-01, NR-02, NR-03, NR-04a, NR-05.
- Wave 2: NR-04b.
- Then NR-06.

---

## NR-01 — Protected spans in the rename and the gate

Status: done — e0648e01c, be0f4e5dc, 7fa06a2d6 (merged)

- `protectedNames` lives in the kernel, as one function: the investigators' registered names, told people's whole names,
  and the table's words for people.
- `table.untold` answers `{people, protected}`.
- The host rename skips any place overlapping a protected occurrence, and so does §177.15's judge.
- The kernel gate skips the same places, using the same function.

Acceptance:
- Fixture: the investigator 「丹尼尔·怀特」; the untold 「丹尼尔·马瑟」, also printed as 「丹」.
- The assembled request keeps the investigator's full name and still renames 「丹尼尔·马瑟」 and a lone 「丹」 elsewhere.
- A delivery naming the investigator is not held; one naming the untold person is.
- Legacy behaves the same.
- Mutation evidence. ext on the box.

## NR-02 — The cast joins its duplicates

Status: done — 2842ffcb6, 729501083 (merged)

- Find why Blood Road's unread cast row `cast-78239617e2` ("Daniel Mather") did not join the graph person
  `red-haired-store-owner-smoker`, and fix the join under §177.1's whole-identity rule.
- A joined row owns no separate roster entry.
- The book data is in the acceptance home (`~/leehow/code/chatrpgv4-nfh-acceptance-home/.coc/modules/book-4`, `cast.json`),
  read-only.

Acceptance:
- A fixture cast with an unread duplicate of a graph person. The roster shows that person with one word, not joined words.
- A real duplicate (two different people sharing a name) still shows both words.
- Mutation evidence. ext and the cast-related py files on the box.

## NR-03 — Undo the rename on a miss: every row, both schemes

Status: done — b483d4885 (merged)

- `renameUndo` rows gain every name→shown pair the roster can produce, built over-inclusively, including joined words.
- The rows are installed in both schemes. Handle rows stay legacy-only.
- The first spelling that resolves to exactly one node wins. Several distinct nodes → refused `ambiguous`, with each
  candidate's own shown word.

Acceptance — a round-trip test for each row kind (whole name, piece, one-character alias, joined word, legacy handle):
- copy from the assembled request into the tool call that uses the string;
- it resolves, or is refused `ambiguous` with candidates;
- no book name appears in the refusal.
- Mutation evidence. ext on the box.

## NR-04a — One junction, batch A

Status: done — da93d6cd8 (merged)

Route these entrances through `resolve` plus §87.8, and compare stored references by identity:
- cash/owed `with` and `subject`;
- `apply item from`;
- `apply object to/from` and `apply ability to` (`objectOwner`);
- `apply damage` subject.

The list and the places are in §185.11 `#### NFH-01` ("The sweep").

Acceptance:
- Per entrance, a test where a table word, a told name and a handle each reach the same person, and a different person
  is refused. Each test fails when its conversion is reverted.
- ext and the related py files on the box.

## NR-04b — One junction, batch B

Status: done — 4a8157708 (merged)

The remaining §188.4 entrances:
- memory and notes (`EntityIndex`);
- chase;
- `resolve action.obligation`;
- Mod dossier and effect target;
- the material gate's pre-pass;
- ruling anchors;
- `lookup kind=module`;
- the say-token resolver;
- the cast and clue-label matchers.

## NR-05 — Measure `say_name`

Status: done — 91309cc3c (merged)

- A read-only script over retained tables:
  - App campaigns in `~/Library/Application Support/Pipi/pipicoc/pi-coc/.coc/campaigns`, read-only;
  - driver runs under `~/leehow/code/*/.coc/playtests` and `~/leehow/code/chatrpgv4-nfh-acceptance-home/playtests`.
- For each turn where the player asked a book person's name, classify the Keeper's answer: copied `say_name` (a
  `{{name:…}}` token, or the resolved book name, in the delivery); wrote another name; or deflected.
- The classification uses the turn records' tool arguments and the delivered text, not prose semantics. Where a case
  needs judgment, list it for the lead rather than guessing.
- Output: the script under `tests/play/`, plus `docs/specs/names-say-name-measurement.md` with counts per table and
  model, and examples.

## NR-06 — Integration and the real table

Status: done — tables nr06-blood-road-2 and -3 passed the pre-registered lines (acceptance home NR06-PREREG.md, NR06B-PREREG.md); merging into the mainline per the owner

- Run ext, py and loop on the box.
- Play a real Blood Road table whose investigator shares a name with a book person. Cover payments, hand-overs and writing
  a note. Pass when:
  - zero `unknown_entity` on the investigator;
  - zero empty turns caused by the rename;
  - no corrupted name in any delivered text or document.
- Then merge into the mainline and package on the owner's word.

## NR-07 — Page readings duplicate people the graph already has

Status: done — implemented as §192 (`reading-duplicates-tickets.md`, DUP-01..04)

On Blood Road the campaign fork's generation 55 (a page reading of pp. 25–26, 2026-10-07 02:05Z) wrote
`npc-daniel-mather` beside the existing `npc-book-4-daniel-mather`: same name, same page, same biography. At generation
60, book-4 has seven cast rows answered by two or more graph nodes: Alissya, Brenner (three nodes), Scott, Sutton,
Mather and Pete Smith. The same reading also duplicated the squatter, 沙漠地痞, and the general store.

NR-02 makes the cast and the roster treat a man's nodes as one individual. The reader and merge that mint a second node
for an existing person are unchanged.

What to decide: where the reading merge must recognise an existing node (cast row identity, `source_refs` page and the
same whole name), and whether existing duplicates are merged in the graph or only grouped at read time.

---

## NR-08 — A shared untold name is never written as joined words

Status: done — 281491ba2 + e441a032f (NR-08b), contract §188.8

Found on table `nr07-blood-road-1`: Blood Road's two 皮特 got their joined roster word written into the player's prose,
in 4 turns. The second-delivery replacement had substituted the joined word.

Fix:
- A shared name is held every time, with each person's own word and `say_name`.
- A joined word in prose, in a say token or in a document is held.
- Re-tests: `nr08-blood-road-1` found that the name could not be said, which NR-08b fixed; `nr08-blood-road-2` passed
  J1–J4.

## Comments
