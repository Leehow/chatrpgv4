# NPC speech: one marker for every spoken line, colour by speaker, and a voice for people the book left silent

_Date: 2026-09-15. Status: implemented and accepted at a real table on branch `claude/npc-speech-20260915` (contract §40). Acceptance run: campaign `speech-0915`, The Haunting in Chinese, `xai/grok-4.6` thinking low, 21 delivered turns, the main session as the only player, one line per turn through `tests/play/driver.py`; evidence under `.coc/campaigns/speech-0915/` and `.coc/playtests/speech-0915-*`. Packaged into `/Applications/PipiCOC.app` from commit 6cc45c040. Suites: `npm run test:ext` 1240/1241 (one pre-existing load-time flake), kernel pytest green but for the pre-existing `test_fast_guidance` era case, host vitest targeted 199/199. **Open: four npc-voice lane defects the table found (see Acceptance results), and the colours were never seen as pixels — screen access was declined.** Contract home: §40 (§-numbers are stable ids). User rulings 2026-09-15 under "Rulings": the wrapper form, marking is mandatory and the brief ceiling is raised, colours are hashed and never stored, the model never reads or writes a high-entropy id, the `sample_lines` lane is specified here, coarse language on by default with a sidebar toggle._

## Problem statement

A survey of this tree (2026-09-15) and of the two predecessor products, `chatlab` (TRPG mode) and `chatrpg` v1, puts the gap in three layers.

1. **No layer says what a spoken line looks like.** The base prompt and `narration-craft` owe the turn "a voice" (contract §34.2, `prompts/keeper.md` Writing paragraph, `content/craft/beat-directives.json` `floor_lines`), and nothing says how a line is written. The Keeper chooses quote marks, whether to write "X said", and whether a line is direct or reported, turn by turn. Two consecutive turns of the same table punctuate the same person differently.
2. **Nothing downstream knows who spoke.** `narrate` and `ask` take one `text`; `deliveryText` (`kernel-ts/write/delivery.ts`) strips `{{marker}}` tokens and passes the rest through; the record keeps `text`, `rendered_text`, `mechanics`, `labels`. There is no speaker anywhere in the turn record. The one structured NPC channel, the §17.10 journal, runs a second model over the Keeper's prose after the fact to guess who appeared, and its `exchange` is a paraphrase.
3. **The host paints every word the same.** `pipicoc/mechanics.js` `DeliveryCard` splits the delivery at mechanics markers and blank lines and renders paragraphs. A player reading a three-person conversation has only the prose's own "he said" to tell them apart, and the Keeper is told not to write it that way.

Both predecessors solved 1–3 the same way and neither used JSON: one inline attribution glued to each quoted line (`「…」[speak:emotion:key]名字[/speak]`), the whole turn still one flowing text, the frontend colouring each speaker's span by a hash of a stable key (FNV-1a; `chatrpg` adds an 18-slot palette with linear probing so people in one session never share a colour), a fixed colour for the player character, and no per-message bubbles. Neither had a list of forbidden "AI phrases"; what made their people sound like people was a per-NPC voice card with two sample lines (one at ease, one under strain), which the prompt told the GM to follow. Two things there must not be copied: the resolver's regexes that decide a label is a "bystander" or an "off-screen voice" from words like 男人 / 女人 / 广播 (a hard-coded semantic list, forbidden here), and the `key` slot the model was asked to echo (an id, forbidden here by the same invariant §16.6 states for markers).

This tree already holds most of the material: the capsule's `present[]` carries an authored `voice` per person (`content/modules/module-graph-contract-v3.json` `actor_dossier`), `deflect_lines`, `knows`, `would_lie_about`, `toward_party`, `history`; `mods/natural-npc` shows a package establishing a dossier word at the table through door 4 (§28.7); the §17.10 journal shows a zero-tool lane with a job packet, a closed submit and a fail enum. What is missing is (a) the one machine token that says "this is a line, and whose", (b) its projection to the host and to adopters, and (c) something to perform from when a PDF gave the person no `voice` at all.

