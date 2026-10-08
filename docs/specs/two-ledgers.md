# Two ledgers: the Keeper holds the book's truth and a separate record of what the player knows

Status: ready-for-agent

Owner ruling (2026-10-08, after real table TR-F on App `d944b6b07`):
「停桌，先修名字这条链路。我觉得台上和台下应该给kp两个账本，一个是全部事实的账本，一个是玩家知道的账本，要不要kp不知道就乱编了」

Contract: `docs/kernel-rpc.md` §194. Amends §103.5, §103.8 (items 1–2), §176.3, §176.5, §176.8 and §177.5.

## 1. What went wrong (evidence)

TR-F: Cold Harvest (book-2, sha `e4832eec…`), openai-codex/gpt-6-luna low, 12 turns, campaign
`game-56788eff-11bf-4bfb-98e0-b47712330b3e`. The Keeper invented who wrote the denunciation, whom it accused and which
family fled. The material did reach the table:

- The opening `look` (06:38:54Z) returned the book's own scene text: Captain Aganin, Galena Smolskaya's letter accusing
  Pyotr Abramov's family, supervisor Boris Gapon, a family that fled four months ago.
- The persisted capsule held Boris's knowledge correctly: he knows Galena wrote, thinks the Abramovs are good party
  members, believes Galena drowned in the pond.

But the request the Keeper read is not that capsule. §103.5/§103.8 rename every untold person's book name, in every host
message and tool result, to the table's word for them. On this table those words were wrong:

- `epithets.json` gave Dimiri Kravchuk (46, stonemason, fled) 「四十九岁的电工斯基」 — Vasili Smolsky's age and trade; Andrei
  Nikitin (62) 「二十九岁的劳工娜」; Olga Nikitina (61) 「八岁的儿童芙娜」.
- It gave Pyotr Abramov, the victim, 「使两家人突变的生物」 (the creature), and Stalin 「破坏秩序的揭发者」.

So the Keeper read "厌恶病变一家的村民 wrote to the NKVD about 使两家人突变的生物 and his family" and "he believes 厌恶病变一家的村民
drowned". It produced: the fled family is 「电工斯基一家」 (turns 1, 2, 8); the letter accuses 「加庞家——我妻子和儿子」 (turn 9);
the writer 「叫薇拉，上个月死的」 (turn 10). Each line follows from the renamed text.

Two more defects on the same chain:

- **A document in the player's hands does not tell its names.** The player held handout #2 (the letter, which prints
  Galena's and Pyotr Abramov's names). The Keeper, holding no names, said the letter 「没有留下可辨认的姓名」.
- **The epithet lane's input for an unread person is a window, not their entry.** `first.sentence` (§177.2) for every
  resident on page 10 is a ~200-character cut of the resident list holding six to eight people
  (`modules/book-2/cast.json`), so the lane took a neighbour's age and trade. For graph people the lane reads
  `personDescribed` else `node.summary`; a summary is Keeper knowledge, which is how a spoiler became an epithet.

## 2. The design

**The truth ledger.** The Keeper's request carries the book as written: every person under their book name, in the
capsule, the clerk's notes, tool results and source text. The request no longer renames book names (§103.5's rename is
retired for names; handles stay machine text and keep being shown as the table's word, §176.8).

**The player ledger.** A capsule section `player_knows` says what the investigator knows, in one place:

- `people`: each book person the investigator has met or heard of, with `word` (what prose calls them) and either
  `name` (told, the book's name) or `untold: true` with `book_name` beside it for the Keeper's own reckoning.
- `documents`: each handout or document delivered to the player (`label`, `turn`), so the Keeper knows the player has
  read it.
- It points at the existing sections that already hold the rest (`known.discovered_clues`, `memory`), not copying them.

Each `present[]` row keeps `name` = the table's word for an untold person (what prose and say tokens use), and gains
`book_name` for someone untold. The untold `use` line changes from "you do not have the name" to: the player has not
heard this name; you know it to keep the story straight; prose calls them `name`; where the fiction has it said, write
`{{name:<name>}}`.

**The leak guard stays at the exit.** §177.11/§177.15 already refuse a delivery that prints an untold person's name
(first time refused with places, second time replaced by the table's word, Jev clears other-word places). That gate is
now the only guard, and it covers the case §103.8 was made for (table 20: the Keeper wrote 拉斯 and 史蒂夫·布朗 in
prose). Its first refusal costs one model call; TR-F2 measures how often it fires.

**A document tells its names.** When a delivery carries a handout (or any effect that hands the player a document's
text), every untold cast person whose printed name the document's text shows becomes told at that delivery, through the
same told path `{{name:}}` uses (`person_labels`, `toldTurn`/`castToldTurn`). Places are found and Jev-cleared exactly as
§177.15 finds them, so a place name inside a document (Dallas) tells nobody.

**The epithet lane sees one person at a time.**

- An unread person's `looks` is their own entry: in the page's reading text (§191 transcript `text` when the page has
  one, else native), from their printed name to the next place another cast person's printed name starts, or the end of
  the paragraph. This is identity matching on names the cast already holds, not semantic classification.
- A graph person's `looks` is `personDescribed` only (appearance); without it, `relationship_to_investigators`; never
  `node.summary` or any Keeper-only field.
- The instruction says the word is what an investigator would see or be told on first meeting, and never a secret.

## 3. Decisions taken (owner: 「有什么自己定夺」 standing)

- **Q1. Retire the request rename for book names?** Yes, owner's ruling. §103.8 items 1–2 are superseded; item 3
  (`{{name:}}`), item 4 (an epithet may not carry a book name) and item 5 stay.
- **Q2. Keep the exit gate as is?** Yes. No new prose guard is added; TR-F2 counts refusals.
- **Q3. What counts as a document telling a name?** Delivered handouts with stored text. Spoken words still tell only
  through `{{name:}}` and the journal lane (§176.9); a clue's prose is the Keeper's words and goes through the gate.
- **Q4. Epithets survive?** Yes: they are the player-facing word for someone untold and the gate's replacement. Only
  their inputs change.
- **Out of scope** (TR-F findings filed separately): NPCs not answering a direct question (turns 3, 5, 11); the ingest
  progress toast firing per reading-job phase (`extensions/table/commands.ts:687`); the card's 463/460 budget.

## 4. Acceptance (TR-F2, pre-registered before the table)

Fresh Cold Harvest campaign on the packaged App, openai-codex/gpt-6-luna low, same opening lines as TR-F turns 1–10.

- The Keeper's account of the letter names Galena as writer and the Abramovs as accused once the player reads it, and
  the fled family is the Kravchuks. No line of TR-F's three fabrications recurs.
- The handout read on turn 2 makes Galena and Pyotr Abramov told (`player_knows.people`, sidebar).
- No delivered prose prints an untold person's name; refusals by the gate are counted and listed.
- Every epithet in `epithets.json` for page 10's residents carries only that resident's own age/trade, and no epithet
  states a secret (manual read of the whole table, listed).
