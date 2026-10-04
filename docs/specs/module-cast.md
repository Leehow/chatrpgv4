# The book's cast: one list of every person the book names, from when the book is read (2026-10-04)

Status: decided 2026-10-04 (owner: 「按你推荐的做」, Q1–Q5 as recommended); contract §177. Implementation on branch `claude/module-cast-20261004`; the real-table acceptance (§4) is CAST-06. Owner, 2026-10-04:
- 「对了，创建模组图谱的时候是不是应该建立一个模组npc名表，这样索引名称也方便，而且临时刷出来的新npc也可以避开模组已有角色名称」
- Asked whether to build it: 「先写 spec 给我看」
- On this spec: 「按你推荐的做」
- After table 25 (a whole book name the Keeper wrote in prose): 「拦，只拦整名」 (Q5 revisited: §177.11) and 「先不合，修完正文书名再说」 (not merged into 0.9.6a).
- After table 27: 「我们之后会在mod系统做一个比较大的重构，你先尽快收尾然后提交，等重构之后你再按照重构后的协同来修」. The three defects in §7 wait for that refactor; the branch is still not merged.
- After the refactor (§183 on 0.9.6a@7b83acc22): resume, sync the baseline and the new interfaces, and fix A/B/C as §7 records, keeping the model, the acceptance, the evidence and the merge boundary. Done on the branch: 0.9.6a merged (§176.9's narrow question supersedes §177.12's refusal), C as §177.13, B as §177.14, A as §177.15 (the Jev judgement, the coordination §183.5 uses for topics); acceptance is table 28.

Two departures from the text below, both recorded in §177:
- Creature nodes are not in the cast (§177.1). A creature node is as often a kind (a deep one) as someone.
- The newcomer refusal skips a piece the name writes with a period after it (§177.3). Otherwise "Mr" of "Mr. Dooley" refused every "Mr" newcomer.

Related contract: §79 (what the table calls a person), §87.7 (a newcomer is declared with `walk_on`), §87.8 (one junction for a person's name), §103.8 (the Keeper holds no untold name; pieces), §176 (epithets from the graph), §22.1 (the index), §22.4.7.1 (a person not yet read lands on the book's text), §11.5.4 (a person the carried text names), §127.1 (lookup).

## 1. Evidence

### 1.1 A newcomer may carry a book person's name

Probe, 2026-10-04:
- **Setup.** A scratch copy of table 23's campaign (`game-24bb66cb`, Blood Road, open turn 9), on the TS kernel at 0.9.6a `d0df51d2d`. Each name below went through `table.apply` as `{kind: "npc", name, to: "here", walk_on: true}`.
- **Result.** All seven were minted as new table people (`established: "table"`).

| newcomer's name | book person whose name it carries | that person at this table |
| --- | --- | --- |
| 史蒂夫, 老史蒂夫, 史蒂夫大叔 | 史蒂夫·布朗 (Steve Brown) | this table calls him 有海军纹身的退伍老兵 |
| 拉塞尔, 卡车司机拉塞尔 | 拉塞尔·威廉姆斯 (aliases 拉斯, 拉索) | told; this table calls him 拉塞尔·威廉姆斯 |
| 爱丽丝, 金发的爱丽丝 | 爱丽丝·杜威特 (Alice Dewitt) | not met, no word yet |

After the probe the gas station holds two people called 拉塞尔, and one of them is the told owner.

