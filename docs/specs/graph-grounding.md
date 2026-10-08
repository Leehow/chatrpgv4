# The module graph states only what its source states

Status: ready-for-agent (GG-01..GG-05 landed on `claude/graph-grounding-20261008`; GG-06..GG-09 open)

Contract: `docs/kernel-rpc.md` §199. Amends §22.3, §151.3/§186.6, §168.5, §176.3 and §194.4.

Owner standard (2026-08-13): the Keeper's invention is play; the pipeline's invention is pollution. Since §194.1 the graph is
the truth ledger the Keeper plays from, and the Keeper cannot tell a printed fact from a made-up one. So a fact a graph node
states about a person -- alive or dead, whose kin, rank or office, what an investigator sees on meeting them -- is grounded in
the page it cites, or it is not written.

## 1. What went wrong (evidence)

Real table TR-F2 run 2 (App `4ce2e4cab`, Cold Harvest = `book-2`, campaign `game-565055f1-8a99-4e69-9932-ca64c0e27d93`,
library generation 74). Per-turn log: the lead's scratchpad `trf2/run2-frozen.log`. App data read only, every probe on a
`cp -c` clone.

### 1.1 A false fact in the truth ledger

- Graph node `npc-vasili-viktorovich-smolsky`: `summary: "嘉琳娜已故的丈夫。"` ("Galena's late husband"), handle
  `deceased-husband-of-farm-resident`, epithet 「死在农场的女居民丈夫」.
- The book, p8 and p34: 「瓦西里曾是嘉琳娜的丈夫，性格温顺，希望能取悦每一个有权有势的人。嘉琳娜死后他变得愈发沮丧。」 He was her
  husband because she is dead; he is alive and central (p21 §6.2).
- At the table (T12–T13) the Keeper produced a husband 「彼得」, then 「她丈夫瓦西里已经死了」.

Where it came from:

| step | what happened | file |
| --- | --- | --- |
| producer | reading `read-30` of fork `game-56788eff` (detail, pages 33–34, 2026-10-08 06:51Z), reader child openai-codex/gpt-6-luna low, wrote the summary from p34; its `critical` listed Vasili's `agenda` and `fear` (both right) but not the summary | `module-campaigns/game-56788eff…/modules/book-2/work/read-30/attempt-1/draft.json` |
| kernel check | module-logic-v1 folds every pointer to its record: the reviewer owed `/nodes/5` | `review-plan.json` |
| vision review | `/nodes/5` supported: "Vasili is Galina's former husband; ... became more depressed after her death" -- the page restated right, the summary approved | `verify-1/unit-1/attempt-1-t8XQjk/review.json` |
| Jev claim check (shadow) | asked nothing: the one review unit also carried `/coverage`, and `factRecords` skips such a unit (`nothing_eligible`, `records: 0`) | fork `telemetry.jsonl`, `claim_support` row of read-30 |
| library | first published at library generation 36 | `modules/book-2/generations/generation-36-*/module-graph.json` |
| a later reading of p8 | wrote 「嘉琳娜的前夫……」; module-logic-v1 kept the published value for the ready node and filed the reread under `source_mappings` | generation 74 `source_mappings` |
| handle lane | minted `deceased-husband-of-farm-resident` from `name` + `summary` (§185.5) | `modules/book-2/handles.json` (06:53:01Z) |
| epithet lane | worded that handle 「死在农场的女居民丈夫」 | campaign `epithets.json` |

### 1.2 Epithets that state secrets or wrong facts

`epithets.job` re-run on a clone of the App home with this branch's kernel at `4ce2e4cab` returns the App's first job byte
for byte (`job_id …:b43142c950b1`), so these are the inputs the lane had. The lane keeps no request or answer file (only
telemetry: job 2's first attempt wrote 1 and refused 23, Sofia's being the one).

| word | the person's row in the job | source of the secret or error |
| --- | --- | --- |
| 母亲死后躲在炉子里的幼儿 (Beniamin) | `{id: "toddler-hiding-in-stove-after-mother-died"}` | the id: a handle the handle lane made from the summary 「三岁男孩；母亲死后躲在炉子里。」 |
| 国营农场被腐化的家庭成员 (Genrikh) | `{id: "corrupted-family-member-from-state-farm"}` | the id; summary 「……被罗伊格尔追随者绑在树上供其享用；如今深度腐化。」 |
| 绑在树上腐烂的家庭成员 (Grigori) | `{id: "rotting-family-member-tied-to-tree"}` | the id; the same summary |
| 变异之家的肿胀女主人 (Katarina) | `{id: "swollen-matriarch-of-mutated-household"}` | the id; summary 「已完全受罗伊格尔控制……畸变。」 |
| 受控之家的畸形家长 (Mikhail) | `{id: "grotesque-patriarch-of-controlled-family"}` | the id; the same summary |
| 邪教家庭的畸形儿子 (Pavel) | `{id: "misshapen-son-of-cultist-family"}` | the id; the same summary |
| 吹嘘杀过女人的男仆情人 (Nikita Molodin) | `{id: "manservant-lover-boasting-of-killing-woman"}` | the id; summary 「自称Upyr并承认杀害嘉琳娜。」 |
| 后背藏触手的躲闪母亲 (Maria) | `{id: "evasive-mother-hiding-tentacles", looks: <biography>}` | both: the id, and `looks` = `properties.biography`, the reader's account of her infection and tentacles |
| 指挥室桌后的高大上校 (Aganin) | `{id: "captain-at-desk-in-command-room", role, looks: <biography>}` | 高大 from the biography; the rank from the id's English "captain" (the book: 上尉) rendered 上校 |
| 戴眼镜、浓密胡须的NKVD医生 for Sofia | `{id: "wife-holding-bedroom-alongside-husband"}` (nothing else), next to Timur's `{role: "……NKVD特派员/医生。", looks: "戴眼镜、浓密胡须……"}` | a person with nothing to word, beside a neighbour; `epithets.submit` checks shape, handle, untold name and taken, never whose word it is |

