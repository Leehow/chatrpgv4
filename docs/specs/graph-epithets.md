# Epithets from the graph: every book person has the table's word before the table meets them (2026-10-03)

Status: decided 2026-10-04 (owner: 「按你推荐的做」, Q1–Q4 as recommended); contract §176. Implementation on `claude/graph-epithets-20261004`; the real-table acceptance (§4) is GE-05. Owner, 2026-10-03:
- 「对了，我发现这个外号是不是应该是图谱解析的时候就应该填的内容，解析图谱的时候能知道这个角色的很多信息，除非是一个图谱里没有的角色才现创建外号吧」
- Asked whether to build it: 「先写 spec 给我看」

Related contract: §79 (what the table calls a person), §103.5–§103.8 (untold names), §103.7 (one distinctive visible thing), §135.26 (the clerk's stated meeting), §168 (first sight), §175 (what needs no result rides with the narrate; numbered §172 on the work branch).

## 1. Evidence

Today the word the table calls an unnamed book person has three writers, and none of them is reliable.

| writer | when | what went wrong |
| --- | --- | --- |
| The Keeper's `apply person` | at first meeting, mid-turn | Costs a write. On table 18 that write took about 30 s of a 71 s turn. On table 21 the Keeper never wrote one in three turns. On table 20 it wrote the book's names (fixed by §103.8's refusal). |
| The journal lane's `label` | after each turn, when the Keeper wrote none | Guessed from the prose. On table 21 the labels moved between the three men at the gas station across turns, and the Keeper then called the owner 「老人」. |
| The clerk's stated meeting (§135.26) | when an obligation puts a person on stage | Fell back to the book's name. §103.8 item 5 removed the fallback, so without a label the meeting is now the Keeper's, an LLM step. |

Table 21, turn 3 (App `4decd9ac8`, flapcode gpt-6-luna). The player asked the owner's name, and two more gaps showed:

1. **The handle carries the name.** The Keeper never wrote `{{name:…}}`. It transliterated the handle `book-4-lars-williams` into 「拉尔斯·威廉姆斯」 and wrote that into the prose, and also tried to make it his epithet. The book calls him 「拉塞尔·威廉姆斯」. §103.8 keeps the book's names out of the Keeper's request, but a handle is the English name as a slug, and the untold view hands it to the Keeper as `untold.id` and as the fallback `name`.
2. **The word shown is not a word that resolves.**
   - The Keeper's view names an untold person by `called.name`, else `untold.label`, else the handle (`extensions/kernel/untold-view.ts`). `untold.label` falls back to the journal lane's label (`untoldBlock`, `kernel-ts/read/capsule.ts`).
   - But `apply person`'s `who` resolves only handles, book names and `world.person_labels` (`personOf`, `kernel-ts/apply/person.ts`). The Keeper wrote the word it was shown, 「手臂有海军纹身的老人」, and got `unknown_entity` twice.
   - `cash.with` accepted the same word.

Turn 4, after the owner switched the Keeper to grok-build grok-4.5 low ("要不还是换grok4.5吧"). The player asked the thin man's name. Same two gaps, so they belong to the system, not to one model:

- First step: `apply person` with `who` set to the journal label 「把香烟挂在油布旁的高瘦男人」 → `unknown_entity`.
- Second step: `who` set to the handle `book-4-nate-patterson`, `name` 「内特」 → refused `untold_name`. He was still untold when the write ran, although the same response's prose has him say his name.
- Third step: plain-text delivery, writing 「内特·帕特森」 itself, with no `{{name:}}`. This time it equals the book's name only because `nate-patterson` transliterates that way.

Across both turns, 3 of 4 refusals were the shown word not resolving. Neither model wrote `{{name:}}` once, although the untold line and the narrate field both ask for it.

## 2. What changes

Every person the graph has gets the table's word in the campaign's play language **when they enter the graph**, before anyone meets them. The kernel validates that word and stores it in the campaign. Every surface reads it, and every tool resolves it. Only a person the graph never had (a walk-on, `apply npc` with `walk_on: true`) is named at the table, as now.

### 2.1 Producer: one epithet step when people enter the graph

- **When.**
  - A starter module: at `campaign.create`, for its whole cast.
  - A PDF read on demand: whenever a reading lands people the campaign has no epithet for. That step comes after the reader's own job, not inside its extraction call (Q1).
  - Either way it runs in the background, off the turn path. The App's character creation takes minutes, which is enough for a starter cast.
- **Input**, per person:
  - the handle and the role;
  - only what a stranger sees on first meeting: the book's description of looks, dress, manner, and the job they are doing (the §168 first-sight material). Never keeper-only motives or secrets: an epithet must not spoil.
  - It also gets the whole cast and any epithets already stored, so that uniqueness is judged across the cast at once rather than meeting by meeting.
- **Output:** one epithet per person, in the play language, under §103.7's rule: one visible thing only they have here plus at most one identity word, like a nickname, not a sentence.
- **Writer:** a model lane on the "fast model" setting (one setting for all quick lanes). One call per batch. The play language is open: the epithets are generated, not looked up, and nothing branches on the language.

### 2.2 Kernel: validated, stored in the campaign

- A new write, e.g. `campaign.epithets.submit {entries: [{who: <handle>, word}]}`. It applies exactly `apply person`'s refusals:
  - no book name, alias or punctuation piece (§103.8);
  - not a handle (§103.7);
  - not the same words as another person's word (§103.7);
  - one line, at most `LABEL_LIMIT` characters, no marker.
- A refused entry goes back to the lane once with the refusal. If it fails again, that person gets no graph epithet and today's behavior applies to them.
- Stored per campaign, never in the module, because the play language is the campaign's (§28.7 keeps modules campaign-neutral): `world.person_epithets[<handle>] = {word, at}`.
- It is not `world.person_labels`, which records what the fiction established. `called.name` marks a person as met, and the clerk and the capsule depend on that.

### 2.3 Readers: one word, everywhere, and it resolves

The table's word for a book person:
1. the Keeper's own `apply person` (fiction-driven, e.g. the player nicknames him 「大胡子」);
2. else the graph epithet;
3. else the journal lane's label.

Every reader takes it from one function. Today `untoldBlock`, the untold view, the journal's `epithetOf` and the obligation meeting each read their own source:

- **The capsule:** `untold.label`.
- **The Keeper's view:**
  - the shown `name`;
  - the say-token and `who` resolvers (`ModuleGraph.nameKeys`, `calledPerson`), so the shown word always resolves, and every tool that takes a person resolves it the same way (`apply person`, `cash.with`, `resolve.target`, say tokens);
  - the sidebar and the hover label.
- **The journal lane:** its label for an unnamed person is the epithet. It still writes descriptions and exchanges.
- **The clerk's stated meeting:** it again stages the person with no LLM step, under the epithet (§103.8 item 5's hand-off to the Keeper remains only for people without one).
- **Introduction:** unchanged. `{{name:<who>}}` puts in the book's name and makes it the table's word (§103.8 item 3).

### 2.4 The Keeper never sees an untold person's handle (Q2)

The untold view already renames each untold person's book names to the shown word in the whole request. That covers host messages, tool results and look answers (`renameUntold`). The rename table gains a row for the handle and the node id. With a resolvable epithet for everyone, nothing is lost: the Keeper addresses people by the word it is shown, and the kernel resolves that word. A person with no epithet keeps today's handle fallback, a known residual.

### 2.5 Saying a name is a token the Keeper copies, not a rule it remembers

Both models ignored "write {{name:<who>}}". Each untold row in the Keeper's view carries the exact token, so saying the name is a copy, not a composition: `say_name: "{{name:<shown word>}}"`. The untold line then says only to put `say_name` where the fiction has the name said. With handles hidden (§2.4), the token is the only way the book's name can reach the prose. A name the Keeper invents is then visibly its own, not a guess from a slug.

## 3. Not changed

- Walk-ons and people the book never had: named at the table by the Keeper (`apply npc`, `walk_on: true`).
- The Keeper may still give anyone a better word mid-play with `apply person`. The refusals stay as they are.
- Existing campaigns are compile snapshots, so they get no epithets. A backfill command is possible later and is not in scope.
- No list, regex or mapping decides anything about a name or a language. The kernel's checks compare strings it holds (§103.8), and choosing the word is the lane's job.

## 4. Acceptance (real table: a new Blood Road campaign, played turn by turn as the player)

1. Before any `apply person`, the capsule, the sidebar and the prose name the three men by three distinct epithets, each built from a visible thing, and the same across at least five turns.
2. No turn spends a write on an epithet for a book person, which lowers the split rate against table 21.
3. The Keeper's request holds no handle, node id or book name of an untold person, audited like `tests/extension/untold-request.test.mjs`.
4. Asked his name, the owner answers with the book's name, delivered through `{{name:}}`, not a transliterated handle.
5. Across the table, zero `unknown_entity` refusals for a word the Keeper was shown.
6. An obligation's meeting runs as the clerk's direct step under the epithet, with no LLM step (scene-obligation-candidates covers the unit).

## 5. Open questions for the owner

- **Q1. Where is the epithet produced?**
  - Recommended: its own lane step right after people enter the graph.
  - Alternative: one more field in the reader's extraction call. Rejected because the reader's output is module-scoped and in the book's language, whereas the epithet is the campaign's, in the play language. Extraction output is also already saturated, and the cost of a build is its rounds (memory notes on module builds). The owner's "at parse time" is kept as the moment it happens, not the call that does it.
- **Q2. Should handles be hidden from the Keeper for untold people (§2.4)?** Recommended yes: it is what closes table 21's 「拉尔斯」. The cost is one more rename row per person.
- **Q4. Should each untold row carry the name token to copy (§2.5)?** Recommended yes, together with Q2. Neither alone fixed turns 3 and 4: the token without hidden handles leaves the slug to transliterate, and hidden handles without the token leave the Keeper inventing a name.
- **Q3. Should the turn-3 resolution gap be fixed now, before this spec lands?** That fix makes `who` resolve the journal label the Keeper is shown. It is small, and §2.3 subsumes it later.

## 6. Tickets (to file after the owner decides)

- GE-01: the kernel write, its validation and storage (§2.2); unit tests with the same refusal cases as `untold-names-held`.
- GE-02: one reader for the table's word, and resolution everywhere (§2.3); includes Q3's gap.
- GE-03: the epithet lane: starter trigger at `campaign.create`, PDF trigger after a reading lands new people (§2.1).
- GE-04: the handle rename in the Keeper's request (§2.4) and the `say_name` token (§2.5).
- GE-05: the real-table acceptance (§4).

## Comments
