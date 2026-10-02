# First sight: what the book describes reaches a new player (2026-10-02)

Status: decided; contract §168. Owner rulings, same day:
- 「模组里有些的东西一定一定要展示出来！！禁止简略！」
- 「行了，可以停了，你测试的时候自己不看看的么，有描述吗？」
- 「1 和 3 直接改，2 和首见面义务按你推荐的做」

## 1. Evidence

Installed App `153469067`, Blood Road (`book-4`), new campaign `game-717a9e4b`. Flapcode gpt-6-luna was the Keeper. The table was played as a first-time player. Turns 0–2 established neither the place nor the people:

| turn | player | what the player read |
| --- | --- | --- |
| 0 (opening) | — | 「你是莉娜·卡特，一名摄影记者；这趟路上没有人交给你一项必须完成的差事……棚下的瘦高男人抹了把被汗浸湿的额头……」 One man; the other two absent; the station undescribed; the card's errand denied. |
| 1 | 我把车开到油泵旁边，下车伸个懒腰，打量一下这个加油站和棚子底下的人。 | 「你从事什么职业？」 (the whole reply) |
| 2 | 我是休斯敦报社的摄影记者……加满一箱油多少钱？ | A price. The narration names 「拉塞尔」, a name the player was never told. |
| 3 | ……棚子底下还坐着什么人？ | The Keeper finally wrote the station and all three men in full, inside `apply.narrate`. The kernel refused the batch (`owed_unknown`), and the prose was lost. |

Each failure has a system cause:

1. **The host's opening instruction capped description.** `extensions/kernel/index.ts` "Opening the table" said: "one sentence of room at most, one gesture per line of speech, and the whole opening shorter than the prologue. Introduce at most two new proper names…". This directly contradicts narration-craft 2.1.11 ("the place, with everything the book describes of it… Take the room this needs"). The host's more specific line won. The caps came from the 2026-09-16 opening-guidance pass, which answered a different complaint ("300 characters on wind, clocks and knuckles before saying anything"). When the craft moved into the prose package, `prompts/keeper.md` lost the same sentence; the host message kept it. Its "what they were asked to do" also led the Keeper to deny an errand the card records.
2. **The people stayed in the prologue.** The graph seats Lars, Nate and Steve `present-in` both `scene-book-4-prologue` (`is_entrance: true`) and `scene-book-4-esso-station`, and the prologue `hands-off-to` the station. `initialWorld` gives each person one seat, "the first scene to claim a name", with the start scene first. So all three sat in the prologue. The player's 「开到油泵旁边」 compiled to a move to the station; the turn record read `Present: nobody` while the station's description said three men sat under the awning. The Keeper's thinking was "Requesting missing occupation", and it asked for it.
3. **An invalid optional annotation sank the write and its prose.** The Keeper copied the capsule's §51.4 `unrecorded` line into `owed` on its `apply npc`. `owedRowFor` refused the batch `owed_unknown`, and every effect went with it, including the embedded narrate that finally described the scene. Every `owed` refusal's own fix begins "Leave owed out".
4. **The material was there and was not used, and the capsule cut it.** In turn 1's capsule, Nate's and Steve's `present[]` rows were `{name, truncated: true}`: Lars's English personality block spent the section's budget. The station's full description was in the clerk's move row, and the player asked to look. Prose rules alone did not make the Keeper write it.

## 2. Decisions

### 2.1 The host's opening instruction carries no craft (item 1, owner: change directly)

The opening message keeps only its contract:
- no player input this turn;
- the investigator exists and is not asked for again;
- the prologue's sentences are not repeated;
- the play language;
- `pending_action` is preserved;
- no keys or money were granted;
- close with narrate.

Every length, sentence-count and name cap goes. How to open is the prose package's (narration-craft "Opening the table" and its first-sight paragraphs). Why the investigator is here is said from the card and the committed prologue. The Keeper never states that something is absent from them. Orientation first stays (09-16 ruling): where and when, who the investigator is here, why they are here.

### 2.2 An entrance carries its people into the scene it leads to (item 2, my recommendation, adopted)

