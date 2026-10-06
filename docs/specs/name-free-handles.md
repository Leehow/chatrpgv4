# Name-free handles: a reference the Keeper copies is never rewritten (2026-10-06)

Status: ready-for-agent — decided 2026-10-06 (owner rulings quoted below); contract §185 written 2026-10-06, tickets in `name-free-handles-tickets.md`. Contract first: the section is written before any
code, at the next free number (§185 is free on `0.9.7a` at the time of writing), and amends §176.5, §103.5, §142 and §58.9.

Owner, 2026-10-06, after a scan of the App's sessions from 10-01 to 10-06 (28 sessions, 84 tool failures, 16 of them in
names, titles, NPCs and references) and a review of what the scan called "internal references broken by the title rename":
- 「为什么不直接根治？」
- 「按你说的，(a)，旧战役不动，写 spec 吧」 — (a) was opaque numbering for the new handles; old campaigns stay as they are.
- 「等一下，编号是否可以用语义编号，毕竟如果是数字的话llm写的时候很容易出错」
- 「同意，写 spec 吧」 — on semantic handles written by a lane, checked against the book's own cast, one narrow retry, and a
  per-node fallback to a kind-and-ordinal handle.

Related contract: §2 (the only identifier a model is given is a name), §31 (writer, reader, actor), §58.9 (purchases and
quotations), §87.8 (one junction for a person's name), §103.5 and §103.8 (untold names), §142 (intentions), §176.3 and §176.5
(the epithet lane; the Keeper's view hides the handle), §177 (the book's cast), §177.15 (name places judged by Jev), §184.1
and §184.5 (the library follows the leading fork).

## Problem Statement

A book person's handle is their name as a slug: `book-4-robert-taylor`. The reader mints node ids from the book's words, and
a handle is the node id without its kind prefix. So the handle leaks the name, and §176.5 hid it the only way the request
allowed: the untold roster carries a row for each untold person's handle and node id, and the request-wide rename replaces
that string with the person's shown word wherever it stands. On table 21 (`docs/specs/graph-epithets.md`) the Keeper had
transliterated `book-4-lars-williams` into the prose.

The rename is a text substitution. It does not know which strings are identifiers, so it also rewrites identifiers the Keeper
copies back into tool calls:

| what the Keeper is shown | after the rename | what happens when the Keeper copies it |
| --- | --- | --- |
| `intent:book-4-robert-taylor:<digest>` on a card | `intent:留铅笔胡子的酒吧旅馆老板:<digest>` | The owner segment is not the handle, so `apply npc` refuses: the intention "belongs to" someone else. Past that, the ledger is searched by the whole string and finds nothing. |
| scene `book-4-dr-brenner-home` | `<Brenner's word>-home` | Resolves to nothing. A hyphen counts as a word boundary, so a person's handle is matched inside every handle it begins. |
| clue `book-4-pete-east-windmill-firelight` | `<Pete's word>-east-windmill-firelight` | Same. |

This was reproduced with the request rename itself, on a roster shaped like the one `table.untold` builds. In book-4 as the
App holds it (generation 53), 9 handles begin with a person's handle: two scenes, a clue, an organization, an object, an asset,
two rules and another person.

The rename also does not hide the leak. It replaces only the person's own whole handle, node id and book names. Other
entities' ids carry the same names: `clue-book-4-john-hides-book-under-counter`,
`clue-book-4-slaughterhouse-butcher-paper-taylor`, `clue-book-4-vincent-car-bloodstains`. A rough token scan of the same
graph puts about 100 of its 376 non-person ids in this class; the scan has a few false matches, such as `house`. These reach
the Keeper unchanged, in Latin letters, beside a Chinese table that calls those people by epithets.

Two comparisons fail for a related reason: they compare spelling, not identity.
- A cash quote stores the counterparty as the Keeper wrote it at quote time (`with`), beside the resolved handle (`with_id`).
  Settling compares the new `with` to the stored spelling. Name the same person another way and settlement is refused,
  whether by the handle, by a new word after `apply person`, or by the name once it has been said.
- The intention owner check above compares the owner segment as a string to the handle.

From the player's side: turns stall on refusals the Keeper cannot fix, because the reference it copied was correct when the
kernel wrote it. Meanwhile, names the player was never told sit in identifiers the Keeper reads every turn.

## Solution

Identity and display are separated at the source. The untold rename stops having to touch identifiers.

1. **New campaigns on reader-built books get name-free handles.**
   - Every node of a graph the PDF reader built gets a Keeper-facing handle that is not derived from the book's names: a
     short English kebab-case phrase written by a handle lane, such as `bar-owner-pencil-mustache` or
     `book-hidden-under-gift-shop-counter`.
   - The kernel refuses any proposed handle that carries a piece of any name in the book's cast, in any of the cast's forms.
     It checks with the same piece-and-`occurs` test the epithet check uses, so it compares strings the kernel holds and
     classifies nothing.
   - A refused node is asked about once more, alone, with the kernel's refusal. A node still refused, or one the lane could
     not answer, gets `<kind>-<ordinal>`.
   - A handle enters the campaign at a safe moment and never changes afterwards. A node shown before then carries a
     deterministic interim handle, which stays resolvable.
2. **The rename touches only names.** In these campaigns the untold roster has no handle or node-id rows. No Keeper-facing
   surface carries a book node's node id or its old slug; the slug stays an input-only key the kernel still resolves.
3. **References are compared by identity, in every campaign.**
   - An intention reference's owner segment is resolved like any person reference and compared as a node. The reference is
     rebuilt in its canonical form before the ledger is searched.
   - A quote's counterparty is compared by resolved identity, not spelling.
   - A sweep finds every other input field that is compared to stored state by spelling.
4. **Old campaigns and authored packs keep today's handles.** Two kinds of campaign keep their handles and §176.5's handle
   rows: campaigns created before this lands, and campaigns on authored starter packs. In them, a reference that does not
   resolve as written is retried once with the rename undone, using the same roster the host renamed with. Point 3 applies to
   them too.

## User Stories

1. As the Keeper, I want an intention reference I copy from a card to settle that intention, so that a person's plan gets its result instead of a refusal I cannot repair.
2. As the Keeper, I want a scene or clue handle I copy from a tool result to resolve to that scene or clue, so that moving the party or awarding a clue is not refused for a spelling the kernel itself showed me.
3. As the Keeper, I want handles that say what a thing is (`gift-shop-counter-book`), so that I pick the right one and copy it without the digit slips numbered handles invite.
4. As the Keeper, I want no handle to carry a person's name, so that I cannot transliterate a name the investigator has not heard into the prose.
5. As the Keeper, I want the same handle for a thing from the first turn to the last, so that a handle I wrote earlier, which my history and the ledger both carry, still names it.
6. As the Keeper, I want to name a quote's counterparty by any word that names them — their handle, this table's word, a new word, or their name once said — so that settling a quote is not refused over spelling.
7. As the Keeper, I want a refusal that names a reference to mean the reference is wrong, not that a host layer rewrote it, so that I can trust and act on refusals.
8. As the player, I want my turn not to stall on a repeated refusal over a reference that was right, so that play continues.
9. As the player, I want people whose names I have not learned to stay unnamed in the prose, so that learning a name remains something that happens in the fiction.
10. As the player of a campaign started before this change, I want it to keep working as it did, with the reference failures fixed, so that my existing game is not disrupted.
11. As the owner, I want the leak closed where it starts, in identifiers minted from the book, so that a new kind of reference does not need another rename rule.
12. As the owner, I want the check that keeps names out of handles to compare against the book's own cast, never a word list, so that the project's rule against hardcoded semantics holds.
13. As the owner, I want a node whose handle could not be written to fall back on its own, so that one bad lane answer never blocks a book or a turn.
14. As the owner, I want handles minted once per book and shared by every campaign on it, so that a new campaign does not pay the lane again (the §184 traffic ruling).
15. As the owner, I want telemetry that says how many handles each round accepted, refused and fell back, so that I can see the lane working on a real table.
16. As a lane, I want each node's kind, name, summary and the names I must not use, so that I can write a descriptive handle that passes the first time.
17. As a lane, I want the kernel's refusals verbatim when a handle is refused, so that the one retry fixes the actual problem.
18. As the kernel, I want the handle map to be the first source `handle()` consults after the table's own names, so that every existing consumer reads the new handle without being changed.
19. As the kernel, I want a book node's old slug still to resolve as input, so that internal and host references written with it keep working.
20. As the request rename, I want no identifier rows in new campaigns, so that I only ever replace names in text.
21. As a kernel maintainer, I want a single place where reference fields are resolved and canonicalized, so that the next composite reference does not need its own fix.
22. As a kernel maintainer, I want a list of the input fields that used to compare spelling, written into the contract section, so that a reviewer can check none is missed.
23. As a test author, I want a round-trip test (kernel output → the Keeper's request as assembled → the copied reference back into a tool call), so that any reference the request can break is caught at the seam where it breaks.
24. As a test author, I want a test that scans the Keeper's assembled request in a new campaign for every node id and old slug the kernel holds, so that a new egress of a node id is caught wherever it comes from.
25. As a pack author, I want authored starter packs to keep their authored handles, so that byte-frozen packs and the tests built on them stay valid.
26. As a worker, I want the old/new handle scheme to be fixed per campaign at creation, so that one campaign never mixes the two.
27. As the reader pipeline, I want handle minting to be a step after my output and not a change to how I mint node ids, so that existing books need no re-read.
28. As the epithet lane, I want handles and epithets to stay separate, so that the word the table calls someone can change in the fiction while their handle does not.

## Implementation Decisions

### Scope and scheme
- Two handle schemes, fixed per campaign when the campaign is created and recorded in the campaign:
  - **name-free**: new campaigns whose module graph was built by the PDF reader (the library's books).
  - **legacy**: every campaign created before this lands, and every campaign on an authored starter pack.
- A campaign never moves between schemes. Old campaigns get no backfill. Authored starter handles are authored content;
  their packs are byte-frozen per version, and about 980 test references depend on them.

### The handle map (writer and reader)
- A name-free campaign has a map from node id to handle. `ModuleGraph.handle()` consults it before the book-derived
  fallbacks: the stripped node id, and a scene's `scene_id`. Names the table itself gave keep their precedence: table
  entities, table people, table creatures and adaptation names. Every existing consumer of `handle()` reads the new handle
  unchanged.
- Source place projection is not a table name. It captures the location's handle at projection time (`sourcePlaceNames`),
  so the map must be in place before that projection runs. A location projected into a scene then keeps the name-free
  handle the map gave the location.
- A node's old slug and node id stay in its name keys, so the kernel still resolves them as input. They are never emitted.
- Two layers (contract §185.4–185.6):
  - The book's `handles.json` in the shared library holds what the lane wrote; the first writer wins, and every campaign on
    the book reuses it.
  - The campaign's `world.node_handles` is the map every reader uses. Entries enter it only at a fold and never change.
- **Revised while writing the contract (2026-10-06).** "Minted before the node can be shown" cannot be guaranteed. Until its
  first private write, a campaign reads the shared library (§22.6), so nodes another campaign's reading lands reach it with
  no write of its own. So:
  - A node not yet folded shows a deterministic interim handle, `<kind>-<first six hex of sha256(node_id)>`. It needs no
    write and stays resolvable forever.
  - The fold runs at §176.1's two safe moments, `table.open` and `table.player_input`, and once at `campaign.create`. It takes
    the book's handle; or `<kind>-<n>` for a node the lane gave up on; or nothing yet, keeping the interim handle until the
    lane answers.

### The handle lane
- The lane is shaped like the epithet lane (§176.3): `handles.job` lists the nodes still without a handle, in parts, and
  `handles.submit` checks each proposed handle on its own and keeps the accepted ones.
- **Lane input**, per node: kind, the node's name and summary as the graph holds them, and the cast forms it must not use.
  It never sees the node id or the old slug.
- **Single completion** (Agents.md's two criteria). The lane runs as a zero-tool subsession on the fast model:
  - The output is a short closed structure: one handle per node.
  - It sits on the path between a landed reading and the Keeper seeing its nodes.
  - Same shape as the epithet lane, which the owner approved on 2026-10-04.
- **Refusals** are a closed set, each with a reason code:
  - `shape`: not lowercase ASCII kebab-case, or over the contract's length limit.
  - `carries_name`: carries a piece of any cast name in any form (book, play and notes renderings), by the epithet check's
    `occurs`.
  - `taken`: its normalized form equals the handle or any name key of another node in the graph.
- **Retry and fallback.** A refused node gets one more ask with its refusal verbatim, alone. Refused again, or not answered
  because the lane is unavailable, late or failed, it gets `<kind>-<ordinal>`, unique in the graph. Such a node is not asked
  again.
- **Telemetry**: one row per round with accepted, refused-by-reason and fallback counts (§31's third end).

### What the Keeper sees (name-free campaigns)
- `table.untold` emits no handle or node-id rows. The request rename replaces names only.
- No Keeper-facing surface emits a book node's node id or old slug. That covers the capsule, tool results, receipts in
  mechanics, host messages and lane output folded into the request. The sweep converts each such egress to the handle.
  Two candidates seen so far, not yet confirmed as reaching the Keeper:
  - the dossier receipt's `npc`;
  - the memory recall reference built from a node id.

  The request scan in Testing Decisions is what establishes the full list.
- A person's handle and their epithet are separate. The epithet is still the shown word and may change in the fiction; the
  handle never changes. `say_name` keeps its form.

### Identity comparison (every campaign)
- **Intentions.** An intention reference's owner segment is resolved through the same junction as any person reference
  (§87.8, including the table's word). The owner check compares nodes. The reference is rebuilt as
  `intent:<handle>:<digest>` before the ledger is searched. The ledger format does not change.
- **Quotes.** A quote's `with` at settlement is resolved to a person and compared to the stored `with_id`. Only when neither
  side resolves to a person is the stored spelling compared, as today. A different person is still refused.
- **The sweep.** Every input field that names a person or entity and is compared to stored state by spelling becomes an
  identity comparison. The list goes in the contract section. Comparison happens at one place where references are resolved,
  not per tool; if the implementer finds resolution spread across tools, they report it before writing per-tool copies.

### Legacy campaigns only: undo the rename on a miss
- A reference that does not resolve as written is retried once with the rename undone: each handle row's shown word is
  replaced by its handle, using the roster the host renamed with. Each handle row belongs to one person, and shown words are
  unique (§176.3's `taken`), so the inverse is exact.
- The retry runs only on a miss, never first. A reference that resolves as written, by a display name for example, is never
  rewritten.
- This covers composite references (an intention's owner segment) and handles that begin with a person's handle. It is pure
  string data from the roster; nothing is classified.

### Contract
- One new section, written first. It amends:
  - §176.5 (handle rows exist only in legacy campaigns);
  - §103.5 (the rename touches names only in name-free campaigns);
  - §142 (owner resolution and the canonical intention reference);
  - §58.9 (quote counterparty by identity).
- It states the §31 triple for the handle map:
  - writer: `handles.submit` and the fallback;
  - reader: `handle()`, and through it every Keeper-facing surface;
  - actor: the Keeper's tool calls, counted by refusal codes.

## Testing Decisions

- **What a good test is here.** It drives the real path and checks behaviour, not implementation:
  - the kernel in process, with the context hooks as installed;
  - the Keeper's request as assembled, not a hand-built dictionary.

  It asserts reason codes and structure, never message text. Every product fix comes with a test that fails when that fix is
  reverted (mutation check), and the revert is done by copy, not `git checkout --`.
- **The seam: one.** The kernel in process plus the installed context runtime, as `tests/extension/untold-name-path.test.mjs`
  does. All behaviour below is observable there:
  - **Round trip, legacy campaign.** A campaign with untold people whose handles begin other handles, and an intention on a
    card. Take the Keeper's assembled request, copy the renamed intention reference, scene handle and clue handle into tool
    calls, and assert each resolves to the original entity and the intention settles. Today all three fail.
  - **Name-free campaign.** Handles submitted through `handles.submit` (as `graph-epithets.test.mjs` submits epithets).
    Assert:
    - the assembled request carries no node id, no old slug and no cast name piece in any identifier;
    - `table.untold` has no handle rows;
    - every reference in the request resolves when copied back;
    - handles do not change after a name is told, after `apply person` gives a new word, or after the cast grows.
  - **Lane checks.** Each refusal reason (`shape`, `carries_name` including a notes rendering, `taken`). The retry carries
    the refusal verbatim. A node refused twice and a node the lane never answered each get `<kind>-<ordinal>` and are not
    asked again. Lane runner tests follow `npc-epithets-lane.test.mjs`, with a stubbed subsession.
  - **Quotes.** Register with one word, then settle by the handle, by a new word and by the told name: each is accepted.
    Settle naming another person: refused. Prior art: `purchase-settlement.test.mjs`, `purchase-recovery.test.mjs`.
  - **Scheme fixed.** A campaign created before the change keeps slug handles and roster handle rows. A starter campaign is
    legacy. A campaign never changes scheme.
- **Existing tests.** Five extension test files hardcode reader-style handles (`book-N-…`): first-sight lane, untold view,
  epithet lane, untold name path, name spans. Read each before changing it: a fixture that pins a slug is a test of legacy
  behaviour or a stale fixture, and which one decides the edit. Authored starter tests are untouched by design.
- **Where to run.** `test:ext`, the loop suites and pytest run on the LAN test box (amax first), not the Mac. Single files only
  on the Mac.
- **Acceptance.** A real table on the packaged App: a new campaign on a PDF book (Blood Road, book-4), live Keeper, one
  sentence per turn, per Agents.md's method. It passes when:
  - there are no owner or unknown-reference refusals on references the kernel wrote;
  - no identifier in the Keeper's requests carries a cast name;
  - lane telemetry shows handles accepted, not mostly fallbacks.

## Out of Scope

- The Chinese-substring problem in prose ("达拉斯" containing a nickname) and the direction of §177.15's fallback when Jev is
  down. It concerns names in text, not identifiers.
- Migrating old campaigns to name-free handles.
- Renaming handles in authored starter packs. That is an authoring change with a version bump per pack, and its own spec if
  wanted.
- Changing how the reader mints node ids, or re-reading any book.
- Names inside display names (a clue named 「约翰往柜台下藏书」). The existing name rename already covers them; unchanged.
- Any change to what the player sees.

## Further Notes

- **Known residual: a cast that grows after a handle is minted.** When the cast is partial (§177.2), a handle can pass the
  check and later turn out to carry a name the cast learns. It cannot be changed in a campaign that holds it. Mitigations:
  - the lane sees the node's own text and is told to use no name at all, so the check is a backstop, not the only defence;
  - a recheck when the cast grows can re-mint library handles no campaign has copied yet;
  - a running campaign keeps its handle, and the telemetry counts these.
- **Old campaigns still carry the leak.** Legacy campaigns still show other entities' slugs carrying names
  (`clue-book-4-john-…`). Accepted by the owner's ruling to leave old campaigns as they are; the fix here for them is
  correctness only.
- **Suggested order for tickets.**
  1. Contract section.
  2. Identity comparison: intentions, quotes and the sweep.
  3. Legacy undo-on-miss, with the round-trip test.
  4. Handle map and scheme marker.
  5. Handle lane.
  6. Node-id egress sweep, with the request scan.
  7. Packaging and the real-table acceptance.

  Steps 2–3 help every existing campaign and can ship first.

## Comments
