# NPC voice masks: distinguishable people, not personalities (2026-09-16)

Status: design ruled by the user 2026-09-16 ("聚光灯在玩家身上，NPC 为玩家服务，不需要自己的人格；需要的是玩家能分辨的性格特质、像人的语言行为和口癖"); implemented on `npc-voice` 1.1.0, tuned to 1.1.1 after the second table; acceptance on a seeded chat bench (below).

Supersedes the `sample_lines` word of `docs/specs/npc-speech.md` §40.5. The say token, the speaker colour and the host steer are unchanged.

## 1. The finding

After the 2026-09-15 landing the user read two lines from the final table — the archivist's 「一般人连门都摸不着」 and the news-seller's 「买过报的人我才讲」 — and said nobody talks like that. They are right: every line was an aphorism. The 1.0.1 instruction asked that "every line wants something", and a model that obeys it writes zingers. The two people were different, but neither was a person.

The user's first proposal was one agent per NPC. Rejected by the user the same day, for the right reason: the player is the protagonist and the NPCs exist to serve the player's scene, so they need no personality of their own — only speech the player can tell apart and would believe a person said.

## 2. What the research says (sources in §7)

- **Role language (役割語, Kinsui 2000–).** Readers identify a speaker from a first-person term, a sentence ending and a few words; marked speech is for supporting characters, because a marked voice "impedes empathy and marks the supporting role", while the protagonist speaks unmarked standard language. The markers are stereotype, not real speech, and one ending suffices for recognition. This is exactly the user's ruling, stated as linguistics: **the investigator speaks unmarked; each NPC wears a mask.**
- **One or two markers, not five.** The Japanese web-fiction craft essay: 1–2 consistent markers per character; overuse reads as artificial, more characters converge. The GM cheat sheet: 1–2 speech patterns per NPC. RPG Academy: "one strong trait beats five complicated ones", repeatable across sessions. Mercer: know what the NPC wants in this exchange, give one repeatable habit, avoid offensive dialect caricature.
- **Examples beat descriptions.** Inworld's character dialogue style is three adjectives, a colloquialisms field and *example dialogue*. SillyTavern's AliChat format is example messages only: the model copies the length and manner of the examples, and a description does not move it.
- **Style is separable from content, and separating it helps.** Test-Time-Matching (2025) decouples personality, memory and *linguistic style* — style being preferences (formal/informal, sentence length, rhetoric), common vocabulary and retrieved example utterances — and applies style after content; persona consistency rose 6.5 → 7.3. The style layer is what we want; the personality and memory layers are what the user rejected.
- **Chinese craft.** Web-fiction advice converges on the same three tools: a repeated word or pet phrase, a fixed form of address, one identifiable register ("王胖子" is recognisable from one line), and the test "去掉人称也分得清是谁".

## 3. Design

### 3.1 Two words replace `sample_lines`

`npc-voice` 1.1.0 contributes two `shape: "lines"` words:

| key | label | value | what it is |
| --- | --- | --- | --- |
| `voice_mask` | `mask` | one line ≤ 200 chars | how this person's speech is marked: what they call themselves and the person they are talking to, one sentence-ending habit, the level of their words (trade, schooling), one pet phrase. In the play language. |
| `exchanges` | `in exchange` | three lines ≤ 200 chars each | three exchanges: a stranger's plain line, then what this person says back, on one line. The reply wears the mask. Reference, never read out. |

Both are written once per person by the lane (§3.3) or authored by a book that prints the person's speech (the reader's `ask`), and both die with the package (§28.7). `apply {kind: "dossier"}` refuses both, as it refused `sample_lines`. A person the book says does not speak is filed `{value: null, reason: "does_not_speak"}` under both keys, as before.

### 3.2 The capsule carries them as `voices`, not inside `present[]`

Lines-shaped words are bulky reference material; `present[]` has 3 KB for everyone on stage, and a room with six people would lose people to the budget. A new capsule section `voices: [{name, mask, "in exchange": [...]}]` carries every lines-shaped word of every present person (any package's — the rule is the shape, not the package), budget 3072 bytes, trimmed exchanges-first (`fitBudget` pops the largest leaf list, which is an exchange list before it is a person). `present[]` stops carrying lines-shaped words. `look focus=npc` still shows them on the person (its rows are the Keeper's explicit read). `head` says what `voices` is for: wear the mask on every spoken line, never read an exchange out.