Why:
- `personOfEffect` (`kernel-ts/apply/entities.ts`) refuses `walk_on` only when the name resolves to a book person. That goes through `graph.npc`, then `personNode` (the table's words).
- Asked directly, the same graph resolves 史蒂夫·布朗 and Steve Brown to `npc-book-4-steve-brown`. It answers "no npc named" for 史蒂夫, Steve, 布朗, 拉塞尔 and 爱丽丝.
- A name that only carries a piece is never compared. §103.8's piece refusal (`refuseUntoldName`) guards `apply person` names and nothing else.

When the name does resolve, the refusal names the person by `graph.displayName` (`entities.ts:124`). For an untold person that is the book's name, handed to the Keeper, and §103.8 says the Keeper holds none. Read from the code; not seen on a table.

### 1.2 The graph is not the book's cast

Blood Road at this table is a PDF read on demand: `book-4`, 111 pages, the source-reference path, `index_complete: false`, so no index pass at all.
- At turn 9 the campaign's graph (generation 52) held 54 people. People enter it as the reader reaches their pages.
- Every check that keeps names apart reads the graph:
  - §103.8's rename of the Keeper's request, and its refusal;
  - §176's epithet refusals;
  - the journal lane's label check;
  - `walk_on` resolution.
- A person on a page not yet read is unknown to all of them. Their name can be given to a newcomer, and if carried page text mentions them, their name reaches the Keeper unrenamed.

The index pass (§22.1), where a book has one, is navigation by design: "Do not scan the whole document" (`content/setup/visual-reader.md`). Its sections may list `entities`, which are untyped names from contents and heading pages, and "important people". That is not the cast.

### 1.3 Lookup does not find a person by the word the table uses

On table 23, `lookup kind=module query=<epithet>` answered `not_found`. `graph.search` matches graph keys. The table's word (§176.1) resolves only through the person junction (`personNode`, §87.8), and lookup does not ask it.

### 1.4 §176's residual

An untold person with no epithet yet is shown to the Keeper by handle. The §176 spec (§2.4) records this as "a known residual".
- At the probe moment, the roster showed 爱丽丝·杜威特 and 亚伯, among others, by handle.
- The epithet lane asks at start and after each committed turn. Meanwhile the reader keeps landing people.

## 2. What changes

### 2.1 The cast: what it holds

The cast is a module-level record with one row per person the book names:
- `names`: every name the book uses for them, as the book writes it, plus the play-language rendering. This is the same pair a graph person carries: `name` 史蒂夫·布朗, alias `Steve Brown`.
- `pages`: the physical pages where a name occurs.
- `node_id`: the graph person, once there is one.

There are no roles, descriptions or kinds. That a string is a person's name is the reader's judgment. The kernel checks only strings it holds.

### 2.2 Producers

**Authored graphs (starters).** Derived by machine at load from the `npc` and `creature` nodes: name, display name and aliases. No model call.

**PDF books.** One reader job with purpose `cast`:
- **When.** Queued in the background when the book is registered. It never blocks the opening.
- **What it reads.** The native text layer, page by page.
- **Who runs it.** A Pi agent run on the reader runtime, like every other purpose, because text work must be an agent, not a single completion.
- **Draft.** `{people: [{names: {book: [...], play: [...]}, pages: [...]}]}`.
- **Kernel check, by machine.** Each book-language name must occur (`occurs`) in the native text of at least one of its cited pages. A failing row is refused alone, naming the row and what to add (§90.3).
- **Merging.** Rows from different page ranges merge only when a normalized name is shared exactly. Nothing is merged by meaning.
- **Cost.** Book-4's text layer is about 119,000 characters (`pdftotext`). The output is names and page numbers.

**Linking.** When the reader later publishes a person node, the kernel links it to the cast row that holds the node's name or one of its aliases exactly. A node that matches no row adds one, so the cast never lacks a person the graph has.

### 2.3 Consumers

1. **Newcomers (§87.7).**
   - A `walk_on` name may not equal or carry any cast name, or any punctuation piece of one (§103.8's pieces, `occurs`), whether that person is told or not.
   - People from a passage (§11.5.4) are book people and keep their path.
   - The refusal names no book name:
     - for a person this table has met or been told, "`<word>` is `<this table's word>`, whom this table already has";
     - for anyone else, "`<word>` carries a name the book gives someone else; a newcomer needs a word of their own".
   - The existing message at `entities.ts:124` switches from `displayName` to the table's word.
2. **Words for book people.** The epithet lane (§176.3), the journal lane's labels, and `apply person` names (§103.8 item 4) refuse names and pieces of untold people across the whole cast, not only the graph.
3. **One lookup.**
   - `lookup kind=module` asks the person junction (`personNode`) after `graph.search`. That covers the handle, the book's names, the table's word and the epithet.
   - A cast row with no node answers `{kind: "npc", material: "unread", pages}` instead of `not_found`, so the Keeper's next write on them lands on the text (§22.4.7.1).
4. **Landing (§22.4.7.1).**
   - A name in a person's seat that names a cast row with no node counts as an index-only person, with the row's pages as index pages.
   - Today only an index row's `entities` count, and book-4 has no index rows.
5. **The reader.**
   - Detail and fragment reads get the cast's names in both languages among their known identities. A person read in two fragments then keeps one rendering, and the node links to its row.
   - This is the "索引名称也方便" half: one table every surface resolves names against.

### 2.4 The Keeper's copy (Q3)

If the owner agrees (Q3), cast rows with no node join the untold rename:
- **Shown word.** It comes from the epithet lane, which then works from the cast rather than only the graph.
- **What the lane is given about a person with no node.** The sentence around the name's first mention, cut from the native text by machine.
- **What this closes.** The 1.2 channel (unread people named in carried page text) and the 1.4 residual.

## 3. Not changed

- No list, regex or mapping decides what is a name or what a name means. The reader says which strings are names. The kernel compares strings it holds, as §103.8 and §176 do.
- The cast is navigation, not permission to play. A row gives no facts about the person, only that the book names them and where.
- **Existing campaigns.**
  - Starter campaigns derive their cast at load, so they get it with no job.
  - A PDF campaign whose module has no cast queues the job at its next `table.open`. Each PDF campaign has its own module copy, under `module-campaigns/<campaign>/modules/`.
- A newcomer named only in prose, with no `apply npc`, is not gated (Q5).

## 4. Acceptance

**Offline (emitted kernel, unit tests):**
- the seven probe names in 1.1 are refused, and no refusal text carries a book name;
- lookup by an epithet finds the person;
- a cast draft row whose name is not on its cited pages is refused alone;
- a node published later links to its row;
- a starter's cast equals its people's names.

**Real table:** a new Blood Road campaign, played turn by turn by me as the player, on the current Keeper model (grok-build grok-4.5 low; no switching). At least 10 turns; preregistered before the table.
1. Before the opening, the cast job has finished, and the cast holds at least every person the graph has.
2. No newcomer the Keeper establishes carries a cast name or piece. Each refusal is followed by a different word within the same turn. If no newcomer appears in 10 turns, this gate is recorded as not exercised, not passed.
3. Lookup by the word the Keeper is shown returns that person every time.
4. The name-leak audit of tables 22 and 23, extended to cast names, finds no book name before it is told.
5. Each graph person's play-language name equals its cast row's rendering.

## 5. Open questions for the owner

- **Q1. Where does a PDF book's cast come from?**
  - Recommended: the background reader job `cast` over the native text (§2.2).
  - Rejected alternative: extend the index pass. It is navigation by design and does not scan the document, and book-4's source-reference path has no index pass.
  - Smaller alternative: build the cast only from graph people as they land, with no new job. That fixes 1.1 and 1.3 for people already read, but not the owner's case of a newcomer taking the name of someone the reader has not reached.
- **Q2. A scanned PDF with no text layer?**
  - Recommended: the cast is `unavailable` and the checks fall back to the graph.
  - Alternative: the reader views every page image once, at the cost of a whole-book visual read.
- **Q3. Should cast people with no node join the Keeper's rename and get epithets up front (§2.4)?**
  - Recommended yes. Otherwise the names of people not yet read reach the Keeper in carried page text.
  - Cost: about one epithet job per 24 people when the book is registered. Book-4 would take about three jobs. On table 23 each job took about 2.3 s on `opencode-go/deepseek-v4.1-flash`.
- **Q4. A starter name that appears only in prose (someone a biography mentions, with no node)?** Recommended out of scope: a starter's graph carries its cast as nodes.
- **Q5. Gate a newcomer named only in prose?**
  - Recommended no. Delivery refuses nothing for names today (§103.8 item 3).
  - The journal lane already refuses such a name as a label, under the widened check in §2.3 item 2.

## 6. Tickets (to file after the owner decides)

- CAST-01: the kernel's cast record, derived for authored graphs and linked to nodes; the newcomer refusal and the table's word in its message (§2.3 item 1). This fixes 1.1 for every person already in the graph and needs no reader work.
- CAST-02: lookup through the person junction (§2.3 item 3, 1.3).
- CAST-03: the reader's `cast` job for PDF books, its draft check and merge (§2.2, Q1, Q2).
- CAST-04: the other consumers over the cast: the lanes' refusals, landing pages, and the reader's known identities (§2.3 items 2, 4 and 5).
- CAST-05, if Q3 is yes: the rename and epithets for cast rows (§2.4).
- CAST-06: the real-table acceptance (§4).

## 7. Real tables and open defects (tables 24–27, 2026-10-04)

Tables 24–26 found eight gaps, fixed on the branch (§177.3–§177.12). Table 27 (App `e634c3eb0`, Blood Road, `grok-4.5` low, eight turns): the cast was complete at the opening and not read again; every request carried the rename (287–300 rows, no failed read); a book person who gave an invented nickname stayed untold (§177.12 held); no book name was delivered before it was told. It was stopped on turn 8, when the gate refused an ordinary word, and three defects remain open. Each needs a decision about the mod system's refactor before it is fixed.

- **A. A name matched inside another word.** Fixed by §177.15.
  - Matching is by substring, and Chinese has no word boundaries. 「拉斯」 is a nickname the book prints alone, so it is a whole name, and it is also part of 「达拉斯」 (Dallas).
  - On turn 8 the Keeper wrote 「达拉斯」, and §177.11 refused it. The refusal quoted 「拉斯」, which the request exit (§103.5) renamed to the station owner's word, so the Keeper was shown a word it had not written.
  - The second delivery replaced the name as designed, and the player read 「你把要寄到达油布口袋的加油站老板的信递过去」.
  - Book-4 prints 「达拉斯」 five times and 「拉斯维加斯」 once. The cast has 74 printed forms of two or three characters. The request-exit rename mangles the same occurrences in source excerpts.
  - Whether an occurrence is the person's name is a semantic question, not one for a boundary rule or a word list. Candidates:
    - the Keeper judges its own sentence, quoted back unrenamed, and a resubmission is delivered as written;
    - a fast-model or Jev yes/no on each match.
- **B. English renderings in the pipeline's own fields.** Fixed by §177.14.
  - The reader writes some fields in English (`source_needs.question`/`trigger`, drafts, character guidance) and calls people by English renderings ("Lars"). The cast holds only the book's printed forms and the play language's renderings, so the request exit does not rename them.
  - On turn 6 the Keeper reasoned that the station owner "is likely named Lars". Nothing reached a delivery.
  - Candidate fix: the cast also records each person's rendering in the language the pipeline writes its notes in.
- **C. `recall` does not take the table's word.** Fixed by §177.13.
  - `recallMemory` (kernel-ts/memory/recall.ts) resolves `about` through `EntityIndex` only, not the person junction (§87.8). For an untold person the Keeper holds only the table's word.
  - On turn 5, `recall about: ["烂牙的退休卡车司机"]` was refused `unknown_entity`, and the lookup and look in the same batch did not run.

Observed, not filed:
- The Keeper had three NPCs in a row decline to give their real names; on tables 25 and 26 the bar owner gave his.
- Every new session starts with a 0.3 s `model_change` to `flapcode/gpt-6-luna` before the App sets the table's model; no request used it.

The table notes are in `.coc/playtests/speech-replay-20260930/newplayer-20261002/turns.md` (not tracked).

## Comments
