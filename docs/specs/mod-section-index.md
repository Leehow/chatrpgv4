# Mod instructions as an index: resident lines, retrieved sections

Status: needs-decision (design and offline measurement done 2026-10-04, three rounds; the recommended shape is §7.4–§8; no product code yet)
Owner ruling, 2026-10-04: "我希望是类似 skill 一样索引，然后找到哪些需要的 mod，把上下文加进来 … 用 jev 来检索决定 … 未来可能会有成百上千个 mod … 限制那么小的话可能会描述不全。" Then: "你先设计怎么做，然后做一些测试看看效果，然后调试好最佳方案".

## 1. The problem

Every enabled package sends the Keeper its instructions twice: the full text on the first turn a process opens for the campaign, and a `brief` on every turn after (§30.7). The briefs share a 5000-byte ceiling (§40.6; `test_mod_director_text.py` holds it strictly under). After natural-npc 1.4.5 (§179) the active briefs total 4999 bytes.

The brief is not an index. It is each package's rules compressed until they fit, and what the compression drops is gone for the rest of the process: a rule the first turn carried in full reaches later turns as a clause ("Give or hide the answer."), or not at all. Two consequences the owner named:
- the ceiling cannot hold hundreds of packages, and a flat ceiling shared by all of them punishes every package for every other;
- the compressed form cannot describe the rule, so the Keeper on turn 20 is not playing the package the author wrote.

## 2. The shape

Two kinds of package text, declared by the package:

| kind | what | how it reaches the Keeper |
| --- | --- | --- |
| resident | behaviour that holds on every turn: the viewpoint, the say token, the mood before speech, pacing's carry-and-stop | a short always-on text, as the brief is today, with a ceiling per package |
| section | a rule that bears on some turns: the language of an exchange, asking for something, what the asker is after, a readable carrier, a lethal outcome, a price | a card in an index; the host decides per turn which cards' full text to hand the Keeper |

A package declares its sections in `agent.md` by heading, each with one `when` line (system language) that says the situation the rule bears on. The manifest declares `contributes.sections` and requires a new capability (`instructions.sections.v1`). The brief ceiling does not apply to a package that declares sections; its resident text has its own ceiling. A package that declares nothing keeps today's full/brief lifecycle under its lock (§137.10, §26).

Three ways a card becomes due, declared per card:
- `trigger: jev` — judged each turn from the player's words and a slim current context (§3);
- `trigger: state` — a capsule field is present (`mods.thread.reentry`, `historical_reference_materials`, the opening turn);
- `trigger: host` — a host event (a refused narration, a closed retrieval lane).

## 3. The selection lane

The same shape as semantic locate over the entity index (§124.10, `runtime/jev/semantic-locate.ts`): every `jev` card of every enabled package becomes one card `{alias, package, applies_when}`; Jev answers one independent Noul per card against the request and the context; the host keeps the cards at or above a threshold, at most `k`, within a byte budget of their own. The Keeper never sees the index; only the selected sections' full text, delivered in the request's tail beside the prescreen's materials (§135.23 keeps the prefix cached). Nothing reads the words in code.

State per batch: the player's words, the scene, the people present, and the compile's cleared features (addressee, act, item, destination, what is sought) when the read has them. Not the capsule. Hundreds of cards partition into batches as locate does (64 cards, 14 KB per batch); batches are issued together.

Resident text is never selected; `state` and `host` cards are decided in code.

## 4. Who writes, who reads, who acts (§31)

- The package author writes the sections and their `when` lines; the kernel validates the manifest at install and refuses a section without a `when`.
- The host's selection lane reads the index and the turn; the kernel's capsule reads nothing new.
- The Keeper acts on the delivered sections. Nothing counts that; the measure is a replay, not a counter. The lane records per turn which cards were offered, scored, selected and delivered (`lane: "mod-sections"`), the offer-ledger way: counted, never fed back as an obligation.

## 5. What can go wrong, stated before the measurement

- **A needed rule is not selected.** The failure is silent: the Keeper does not know what it was not given. This is the cost that decides the threshold, so recall of needed cards is the primary measure and precision is the budget.
- **The `when` line is the whole interface.** A badly written line never fires. The telemetry's "offered, never selected" per card over a campaign is the author's signal.
- **Big state degrades Jev.** The context stays slim; the capsule is never the state.
- **Chinese input against English cards.** The locate already judges Chinese requests against English entity cards (noul 0.6–0.8 on the live tables); the measurement includes Chinese `when` lines as a variant.
- **The tail budget is shared with the book's passages.** Sections get their own slice.