Book-authored lines-shaped words reach `voices` through the module's bound vocabulary (`graph.dossier.contributed[].shape`); table-established ones carry `shape: "lines"` on their record. A `sample_lines` record left by 1.0.x has no shape and stays in `present[]` until the lane re-establishes the person, which deletes it.

### 3.3 The lane

`voice.job` packet (closed): as §40.5 plus `taken_masks: [string…]` (the masks already established or authored for other people of this campaign, ≤ 12, no names) and `budget: {mask_chars: 200, exchanges: 3, max_chars: 200}`. `voice.submit {campaign, job_id, voice: {mask, exchanges} | null, reason?}` — shape only: `mask` one line 1–200 chars, `exchanges` exactly three distinct lines 1–200 chars, no `{{`, no line break. Event `dossier-established {npc, keys: ["voice_mask", "exchanges"]}`.

The lane instruction (`content/setup/npc-voice.md`) now asks for a mask first and three exchanges in it, with the role-language rules: pick one or two markers, make them different from every mask in `taken_masks`, register over dialect caricature, the reply is mundane talk that answers the stranger and leaves the stranger something to say back, no aphorisms, no other person's name, no secrets. The voice guard (§40.5) reads mask and exchanges against the book's `voice` and asks one more thing: does every reply wear the mask.

### 3.4 The Keeper (package instruction)

The package instruction stops asking for wants in every line and asks for three things instead:

1. **Wear the mask.** Every spoken line of a person carries their address terms and their ending habit; the pet phrase at most once a turn. Two people whose masks you cannot hear apart in a line is the Keeper's fault.
2. **Talk like a person** — speech behaviour, not personality: answer the words just said before anything else; acknowledge before answering (「哦，那个啊……」); repeat half of what was said back; say the mundane thing; drift to what is at hand; pick a dropped thread back up; a fragment is one beat, not a style; nobody says an aphorism.
3. **Serve the player.** A line reacts to what the player just said or did and leaves the player something to say back — a question, an opening, a demand. No line closes the subject. The investigator's own lines are unmarked.

`coarse_language` unchanged.

### 3.5 What stays out

No agent per NPC, no persistent NPC process, no style-rewrite pass after delivery (TTM stage 3 remains the documented second lever if the Keeper flattens masks on a real table), no emotion slot, no classifier, no colour storage.

## 4. Acceptance: the chat bench

The user authorised a seeded scene for this test (2026-09-16: "造很多不同类型的 npc 疯狂聊天，不用推剧情"). It is a probe, not a playtest, and the Keeper is still the live product Keeper with one utterance per turn from the driver.

- **Starter `voice-bench`** (`content/starters/voice-bench`, unlisted like `mystery-house`): a rainy night in a dockside teahouse in Tianjin, 1926, nine people from nine stations in one start scene — a docker, a former licentiate who writes petitions, the proprietress, a newsboy, a constable, a comprador, a fortune-teller, an English mission teacher with imperfect Chinese, and a mute boatman (the `does_not_speak` path). Each holds one fragment of last night's sinking of the barge 福顺号, so there is something to talk about; nothing has to be advanced. Pregen `shen-zhiwei`, a newspaper reporter. Generated by `tests/play/fixtures/voice-bench/build.mjs`.
- **Table.** `tests/play/driver.py start --campaign voice-bench-1 --pregen shen-zhiwei --module voice-bench --model xai/grok-4.6`, then one turn per person, a second round pressing each, ~20 turns.
- **Lineup test** (`tests/play/voice_lineup.py`): every `speech[]` row of the table with `who.npc` set, names stripped, shuffled, given to a judge model with the roster (name and station only, no masks) — the role-language test "去掉人称也分得清". Reported: accuracy per person and overall, the confusions. Pass: ≥ 80% overall on a nine-person roster and no person below 50%.
- **The user's reading**: the same lineup file, un-judged, for the question the judge cannot answer — does it sound like a person said it.

## 5. Results

**Table 1 (`voice-bench-1`, 2 turns, abandoned).** The first masks the lane wrote were costumes: the docker's mask read 「每句他妈的开头操结尾」 and his exchanges were 「他妈的扛包的操」; the licentiate had 「也哉」 glued to every reply; three of five replies had no punctuation at all. Two causes, both fixed before table 2: (1) **nothing had ever read `content/setup/npc-voice.md`** — the lane's system prompt was the kernel's short fallback constant, in 1.0.x too, so the whole crafted instruction was dead text (`voice.job` now sends the file as `instruction`); (2) the bench's own `voice` lines prescribed tics (「粗话当标点」), which the lane obeyed literally (rewritten to describe the person). The instruction also gained: a habit is never the same word glued to every sentence, replies are punctuated as the play language writes speech, a telegram is not a line.