So §194.4's rule (never `node.summary`) was bypassed through the id, and its "first-sight description" (`biography`) is the
reader's whole account of a person, reveals included. The page-10 residents (cast rows) were right: TL-05 fixed that path.

## 2. Decisions

1. **A person's summary and appearance are reviewed as their own pointers** (§199.2), identity statements like
   `distinct_from`: never advisory, never folded, owed by the checker and by the host's units.
2. **The deciding check is a decomposed reading, not the reviewer's verdict.** Evidence, each pre-registered before it ran:
   - Jev claim-support (shipped family v2, p34 native text, 3 repeats): the false summary `supported` 0.85–0.88 /
     `contradicted` 0.08–0.10; an explicit 「瓦西里已经去世。」 `contradicted` 0.74–0.87. Jev reads an explicit death, not a
     modifier's attachment. Not usable; and a person never clears through Jev (§199.3).
   - The vision reviewer with the pointer and the instruction, live (GG-05 run 1): `supported` twice, "the summary correctly
     calls him her late husband". Not usable alone.
   - The same model asked narrowly and apart: right 9/9.
   So the verify round adds the person-state reading: a statements reader that sees only the summaries and a pages reader
   that sees only the pages, both tool-carrying Pi children on the reviewer's model; the host compares the living state and
   refuses a mismatch as a `logic` row. Not a single completion: the reading pipeline is off the turn's critical path
   (Agents.md's two criteria), and text work runs as a Pi agent.
3. **What is compared is closed**: `alive` / `dead` / `not_stated`. Kin and rank are open or subtle (`former_spouse` vs
   `spouse`) and stay with the reviewer's instruction (GG-09).
4. **The epithet lane asks about one person per request, by their role and looks alone** (§199.5): no id (a handle is the
   summary's paraphrase), no neighbour (Sofia). Concurrency 3; `taken` grows as words are accepted.
5. **A graph person's `looks` is a reader-written first-meeting `properties.appearance`**, never the biography (§199.4); a
   person with neither appearance nor role is not offered and a word for them is refused `no_material`. First sight (§168)
   prefers `appearance` and keeps the biography for books read before §199.
6. **No semantic word-to-person check.** The owner's suggestion was a Jev Noul ("is this word about this person's looks").
   Probe (2 repeats): right person 0.95 and 0.48/0.45, wrong person 0.07, 0.19/0.16 and 0.53/0.36: no threshold separates
   them. A per-sentence "first-meeting" Jev filter of biographies kept 2 of 7 visible-look sentences. Decision 4 removes the
   failure by construction instead.

## 3. Tickets

### GG-01 Person statements are their own review pointers
Status: done. `kernel-ts/modules/review-verdicts.ts` (`PERSON_KIND`, `PERSON_STATEMENTS`, `personStatementPath`,
`statementReviewPath`), `kernel-ts/modules/visual.ts` (check owes them; `checkReview` never advisory),
`extensions/module/reader-review.ts` (`reviewGroups`, `gateRefusal(task, draft)`), `extensions/module/targeted-repair.ts`,
`content/setup/visual-reader/review.md`, `content/setup/visual-reader/read.md`.

### GG-02 The person-state reading
Status: done. `extensions/module/person-state.ts`, `content/setup/person-state-statements.md`,
`content/setup/person-state-pages.md`, `reviewCandidate`'s `statementCheck`, `ReadingService` (opening and detail).

### GG-03 First-meeting appearance
Status: done. `kernel-ts/first-sight/index.ts` (`personAppearance` = `appearance`; `personDescribed` prefers it).

### GG-04 The epithet lane: one person, no id, no word without material
Status: done. `extensions/npc-epithets/index.ts`, `kernel-ts/epithets/index.ts` (`firstMeeting`, the job's filter, the
one-person instruction), `kernel-ts/read/person-words.ts` (`no_material`).

### GG-05 Replay read-30 and sweep the published graph
Status: done. `.coc/probe-gg/replay-read30.mjs` (gitignored probe; live; evidence in the contract §199.2) and
`.coc/probe-gg/sweep-person-state.mjs` (§199.7: 1 of 27 person summaries refused, Vasili, in 3 runs over generations 74 and
75).

### GG-06 Published graphs and the source-mapping merge
Status: needs-triage. A published false summary stays until a reading republishes the node, and under module-logic-v1 a
reviewed reread of a ready node is filed as a source mapping instead of replacing it. Options: a library sweep job that runs
the person-state reading over published persons and queues a repair read for each refusal; a merge rule that lets a reviewed
person statement replace the published one. Needs an owner ruling (it changes "established values remain canonical").

### GG-07 The handle lane reads the summary
Status: needs-triage. §185.5's lane is shown each node's `summary`, so a person's handle states what the book reveals later
(`rotting-family-member-tied-to-tree`). A handle is Keeper-facing, but a person with no word is shown by it, and GG-04 leaves
more people without a word. Same rule as §194.4/§199.4 for persons (role, appearance) would need a ruling on what a person
with neither is called.

### GG-08 The claim check skips a unit that carries `/coverage`
Status: needs-triage. `factRecords` skips every record of a unit containing `/coverage`; since §187.8.1 rides coverage in a
fact unit, small readings send Jev nothing (read-30: `records: 0`).

### GG-09 Kin and rank
Status: needs-info. Whether to compare kinship as a closed reading (relation enum x roster key), and how to treat "was her
husband" (widower) against "ex-husband" (divorced) without refusing true summaries.

## Comments