## Rulings (2026-09-15)

| question | ruling |
|---|---|
| wrapper (`{{say:…}}…{{/say}}`) or quote-plus-tail (`「…」[speak]…[/speak]`) | **wrapper.** Language-neutral: the play language is open (§23) and no quote glyph is a contract. |
| mandatory or optional | **mandatory** for every spoken line. The brief ceiling (§30.7, 4000 bytes) is **raised** so the rule fits without squeezing the packages. |
| colour stored on the NPC or derived | **hashed, never stored.** The anchor the host hashes is host-side identity; **the model never reads or writes a high-entropy id or hash** — the marker carries the person's name, exactly as the capsule already gives it. |
| a lane that writes `sample_lines` for people the book left silent | **spec it** (this document, part E). |
| how people talk | **spoken, colloquial, and different by background.** The user's example: mocking someone's hair, a coarse labourer says 「我操！你他妈头发也太乱了！」 and a respectable man says 「你这是把鸡窝放脑袋上了么？」. Same thought, two mouths. Every person at the table talks their own way, in the words of their class, trade, era and place, and in the words people actually say aloud. |

One interpretation made here, flagged for the user: "mandatory" means a law in the base prompt, a fifth verifier finding, and a measured count per turn — **never a refusal**. §34.14 already settled that a marker is a rendering hint and not a reason to refuse a delivery, and an unmarked line is a line the player still reads.

## Solution

Five parts. A and B are the kernel contract; C is the host; D is adoption; E is the voice lane. They land together: the host must learn the new token in the same package as the kernel starts emitting it (see B.5).

### A. The token: `{{say:<name>}}` … `{{/say}}`

**A.1 Form.** A spoken line is written as

```
{{say:Knott}}「Locked since the war. Nobody wants it opened.」{{/say}}
```

The open token carries the speaker's name; the close token is invariant. Everything between them is the spoken words, with whatever quotation marks the play language uses (or none). Narration, gesture and "he said" stay outside, as they already do with mechanics markers.

**A.2 The name is a name.** `<name>` is the person exactly as `present[].name` gives it — the same string `apply npc` takes, the same string the journal lane copies. Not a handle, not a node id, not a receipt id, not a hash (the §16.6 invariant, restated here by user ruling). A person who is not in `present[]` — a passer-by, a voice behind a door, someone the book hides the name of — is written under the label the prose uses for them (`the woman in the black coat`, `227门后的人`), and the same label used again is the same person to the host (A.5). Name text: anything but `}}` and a line break, trimmed, at most 60 characters.

**A.3 Everyone who speaks.** Every line spoken aloud by anyone other than the narrator is wrapped: NPCs, and the investigator when the uptake renders the player's speakable line as the investigator's line (§34.2). Thought, signage, a document's text and reported speech ("he told you the house was locked") are not lines and are not wrapped. One rule, no exceptions per kind of speaker, so the model has one thing to learn.

**A.4 Shape rules (the kernel repairs, never refuses).**
- No nesting. An open before a close closes the previous span at the new open.
- An open with no close closes at the end of its paragraph (the next blank line, or the end of the text).
- A close with no open is removed.
- A mechanics marker written inside a span is moved to immediately after the span's close (the card is drawn after the line, which is where it happened).
- The braces never reach the player: `rendered_text` is stripped of both kinds of token, the way it already is of mechanics markers.

**A.5 Identity is resolved by the kernel, by name, deterministically.** The kernel resolves each `<name>` in this order: someone in the turn's `present[]` (via `ModuleGraph.nameKeys`, normalised, as `resolve` already does — name, aliases, display name); an investigator of the party; any NPC of the graph. The first match wins; a name that matches nothing stays a **label**. No fuzzy matching, no character-overlap heuristics, no word lists deciding what kind of person a label denotes. A label is a label; its colour is the label's own hash (C.2).

