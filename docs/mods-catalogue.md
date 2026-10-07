# The built-in packages: what each one does, and where its text goes

Written 2026-10-04 from the shipped files under `mods/` (before §183 sectioned six of them: the blank-line blocks below are now `## ` headings, and the briefs are gone) (manifests, instructions, briefs, lane files) and the contract sections they cite, for the instruction index (`docs/specs/mod-section-index.md`). Ten packages, and an eleventh, Hostile Creatures (§11), added the same day for contract §180.11. The byte counts are the shipped files'.

## How a package reaches the table

Game Clock (`game-clock` 1.0.1, default on for new campaigns; added 2026-10-06)
is a presentation-only package requiring `ui.clock.v1` and `mods.package-files.v1`,
with `package_files: []` (only `mod.json` ships). It places the game's
clock at the upper right of the transcript. Reading history follows the centered
message's committed time; returning to the bottom restores current time. It has
no Keeper instructions, settings, model calls or state writer. Existing campaigns
enable it through the Mods panel. Contract: §23.5.

A package contributes text and declarations through closed slots in `mod.json`; each slot has one consumer, and only two of them are Keeper instructions:

| slot | who reads it | when |
| --- | --- | --- |
| `instructions` (`agent.md`) | the Keeper, in the `coc-context-brief` message built from `capsule.mods.instructions[]` | whole on every turn while the table's instructions fit 64 KiB; beyond that a sectioned package sends its resident sections there and the rest by topic (§183) |
| `sections` (`sections.json`) | the kernel and the host's section lane | which `## ` sections ride every turn and which a turn loads by topic, state or call (§183.1) |
| `brief` (`brief.md`) | nobody | retired (§183): the probe of 2026-10-04 found it only ever reached the capsule; frozen versions still carry it |
| `style` (`style.json`) | the Keeper, as `capsule.style` | every turn: axes, the beat's directives, the floor (§137) |
| `auditor` (`auditor.md`) | the pre-delivery audit lane (a tool-enabled Pi task) | before a delivery, when the host runs the audit |
| `materializer` (`creator.md`) | the definition/usage creator (a tool-enabled Pi task) | when the Keeper's `apply define` / `usage` needs parameters |
| `checks` | the kernel | declares a contributed check, its trigger, values and result table (§26, §134.2) |
| `vocabulary` | the graph reader | asks the book for these profile keys per person (`speaks`, `mask`, `in exchange`) and per creature (`habits`, §180.8) |
| `voice_lane`, `voice_lane_addendum` | the NPC voice writer (a tool-enabled Pi task) | when a person's voice card is generated (§40.7, §153.3) |
| `expression_cards`, `speech_edit_lane` | the expression selector and the speech editor lanes | per turn on a Chinese table (§165, §172) |
| `setup_instructions`, `setup_slots` | the setup guide | character creation only |

The index concerns the first two slots. Everything else already reaches its consumer when that consumer runs; it never competes for the Keeper's context.

## 1. Narration Craft (`narration-craft` 2.2.7, default on, conflicts with npc-voice)

**What it is.** The one prose package: how the Keeper writes. The base keeps only interfaces; every sentence about voice, rhythm, description and the people's speech lives here (prose-mod §6, §170).