The template separates `entrance_relation_kinds` (`play-precedes`, `may-lead-to`, `alternative-to`, `hands-off-to`: the book's playing order) from `route-to` (travel between places).

**Rule:** a `move` from an entrance scene to a scene it leads to by an entrance relation carries along everyone the ledger has in that entrance scene whom the destination also seats (`present-in`, or the scene's `npc_ids`).
- An entrance scene is the graph's `entry_scene_ids`, or a scene whose `properties.is_entrance` is true.
- The move receipt names them (`with: [handles]`), and their `npc_presence` changes in the same write.

**Not chosen:**
- **Carry along on any move between two scenes that both seat a person.** That drags recurring people (Knott-style) across ordinary travel.
- **A containment model of places.** Still the right long-term cure for the flat-locus class, but larger than this defect needs.

The rule is structural: graph relations and the ledger. Nothing reads prose.

### 2.3 An `owed` annotation that does not hold is left out; the write stands (item 3, owner: change directly)

`owed` is optional (§158.5). When it does not hold, the host leaves it out, and the write goes on as an ordinary write under ordinary admission:
- **Before admission:** on the Keeper's own `apply`, an `owed` naming no open row of the owed rows the host last read is removed. The batch then goes through ordinary review instead of the told path, so a made-up name never buys the told basis.
- **After a kernel refusal:** if the kernel refuses the Keeper's `apply` with `details.field: "owed"` (`owed_unknown`, `owed_mismatch`, `owed_not_told`, `owed_kind`, `owed_unresolved`), only that effect's `owed` is removed. Admission and the Mod gates run again, and the call is sent once more. This follows the band-recovery pattern already in `runTool`.
- Other effects' valid `owed` stay, so an owed time row is never landed twice.
- The result tells the Keeper in one line that the name was left out and why; the row, if any, stays open.
- A **clerk** (policy-origin) owed landing keeps §158.4's rule: a row that cannot land stays open, and nothing is stripped.

Telemetry: `lane: "owed", event: "owed_left_out", stage: "before_admission" | "kernel_refused", owed, reason, kind, turn`.

### 2.4 First sight is an obligation with its material, checked after delivery and carried forward (item 4, my recommendation, adopted)

**State.** The kernel's `first-sight.json` in the campaign directory: `{shown: {places: [handle], people: [handle]}, open: [{kind, id, missing: [text], turn, at}]}`.
- Same reasons as `owed.json` (§158.3): written after a turn closes, part of no world revision, committed with the next turn, carried by forks.
- A place or person is **owed** while the party is there or they are present and they are not in `shown`.

**Producer: the capsule section `first_sight`** (`kernel-ts/read/assemble.ts`). Its own budget is 8192 (raised from 4096 at integration: the Blood Road station and three biographies run about 3.6 KB of Chinese before JSON); nothing else's budget cuts it. It is placed before `present`.
- `place`: `{id, name, described}` when the active scene is not shown. `described` is the scene's `properties.description` (else `summary`).
- `people`: `[{id, name, described}]` for each person present whose node is `player-safe` and not shown. `described` is the person's `biography` (else `summary`).
- When an `open` row exists for an item, `described` is replaced by `missing`: only what the last check found unshown.
- A HEAD sentence: this is the player's first sight of these. Write what the book describes of the place, and of each person their looks, dress and manner, in this reply, in the play language, along the eye's path, before the turn's business. A person is seen before named. Nothing here is a fact to recite: only what can be seen or heard on arrival.

**Check: the `first-sight` lane** (host, `runtime/jev/first-sight.ts`). It runs after each delivery whose capsule carried `first_sight`, in the background, and never delays a delivery.
- One zero-tool `runLane` on the fast model (`PI_COC_FIRST_SIGHT_MODEL` > fast-model setting > table), 20 s cap.
- Input: `{prose: <delivered rendered_text>, items: [{id, kind, described}]}`.
- Output: `{items: [{id, missing: [<exact excerpt of that item's described>]}]}`. `missing` lists only details a newcomer could see or hear on arrival that the prose did not show.
- Each excerpt must be found in that item's `described` (§139 quotation-mark normalisation); unanchored excerpts are dropped.
- The host sends the result to the kernel: `table.first_sight {campaign, turn, items}`.
  - An item with empty `missing` is added to `shown`.
  - Otherwise it becomes or replaces its `open` row.
- A lane failure records nothing; the item stays owed in full.
- Telemetry: `lane: "first-sight", ok, ms, model, items, shown, missing`.

**Watched, not waited for.** As with §158.4's owed review, the next run's first read reads a check that has already landed. A check still running then is applied at the next read. While a check of an item is in flight, the capsule omits that item, so the next turn does not describe it a second time; it returns at the following read if the check found it unshown.

**Not chosen:**
- A pre-delivery gate that refuses or rewrites prose: the owner removed the automatic rewrite (§166 single pass), and it adds a round to the turn.
- Per-feature Jev Nouls: Jev does not count or enumerate reliably (jaggedness), and the Keeper needs the missing text, not a score.

## 3. Verification

- Unit and integration tests per item, each killed by mutation.
- Box suites when a box is reachable; otherwise targeted files locally, said so.
- Package, then a **new** campaign of Blood Road played as a first-time player. Before playing, pre-register these per-turn answers from the screen, with stop rules:
  - Where am I?
  - Who is here, and what do they look like?
  - What is going on?
  - For a first arrival or first meeting: every feature of `described` shown?
- **Stop rule:** the first turn that answers "no" for a reason not already understood stops the table, and it is reported.
