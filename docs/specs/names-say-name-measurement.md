# `say_name` measurement: copied, invented or deflected (NR-05)

Status: measured, read-only, 2026-10-07. Ticket NR-05; contract `docs/kernel-rpc.md` §188.5; spec
`docs/specs/names-in-the-request-rename.md` problem 6. No product change follows from this report.

Script: `tests/play/measure_say_name.py` (standard library only; no model, no network; nothing under the data roots is
written). Run it as

```
uv run --frozen python tests/play/measure_say_name.py --hand-read          # numbers below
uv run --frozen python tests/play/measure_say_name.py                      # mechanical classes only
uv run --frozen python tests/play/measure_say_name.py --json rows.json     # every row, for audit
```

The output is deterministic (two runs hash the same). The hand-read labels are inside the script (`HAND_READ`), so the
reading is reproducible and reviewable; the classifier never reads them.

## Result

The question (§188.5): when the fiction has an untold book person's name said, does the Keeper copy that person's
`say_name` (`{{name:<word>}}`), write a different name of its own, or deflect?

- **Total.** 22 tables, 117 turn x person rows where the request hid the book's name. In **37** of them the player asked the
  person's name and the person answered (an "ask"). The Keeper **copied `say_name` in 6**, **wrote a name of its own in 11**,
  **wrote the book's own name (full, alias or a piece) without a visible token in 10**, and **deflected in 10** (a title, a
  nickname, or no name).
- **With the full `say_name` path in the kernel's capsule (era E2; the nfh, rc and rd tables, all
  flapcode/gpt-6-luna low): 7 asks, 0 copied, 4 invented, 3 deflected.** In those tables the Keeper wrote no `{{name:}}`
  token at all.
- **The only copies in the scanned data are 6 tokens in 5 of the 6 tableau-closer replays** (one table, 10-04,
  grok-build/grok-4.5 low), where `say_name` rode the extension's view (§176.8). There it was copied in 6 of the 9 asks
  of the two people whose rows carried it (gas-station owner 2 of 5, bartender 4 of 4 visible) and in 0 of the 6 asks of
  the veteran, whose stub carried none.
- **Per model.** grok-build/grok-4.5 low: 28 asks = 6 copied / 7 invented / 8 book name / 7 deflected. flapcode/gpt-6-luna
  (low and none): 9 asks = 0 / 4 / 2 / 3.
- **Invented names (11):** 7 landed through `apply person`, so they became the table's word for the person; 4 stayed in
  prose only (马丁, 哈珀, 沃尔特, 巴德) and the kernel never learned them. 2 of the 11 were given to a walk-on the kernel holds
  as table-made (卡尔, 埃德), not to a book person. `厄尔` was invented three times, for two different people, on three
  different tables, by the same model.
- **The measurement has a hole where it matters most.** A campaign record keeps the delivered text after the kernel put the
  book's name where a token stood, and keeps no tool arguments, so the App tables cannot tell a copied token from a literal
  name: 7 of the 15 E1 asks are "the book's name was delivered, token or literal".

## Method

### What is read

| source | what it holds | used for |
|---|---|---|
| App campaigns, `~/Library/Application Support/Pipi/pipicoc/pi-coc/.coc/campaigns/*/turns/NNNN.json` | player text, delivered text, `speech[]` rows, `person` receipts, the capsule the Keeper was given (`capsule.present[].untold`) | App tables; the capsule of every table |
| other campaigns, `~/leehow/code/*/.coc/campaigns/*` and the acceptance home | the same | tables played from a worktree |
| driver runs, `~/leehow/code/*/.coc/playtests/*/turn-N.json` and `chatrpgv4-nfh-acceptance-home/playtests/*` | the Keeper's tool calls **with arguments** (the raw `narrate`/`ask`/`apply` text), results, `final_text` | the raw `{{name:}}` token; person effects; replays |
| `driver.log`, `final.json`; campaign `telemetry.jsonl` | spawn line with `--provider/--model/--thinking`; `provider-request` rows by turn | the Keeper model |
| the book's module graph, `world.json` (`node_handles`, `table_people`), `epithets.json` | names and aliases a book gives a person; handles; walk-ons; this table's word per person | what counts as "the book's name" |

675 driver runs (7,363 turns) and 1,052 campaign records that no driver run produced were read.

### Unit, hidden name, eras

- **Unit:** one turn of one table times one person. A driver turn whose delivered text and player text equal a campaign
  record's is that record and is counted once (from the driver's richer view). A driver turn that only shares the player
  text with a record borrows that record's capsule: a **replay** (era suffix `r`; the tableau-closer sequences replay
  turns 2-8 of App table `game-24bb66cb`). A record no driver run produced is a unit of its own.
- **Hidden name at a turn:** the capsule of the turn (or the next) lists the person with an `untold` block, or no earlier
  delivered text shows the book's name or display name for them (the kernel's own told rule, `journal/naming.ts`
  `toldTurn`, read from the records).
- **Eras, read from the shape of the kernel's own `untold` block, not from dates:** E0 no `id` in the block (before §103.5:
  the Keeper still saw the book's name; 175 rows, excluded); **E1** `id`, no `say_name` (the name is hidden, the token is
  instructed but not offered); **E2** `say_name` in the block (§176.8: the Keeper is handed the token); E? no untold block
  within eight turns (133 rows, excluded: no evidence the name was hidden).

### Mechanical classes (strings the kernel holds; no word list, no classifier of meaning)

| class | rule |
|---|---|
| AI | copied `say_name`: the raw text carries `{{name:W}}` and W is the person's table word, handle, epithet, or the one graph person whose name the delivery shows although the raw text never wrote it |
| BB / BBp | the delivered text writes a full book name or alias (BBp: a piece of it, split on punctuation) and the raw text has no token. A name the player's text writes, or the investigator's, is not counted |
| BN / BNp | the same, for a record that kept no raw text: a copied token and a literal name cannot be told apart |
| BI | a `person` effect put a word on the person that is neither the shown word, the handle, the epithet nor a book name, **and the person says that word in their own line** (「叫我罗伊就行」). A word the person never says (a re-stated epithet) makes no row |
| J | a hidden-name book person speaks (a say line) and nothing above fired: needs judgment |

One primary class per row, in the order AI, BB, BBp, BI, J (BN/BNp in place of BB/BBp when no raw text exists).

### Reading step (not mechanical)