**Table 2 (`voice-bench-2`, 20 turns, grok-4.6 Keeper, deepseek-v4-flash admission, npc-voice 1.1.0; evidence `.coc/playtests/voice-bench-2/`, campaign `.coc/campaigns/voice-bench-2/`).**

- Masks: eight written, one silent (`does_not_speak` for the mute boatman, 3.4 s, no judge); the guard bounced two. All eight are one-line masks with address terms and one habit — 老子/伙计, 在下/先生/罢了, 客官/您说是不是, 小的/先生您/嘞, 本官/这位/按规矩来/再议, 老兄/兄弟/懂不懂 + an English word, 施主/贫道/未可知啊, 请原谅/您/是吗 — and all 24 exchanges are punctuated sentences.
- Lineup: 41 NPC lines from eight people, names stripped, shuffled; deepseek-v4-flash attributed **41/41** (per person 3–13 lines, every person 100%, no confusions). The mute boatman spoke no line in 20 turns and answered by gesture.
- Turns: 18 delivered, 170–577 chars (median 357), 75 「 for 63 speech spans, one `unmarked_speech` warning, zero speech steers, zero runaway rows. Median wall time 143 s.
- Two turns were lost to the continuity review (§38), not to this change: `continuity_review_unavailable` twice (a 40 s reviewer timeout on grok-4.6, and a bounded repair that did not resolve), each costing ~4 minutes and a "send anything" nudge; `mod_narrative_repair` refused a first draft twice. The Keeper leaked an English word into prose twice (「pot 里的茶」, 「rumours 满码头都是」) — a grok-4.6 habit seen on other tables, outside this section.
- **The honest reading.** Distinguishable: yes, completely. Like people: the licentiate, the fortune-teller, the teacher and the newsboy do; the docker and the constable do not, because the Keeper wore the whole mask on every line — 「老子喝完就走，伙计」 three times, 「按规矩来／回头到局里说／再议」 stacked in each of four lines — and used the docker as a chorus growling from across the room in ten of twenty turns. The lineup judge cannot see this (it rewards over-marking). That is the syosetu warning: overuse reads as artificial.

**npc-voice 1.1.1** answers it on the Keeper side only: the address term *or* the ending habit, not both in every sentence; no line said twice at a table; a bystander speaks only with something new. Table 3 below measures it.

**Table 3 (`voice-bench-3`, 10 turns, same Keeper and reviewer, npc-voice 1.1.1; evidence `.coc/playtests/voice-bench-3/`).** The same opening, the docker and the constable pressed twice each, then the proprietress, the comprador, the newsboy, the fortune-teller and the room.

| | table 2 (1.1.0) | table 3 (1.1.1) |
| --- | --- | --- |
| turns delivered / played | 18 / 20 | 10 / 10 |
| lineup (names stripped, deepseek-v4-flash) | 41 / 41 | 19 / 19 |
| NPC lines spoken by someone the player was not addressing | 22 of 41 (the docker 10) | 5 of 19 (the docker 1) |
| four-character runs one person reused three or more times | 10 | 1 |
| exact duplicate lines | 0 | 0 |
| median chars per turn | 357 | 374 |
| turns lost to the continuity review | 2 | 0 |