## 6. Offline measurement (pre-registered 2026-10-04, before any Jev run)

`experiments/mod-section-index/`: 18 `jev` cards cut from the five built-in packages' live `agent.md` (`cards.json`, `sections.mjs`); 120 real player turns sampled from the App home's 70 campaigns (341 turns), stratified by what the turn's own records say happened (`sample.py`); gold labels from a model judge (Sonnet) reading each card's full text against the turn, a second judge on 30 turns for agreement; Jev `jev-1.13.0` through the product's `packDecisionBatch`.

Configurations: state = words only / words + scene + present / + compile features; card = `when` only / `when` + 240-char excerpt; `when` in English / Chinese; 18 real cards / 18 + 60 decoy cards of packages that do not exist; per-card Noul fan-out / one Choice + exists.

Measures: precision, recall and F1 over (turn, card) pairs at thresholds 0.35–0.7; whether every gold card is within the top-2/3/4; per-card recall; decoy firing rate; latency p50/p95 and input tokens per turn.

Feasible, decided now: some configuration reaches recall ≥ 0.85 of gold cards with ≤ 4 cards selected per turn on average, all gold cards within the top-3 on ≥ 0.8 of turns, decoy pairs firing at the operating threshold ≤ 10%, p50 under 800 ms with the 78-card catalogue. Not feasible: no configuration reaches recall 0.7 at any budget, or the judges agree on fewer than 85% of pairs (then the labels cannot carry a verdict).

## 7. Results

### 7.1 Round 1 (18 `jev` cards, one `when` line each)

Judges agreed on 531/540 pairs of packet 1 (98.3%); 275 of 2160 (turn, card) pairs are gold "yes". Jev p50 309 ms, 2.5K input tokens per turn at 18 cards; 383 ms, 8.8K tokens at 79 cards (60 decoys), decoys firing on 1.9% of pairs.

| configuration | P / R / F1 at 0.5 | all gold in top-3 |
| --- | --- | --- |
| words only | 0.52 / 0.71 / 0.60 | 0.47 |
| + scene, present | 0.52 / 0.74 / 0.61 | 0.44 |
| + compile features | 0.55 / 0.74 / 0.63 | 0.43 |
| + 240-char excerpt | 0.64 / 0.67 / 0.65 | 0.42 |
| Chinese `when` lines | 0.64 / 0.65 / 0.64 | 0.47 |
| + 60 decoys | 0.53 / 0.76 / 0.63 | 0.36 |
| one Choice + exists | best card in gold 54/120 | — |

**Not feasible as a pure Jev index: recall 0.74 against the pre-registered 0.85.** Reading the misses and the false positives by card:
- The misses are mostly things the player's words cannot carry. 「干吧」 (taking the job) needs the enhanced-items rules because the book has the client hand over keys, a note and pay: a fact of the scene, not of the sentence. A camera lifted needs the register rule only if the camera is unregistered: a fact of the ledger. 「加满」 (fill the tank) implies a fuel price. 「然后呢」, 「？」, an ooc complaint, were under 0.5 for the out-of-character rule.
- The false positives are the cards whose `when` was broad: the item-management card fired on anything with an object in it (37 false, 3 true); asking-for-something fired on buying at the asked price and on plain questions; first impression fired on people already met, which Jev cannot know.

Both point the same way: due-ness that is a fact of the table is code's to decide, and Jev should be asked only what the words can tell.

### 7.2 Round 2: due-ness that is a fact of the table goes to code; Jev gets structured cards