### B. Kernel: projection and record

**B.1 `deliveryText` (`kernel-ts/write/delivery.ts`, `kernel-ts/write/text.ts`).** The say pass runs first and protects its tokens from `bindMarkers`: say tokens are not mechanics markers, are never reported as `unknown`, and never count toward `placed`. Then binding, placement of unplaced mechanics and stripping run as today. `{{say:knott}}` happens to match the mechanics `MARKER` grammar (`[a-z0-9][a-z0-9:_-]*`) — the say pass must lift the say tokens out before `bindMarkers` sees the text, or `bindMarkers` would drop them as markers naming no receipt.

**B.2 Outputs.**
- `rendered_text`: as today, now also stripped of say tokens. A host that renders only `rendered_text` sees exactly what it sees today.
- `marked_text`: emitted whenever **any** token was placed (mechanics or say); carries both kinds, after A.4 normalisation. Today it is emitted only when a mechanics marker bound; the condition widens.
- `speech`: a list, in text order, one entry per span:
  ```
  {who: {npc: "<node_id>", name: "<display name>"} | {investigator: "<id>", name} | {label: "<label>"},
   text: "<the spoken words, tokens stripped>"}
  ```
  `node_id` and investigator ids are host- and adopter-facing; they are never shown to the Keeper (B.3).
- `deliveryRecord` persists `speech` beside `mechanics`. `ask` takes the same pass on its `text`.

**B.3 What the Keeper is told back.** The `narrate` / `ask` result carries `speech: {lines: <count>, unresolved: [<label>, …]}` and nothing else about it. `unresolved` is informational: "these names matched nobody present; a person present is named as `present[].name` gives it". No ids, no hashes, no refusal.

**B.4 Contract text.** New section §40 in `docs/kernel-rpc.md` (the number is the next free one; stable ids, §-numbers never shift). `docs/pi-host-contract.md` gains the token in its narration paragraph beside the §16.6 markers. `prompts/keeper.md` Law 4 names **two** machine tokens that belong in the text (the mechanics marker and the say token); the Writing paragraph states the say rule affirmatively right after the marker sentence, the way §34.13 did for markers. The `narrate` and `ask` tool descriptions gain one sentence each.

**B.5 Compatibility.** A host rendering `rendered_text` is unaffected. A host rendering `marked_text` (the PipiCOC `DeliveryCard`) must be updated in the same landing: its `proseBlocks` strip is ASCII-only and would show `{{say:诺特}}` to the player. Old records without `speech` render as they do today.

### C. Host: colour by speaker

**C.1 Where.** `pipicoc/mechanics.js` `DeliveryCard`: after `splitDelivery` cuts the delivery at mechanics markers, each text run is cut again at say tokens and every span becomes `<span class="coc-say" data-who="npc|investigator|label" style="--say-h: …">`. Both render paths get it — the live tool-result card and the restored transcript card (they are two paths; the illustration lane found this the hard way, see the memory note on live vs history cards).

**C.2 Colour.** FNV-1a over the **anchor** → slot in a palette of 16 hues authored once in CSS with a light and a dark value each (theme-aware, like the existing mechanics palette). The anchor is the NPC's `node_id`, the investigator's id, or the label string; the model never sees it (ruling). Within one rendered transcript the host keeps a set of slots already taken and linear-probes from the hash slot to the next free one, so two people at the same table never share a colour (the `chatrpg` allocation); the probe order is deterministic from transcript order, so a reload paints the same colours. Investigators take one fixed slot outside the hash palette. Nothing is written anywhere: no colour on the NPC record, nothing in the campaign, nothing in `localStorage`.

**C.3 What the span shows.** The spoken words, tinted, with a hairline left rule in the same hue so a colour-blind reader still sees "a line begins here". No avatar (no NPC portraits exist), no name chip inline (the prose already names the speaker; a chip would repeat it), a `title` with the name through `term()` for hover. The `Npcs` section of the sheet panel (`pipicoc/panel.js`) paints the same swatch beside each journal row, which is the legend; the journal projection carries the anchor for that (D.2).