**Contributes.** `instructions` 13.8 KB, `brief` 0.9 KB, `style` (five axes, nine directives chosen per beat, four floor lines), `vocabulary` (`mask`, `in exchange`), `voice_lane` (7.3 KB: how the voice writer makes a person's mask and three exchanges). Settings: `coarse_language` (on: a person whose book voice swears may swear when crossed), `density_guide` (off: no length expectation).

**Sections of `agent.md` and what each does.**
- *This turn* (1.2 KB) — the player's words are the act; write it in the Keeper's words then the world's reply; decide what the exchange puts at issue; carry the action to the first outcome, obstacle, risk or fork; no menu. Applies every turn.
- *Sentences and paragraphs* (2.2 KB) — whole sentences, one focus per paragraph, facts not field names, seen over felt, no verdict on a cause the source has not given, identities anchored, declared vs settled. Every turn.
- *The people here* (7.1 KB) — an NPC's factual answer draws only on module and play knowledge; a first meeting shows looks before name; people react to the whole encounter in their register; the mood (`now`) is written with `apply npc mood` before they speak; answer a genuine question directly when the situation permits; threats land one consequence; `voices` masks worn, never read out; every line in `{{say:Name}}`. Every turn with a person present.
- *Scene and detail* (1.9 KB) — viewpoint and movement; first visits show every visible book feature; returns lead with what changed; historical excerpts folded in unannounced; crisis order; quiet scenes may linger. Every turn.
- *Opening the table* (0.5 KB) — the first turn sets the table. Turn 0 only.
- *Settings* (0.5 KB) — what the two settings mean. Every turn.

**Reads.** `capsule.style`, `present[].now`, `voices`, `first_sight`, `historical_reference_materials`. **Writes.** `apply npc mood`; the say tokens in prose.

**Index note.** Resident by nature: all of it is "every turn". It is the one package the index does not help; its cost (13.8 KB full, 0.9 KB brief) is the prose contract's.

## 2. Natural NPC (`natural-npc` 1.4.6, default on)

**What it is.** People, not service desks: a first impression rolled once per pair, a request judged by whether this person would grant it, the answer an asker is after given or hidden, and a language the investigator may not share.

**Contributes.** `instructions` 8.5 KB, `brief` 1.3 KB, `auditor` 2.6 KB (checks that a settled impression shows in the person's manner, and that a spoken exchange respects the language ladder), `vocabulary` (`speaks`), `checks` (`natural-npc:first-impression`: trigger `contact`, the higher of Appearance and Credit Rating, regular difficulty, reusable per pair, six result rows from breakthrough to actively adverse). Setting `language_mixing` (off / light / full: how much foreign fragment is rendered inside lines).

**Sections.**
- *First impression* (2.2 KB) — call `resolve natural-npc:first-impression` on first meaningful contact; the person must be present (stage them with `apply npc to: here` first); the opening turn cannot roll for people not seated; the frozen result shapes manner and what they offer, never forces disclosure; critical/fumble lands a material opportunity or complication through `apply`. Due when a present person has no history with the investigator (the presence-impression branch moves the roll into the kernel at first shared scene, natural-npc 1.5.0).
- *Asking for something* (0.9 KB) — a request this person might grant is rolled with the social skill the approach suggests, opposed as hard as it cuts against them; a request nobody in their position would grant for nothing is refused unrolled. Due when the investigator asks a person for something at their discretion.
- *What the asker is after* (0.7 KB, §179) — know the answer the investigator would need to act on; a willing person gives it complete enough to use; one with a reason to hide hides exactly that. Due when the investigator asks a person a question.
- *The language of the exchange* (4.6 KB) — `speaks` unknown is not shared fluency; the working language comes from the setting and the exchange, kept with `apply dossier`; the printed ladder (5/10/30/50/75) sets how much crosses; render the gap inside lines; `language_mixing`. Due when a present person's language is unknown or not covered by the investigator's sheet.

**Reads.** `present[].speaks`, `.wants/.fears/.hides`, the investigator's Language skills, `mods.pending_contacts`. **Writes.** `resolve` the impression check; `apply dossier` language; ordinary social checks.

## 3. Enhanced Items (`enhanced-items` 1.3.2, default on)

**What it is.** Executable item parameters from the story: definitions and instances with ownership, ammunition, condition, usages and readable documents; a creator agent prepares the numbers, an auditor catches undeclared mechanics before delivery.

**Contributes.** `instructions` 8.0 KB, `brief` 0.9 KB, `materializer` 8.9 KB (the creator: weapon presets copied exactly with listed deviations, spell/item parameter shapes, document text in the play language, `unsupported_capability` refusal), `auditor` 4.7 KB (unpublished narration vs registered objects: missing definitions for things with mechanical consequence, unregistered equipment once used, carriers without a document, described damage vs instance state; never for scenery or a sheet weapon). UI: a paper document editor.

**Sections (blank-line blocks of `agent.md`).**
- *Documents on carriers* (1.6 KB) — readable/writable carriers get a document capability (`object` with `document:{text,presentation}` or `{handout}`); initialise once; text in the play language; player writing through `document:{action:"write"}`; `look focus object` reveals current writing. Due when a readable carrier is received, read, written or shown.
- *Register unregistered equipment* (1.7 KB) — at the opening, inspect `unregistered_equipment` and register weapons lacking parameters; everything else when first drawn, shown, handed over, used, damaged or lost; one apply of definitions and adoptions only; name the object, put the rest of the sheet line in the description. Due when gear is unregistered and a carried thing is handled.
- *Define new things* (0.9 KB) — before a mechanically meaningful new item, weapon or spell appears, `apply define` then `apply object`; a batch of define/object/usage only. Due when the Keeper is about to place a new thing.
- *Transfer, consume, inspect, repair, containers, damage* (1.6 KB) — `apply object` with from/to for transfers; `resolve objects:use` for consumables; `magic:learn-spell` / `cast-spell`; `look focus object`; `objects:repair`; condition changes with a causal why; never `item` for a managed object. Due when a registered instance changes hands, is used up, repaired, damaged or cast with.
- *Attack with a held instance* (1.9 KB) — `look focus object` first; select an accepted usage or `apply usage`; stage define/object/usage in one apply for a scene object; the creator validates; never ask the player for numbers. Due when the investigator attacks or uses force with an object.
- *Host refusal repair* (0.3 KB) — repair a refused narration with define/object, then retry without rerolling. Due on the host's refusal.

**Reads.** `mods.objects` (definitions, instances, usages), `mods.unregistered_equipment`, `known_handouts`. **Writes.** `apply define / object / usage`, `resolve objects:* / magic:*`, `look focus object`.

## 4. Keeper Pacing (`keeper-pacing` 1.3.1, default on)

**What it is.** Carry the selected goal and stop before a new choice; fair warning before death; threat clocks the Keeper runs; a stall counter that asks what the player is doing; recovery that costs only what the book and rules charge.

**Contributes.** `instructions` 5.3 KB, `brief` 0.9 KB. Setting `stall_turns` (default 2).

**Sections (blocks).**
- *Carry the selected goal* (1.2 KB, two blocks) — carry through routine steps, stop before a new destination, method, cost or disclosure; return the turn at completion; give the public basis for the next judgment. Every turn.
- *Close calls* (0.5 KB) — `mods.pacing.close_calls` counts major-wound or zero-HP turns; below the threshold a lethal move lands as a warning; at it, lethal outcomes are fair. Due when an outcome could kill or gravely wound.
- *Threat clocks* (0.7 KB) — `mods.pacing.threat_clocks`: advance one with `apply threat` when the party spent real time, made noise, was seen or pushed the danger; put the segment's symptom in the fiction; a full clock hands the book's words. Due when a clock is running (state) and the turn spends time or draws attention.
- *Stalled turns* (1.3 KB) — `director.because.stalled_turns` reaching `stall_turns` is a prompt to read what the player is doing: deliver owed consequences, let a present person act, put authorised information in reach; never a ladder. Due when the counter reaches the setting.
- *Never lecture a stuck player; Idea roll* (0.7 KB) — say plainly what you meant, remind them what the investigator knows; the rulebook's Idea roll where the book calls for it. Due when the player is out of character, stuck or confused.
- *Empty turn / repeated input* (0.5 KB) — structural RECOVER signs; `director.offer` suggestions are advisory. Due on the Director's RECOVER sign.
- *No escalation ladder* (0.3 KB) — quiet and refusal are play; no invented deadlines. Every turn.

**Reads.** `mods.pacing`, `director.because`, `director.offer`. **Writes.** `apply threat`; the Idea roll.

## 5. Story Thread (`story-thread` 1.2.11, default on)

**What it is.** The module reorganised by what the story still needs: per authored conclusion, the clues here with their gates, the scenes one move away, the book's own recovery; a reentry assessment when the player's frame has left the thread.

**Contributes.** `instructions` 12.3 KB, `brief` 0.9 KB.

**Sections (blocks).**
- *Reading `mods.thread`* (two blocks, 1.8 KB) — lines per conclusion with `here`, `next`, `beyond`, `fallback`; land a reached clue with `apply clue`; what a `gate` means (named check, unspecified check, no check); directions through the fiction when the player asks where to go, never a menu. Due when an undiscovered clue is here or a line has `here`/`next`.
- *Reentry* (five blocks, 9.0 KB) — `mods.thread.reentry`: steering not a gate; `clarify_known` (one acquired row argued in its relation's direction, nothing new) vs `introduce_evidence` (the supplied bridge, `authority.clue_here`, `source_rebinding` only when the fiction reaches for it, `bridge_offer` leaves the choice open); the four lawful defers. Due when `mods.thread.reentry` exists.
- *Handed clues* (0.4 KB) — what the book means to happen: plainly in the room or said when asked; timing is the Keeper's, no invented check. Due when a clue here is handed.
- *Continuity and clarification* (two blocks, 1.1 KB) — `lookup continuity`, `recall`; clarification connects evidenced facts and never fills a causal gap with a new biography; a prior improvised line is not source authority. Due when the player connects evidence or draws a conclusion.

**Reads.** `mods.thread` (lines, connections, reentry), `known.clues_here`, `obligations` (quests), `where.endings`. **Writes.** `apply clue`, `apply flag` to waive a scene obligation, `lookup adaptation / continuity`, `apply adaptation`.

## 6. Historical Reference (`historical-reference` 1.1.0, default on; host setting `exa_api_key`)

**What it is.** Original period background and prices, retrieved through focused questions and selected by Jev. Exact and analogous searches retain their actual source limits; fresh price baselines separate retail prices from hourly wages. An evidence gap can prepare Deep-lite originals in the background for later local reuse.

**Contributes.** `instructions` 5.0 KB in five declared sections; no separate brief or generated-answer source.

**Sections (blocks).**
- *The reference library* — focused exact/analogy questions, local reuse and optional background originals; the host hands `historical_reference_materials` to the first writing step. Resident.
- *Setting and reference* — the authored era is the scenario's; borrow compatible appearance and practice while retaining the source's actual limits and the scenario's names and institutions. Resident.
- *Prices* — separate retail and hourly-wage baselines, then estimate from saved anchors; arithmetic and Spending Level stay the kernel's. Due when a price, wage, fare, rent or menu comes up, and before the Keeper writes `cash`.
- *A disputed price* — only an actual player challenge to a quotation permits targeted checking. Due when the player disputes a quoted price.
- *When retrieval is closed* — finish from what came back. Resident.

**Reads.** `historical_setting`, `historical_reference_materials`. **Writes.** `lookup kind=historical_reference`.

## 7. Chinese Optimization (`zh-optimize` 1.3.9, default on, language-scoped `zh`, own brief budget 1200 B)

**What it is.** Chinese that sounds spoken, not translated: narration and dialogue guidance for the Keeper, a Chinese addendum for the voice writer, 19 expression cards a selector picks per person and turn, and a speech editor that rewrites the delivered lines' connectives and particles after delivery.

**Contributes.** `instructions` 0.8 KB (one section: write Chinese as a native speaker would hear this person; word choice, register, ellipsis, aspect, particles where they carry the moment; no imposed shortness or tics), `brief` 0.6 KB, `voice_lane_addendum` 1.7 KB, `expression_cards` 15.2 KB (6 habits, 13 interactions, each with `applies`, `pattern`, an `activation_question` for the selector and grounded examples), `speech_edit_lane` 14.5 KB (the editor's instruction and the owner's 29 before/after demonstrations).

**Index note.** The Keeper-facing instruction is resident (every Chinese turn). The cards and the editor run in their own lanes and never enter the Keeper's context.

## 8. Narration Audit (`narration-audit` 1.2.32, default on)

**What it is.** The pre-delivery continuity review: settled consequences appear, prose is intelligible, the player is addressed in the second person, failed rolls are respected, the locus is committed, reentry is judged; owed state is named rather than rewritten. Numbers, length and taste are never graded.

**Contributes.** `auditor` 15.6 KB only (schema 2: missing, owed, findings, conflicts and seven subreviews, submitted with `submit_audit`). No Keeper instruction. **Index note.** Not in the index; its consumer is the audit lane.

## 9. Guided Creation (`guided-creation` 1.2.1, default on)

**What it is.** A short, player-paced exchange before the card is drafted: a form of slots (`trade`, `built_for`, `known_for`, optional `not_good_at`), one question per turn, the player's words read into aptitude, then the draft. Setting `max_guided_turns` (3).

**Contributes.** `setup_instructions` 5.5 KB, `setup_slots`. **Index note.** Setup only; the play index never sees it.

## 10. Keeper Context (`keeper-context` 1.1.0, default off) and NPC Voice (`npc-voice` 1.3.0, default off, superseded by narration-craft)

- *Keeper Context*: guidance for a host-owned workspace of verified source bodies and a workpad (settings: mode off/shadow/on, bytes, candidate limits, rerank). `instructions` 1.6 KB, `brief` 0.3 KB. Due when a workspace was provided (state).
- *NPC Voice*: the earlier voice package; its register rules now live in Narration Craft's "The people here". `instructions` 2.9 KB, `brief` 0.2 KB. Kept for campaigns locked to it.

## 11. Hostile Creatures (`hostile-creatures` 1.0.0, default on)

**What it is.** How a hostile creature is played (contract §180.1): a creature as a body, by the habits the book gives it, and the weaknesses that end a being carried to the Keeper as a chain the investigators can work through. What a being is, and which machinery may treat it as a person, stays the base's: disabling this package does not make a rat a person again.

**Contributes.** `instructions` 2.7 KB, `sections`, `vocabulary.creature_profile_keys` (`habits`: where it lairs, how it hunts or attacks, what draws it, when it breaks off or flees). Requires `actor.weaknesses.v1`, so a build with it enabled asks the reader for `weaknesses` on npc and creature nodes and the checker holds them (§180.9); and `graph.vocabulary.table.v1`, so the Keeper may establish `habits` and append `weaknesses` with `apply dossier` where nothing authored says (those go when the package does; the build-bound words stay, §28.5). No brief, no settings.

**Sections.**
- *Preamble* (0.7 KB, resident) — what the package reads (creature rows, the weakness chain, `habits`); an animal the Keeper brings in is declared with `apply npc walk_on` and `creature`, its habits written with `apply dossier`.
- *Playing a creature* (0.5 KB) — a body by its `what` and `habits`: sound, motion, behaviour, no lines and no name to learn; its disposition decides how it fights and when it breaks; its acts settle through `resolve` and `apply npc`. Due on `state:creature_present`.
- *Weaknesses* (1.4 KB) — a weakness without `learned_by` is found in play, never announced; a learnable one's `found`/`of` and the thread line say what is missing; `needs` with `held_by` / `known_by` / `taught_by`; a false lead is believed until tested; exploiting a weakness settles through ordinary receipts; table entries are appended. Due on `state:weakness_here` and `before_resolve:combat`.

**Reads.** `present[]` creature rows (`kind`, `what`, `habits`), `weaknesses` and `false_leads` on actor rows, `look focus=npc` for the whole chain, `mods.thread` lines. **Writes.** `apply npc` (walk-on with `creature`, `disposition`, `action`, `conditions`), `apply dossier` (`habits`, `weaknesses`), ordinary `resolve` and damage.

## What the index sees

Of the ten packages, seven contribute Keeper instructions; their full texts total 55 KB and their briefs 4.9–5.0 KB, the ceiling. By section:

| kind | sections | bytes | how they load |
| --- | --- | --- | --- |
| resident (every turn) | Narration Craft ×5, Keeper Pacing carry + no-ladder, Historical Reference bounds, zh-optimize | 16.1 KB | the resident text: today the brief; in the index design a per-package resident ceiling |
| state / host triggered | reentry, clues here, handed clue, first impression, language gap, clocks, stall, recover, opening, materials, workspace, documents, define, manage, refusal, closure | 20.3 KB | code: a capsule field or a Keeper call |
| topic-judged (Jev), some also gated | register, force with object, lethal, out-of-character, asking, asker, conclusion, prices, price dispute | 7.1 KB | the topic lane |

Every section's trigger, topics and gate are recorded in `experiments/mod-section-index/prototype/index.json`.