`cards.v2.json`: nine cards moved to `state` or `host` triggers (first impression → a present person with no history, the natural-npc 1.5.0 model; clue landing and handed clues → `clues_here`; clocks and stalls → `mods.pacing` and the Director; readable carriers, definitions and instance management → the Keeper's own apply/resolve before it runs). Nine cards stay with Jev (register a carried thing, forceful use of an object, a lethal outcome, out-of-character words, asking for something, what the asker is after, drawing a conclusion, prices, a price dispute), each with `what`, `not_for` and `examples` — the structured criteria form the vendor documents — and the question asks whether the turn presents that situation, not whether a rule "would change what the Keeper writes".

Of the 275 gold pairs, 161 fall to the state/host cards and 114 to Jev's. Scored over Jev's nine cards:

| configuration (all: scene + present in state) | P / R / F1 at 0.5 | all gold in top-3 |
| --- | --- | --- |
| plain `when` line, "would it change" question | 0.62 / 0.89 / 0.73 | 0.93 |
| structured card, "would it change" | 0.67 / 0.89 / 0.76 | 0.93 |
| **structured card, "does the turn present the situation"** | **0.71 / 0.89 / 0.79** | 0.92 |
| + compile features | 0.71 / 0.89 / 0.79 | 0.92 |
| + 60 decoys (69 cards) | 0.66 / 0.89 / 0.76 | 0.88 |
| Chinese `what`/`not_for` | 0.70 / 0.88 / 0.78 | 0.92 |

Recall does not rise below 0.5 (0.89 at 0.35 too): 0.5 is the knee. At 0.5 the best configuration loads 1.2 Jev-selected sections per turn; the remaining false positives are mostly the register card (25 turns), which in the product is also gated by `unregistered_equipment` being non-empty. Latency p50 310 ms (388 ms at 69 cards), 2.6K input tokens (9.3K at 69 cards, $0.0004). Compile features add nothing once the context holds scene and present. Chinese cards cost 1 point.

**Feasible by the pre-registered bar (recall 0.89 ≥ 0.85, top-3 0.92 ≥ 0.8, decoys 1.6% ≤ 10%, p50 under 800 ms).** Caveat recorded before the check: round 2's `examples` were written after reading round 1's misses and quote sentences of the labelled sample, so these numbers are on the tuning set. §7.3 holds the held-out check.

### 7.3 Held-out check

110 turns the tuning never saw (the rest of the 341 after the first sample, same strata), labelled by four fresh judges (262 gold pairs), the best configuration unchanged. Scored over Jev's nine cards:

| | P / R at 0.35 | P / R at 0.5 | all gold in top-3 | Jev sections per turn at 0.5 |
| --- | --- | --- | --- | --- |
| tuning sample | 0.58 / 0.89 | 0.71 / 0.89 | 0.92 | 1.2 |
| held-out | 0.53 / 0.86 | 0.59 / 0.79 | 0.95 | 1.2 |
| held-out + 60 decoys | 0.53 / 0.88 | 0.59 / 0.79 | 0.81 | 1.2 |

The tuning numbers were optimistic by about 0.1 of recall; the held-out knee is 0.35, where recall is 0.86 at 1.45 sections per turn. The 21 misses at 0.5: 12 are the prices card, and 10 of those are turns where the Keeper itself writes money (the client's advance, 「我付了油钱」): nothing in the words, a fact of the write. With a `host` trigger on that card too (before an apply carrying `cash`), held-out recall at 0.5 is 0.89. The others: four access requests the asking card's `what` does not name (an audience, being let in to see someone), two out-of-character lines (「重新建立人物角色」, 「不对吧，我没说用镐头」), one probing a bleeding hole for the lethal card. These are `what`/`examples` wording; left as found, not tuned on the held-out set.

**Verdict: feasible, with two triggers on some cards.** A card may be both `host` (or `state`) and `jev`: the code trigger catches what the words cannot carry, Jev catches what the player starts. With that, the pre-registered bar holds on the held-out sample (recall 0.89 at 0.5, 0.86 at 0.35 for Jev alone; top-3 0.95; decoys 1.5%; p50 316–371 ms).

### 7.4 Round 3: a closed topic list, not a `when` line per section (owner, 2026-10-04)

The owner's correction after §7.3: Jev should not be asked whether gear is registered; it should be asked whether the turn involves gear, and the package's sections on gear load when it does, with code applying the state gate. The register card's "false positives" in §7.2–§7.3 were mostly this: Jev answered the question it can answer, and the label was on a question it cannot.

So the index is a **closed topic list the product owns** (`topics.json`: 13 topics drawn from what the built-in sections are about, each with `what`, `not_for`, `examples` written from the rules, none copied from a labelled turn), and a section declares which topics it belongs to plus its gate. Jev judges the topics; the catalogue of sections never reaches Jev. Measured on the held-out 110 only:

| selector | P / R vs the rule labels (7 gate-free sections) | sections loaded per turn |
| --- | --- | --- |
| topic fired at ≥ 0.5 | 0.77 / 0.92 | 0.67 |
| topic fired at ≥ 0.35, then Jev verifies the section with its own 400 chars at ≥ 0.6 | 0.86 / 0.89 | 0.58 |
| round 2's per-section cards at ≥ 0.5 (§7.3) | 0.81 / 0.87 | 0.61 |

Topics are as good as per-section cards on the words-only sections and better on recall, with three structural gains: Jev's work no longer grows with the number of packages (a thousand packages share thirteen questions); authors tag topics instead of writing a `when` line that may never fire; the topic criteria are calibrated once, by the product. The verify stage buys 0.09 of precision for one more serial Jev call (p50 283 ms); precision here is bytes, not errors, so a single topic round is the default and verification is an option for a large catalogue. (Topic-level accuracy against topic labels: §7.5.)

### 7.5 Topic accuracy on its own

Topic labels on the held-out 110 by four fresh judges, given only the words, the scene and who is present (what Jev sees); a second judge on 28 turns agreed on 97.8% of pairs; 299 gold pairs, 2.7 topics per turn.

| threshold | P / R / F1 over (turn, topic) pairs |
| --- | --- |
| 0.35 | 0.84 / 0.90 / 0.87 |
| **0.5** | **0.92 / 0.87 / 0.89** |
| 0.6 | 0.95 / 0.83 / 0.88 |

Per topic at 0.5, recall: asks_question 0.98, carried_item 1.00, speaks_to_person 0.94, money 0.91, out_of_character 0.88, asks_favour 0.87, readable 0.82, new_thing 0.81; clue_search 0.55 (the judges read "looks for evidence" widely, Jev narrowly; its section is state-gated on a clue being here, which decides most of those turns anyway); conclusion 0/2. False positives at 0.5: 22 in 1430 pairs, 8 of them carried_item.

Latency p50 334 ms, 3.5K input tokens ($0.00015) per turn for 13 topics; the count of topics, not of packages, sets this cost.

## 8. The design the measurement points to

Conditional on §7.4–§7.5. Two levels: Jev answers a closed topic list from the player's words; a section says which topics it is about and what state gate it needs; the host loads the sections whose topic fired and whose gate holds. Where this section says "card" below, read "topic".

**Topics.** `content/mods/topics.json`, product-owned: `{id, what, not_for, examples}` per topic, system language. Adding a topic is a product change with its own measurement; a package may still carry one custom `when` card for a situation no topic covers (the escape hatch, judged the round-2 way).

**Package format.** A package that opts in declares `"contributes": {"sections": "agent.md"}` and requires `instructions.sections.v1`. Its `agent.md` is cut at `## ` headings; a heading's first paragraph may be a fenced front matter:

```
## What the asker is after
<!-- trigger: jev
when: The investigator asks a person present a question or seeks information from them.
what: A question put to a person present, or an attempt to learn something from them: ...
not_for: A question the player asks the Keeper out of character; a request to be given a thing ...
examples: ["镇上哪儿能吃饭、住一晚？", "你这店开了多少年了？"] -->
```

A section's front matter names `topics: [...]` from the list, and optionally a `gate` from the closed list below and/or `trigger: host|state` conditions; a section with no topics and no trigger is resident (`always`). A `jev` section needs `when` and `what`; `not_for` and `examples` are strongly advised (round 1 → round 2 was mostly them). A `state` or `host` section names its condition from a closed list the kernel owns (`present_without_history`, `clues_here`, `handed_clue_here`, `threat_clock`, `stall`, `recover`, `opening`, `reentry`, `historical_materials`, `workspace`, `before_apply:<kind>`, `before_resolve:<decision>`, `host_refusal`, `retrieval_closed`). The kernel validates at install: unknown trigger or condition, a `jev` section without `what`, or an `always` section over its ceiling is `invalid_params` with the section named. Bytes stay frozen per version (§26).

**Resident ceiling.** `always` sections of a package together ≤ 2048 bytes; no shared ceiling across packages. Narration Craft's "The people here" (7 KB) does not fit and is not meant to: it is the one prose package, and prose-mod §6 already makes it the base's partner; it keeps today's full/brief lifecycle until it is sectioned on its own terms.

**The lane.** One Jev fan-out per turn, in the same request as the entity locate (the batches are independent; a second family costs nothing in wall time). State: `{request, current_context: {scene, present}, cards: [{alias, package, applies_when: {what, not_for, examples}}]}`. Question per card: does this turn present the situation `applies_when` describes. Threshold 0.35 (the held-out knee; 0.5 when a code trigger shares the card), at most 6 Jev-selected sections, within a section budget of 8 KB of the request tail (p95 of a perfect selector was 6.8 KB). Cards partition as locate does. Unavailable Jev → no Jev sections that turn, recorded; the `state` and `host` sections still load. `host` sections load before the call they name runs, as the clerk's note does today (§135.31).

**Delivery.** Selected sections ride in the request tail beside the prescreen's materials, as one `coc-sections` message: `{package, section, text}` rows, in package order. The `brief` is not sent for a sectioned package. The first turn of a process still sends every package's full text once (§30.7), so the Keeper has read the rules whole before the index starts choosing.

**Telemetry.** `lane: "mod-sections"` per turn: cards offered, each card's noul, selected, delivered bytes, state/host sections fired, Jev ms and tokens. A per-campaign roll-up answers the author's question "was my section ever selected".

**Landing order.** (1) shadow: the lane runs and records on live tables, nothing delivered, the brief unchanged; (2) deliver beside the brief for packages that opt in; (3) retire the brief for them. Each step is its own commit with its replay.

**Cost.** 310 ms and $0.0003 per turn at today's catalogue; 390 ms and $0.0004 at 70 cards; linear in cards beyond that, batched 64 at a time.

### 8.1 The prototype over real capsules (2026-10-04)

`experiments/mod-section-index/prototype/`: `index.json` (every Keeper-instruction section of the seven packages, from `docs/mods-catalogue.md`, with topics, gates and triggers), `select.mjs` (the topic lane plus the closed gate list read from a capsule), `sandbox.sh` and `replay.mjs` (a copy-on-write home per App campaign; for each sampled turn the repository is reset to the commit of the turn before, the kernel opens the table and takes the player's words, and the capsule it hands back is what the selector reads), `score.py`, `policy.py` (re-applies a loading rule over stored rows without calling Jev again).

Held-out sample B, 106 of 110 turns replayed (the four others have no commit for the turn before), against the rule labels, over the eighteen sections the replay can decide:

| | P / R | sections per turn | bytes per turn p50 / p95 | topic lane |
| --- | --- | --- | --- | --- |
| final policy | 0.56 / 0.69 | 3.0 | 3.3 KB / 7.3 KB | 304 ms p50 |
| today | the 4999-byte briefs, every turn; 55 KB of full text on the first turn | | | |

Per section at 0.5: what the asker is after 0.96 recall, prices 0.77, documents 0.78, clue landing 0.74, asking 0.70, out-of-character 1.00; first impression 0.62 with 21 false loads; handed clues 0.38; register 0.33 with 17 false loads; define 0.50.

What the replay taught, each a change in the index or the selector:
- **A state counter alone is not a reason to load.** The stall and recover sections, loaded whenever `stalled_turns` reached the setting or the Director read RECOVER, fired on a third of turns and were needed on two. They now load only when the counter is up **and** the words involve no topic: a stalled counter with nothing to do is the stuck case. Loads halved at equal recall.
- **`met_turns` already counts the opening scene**, so a first-impression gate on it never fired at the first exchange; the gate reads `last_spoke_turn`. And a person present who never spoke is not a meeting: the section loads on the topic (the investigator speaks to someone) and the gate together. Under natural-npc 1.5.0 the roll moves into the kernel and this section's trigger becomes the impression receipt itself.
- **The register gate is nearly always open** (unregistered gear on 87% of turns), so the topic carries the decision; at 0.7 it loads on a fifth of turns. The precise signal is the compile's `item` feature against the registered instances, which the product has and the replay does not.
- **The labels include what only the Keeper's own call decides**: the client's advance (prices), the keys and the note (define, documents), a transfer (manage). Offline these count as misses; in the product the `before_apply:*` triggers load the section at the call. That is most of the gap between the topic lane's own accuracy (§7.5) and this end-to-end figure.
- **`git reset --hard` moves the branch**, so the first replay lost every turn after a reset in the same campaign (59 of 110); the sandbox keeps the original tip under `refs/replay/tip`.

Bytes: 3.3 KB a turn against today's 5.0 KB brief, and the bytes are whole rules rather than compressions. The resident text of the resident packages would ride beside it as today's briefs do (2.5 KB).

**What this prototype does not show**: whether the Keeper plays better with whole sections than with briefs. That is a live replay with a Keeper model (§179.4's shape), the next step if the design is adopted.

## 9. Open

- Whether resident text keeps a shared ceiling or a per-package one.
- `lookup kind=mod`: a Keeper-side way to read a section by name, as a backup. Not relied on (the Keeper does not fetch what is at hand).
- The order of landing: shadow (lane records, nothing delivered) on live tables first; then delivered sections beside today's brief; then the brief retired for sectioned packages.