**C.4 Words.** Nothing new is captioned; the only new host string is a CSS palette. No authored per-language literal enters `panel.js` or `mechanics.js` (§23).

### D. Adoption: who reads `speech[]`

Three ends (§31): producer is the Keeper's `narrate`/`ask`; projection is `speech[]` on the record and in `marked_text`; adopters are the following, each named here so none is an accident.

**D.1 Telemetry (measurement).** One row per delivery in the campaign's `telemetry.jsonl`: `{lane: "speech", turn, lines, resolved, unresolved, present}` — how many spans, how many resolved, how many people were present. This is what "mandatory" is checked against per model (acceptance, below), and what a playtest reads instead of eyeballing prose.

**D.2 The NPC journal (§17.10).** The `journal.job` packet gains `speech` (the resolved spans of the turn, `name` + `text`) so the lane's `exchange` is written from what was actually said rather than guessed from prose; the deterministic recordable set (`kernel-ts/journal/jobs.ts` `collectNamed`) adds every resolved speaker. The journal projection into `table.view.npcs.journal` carries each row's node id so the panel can paint the legend swatch (C.3). The journal stays a paraphrase; it never becomes a transcript.

**D.3 The dossier's `history`.** `npc_ledger[id]` gains `spoke: {turns: <count>, last_turn}` written at commit from `speech[]`; `present[].history` shows `last_spoke_turn`. Cheap, deterministic, and it lets the Director's `person` offer prefer someone who has not spoken for a while.

**D.4 The verifier.** A fifth finding kind, `unmarked_speech`, beside `reveal`, `uncommitted_state`, `player_agency`, `play_language_mismatch` (`kernel-ts/memory/index.ts` `FINDINGS`, `extensions/kernel/verifier.ts`): a spoken line in the delivered prose outside any say span. The verifier is a model reading prose; that is the right place for a judgement no regex can make in an open language. A finding is a warning to the Keeper (`table.warn`), never a refusal.

**D.5 Not adopted (by design, named so it is not an accident).** Text-to-speech, per-NPC portraits, an "emotion" slot on the token, structured `lines[]` in the journal. Each is a later section if wanted; the token's grammar leaves room (`{{say:Knott}}` could grow a second `:` slot) and nothing here forecloses it.

### E. The `sample_lines` lane: a voice for people the book left silent

**E.1 What.** A package `npc-voice` (default-enabled) contributes one dossier word through door 4 (§28.7), `sample_lines` (label `sounds like`), and a lane that writes it for every person the table meets whose source gives none. Two lines in the person's own words — one at ease, one under strain — in the campaign's play language. They are Keeper-facing material, like `voice`: they appear in `present[]`, never in `table.view`, never in the journal, never to the player.

**E.2 Why two lines and not a style paragraph.** Both predecessors found the same thing: "speaks calmly" does nothing, a line does. The authored `voice` field ("Pompous, clipped, editorial. Loves denying 'the general public'.") is the best case and most imported books have nothing there. Two lines give the Keeper a register to hold without telling it what to say.

**E.2a Register comes from who the person is, and it is spoken.** The ruling above is the standard for every line, authored or established or performed: the words a line uses are the words of that person's class, trade, schooling, era and place, and they are words said aloud — short, interrupted, slangy, coarse where the person is coarse, mannered where the person is mannered, never the narrator's register, never a written sentence read out. The dossier already carries what decides this: `role`, `wants`, `fears`, `hides`, `toward_party`, `speaks` (from `natural-npc`), the book's era and setting, and the person's documents. **No table in code or content maps a trade, a class or a place to a way of speaking** (the standing rule against hard-coded semantic lists; also the open-language rule: colloquial is a property of the play language, and there is no per-language slang table). The judgement is the lane's for `sample_lines` and the Keeper's at the table; what the product does is give both the material and the standard, and test the result blind (acceptance, "different mouths").