"The player asked this person's name" and "the person deflected" are prose semantics, and the repository forbids deciding
them with a word list. The script therefore stops at J. The author of this report read **every J, BI, BN and BNp row**
(player text and the person's line) and wrote the result into `HAND_READ`:

| label | meaning |
|---|---|
| ask-copied | the name was asked and the Keeper copied the token (every AI row; all were asks) |
| ask-invented | asked, and the person gives a name the book does not give them |
| ask-book-name | asked, and the person gives the book's own name (full, alias or piece), no token visible |
| ask-deflected | asked, and the person answers with a title, a nickname or no name |
| ask-third-party, invented-unasked, book-name-unasked, no-ask | read and set aside (not an ask of this person, or not an ask) |

A J row without a label was read and is not a name ask. One reader; no second reading.

## Numbers

### By era and Keeper model (asks, from the reading)

`E1r` is the replay group. The telemetry's `reasoning_effort` of null is shown as `none`.

| era | model | ask-copied | ask-invented | ask-book-name | ask-deflected | asks | ask-third-party | invented-unasked | book-name-unasked |
|---|---|---|---|---|---|---|---|---|---|
| E1 | flapcode/gpt-6-luna none | 0 | 0 | 2 | 0 | 2 | 0 | 0 | 1 |
| E1 | grok-build/grok-4.5 low | 0 | 3 | 5 | 5 | 13 | 1 | 0 | 1 |
| E1r | grok-build/grok-4.5 low | 6 | 4 | 3 | 2 | 15 | 0 | 1 | 0 |
| E2 | flapcode/gpt-6-luna low | 0 | 4 | 0 | 3 | 7 | 0 | 0 | 0 |
| **all** |  | 6 | 11 | 10 | 10 | 37 | 1 | 1 | 2 |

Shares: E1 (15 asks): copied 0, invented 3 (20%), book name 7 (47%), deflected 5 (33%). E1r (15): copied 6 (40%), invented 4
(27%), book name 3 (20%), deflected 2 (13%). E2 (7): copied 0, invented 4 (57%), deflected 3 (43%).

### By table (asks, from the reading)

| table | model | era | ask-copied | ask-invented | ask-book-name | ask-deflected | asks |
|---|---|---|---|---|---|---|---|
| game-24bb66cb-df6e-4ebb-a0c8-aa22b59e7eb7 | grok-build/grok-4.5 low | E1 | 0 | 0 | 2 | 0 | 2 |
| game-33170a20-b06f-4e06-b488-d5182d62c22c | grok-build/grok-4.5 low | E1 | 0 | 1 | 1 | 0 | 2 |
| game-45cd3976-d028-4c94-a6ed-c2326527f727 | grok-build/grok-4.5 low | E1 | 0 | 1 | 1 | 0 | 2 |
| game-7e9db15c-adb6-4d71-ac38-194c80623394 | grok-build/grok-4.5 low | E1 | 0 | 0 | 0 | 3 | 3 |
| game-8e41c325-5c5c-420e-bae8-0c2f7c7a167c | grok-build/grok-4.5 low | E1 | 0 | 0 | 1 | 0 | 1 |
| game-d78dd9ec-137f-49a1-85fe-1dda74e292ae | grok-build/grok-4.5 low | E1 | 0 | 1 | 0 | 2 | 3 |
| game-e8e9249b-ad9b-453f-8223-b4ae53b46340 | flapcode/gpt-6-luna none | E1 | 0 | 0 | 1 | 0 | 1 |
| game-f4d8e72b-1f59-49a6-8ff7-f57abeef7eb5 | flapcode/gpt-6-luna none | E1 | 0 | 0 | 1 | 0 | 1 |
| nfh-accept-blood-road-1-play-1 | flapcode/gpt-6-luna low | E2 | 0 | 0 | 0 | 3 | 3 |
| nfh-accept-blood-road-1-play-2 | flapcode/gpt-6-luna low | E2 | 0 | 3 | 0 | 0 | 3 |
| rc-accept-blood-01-play | flapcode/gpt-6-luna low | E2 | 0 | 1 | 0 | 0 | 1 |
| tc-A1-20261004 | grok-build/grok-4.5 low | E1r | 1 | 0 | 1 | 1 | 3 |
| tc-A2-20261004 | grok-build/grok-4.5 low | E1r | 2 | 1 | 0 | 0 | 3 |
| tc-B1-20261004 | grok-build/grok-4.5 low | E1r | 1 | 1 | 1 | 0 | 3 |
| tc-B2-20261004 | grok-build/grok-4.5 low | E1r | 1 | 1 | 0 | 0 | 2 |
| tc-C1-20261004 | grok-build/grok-4.5 low | E1r | 1 | 0 | 1 | 1 | 3 |
| tc-C2-20261004 | grok-build/grok-4.5 low | E1r | 0 | 1 | 0 | 0 | 1 |

### Mechanical classes, per table (script only, no reading)

| table | model | era | AI | BI | BB | BBp | BN | BNp | J | total |
|---|---|---|---|---|---|---|---|---|---|---|
| game-24bb66cb-df6e-4ebb-a0c8-aa22b59e7eb7 | grok-build/grok-4.5 low | E1 | 0 | 0 | 0 | 0 | 1 | 1 | 4 | 6 |
| game-33170a20-b06f-4e06-b488-d5182d62c22c | grok-build/grok-4.5 low | E1 | 0 | 1 | 0 | 0 | 1 | 0 | 3 | 5 |
| game-45cd3976-d028-4c94-a6ed-c2326527f727 | grok-build/grok-4.5 low | E1 | 0 | 1 | 0 | 0 | 1 | 0 | 4 | 6 |
| game-52b14239-a683-4403-8eb8-e5238687f241 | flapcode/gpt-6-luna low | E1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| game-78163ec8-0dbb-4ec4-bfd7-af5ee183163b | flapcode/gpt-6-luna low | E1 | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 5 |
| game-7e9db15c-adb6-4d71-ac38-194c80623394 | grok-build/grok-4.5 low | E1 | 0 | 0 | 0 | 0 | 0 | 0 | 9 | 9 |
| game-8e41c325-5c5c-420e-bae8-0c2f7c7a167c | grok-build/grok-4.5 low | E1 | 0 | 0 | 0 | 0 | 0 | 2 | 5 | 7 |
| game-91d04b3a-fad7-4f7b-b516-492102e8eab6 | flapcode/gpt-6-luna low | E1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| game-91d04b3a-fad7-4f7b-b516-492102e8eab6 | flapcode/gpt-6-luna none | E1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 |
| game-d78dd9ec-137f-49a1-85fe-1dda74e292ae | grok-build/grok-4.5 low | E1 | 0 | 1 | 0 | 0 | 0 | 1 | 11 | 13 |
| game-e8e9249b-ad9b-453f-8223-b4ae53b46340 | flapcode/gpt-6-luna low | E1 | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 5 |
| game-e8e9249b-ad9b-453f-8223-b4ae53b46340 | flapcode/gpt-6-luna none | E1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 1 |
| game-f4d8e72b-1f59-49a6-8ff7-f57abeef7eb5 | flapcode/gpt-6-luna low | E1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| game-f4d8e72b-1f59-49a6-8ff7-f57abeef7eb5 | flapcode/gpt-6-luna none | E1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 |
| nfh-accept-blood-road-1 | flapcode/gpt-6-luna low | E2 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| nfh-accept-blood-road-1-play-1 | flapcode/gpt-6-luna low | E2 | 0 | 0 | 0 | 0 | 0 | 0 | 10 | 10 |
| nfh-accept-blood-road-1-play-2 | flapcode/gpt-6-luna low | E2 | 0 | 2 | 0 | 1 | 0 | 0 | 5 | 8 |
| rc-accept-blood-01-play | flapcode/gpt-6-luna low | E2 | 0 | 1 | 0 | 0 | 0 | 0 | 6 | 7 |
| rd-accept-blood-01-play | flapcode/gpt-6-luna low | E2 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| tc-A1-20261004 | grok-build/grok-4.5 low | E1r | 1 | 0 | 0 | 1 | 0 | 0 | 3 | 5 |
| tc-A2-20261004 | grok-build/grok-4.5 low | E1r | 2 | 1 | 0 | 0 | 0 | 0 | 3 | 6 |
| tc-B1-20261004 | grok-build/grok-4.5 low | E1r | 1 | 0 | 0 | 1 | 0 | 0 | 3 | 5 |
| tc-B2-20261004 | grok-build/grok-4.5 low | E1r | 1 | 0 | 0 | 0 | 0 | 0 | 3 | 4 |
| tc-C1-20261004 | grok-build/grok-4.5 low | E1r | 1 | 0 | 1 | 0 | 0 | 0 | 3 | 5 |
| tc-C2-20261004 | grok-build/grok-4.5 low | E1r | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 3 |

### Mechanical classes, per Keeper model

| model | AI | BI | BB | BBp | BN | BNp | J | total |
|---|---|---|---|---|---|---|---|---|
| flapcode/gpt-6-luna low | 0 | 3 | 0 | 1 | 0 | 0 | 36 | 40 |
| flapcode/gpt-6-luna none | 0 | 0 | 0 | 0 | 1 | 2 | 0 | 3 |
| grok-build/grok-4.5 low | 6 | 4 | 1 | 2 | 3 | 4 | 54 | 74 |
| **all** | 6 | 7 | 1 | 3 | 4 | 6 | 90 | 117 |

Legend: AI copied token; BI a said word set by `apply person`; BB / BBp a book name / a piece of one written with no token;
BN / BNp the same where the raw text is not kept; J needs judgment.

Per era (rows): E0 175 (excluded), E1 62, E1r 28, E2 27, E? 133 (excluded).

## Examples (one line each)

Copied (6): `tc-A1#6` bartender, 「叫我{{name:急需现金的供侄者}}就行。炖肉马上好。」; `tc-A2#2` gas-station owner, 「我是{{name:带油布的加油站老板}}。休斯顿来的啊……汤姆。」;
`tc-B2#2` the same, 「还没请教——我叫{{name:带油布的加油站老板}}。」; `tc-A2#6`, `tc-B1#6`, `tc-C1#6` bartender, token only.

Invented (11): 「叫我罗伊就行」 (bartender, `apply person`, nfh play-2 #5); 「叫卡尔」 (the store's counterman, a person with no book node, nfh
play-2 #7); 「我叫马丁」 (cook, prose only, nfh play-2 #3); 「叫我埃德」 (a walk-on in rc #13); 「叫我厄尔就行」 (Nate Patterson,
`game-33170a20` #8 and `game-45cd3976` #8); 「叫我老乔就行」 (Nate, `game-d78dd9ec` #7); 「叫我厄尔就行」 (the veteran, tc-A2 #4, `apply person`); 「人叫我沃尔特就行」 / 「叫我哈珀就行」 /
「人叫我巴德就行」 (the veteran in tc-B2, tc-B1, tc-C2, prose only).

Book's own name, no token visible (10): 「拉塞尔·威廉姆斯，先生」 (`game-24bb66cb` #3); 「我叫罗伯特·泰勒」 (`game-33170a20` #3); 「这儿都叫我罗伯特·泰勒」
(`game-45cd3976` #3); 「叫我罗伯特就行」 (`game-8e41c325` #5, first name only); 「拉斯。拉塞尔也行」 (`game-e8e9249b` #5); 「威廉姆斯。先生，……」
(tc-A1 #2, a piece of the book's name that a `lookup kind=source` answer had carried unrenamed).

Deflected (10): 「叫我老板就行。先把油加上，名字以后再说也不迟。」 (nfh play-1 #2); 「叫我老板就行。这里的人都这么叫我。」 (nfh play-1 #13);
「叫我老兵就行。你呢？」 (nfh play-1 #4); 「真名没人用，叫出来也记不住」 (`game-7e9db15c` #4); 「真名？……叫老卡也行」 (`game-7e9db15c` #6);
「外头的人多半就叫我老头」 (tc-C1 #4).

## Cross-checks

- **The nfh table (`nfh-accept-blood-road-1`, flapcode/gpt-6-luna low).** The known data points are all found: 「叫我罗伊」
  (BI), 「叫卡尔」 (BI, no book node), 「我叫马丁」 (J, prose only, read as invented), 「叫我老板就行」 twice (play-1 #2 and #13),
  and a third deflection 「叫我老兵就行」 (play-1 #4). The ask at play-1 turn 3 (the veteran) ended with the host notice "this turn ended
  without a delivered result", so it has no row.
- **§176.8's own tally for the tableau-closer sequences is reproduced.** The veteran (turn 4 of each replay): A1
  deflected, A2 「厄尔」 with `apply person`, B1 「哈珀」, B2 「沃尔特」 (plus C1 deflected, C2 「巴德」). The bartender (turn 6):
  copied in A1, A2, B1 (and C1); B2 and C2 delivered without a visible token.
- **§103.8's token path in the App tables.** No App record holds a `{{name:}}` token, so the contract's "3 times in 4" for table
  21 cannot be re-derived here; the 7 E1 BN/BNp asks are the closest the App records can show.

## Limits

1. **Small, uneven samples.** E2 is 7 asks from three tables and one model; the replays are six runs of the same seven
   player lines on one table, so they are not independent. Read the percentages as counts.
2. **No raw text in a campaign record.** BN/BNp cannot separate a copied token from a literal name (10 of 37 asks are
   `ask-book-name`; 7 of them are E1 App rows). The copy rate of the App tables is bounded below by 0 and above by those 7.
3. **A delivery with no say token hides who spoke**, so a name invented in such prose is invisible to the script and to
   the speech rows. The table below counts them per table; in the E2 tables 4 of 22 nfh turns, 11 of 24 rc turns and 15 of
   20 rd turns are such deliveries (most are narration with nobody speaking, but the script cannot tell). One spot check
   outside the script: `tc-C2` turn 7 delivered 「巴德呗」 as the bartender's answer about another man, in an unmarked delivery.
4. **A person introduced and named in the same turn** is in no capsule and no earlier delivery, and is missed unless a
   token or a person effect names them.
5. **AI does not verify that the token's word is the one offered.** The extension's own copy of the capsule is not recorded.
   The bartender's words in the replays (`急需现金的供侄者`, `寄钱养侄的急需现金者`, ...) differ from run to run and are in no
   original record, so each is a label that run produced and the Keeper can only have taken from its view; they resolve to
   the bartender through the book's name the delivery shows.
6. **The replays ran with `say_name` in the Keeper's view through the extension (§176.8), while their record shape says E1.**
   They are reported as their own group (`E1r`) for that reason; the contract text is the only evidence for that.
7. **One reader** for the hand labels. A different reader may call 「叫我老卡也行」 a name rather than a deflection.
8. **Outside the ticket's roots, not counted.** A probe of `~/.codex/worktrees` found no further name ask in the say_name era;
   it holds one more `{{name:}}` token (grok-build/grok-4.5 low, a Jev regression fixture, `Doctor Morgan`).
9. **E0 and E? rows (308) are excluded**; before §103.5 the Keeper could read the name, so nothing there says how it behaves
   without one.

### What the script cannot see, per counted table

| table | turns | no delivery | delivery with no say marker |
|---|---|---|---|
| game-24bb66cb-df6e-4ebb-a0c8-aa22b59e7eb7 | 9 | 0 | 3 |
| game-33170a20-b06f-4e06-b488-d5182d62c22c | 10 | 0 | 2 |
| game-45cd3976-d028-4c94-a6ed-c2326527f727 | 9 | 0 | 1 |
| game-52b14239-a683-4403-8eb8-e5238687f241 | 2 | 0 | 1 |
| game-78163ec8-0dbb-4ec4-bfd7-af5ee183163b | 6 | 0 | 1 |
| game-7e9db15c-adb6-4d71-ac38-194c80623394 | 9 | 0 | 1 |
| game-8e41c325-5c5c-420e-bae8-0c2f7c7a167c | 8 | 0 | 2 |
| game-91d04b3a-fad7-4f7b-b516-492102e8eab6 | 4 | 0 | 2 |
| game-d78dd9ec-137f-49a1-85fe-1dda74e292ae | 12 | 0 | 1 |
| game-e8e9249b-ad9b-453f-8223-b4ae53b46340 | 7 | 0 | 3 |
| game-f4d8e72b-1f59-49a6-8ff7-f57abeef7eb5 | 5 | 0 | 2 |
| nfh-accept-blood-road-1 | 3 | 2 | 0 |
| nfh-accept-blood-road-1-play-1 | 14 | 2 | 4 |
| nfh-accept-blood-road-1-play-2 | 8 | 0 | 0 |
| rc-accept-blood-01-play | 24 | 0 | 11 |
| rd-accept-blood-01-play | 20 | 0 | 15 |
| tc-A1-20261004 | 7 | 0 | 1 |
| tc-A2-20261004 | 7 | 0 | 0 |
| tc-B1-20261004 | 7 | 0 | 1 |
| tc-B2-20261004 | 7 | 0 | 1 |
| tc-C1-20261004 | 7 | 0 | 2 |
| tc-C2-20261004 | 7 | 0 | 2 |

## What this says about the §188.5 choice (observations, not a decision)

- Whether an invented name for a book person should be an `apply person` word is already half-decided by the Keeper:
  7 of 11 invented names were put on the person with `apply person` (the table calls them that from then on), 4 were not.
- Where the offered `say_name` was in the Keeper's view and the person had a row, grok-build/grok-4.5 copied it most of the time
  (6 of 9); flapcode/gpt-6-luna never did in 9 asks. The behaviour differs by model, not only by whether the token is offered.
- The 10 deflections give a title (老板, 老兵, 老头) or a nickname (老卡), never a personal name.

## Appendix A. Needs judgment (J rows, E1/E2/T)

A hidden-name book person speaks and nothing mechanical fired: 90 rows. "read as" is the reading.

| row (table#turn person) | era | player (clipped) | the person says (clipped) | read as |
|---|---|---|---|---|
| game-24bb66cb#2 lars-williams | E1 | 我朝那个口袋挂着油布的高瘦男人点点头：“加满吧。顺便问一句，镇上有地方能吃顿热… | 「行，先生，油箱盖拧开就行，我这就给你加。」 / 「加满大概九块五毛上下，按实加的算。这一… | no-ask |
| game-24bb66cb#4 nate-patterson | E1 | 我把皮卡钥匙揣回兜里，走到棚下那个捏着啤酒罐、一口烂牙的男人旁边：“老兄，最近… | 「坐啊，小伙子。红白相间的货车？三十来岁、小胡子？」 | no-ask |
| game-24bb66cb#6 robert-taylor | E1 | 我跟三位道了别，开车顺着土路进镇，找那家叫“最后一站”的店，进门找个靠窗的位子… | 「热的？冰水也有。今早有炖肉配土豆、汉堡、辣肉酱配玉米饼，厨子手艺不差。热饭加冰水一块二就… | no-ask |
| game-24bb66cb#8 robert-taylor | E1 | 我喝了口冰水，随口问罗伯特：“加油站那儿有个一口烂牙、说自己开过长途的老兄，挺… | 「哦，那个啊——跟拉斯一块儿坐棚底下的。真名我还真叫不上来，镇上谁也不怎么喊全名，就当他是… | ask-third-party |
| game-33170a20#2 lars-williams | E1 | 我让老板把油加满，描一句我在找一个十九岁的金发女孩，问他最近有没有什么外地人路… | 「加满啊。这一箱大概九块半，伙计。」 / 「金发的？这镇口过路的人不多。我这儿就卖油修车，… | no-ask |
| game-33170a20#7 nate-patterson | E1 | 我谢过他，吃完汉堡开回加油站，在棚底下找那个一口烂牙的老司机，递上一罐冰啤酒，… | 「哟，老弟，懂规矩。坐啊，这鬼日头能把人烤干。」 / 「蓝壳虫……甲壳虫啊。干线上啥车都有… | no-ask |
| game-33170a20#9 nate-patterson | E1 | “厄尔，镇上哪儿能寄信、打长途电话？我得给委托人报个平安。” | 「寄信啊……老弟，这破地方哪有正经邮局。镇中心那头木头杂货店，灰围裙那家，有时能捎邮票、把… | no-ask |
| game-45cd3976#1 lars-williams | E1 | 我右转开上土路去阿巴托尔。进了镇子先找个能加油的地方停下，顺便看看那里都有些什… | 「加满？还是先看看机油。这鬼天，车容易闹脾气。」 | no-ask |
| game-45cd3976#2 lars-williams | E1 | 我让老板把油加满，描一句我在找一个十九岁的金发女孩，问他最近有没有什么外地人路… | 「加满大概八块五毛，现金就行。」 / 「金发的十九岁？这几天倒是来过几辆外地车，加完油就走… | no-ask |
| game-45cd3976#2 nate-patterson | E1 | 我让老板把油加满，描一句我在找一个十九岁的金发女孩，问他最近有没有什么外地人路… | 「外地车啊，老弟，我从前跑长途那会儿，这种土镇口天天见，加完油掉头就没影儿。金发小姑娘？我… | no-ask |
| game-45cd3976#7 nate-patterson | E1 | 我谢过戴夫，吃完汉堡开回加油站，在棚底下找那个一口烂牙的老司机，递上一罐冰啤酒… | 「哟，老弟还知道带酒啊。蓝色甲壳虫？甲壳虫这车我见得多了，蓝的也有——可最近几天在这鬼镇口… | no-ask |
| game-52b14239#0 lars-williams | E1 |  | “来加油的？把车停到泵边吧。镇里没什么好逛的，办完事就走，马拉松那边的餐馆多得多。” | no-ask |
| game-78163ec8#1 lars-williams | E1 | 开进镇子，把车停在加油站的油泵边，下车看看棚下那几个人。 | “要加油就直说，别在太阳底下耗着。这里没什么好看的。” | no-ask |
| game-78163ec8#2 lars-williams | E1 | 我朝那位老板点点头：“加满吧。顺便问一句，镇上有地方能吃顿热饭吗？” | “吃热饭啊？有是有，往前走一段就是最后一站，能吃，也能住。不过先说好，加油得按泵上的价算，… | no-ask |
| game-78163ec8#3 lars-williams | E1 | “普通的就行。”我看了眼泵上的标价，从钱包里数出钱递给他，“最后一站是家饭馆？… | “普通油，按泵上的价算。你看过了，回头我把找零给你。最后一站就在前面，沿着这条路走，看到那… | no-ask |
| game-78163ec8#4 robert-taylor | E1 | “谢了。”加完油我把车开到最后一站门口停好，进去找个靠窗的位子坐下，看看菜单。 | “早上好，伙计。吃点什么，还是先看看？” | no-ask |
| game-78163ec8#5 robert-taylor | E1 | “来份今天的热菜，再来杯咖啡。”我把菜单合上，压低声音问他，“这镇上平时过路的… | “车嘛，偶尔有，算不上多。大车一般沿主路过去，进镇的没几辆。你找的是哪一辆？有车号、公司名… | no-ask |
| game-7e9db15c#1 lars-williams | E1 | 我右转开上土路去阿巴托尔。进了镇子先找个能加油的地方停下，顺便看看那里都有些什… | 「加满？还是加点就走。」 | no-ask |
| game-7e9db15c#2 lars-williams | E1 | “加满。”我下车把油箱盖拧开，递上一张照片：“顺便问一句，我在找一个十九岁的金… | 「加满是吧。五毛七一加仑，九加仑左右，五块出头。」 / 「十九岁金发姑娘、蓝甲壳虫？这站上… | no-ask |
| game-7e9db15c#2 nate-patterson | E1 | “加满。”我下车把油箱盖拧开，递上一张照片：“顺便问一句，我在找一个十九岁的金… | 「蓝甲壳虫？我倒是记得路上见过甲壳虫，可颜色对不上，也没数是不是金发妞开的。这地方一天就那… | no-ask |
| game-7e9db15c#3 lars-williams | E1 | 我数了五块钱加两个钢镚递过去：“谢了。镇上哪儿能吃顿饭？”问清楚就开过去，进门… | 「往前开，镇中心就那一家——最后一站。沙龙样的门脸，木头印第安人立门口，错不了。」 | no-ask |
| game-7e9db15c#3 robert-taylor | E1 | 我数了五块钱加两个钢镚递过去：“谢了。镇上哪儿能吃顿饭？”问清楚就开过去，进门… | 「汉堡一份，一块两毛五。厨房这会儿就做。」 / 「我这儿管事。叫我老板就行，外头人也这么喊… | ask-deflected |
| game-7e9db15c#4 robert-taylor | E1 | 我咬了口汉堡，笑了笑：“我叫卡尔。老板总得有个名字吧？还有，镇上有没有常跑这条… | 「卡尔是吧。我这儿就叫老板，外头人也这么喊，真名没人用，叫出来也记不住。你汉堡还行吧？热乎… | ask-deflected |
| game-7e9db15c#5 nate-patterson | E1 | 我吃完汉堡，跟老板买了两罐冰啤酒，开回埃索站。在棚底下找到那个一口烂牙的老司机… | 「哟，老哥，这下对了。坐下呗，这鬼地方的油泵一天也没几个人摸，我闲着也是闲着。」 / 「甲… | no-ask |
| game-7e9db15c#6 nate-patterson | E1 | “谢了老哥。还没请教，怎么称呼？”我也蹲到他旁边的阴凉里，自己拉开另一罐啤酒。 | 「谢啥啊，啤酒是你的。真名？社保本子上那一串也没人念，这镇上谁还正经自我介绍。你就接着叫老… | ask-deflected |
| game-7e9db15c#7 nate-patterson | E1 | “行，老卡。”我跟他碰了下罐子，“问你个正事：镇上哪儿能寄信、打长途电话？我得… | 「寄信啊？往里走，镇中心那栋红砖两层楼，牌子上写着镇政府，底下小字Est. 1943，右边… | no-ask |
| game-8e41c325#1 lars-williams | E1 | 我右转开上土路去阿巴托尔。进了镇子先找个能加油的地方停下，顺便看看那里都有些什… | 「要加油？泵还能用。加满还是加点儿就走？」 | no-ask |
| game-8e41c325#2 lars-williams | E1 | 我让老板把油加满，描一句我在找一个十九岁的金发女孩，问他最近有没有什么外地人路… | 「加满……按这会儿油价，大概十一块五毛上下，哥们儿。你看表，跳完再说。」 / 「外地人啊…… | no-ask |
| game-8e41c325#3 lars-williams | E1 | 我付了油钱，又问棚下那几位：镇上哪里能吃饭、住一晚？也顺便问问最近有没有一辆蓝… | 「吃住啊……往前开一点，有家叫最后一站的，能吃饭，也有几间房。不过哥们儿，真要舒服，还是继… | no-ask |
| game-8e41c325#3 nate-patterson | E1 | 我付了油钱，又问棚下那几位：镇上哪里能吃饭、住一晚？也顺便问问最近有没有一辆蓝… | 「最后一站就行，老哥，我从前跑车常停那儿，床板硬点，总比睡车里强。热水、吃的都有。蓝甲壳虫… | no-ask |
| game-8e41c325#4 robert-taylor | E1 | 我开车去“最后一站”，点一份热饭，问吧台后面的老板这几天有没有别的外地人在店里… | 「热饭有，厨子现做。一份两块五，汉堡、辣肉酱或者今日炖的都行，你点。 / 「住客啊……这地… | no-ask |
| game-91d04b3a#1 lars-williams | E1 | 顺着土路开进镇子，看见加油站就把车停到油泵边。 | “加油还是修车？要是只加油，把盖子打开就行。” | no-ask |
| game-d78dd9ec#1 lars-williams | E1 | 我右转开上土路去阿巴托尔。进了镇子先找个能加油的地方停下，顺便看看那里都有些什… | 「要加油？泵是通的。修车也行，这儿工具齐。」 / 「加满就走也行。这地方……待久了没意思。… | no-ask |
| game-d78dd9ec#2 lars-williams | E1 | “加满。”我下车把油箱盖拧开，递上一张照片：“顺便问一句，我在找一个十九岁的金… | 「加满是吧。眼下五毛五一加仑，十来加仑也就五六块的事，师傅。泵我给你开着——你点头我就加。… | no-ask |
| game-d78dd9ec#2 nate-patterson | E1 | “加满。”我下车把油箱盖拧开，递上一张照片：“顺便问一句，我在找一个十九岁的金… | 「老弟，这条线我从前跑过不知多少趟，金发蓝壳的甲壳虫啊——记不得。日子过得闷，一天就那么几… | no-ask |
| game-d78dd9ec#3 lars-williams | E1 | “加满吧。”加完我数了钱递过去：“谢了。镇上哪儿能吃顿饭？”问清楚就开过去，进… | 「谢了。要吃饭？镇中心那家最后一站，旧沙龙样子，木板路那边就到。汉堡、啤酒都有。」 | no-ask |
| game-d78dd9ec#3 robert-taylor | E1 | “加满吧。”加完我数了钱递过去：“谢了。镇上哪儿能吃顿饭？”问清楚就开过去，进… | 「汉堡一块五，厨房这就做。我这儿当差的，叫我老板就行——有事喊一声。啤酒也要吗？」 | ask-deflected |
| game-d78dd9ec#4 robert-taylor | E1 | “来一罐。”我笑了笑，“我叫卡尔。老板总得有个名字吧？还有，镇上有没有常跑这条… | 「一罐七毛五，卡尔。钱搁台上就行。名字啊——镇上的人都喊我老板，你也跟着喊，省得记。有事直… | ask-deflected |
| game-d78dd9ec#5 nate-patterson | E1 | 我付了啤酒钱，吃完汉堡，又跟老板买了两罐冰啤酒开回埃索站。在棚底下找到那个一口… | 「哎哟，老弟，这礼够意思。坐，坐。」 / 「跑长途啊，那是以前的事了，肯塔基、德州这条线我… | no-ask |
| game-d78dd9ec#6 nate-patterson | E1 | 我把冰啤酒递给那个烂牙的老司机：“老哥，最近有没有见过一辆蓝色甲壳虫？” | 「哎，老弟，刚才不就说了吗——这阵子棚底下我盯着的，多半是皮卡、拉货的，蓝小甲壳虫没往心里… | no-ask |
| game-d78dd9ec#8 nate-patterson | E1 | “有事儿，找人。”我跟他碰了下罐子，“老乔，问你个正事：镇上哪儿能寄信、打长途… | 「办事啊。寄信这镇上没正经邮局，杂货店那边有时能代收代寄，看老板心情；真要写信，多半还得往… | no-ask |
| game-d78dd9ec#10 daniel-mather | E1 | 我当场买了纸笔，在柜台边写好信，封口写上达拉斯的地址，连邮费一起递给他：“谢了… | 「嗯。马瑟。招牌上写的就是。」 | no-ask |
| game-d78dd9ec#11 daniel-mather | E1 | 我把女孩的照片推到柜台上：“马瑟先生，这姑娘来过店里吗？”一边等他看，一边在心… | 「没印象。」 / 「过路的多，我记不住脸。你要买东西就说，别光站着问。」 | no-ask |
| game-e8e9249b#2 lars-williams | E1 | 我下车朝高瘦的那位点点头：“加满，谢谢。这附近有能吃顿热饭的地方吗？” | “热饭？街那头有家叫‘最后一站’的，酒吧、厨房和汽车旅馆都在一栋房子里。往前走两条街就到了… | no-ask |
| game-e8e9249b#2 nate-patterson | E1 | 我下车朝高瘦的那位点点头：“加满，谢谢。这附近有能吃顿热饭的地方吗？” | “那地方至少有热咖啡，姑娘。要是你不嫌它尝起来跟机油一个味儿。” | no-ask |
| game-e8e9249b#3 steve-brown | E1 | 我把车往前挪了挪，然后走到棚下，给那个手臂上有海军纹身的老人递了根烟：“您以前… | “驱逐舰。服役挺久，换过几条。名字你不会听过。” | no-ask |
| game-e8e9249b#6 lars-williams | E1 | “拉斯，车一路过来有点发烫，你能顺便帮我看看水箱吗？”我又朝棚下那两位点点头，… | “先别开盖，烫着呢。水箱没往外喷，皮带也没松得厉害。等它凉下来，我再给你仔细看一遍，看看是… | no-ask |
| game-e8e9249b#6 nate-patterson | E1 | “拉斯，车一路过来有点发烫，你能顺便帮我看看水箱吗？”我又朝棚下那两位点点头，… | “歇着，歇着，姑娘。你忙你的。” | no-ask |
| game-f4d8e72b#2 lars-williams | E1 | 我朝那个高瘦的男人点点头：“加满吧。顺便问一句，镇上有地方能吃顿热饭吗？” | “最后一站能吃上热饭，先生。就在镇里，进门就看得见。普通汽油每加仑五角七分，车要加满吗？” | no-ask |
| nfh-accept-blood-road-1#0 sun-darkened-station-owner | E2 |  | “要加油，还是车出了毛病？” | no-ask |
| nfh-accept-blood-road-1-play-1#1 sun-darkened-station-owner | E2 | 我减慢车速拐上那条土路，一边开一边留意路口的路标和路两边有没有什么异样。 | “要加油，还是车出了毛病？” | no-ask |
| nfh-accept-blood-road-1-play-1#2 sun-darkened-station-owner | E2 | 我把皮卡停在油泵旁，下车说：“先给我加满油，对了，怎么称呼您？” | “叫我老板就行。先把油加上，名字以后再说也不迟。” | ask-deflected |
| nfh-accept-blood-road-1-play-1#4 retired-sailor-dog-owner | E2 | 我把油钱递给老板，然后转向那个抱着啤酒的老兵，笑着问他怎么称呼。 | “叫我老兵就行。你呢？” | ask-deflected |
| nfh-accept-blood-road-1-play-1#5 retired-sailor-dog-owner | E2 | 我说我叫丹尼尔·怀特，正在找一个三个月前在这条公路上失踪的女孩，问他们有没有听… | “我没听说过。这里每天都有车来车走，真要有人在路上丢了，镇上的人也未必会当回事。” | no-ask |
| nfh-accept-blood-road-1-play-1#5 retired-truck-driver-helper | E2 | 我说我叫丹尼尔·怀特，正在找一个三个月前在这条公路上失踪的女孩，问他们有没有听… | “我就是路过歇脚的，伙计。小地方的闲话多得很，可我没听见哪句能对上你要找的姑娘。” | no-ask |
| nfh-accept-blood-road-1-play-1#5 sun-darkened-station-owner | E2 | 我说我叫丹尼尔·怀特，正在找一个三个月前在这条公路上失踪的女孩，问他们有没有听… | “我没听说这件事。你可以去镇中心问问，那里的人比我们清楚些。” | no-ask |
| nfh-accept-blood-road-1-play-1#9 sun-darkened-station-owner | E2 | 我从皮卡里拿了手电筒回到车库，问老板拆得怎么样了，油管的接头看起来有什么不对。 | “还没到能下结论的时候。外面的油泥太厚，得再擦干净一点。你把光稳住，我看看螺纹有没有新留下… | no-ask |
| nfh-accept-blood-road-1-play-1#11 sun-darkened-station-owner | E2 | 我说只是随口问问，谢过他之后走到那台生锈的可乐机前投币买了一瓶可乐，再问老板去… | “沿着这条大路往前走，别在那些小道上乱拐。加油站、商店和最后一站都在镇中心，顺着路就能看见… | no-ask |
| nfh-accept-blood-road-1-play-1#13 pencil-mustache-bar-owner | E2 | 我锁好车，穿过路面走进“最后一站”酒吧，在吧台坐下，点一份热的吃食和一杯冰啤酒… | “叫我老板就行。这里的人都这么叫我。热食有汉堡、香肠，还有辣肉酱；你想要哪一种？冰啤酒可以… | ask-deflected |
| nfh-accept-blood-road-1-play-1#14 pencil-mustache-bar-owner | E2 | 我要一个汉堡和那杯冰啤酒，把钱放在吧台上，顺口问他三个月前有没有见过一个独自赶… | “三个月太久了。我见过不少过路客，不能说记得每一张脸。你说的那个姑娘，我没有印象。” / … | no-ask |
| nfh-accept-blood-road-1-play-2#1 pencil-mustache-bar-owner | E2 | 我咬了一口热汉堡，抬头问吧台后的老板，旁边那间汽车旅馆的房间一晚上多少钱。 | “一晚上八美元。房里有床、浴室，床头柜上还有电话，不过那部电话只能打到这间酒吧。要住的话，… | no-ask |
| nfh-accept-blood-road-1-play-2#2 pencil-mustache-bar-owner | E2 | 我说行，订一晚，从钱包里数出八美元放在吧台上，请他把房间钥匙给我。 | “行，房间给你留着。钥匙牌上的号码就是房号；屋里的电话只能打到这儿。要是房里出了什么问题，… | no-ask |
| nfh-accept-blood-road-1-play-2#3 bearded-fast-food-cook | E2 | 我把钥匙收进口袋，朝厨房里那位扎马尾的厨师扬了扬手里的汉堡，问他叫什么名字，说… | “谢谢夸奖。我叫马丁。只要你吃得满意，这灶台上的活就没白忙。” | ask-invented |
| nfh-accept-blood-road-1-play-2#4 pencil-mustache-bar-owner | E2 | 我从皮革笔记本里撕下一页，写上自己的名字和今晚住在这儿，把纸条推给吧台后的老板… | “我明白你的意思。要是我想起她，或者有人提到她，我会来找你。纸条你先留着，别放在这儿让别人… | no-ask |
| nfh-accept-blood-road-1-play-2#8 red-haired-store-owner-smoker | E2 | 我谢过卡尔，把地图折好收起，走到门廊上拆开烟盒递给那个抽烟的男人一支，顺便问他… | “姑娘？这镇上姑娘不少，外头来的也不少。你说的是哪一个？” | no-ask |
| rc-accept-blood-01-play#15 scott-pastor | E2 | 我谢过埃德，开着皮卡慢慢往镇里开，摇下车窗听着有没有人在街上讲话。 | “车轮从远方带来问题，问题又会把车轮带回去。你是在找人，还是在找一个愿意回答的人？” | no-ask |
| rc-accept-blood-01-play#16 scott-pastor | E2 | 我把车停住，隔着车窗对他说：“我在找人，我妹妹，金头发，开蓝色小轿车。你见过吗… | “金头发，蓝色的小车……我见过许多颜色，也见过许多寻找。你说的那个姑娘，名字是不是艾米丽？… | no-ask |
| rc-accept-blood-01-play#17 scott-pastor | E2 | 他怎么知道艾米丽这个名字？我心里一紧，下车追问：“你从哪听来她的名字的？” | “名字不是从嘴里来的，陌生人。它会沿着路边的尘土爬进耳朵，躲在轮胎印里，等一个人来把它喊出… | no-ask |
| rc-accept-blood-01-play#18 scott-pastor | E2 | “两个都想知道。”我压着火，“谁还听见了？” | “听见的人不止一个。遮阳棚下那个卖汽油的，他听见过；镇里还有几个男人，耳朵比嘴巴更快。他们… | no-ask |
| rc-accept-blood-01-play#20 john-thunder | E2 | 我进门，把妹妹的照片放在柜台上：“传教士说你知道哪些人进了镇子，哪些人没出去。… | “艾米丽。三周前。” / “我见过一辆蓝色小轿车在镇外停过。至于她是不是在车里，我不能替你… | no-ask |
| rc-accept-blood-01-play#21 john-thunder | E2 | “谁看见她以后还活着。”我盯着他，“那辆蓝车停在镇外哪儿？” | “镇外，往东走。过了镇牌，再走一小段，有一条通往干涸河床的岔路。那辆车就停在岔路旁边，不是… | no-ask |
| rd-accept-blood-01-play#6 russell-williams | E2 | 我问老板镇上还有谁住着，警长在哪，晚上能在哪儿落脚。 | “住人的地方不少，不过这里看起来像鬼城，很多房子早就空了。镇中心有杂货店、邮局，还有一家叫… | no-ask |
| tc-A1-20261004#3 nate-patterson | E1r | 我把皮卡钥匙揣回兜里，走到棚下那个捏着啤酒罐、一口烂牙的男人旁边：“老兄，最近… | 「红白相间的？老兄，我这把老骨头天天坐在这儿看车过，什么颜色都见过。红白的货箱——这两天倒… | no-ask |
| tc-A1-20261004#4 steve-brown | E1r | 我冲烂牙老兄点点头道谢，转身朝坐得笔直、胳膊上全是海军纹身的老人欠了欠身：“老… | 「待过。人叫我老兵就行。」 | ask-deflected |
| tc-A1-20261004#5 robert-taylor | E1r | 我跟三位道了别，开车顺着土路进镇，找那家叫“最后一站”的店，进门找个靠窗的位子… | 「吃点什么？」 | no-ask |
| tc-A2-20261004#1 lars-williams | E1r | 我朝那个口袋挂着油布的高瘦男人点点头：“加满吧。顺便问一句，镇上有地方能吃顿热… | 「行，加满。」 / 「要热饭就去『最后一站』。顺着这条路往里走不远，食宿酒吧，厨子还在。别… | no-ask |
| tc-A2-20261004#3 nate-patterson | E1r | 我把皮卡钥匙揣回兜里，走到棚下那个捏着啤酒罐、一口烂牙的男人旁边：“老兄，最近… | 「红白相间的？三十来岁、小胡子？」 / 「老兄，咱以前跑长途，路上啥样的车都见过，红的白的… | no-ask |
| tc-A2-20261004#5 robert-taylor | E1r | 我跟三位道了别，开车顺着土路进镇，找那家叫“最后一站”的店，进门找个靠窗的位子… | 「要点什么？」 | no-ask |
| tc-B1-20261004#1 lars-williams | E1r | 我朝那个口袋挂着油布的高瘦男人点点头：“加满吧。顺便问一句，镇上有地方能吃顿热… | 「加满差不多十加仑，五块五。」 / 「热饭啊——往里头走，有家叫最后一站的，吃住都行。别的… | no-ask |
| tc-B1-20261004#4 steve-brown | E1r | 我冲烂牙老兄点点头道谢，转身朝坐得笔直、胳膊上全是海军纹身的老人欠了欠身：“老… | 「待过。叫我哈珀就行。」 | ask-invented |
| tc-B1-20261004#5 carlos-garza | E1r | 我跟三位道了别，开车顺着土路进镇，找那家叫“最后一站”的店，进门找个靠窗的位子… | 「好。」 | no-ask |
| tc-B2-20261004#3 nate-patterson | E1r | 我把皮卡钥匙揣回兜里，走到棚下那个捏着啤酒罐、一口烂牙的男人旁边：“老兄，最近… | 「哎，老弟，坐啊。热死了，坐这儿凉快。」 / 「红白的？货车啊……这条道上跑的货真不少，红… | no-ask |
| tc-B2-20261004#4 steve-brown | E1r | 我冲烂牙老兄点点头道谢，转身朝坐得笔直、胳膊上全是海军纹身的老人欠了欠身：“老… | 「嗯。待过。」 / 「人叫我沃尔特就行。」 | ask-invented |
| tc-B2-20261004#7 robert-taylor | E1r | 我喝了口冰水，随口问罗伯特：“加油站那儿有个一口烂牙、说自己开过长途的老兄，挺… | 「罗伯特？我是埃德，先生。烂牙那个啊——开过长途的，就住山脊路，跟老史蒂夫隔壁，白天老在拉… | invented-unasked |
| tc-C1-20261004#1 lars-williams | E1r | 我朝那个口袋挂着油布的高瘦男人点点头：“加满吧。顺便问一句，镇上有地方能吃顿热… | 「加满没问题。」 / 「热饭的话，顺着这条路再往镇里开一点，有家叫最后一站的，能住也能吃。… | no-ask |
| tc-C1-20261004#4 steve-brown | E1r | 我冲烂牙老兄点点头道谢，转身朝坐得笔直、胳膊上全是海军纹身的老人欠了欠身：“老… | 「嗯。待过。」 / 「叫我……外头的人多半就叫我老头。你有事就说。」 | ask-deflected |
| tc-C1-20261004#5 robert-taylor | E1r | 我跟三位道了别，开车顺着土路进镇，找那家叫“最后一站”的店，进门找个靠窗的位子… | 「吃点什么？喝的也有。」 | no-ask |
| tc-C2-20261004#1 lars-williams | E1r | 我朝那个口袋挂着油布的高瘦男人点点头：“加满吧。顺便问一句，镇上有地方能吃顿热… | 「满了。镇上能坐下来吃口热的，就前头那家『最后一站』，食宿酒吧都有，开车过去一会儿就到。说… | no-ask |
| tc-C2-20261004#3 nate-patterson | E1r | 我把皮卡钥匙揣回兜里，走到棚下那个捏着啤酒罐、一口烂牙的男人旁边：“老兄，最近… | 「红白相间的？老弟，这路上过往的车可不少，颜色我哪记得清。三十来岁留小胡子的司机？唔……这… | no-ask |
| tc-C2-20261004#4 steve-brown | E1r | 我冲烂牙老兄点点头道谢，转身朝坐得笔直、胳膊上全是海军纹身的老人欠了欠身：“老… | 「待过。人叫我巴德就行。」 / 「你有事就直说。我这儿不掺和闲话。」 | ask-invented |

## Appendix B. Files

- `tests/play/measure_say_name.py`: the script, with its method in the module docstring.
- `docs/specs/names-say-name-measurement.md`: this report.