The masks are still audible (the constable's 「这位／本巡长／您写着办」, the comprador's 「本人／you know／你说是不是」, the proprietress's 「客官／是吧」) but no longer stacked; the docker answers twice and is otherwise silent; the constable ends two of five lines with a question back. Lines are in `.coc/playtests/voice-bench-3/lineup/lineup.md` for the user's own reading, which is the half of the acceptance no judge answers.

**Table 4, the real module (`mask-haunting-1`, The Haunting, 14 driver turns / 13 delivered, grok-4.6 Keeper, deepseek-v4-flash admission, npc-voice 1.1.1; evidence `.coc/playtests/mask-haunting-1/`).** Knott's office, the Globe morgue (Wilmot and Ruth Blake), Dooley's corner, the Hall of Records, the Roxbury asylum.

- Masks: six written, one silent (Vittorio, `does_not_speak`), all faithful to the book's `voice` line and told apart by address term — 老板／伙计／先看文件 (Knott), 本馆／外人／恕不外传 (Wilmot), 先生／呢／我先把这摞理好 (Ruth), 老兄／是不是／先买份报 (Dooley), 本室／查询的／请按规定来 (the clerk), 您／求您别问了 (Gabriela). The Keeper wore them: 「本馆二十分钟就是二十分钟。外人请回。恕不外传。」, 「查询的，本室不跟活人。」, 「别……别问我房间。求您别问了。」.
- Lineup with the module's full roster as distractors (eleven people, five of whom never spoke): **20/28 (71%)** — Dooley 9/9, Wilmot 3/3, Gabriela 2/2, Ruth 4/6, the clerk 1/3 (read as the court contact, an absent person of the same station), Knott 1/5. Below the 80% bar of §4, for two reasons the bench never had. (1) **The first person met is unmasked**: the lane runs on the first *committed* turn, the opening commit does not wake it, so Knott's mask landed after his first two answers — three of his five lines predate it (「马卡里奥家。」, 「听着，海斯……」). (2) The roster carries five people who never spoke, and the judge spent its wrong answers on them. A first cut of the roster used the book's English `voice` adjectives as stations (「Quiet」, 「Dry」) and scored 14/28; `voice_lineup.py` now gives the judge role and want.
- Reused four-character runs: 2, both Dooley's 「信不信随你」 (three of nine lines). Median 322 chars per turn; one continuity-review outage in fifteen reviews (turn 1, a 40 s reviewer timeout on grok-4.6).

**Fix from table 4.** `voice.job` now offers the people on stage in the current world first, so a delivered opening's commit masks the start scene while the player types their first line (`tests/kernel/test_voice_bench.py` pins it). What it does not cover, checked on a fifth bench table: the driver's `--pregen` flow has no delivered opening — turn 0 closes implicitly and empty two seconds before turn 1 opens — so on a driver table the first person met still answers once or twice unmasked. That is a property of the harness, not of the product's opening; the App's creation flow ends in a real opening narrate.

**Verdict.** Distinguishability is met on both bench tables (100% attribution, nine stations, one of them rightly silent). Sounding like a person was not met on 1.1.0 and is materially better on 1.1.1 by the two counts that name the failure; whether it is *enough* is the user's reading. The second lever, if it is not, is the style pass of §3.5 — not another rule.

## 6. Files

`mods/npc-voice/*` (1.1.1), `content/setup/npc-voice.md`, `extensions/npc-voice/index.ts`, `kernel-ts/voice/{jobs,index}.ts`, `kernel-ts/read/{capsule,assemble,module-graph}.ts`, `content/starters/voice-bench/*`, `tests/play/fixtures/voice-bench/build.mjs`, `tests/play/voice_lineup.py`, tests: `tests/kernel/test_voice.py`, `tests/kernel/test_mod_vocabulary.py`, `tests/kernel/test_capsule_nine.py`, `tests/kernel/test_capsule_budgets.py`, `tests/extension/npc-voice-lane.test.mjs`, `tests/extension/npc-voice-package.test.mjs`. Contract: `docs/kernel-rpc.md` §40.7.

## 7. Sources

- 金水敏, 役割語 — https://resou.osaka-u.ac.jp/ja/story/2019/fyvba9 ; https://ja.wikipedia.org/wiki/役割語
- 語尾・人称によるセリフのキャラ付け考察 — https://ncode.syosetu.com/n4943du/
- Speech patterns for NPCs, a GM cheat sheet — https://goupilverse.itch.io/speech-patterns-for-npcs-a-gm-cheat-sheet
- 5 Simple D&D NPC Voice Techniques — https://therpgacademy.com/articles/npc-voices-dnd
- Matt Mercer on bringing NPCs to life — https://slyflourish.com/mercer_bringing_npcs_to_life.html
- Inworld, Dialogue Style — https://docs.inworld.ai/docs/tutorial-basics/dialog-style/
- Test-Time-Matching (2025) — https://arxiv.org/abs/2507.16799
- Persona-Aware Contrastive Learning (ACL 2025) — https://aclanthology.org/2025.findings-acl.1344/
- 网文人设塑造 — https://zhuanlan.zhihu.com/p/115114785 ; https://www.wangwen666.com/post/178.html
- SillyTavern character cards — https://tavernsprite.com/blog/sillytavern-character-card-creation-guide/