**E.3 The package.** `mods/npc-voice/mod.json`: `requires: ["graph.vocabulary.v1", "graph.vocabulary.table.v1", "context.npc.v1"]`; `contributes.vocabulary.actor_profile_keys: [{key: "sample_lines", label: "sounds like", shape: "lines", ask: "two short lines in this person's own words when the book prints their speech, one at ease and one under strain"}]` — `ask` is what the reader is told, so a book that prints speech gets authored lines at build and the lane never runs for that person (28.7: the book's word stands). `contributes.instructions` / `brief` tell the Keeper two things. **`sounds like` is the register, never a line to read out; a person who repeats their sample line is a person the player has heard before.** (The predecessors said "follow it strictly"; strictly followed, two lines become the only two lines the person ever says.) And **a line is spoken by that mouth**: it uses the words this person's trade, class, schooling, era and place would use and no other person's; it is talk, not prose — half sentences, interruptions, slang, an oath where the person swears and a euphemism where the person would not; two people at the table who sound alike is a fault of the Keeper's, and the narrator's own register never enters a say span. The full form carries the user's two-mouths example verbatim as the standard; the brief carries one clause. `shape: "lines"` is new vocabulary on a contributed key: its value is a list of at most two bounded strings instead of one line; the read side (`kernel-ts/read/capsule.ts` `tableWords`) passes a list through as a list; `apply {kind: "dossier"}` refuses a `shape: "lines"` key with a fix naming the lane — the Keeper does not author sample lines mid-turn.

**E.4 The lane** (`extensions/npc-voice/index.ts`), the §17.10 shape: a zero-tool subsession through `runLane`, queued by `createLaneQueue`, model from `resolveLaneModel` with `PI_COC_VOICE_MODEL` overriding, one job per (campaign, person), never re-run once written.

- **Trigger.** On `coc:turn-committed`: every person in the committed turn's `present[]`, and every resolved speaker in its `speech[]`, whose dossier has no `sample_lines` (authored or established). Backfill over the graph's unmet people exists behind `PI_COC_NPCVOICE_BACKFILL` but is **off by default** (ruled 2026-09-15 after the first table spent eleven calls at the door): a person gets lines the turn after they are first present or first speak, which is soon enough, and nothing calls a model for a person the player will never hear.
- **Packet** (`voice.job {campaign, npc}` → closed fields, nothing else reaches the prompt): `job_id`, `play_language`, the module's title and era as the graph states them, the person's `name`, their Keeper-side dossier as `present[]` would show it (`role`, `wants`, `fears`, `hides`, `voice` if any, `speaks` if any, `would_lie_about`, `deflect_lines`, up to three `knowledge` lines), and the person's own documents from the graph, bounded to 4 KB of the record's prose spans (a module node carries documents, not a record — the same reading the capsule's `keeper_note` uses). The lane sees secrets because the output is Keeper-facing; that is the same boundary `voice` already sits on.
- **Instruction** (`content/setup/npc-voice.md`, authored in English like every lane instruction): write exactly two lines this person would say, in `play_language`, in two fixed situations so registers compare across people — **at ease**: brushing off a stranger's first question; **under strain**: pressed on the thing they hide. Each line is talk, not prose: the words of this person's trade, class, schooling, era and place, said aloud, with the oaths, slang, half sentences or mannered turns that mouth would produce; the book's `voice`, if given, governs; a line that a person of another class or trade could say the same way is a failure, and so is a line that reads like writing; no numbers, no rules, no names of things the player has not discovered (the `hides` field is who they are, not what they say aloud). The instruction carries the user's two-mouths example as the bar. Output `{"sample_lines": ["…", "…"]}`.
- **Validation** (`voice.submit {job_id, sample_lines}`, deterministic, refuses on shape only): exactly two strings, each 1–120 characters after trim, distinct from each other, no `{{`, no line breaks. Nothing semantic is checked in code (no "generic" detector, no language detector; §23's `play_language_mismatch` is the verifier's business if it ever matters here). On pass the kernel writes `world.mods.state["npc-voice"].dossier[<node_id>].sample_lines = {value: [a, b], label: "sounds like", turn, mod: "npc-voice"}` — the 28.7 namespace, so the three properties follow for free: the book is never written to, the word dies with the package, it is campaign-scoped. `voice.fail {job_id, reason}` with a closed enum (`no_answer`, `shape`, `lane_error`), retried at most once per person per session.
- **Telemetry.** `{lane: "voice", npc, ok, reason?, ms}` per attempt, in the campaign's `telemetry.jsonl`.

**E.5 What the lane is not.** Not a director signal, not a behaviour engine (`chatrpg`'s liveness compiler — mood → sentence length → directness — is deterministic table-driven style and stayed unwired even there; if it is ever wanted it is its own section). Not a rewrite of `voice`: an authored `voice` stands and is input. Not a player-facing word: it never enters the journal, the sheet, or `table.view`.

### F. Prompt bytes

- `prompts/keeper.md`: Law 4 (+1 sentence), Writing (+2 sentences), the floor's "A voice" clause (+ "inside a say token"). The base prompt has no byte ceiling; this is roughly 400 bytes.
- `content/craft/beat-directives.json` `floor_lines[voice]`: "voice: anyone present the exchange touches speaks a line in their own voice, inside {{say:name}}…{{/say}}".
- `mods/narration-craft/brief.md` (+ ~40 bytes), `mods/npc-voice/brief.md` (new, ≤ 250 bytes). The five default packages total 3892 bytes today against the §30.7 ceiling of 4000.
- **§30.7 ceiling: 4000 → 5000 bytes** (user ruling). The number is stated in §30.7 and §34.8 and enforced wherever the loader sums active briefs; both text and check move together. Old package versions keep their bytes and locks (§26).

## Acceptance

Measured on a real table, live Keeper, one human player, one line per turn, `xai/grok-4.6` low (the standing rule: no settle scripts, no synthetic turns). Twenty Keeper turns of The Haunting in zh-Hans, from a fresh campaign (a campaign is a compile snapshot; the packages and prompt changes reach nothing already created).

| claim | evidence | pass |
|---|---|---|
| every spoken line is wrapped | `lane: "speech"` rows vs a hand count of spoken lines in the same twenty deliveries | ≥ 90% of lines wrapped; every wrapped line resolved or labelled; zero `unresolved` for people in `present[]` |
| nothing machine reaches the player | the twenty `rendered_text`s | zero `{{` |
| one person, one colour | screenshots of turn 3, turn 12, and turn 12 after a relaunch of the App (history path) | the same person the same hue in all three; no two people at the table share a hue |
| the investigator is fixed | same screenshots | the investigator's lines in the fixed slot on every turn |
| the model never touched an id | the twenty `text` drafts | no node id, receipt id, hash or `npc:` prefix anywhere in a say token |
| `sample_lines` arrive | `present[]` of the capsule on each person's second appearance | present for every person the book gave no lines; absent (authored value stands) for any it did |
| the Keeper performs, does not recite | hand read of every line by a person with `sample_lines` | no sample line reproduced verbatim |
| different mouths | ten say spans from the table, names stripped, from at least four people of different backgrounds; a reader who knows the cast assigns each to a speaker | ≥ 8 of 10 assigned right; none reads as written prose |
| the lane's lines are talk | the `sample_lines` of every person the table met | the same blind test on the lane's own lines, ≥ 8 of 10; a labourer and a gentleman never get interchangeable lines |
| nothing else moved | `pytest tests/kernel` (after `build:runtime`), `npm run test:ext`, pi-backend suite, UI suite | green against their recorded baselines (compare case names, not totals) |
| a second model | the same twenty turns on the App's `deepseek/deepseek-flash` | **done: 29%** (19 spans / 65 lines), 6 of 23 turns marked; the verifier raised 35 `unmarked_speech` findings. See "Second model" below |

## Acceptance results (2026-09-15, real table)

| claim | evidence | verdict |
|---|---|---|
| every spoken line is wrapped | 37 spans over 21 turns; the Keeper wrote 37 opens and 37 closes; each turn's prose re-read with its spans blanked, nothing left that reads as speech | pass, 37/37 |
| every speaker resolved | 0 unresolved labels; three NPCs and the investigator, all by handle | pass |
| nothing machine reaches the player | no brace in any `rendered_text` | pass |
| the model never touched an id | no node id, receipt id, hash or prefix in any of the Keeper's own drafts | pass |
| one person, one colour | the host allocator over the real anchors gives three distinct slots plus the fixed investigator slot, deterministic from transcript order | pass on the data; **the pixels were never seen** (screen access declined). Electron 44's Chromium supports the `oklch()` / `color-mix()` the palette uses |
| the host gets what it needs | 16 of 40 `coc-mechanics` session entries carry `speech` beside `marked_text` | pass |
| `sample_lines` arrive | the lane ran for 11 people, every job ok, 11-19 s each | pass |
| the Keeper performs, does not recite | 1 of 22 sample lines appeared verbatim (Wilmot's first line, which the book's own `voice` all but dictates) | **fail, 1 instance** |
| different mouths, played lines | ten spans, names stripped, judged blind by a reader who had not seen the session | pass, 9/10 |
| different mouths, lane lines | one line per character, names stripped, judged blind against the real roster | pass, 10/10 |

Four lane defects the table found, all in `content/setup/npc-voice.md`'s instruction, none in the kernel:

1. **The strained line collapses to one register.** Nine of eleven second lines end in an exclamation mark and four swear, regardless of station: the landlord, the clippings gatekeeper and the quiet basement filer all shout. The at-ease line stays varied (no exclamations, three coarse). One fixed situation for everyone produces one reaction for everyone.
2. **An authored `voice` was overridden.** Ruth Blake is written "Quiet, practical, basement-warm"; the lane gave her a coarse panicked line. §40.5 and the instruction both say the book governs.
3. **People the book says do not speak were given speech.** The rat swarm ("No speech — squealing"), Corbitt ("Rarely speaks; acts through knocks, blood, flying furniture") and Vittorio ("Mostly silent") each got two spoken lines, because `shape: "lines"` demands exactly two and the lane has no way to answer "this one has no sample lines".
4. **A graph name in the book's language leaked into a play-language line**, and `speech[].who.name` carries the same English display name to the host's hover title on a Chinese table.

**Second model (2026-09-15, same day): `deepseek/deepseek-flash`, thinking low, campaign `speech-0915-ds`, the same route, 23 player inputs, 20 delivered turns.** The wrap rate is **29%**: 19 spans over 65 spoken lines; only 6 of the 23 turns carried any token (the opening two and the last five), the fourteen in between wrote every line in 「」 with no token at all, exactly the silent model-dependent failure §34.13 recorded for the mechanics marker. What held: no brace reached the player, no id in any draft, four spans that named nobody on the graph stayed labels (the library clerk, a bystander) and were not refused, and **the verifier's fifth kind did its job — 35 `unmarked_speech` findings** against 0 on the grok table. Backfill off by default was verified here: the lane wrote for the five people the table met and nobody else. Two costs the model carried that are not this section's: 17 of 20 deliveries were implicit closes (0 of 21 on grok) and three whole player turns were stranded and released on the next input because the continuity-review lane, following the Keeper's model, hit its 40 s timeout (3 of 25 reviews; median 13 s). Median 430 characters per delivery, with figures written into the prose. Conclusion: on the App's cheaper model the token is a suggestion the model mostly ignores after the opening; "mandatory" holds only through the verifier's finding, and a host-side steer on a delivery with people present and no span would be the next lever.

Two pre-existing faults the run also surfaced, unrelated to this section: turn 0 took six `mod_audit_stale` refusals and the refusal budget shut `narrate` once; after an `unknown_entity` lookup the Keeper wrote the service state into the story ("this stop is still preparing material"), a §34.1 immersion breach.

Shape of the run: median 137 characters per delivered turn, zero implicit closes, 74 tool calls, 28 admission reviews.

## Tests owed with the implementation

- `tests/kernel/test_speech.py`: A.4 repairs (nesting, unclosed, stray close, marker moved out), A.5 resolution order and label fallback, B.2 outputs (`rendered_text` clean, `marked_text` emitted for say alone, `speech[]` order), B.3 result shape (no ids), `ask` parity, old records without `speech` still read.
- `tests/kernel/test_markers.py`: a say token never appears in `unknown`, `duplicate`, or `placed`.
- `tests/kernel/test_voice.py`: job packet closed fields; submit validation (count, length, distinct, braces); refusal when the source authored `sample_lines`; the list reaches `present[]` through `tableWords`; disappears when the package is disabled; `apply dossier` refuses the `shape: "lines"` key with the fix.
- `tests/kernel/test_journal.py`: packet carries `speech`; a resolved speaker is recordable.
- `tests/extension/npc-voice-lane.test.mjs`: queue, one job per person, the fail enum, no write on a shape failure, backfill env gating.
- `tests/extension/turn.test.mjs`: the `speech` telemetry row per delivery.
- Host: a `DeliveryCard` test rendering `marked_text` with mixed tokens — a span cut by a card keeps its colour on both sides; two anchors hashing to one slot get different slots; a label reused twice gets one slot.
- Mutation check on each product fix (the standing rule: a fix without a test the mutation kills is not covered).

## Coarse language (ruled 2026-09-15)

A table can turn it down: `npc-voice` carries `settings.coarse_language` (boolean, default `true`), rendered as a checkbox by the sidebar Mods panel like every boolean package setting, passed to the Keeper in the instruction row's `settings` and to the lane in the job packet. Off means no profanity; the register otherwise stays the person's.

## Implementation notes (2026-09-15)

- `speech[].who.npc` is the graph **handle**, not the node id: the whole narrate result is the tool text the model reads. The journal projection's `id` is the same handle, so the panel swatch and the card share one anchor.
- The lane's failure enum is `journal.fail`'s (`invalid | lane_error | model_error`); its write appends the §28.7 event `dossier-established` rather than a new event type.
- The host's colour block is authored once and copied byte-for-byte into `pipicoc/mechanics.js` and `pipicoc/panel.js` (pack renderers load from `data:` URLs and cannot import siblings); `tests/extension/speaker-colour.test.mjs` fails if the copies drift. The slot table lives on `globalThis` for the session, nothing persisted; if the sheet panel renders before the transcript it allocates first, so the transcript's colours are reload-stable but a panel-first render can shift which anchor takes which slot.
- Three host leaks were found and closed on the way: the fold that hides the plain assistant copy of a delivery had to learn the token (or a spoken turn printed twice), `mechanicsEntry` builds `details` from a named field list (so `speech` had to be added or both render paths dropped it), and a say-only delivery with no mechanics rows got no card at all.
- Starvation the lane cannot fix: a person whose job failed twice in a session stays first in `voice.job`'s order and blocks everyone behind them; the lane ends its drain there and notes `skipped: "retry_budget"`. A kernel-side fix (a failed job moves to the back, or a `skip` list) is owed if it shows at a real table.
- `content/setup/**` is CJK-guarded, so the lane instruction carries the two-mouths example in English; `mods/npc-voice/agent.md` carries it verbatim.

## Out of scope, named

TTS; portraits; an emotion slot; a bystander/voice classifier of any kind; storing colours; the Keeper authoring sample lines by `apply`; a behaviour engine; rewriting the four verifier kinds. Any of these is a new section and a new ask.
