# Module exhibits: what the investigators perceive reaches the sole author

Status: ready-for-agent

Contract: `docs/kernel-rpc.md` §257 (written by ticket 01). Owner decisions 2026-10-22 (project thread
"新架构接线审计与模组解析"): module parsing is redesigned for the decision packet and the sole author; sandbox first,
then implement. Sandbox evidence: `experiments/module-units/` and the owner's
`.coc/test-runs/module-units-probe-20261022/` (MiniMax 3.1 reader and author A/B, Blood Road, Esso station).

"Exhibit" is the new term for one piece of player-perceivable book material. It is not the reading pipeline's
existing "source unit" (a range of book pages).

## Problem Statement

Since the structured Keeper, a separate author writes every player-facing word, but the module graph is still shaped
for a Keeper who sees every secret and writes the scene himself: nodes carry English Keeper summaries, biographies
holding later reveals, and clues as one-line propositions. The reader is told not to extract dialogue, mannerisms or
read-aloud text. So the author receives either nothing worth writing or what it must not see:

- First sight falls back to the scene summary or a person's biography, and that text goes to the author (spoilers;
  in the sandbox the author input carried "PC进入阿巴托尔后的第一可玩地点。时间线……").
- A revealed clue reaches the author as `{name, summary}`; the diary, photograph or body itself is invented.
- A person's authored lie or deflection cannot be selected in the packet; people only tell the truth, don't know, or refuse.
- Book material the Keeper consults mid-play never becomes something the author may write.
- A person's authored voice never reaches the author.

The player reads invented scenes and propositions instead of the module, and sometimes reads the Keeper's secrets.

## Solution

The reader also extracts, for the nodes it makes ready, **exhibits**: what an investigator can see, read, hear or be
told, in the book's words (read-aloud and handouts verbatim, the rest as a faithful close paraphrase), each tied to a
carrier node, with the Keeper's interpretation kept on a separate Keeper-only side. The Keeper's decision catalog
issues exhibits in scope as `exhibit_N` with a Keeper label; the packet selects one in `reveal` or as a person's
communication; the host settles it (a clue it teaches is discovered, through the clue's existing validation, in the
same atomic settlement) and gives the author only the surface. First sight uses only description and appearance
exhibits. A person's voice exhibit rides with the person. Graphs read before this change keep working: first sight
is undescribed and a background read adds exhibits for the scene the table enters.

The sandbox showed the effect: with exhibits the author input held no Keeper text, and the prose used the book's
detail (corrugated awning, leaking tanks, the Nova on the lift) and the owner's actual words ("tire's leaking, I can
fix or replace it, about an hour"); without them it held the Keeper summary and invented a noon appointment.

## User Stories

1. As a player, I want a newly reached place described with the book's own sensory detail, so that I am in the module's place, not a generic one.
2. As a player, I want a person's first look drawn from the book, so that people are as the author of the module drew them.
3. As a player, I want a handout or sign I read to show its actual text, so that I can investigate the document myself.
4. As a player, I want boxed read-aloud text delivered faithfully in my play language, so that the scene lands as the module intended.
5. As a player, I want what I find by searching written as what I perceive, not as its meaning, so that I do the deduction.
6. As a player, I want a person to answer with what the book says they say, so that interviews feel authored.
7. As a player, I want a person to lie or deflect exactly as the book says they do, unflagged by the narration, so that I can be misled and catch it myself.
8. As a player, I want a person to speak in the voice the book gives them, so that people are distinguishable.
9. As a player, I want never to read a Keeper secret, a later reveal or a pacing note in the prose, so that the mystery is intact.
10. As a player, I want people I have not been introduced to referred to by how they look, not by names I could not know, so that names are earned.
11. As a player, I want a clue I uncover to be recorded once, whether the Keeper chose the exhibit or the clue, so that my notebook is right.
12. As a player, I want a clue whose check I failed never to be shown to me, so that rolls matter.
13. As a player of an old campaign, I want play to continue without spoilers before exhibits exist for my scene, so that upgrading does not break my game.
14. As a player, I want book material the Keeper looks up mid-play to become writable detail when he chooses to disclose it, so that lookups reach the table.
15. As the Keeper model, I want exhibits in scope listed with a short Keeper label, kind, carrier and whether their clue is open, so that I can choose without reading surfaces.
16. As the Keeper model, I want to reveal an exhibit with one reference instead of applying a clue and then citing it, so that a disclosure is one decision.
17. As the Keeper model, I want a clear refusal naming the missing check or the carrier's absence when I select an exhibit I may not reveal, so that I can repair in one step.
18. As the Keeper model, I want testimony selectable only for the people who can say it, so that the wrong person never speaks it.
19. As the author model, I want selected exhibits as surfaces with kind, channel, carrier name and stance, so that I know what to write and how faithfully.
20. As the author model, I want lies and deflections marked as the speaker's claims, so that I render them as speech without correcting them.
21. As the author model, I want verbatim surfaces marked, so that I translate them faithfully instead of paraphrasing.
22. As the owner, I want the author never to receive what an exhibit teaches or its Keeper note, so that spoilers are structurally impossible, not prompt-dependent.
23. As the owner, I want exhibits produced inside the existing opening and detail reads, so that reading cost does not double.
24. As the owner, I want no list or pattern to decide what is secret, so that player safety is a model judgement checked by review.
25. As the owner, I want every exhibit to cite the pages it came from, so that nothing is invented.
26. As the owner, I want exhibits that attach material to the wrong carrier caught, so that a prologue's detail does not appear at the gas station.
27. As a module reviewer, I want the review to check player safety of surfaces, so that a leaking surface is rejected before play.
28. As a maintainer, I want the shard contract to accept graphs with and without exhibits, so that existing graphs load.
29. As a maintainer, I want the summary and biography first-sight fallback removed, so that there is one safe source of first sight.
30. As a maintainer, I want exhibit selection recorded in the turn's telemetry with the author input bytes, so that a bad scene can be traced.
31. As a package author, I want voice exhibits to reach the author through the person, so that the speech craft sections have data.
32. As a tester, I want a live table run covering first sight, a found handout, testimony, a lie and a mid-play lookup disclosure, so that the feature is judged by play.

## Implementation Decisions

- **Exhibit shape** (trimmed from the sandbox prototype's reader instruction). A shard gains an optional top-level
  `exhibits` array; each row:

  ```
  {exhibit_id: "exhibit-<kebab>",
   kind: "description" | "appearance" | "document" | "perception" | "testimony" | "voice",
   carrier: <node_id of the scene, person, creature, object or handout>,
   channel: "sight" | "text" | "speech" | "sound" | "touch" | "smell",
   owners?: [<npc node_id>],            // required for testimony and voice, forbidden otherwise
   stance?: "fact" | "belief" | "rumor" | "lie" | "deflection",   // testimony only; default fact
   teaches?: [<clue node_id | claim_id with knowledge meaning>],   // Keeper and kernel only
   keeper_note?: <one English line>,    // Keeper only
   label: <one English Keeper line: what it is>,
   surface: {text, language, verbatim},  // people as {{who:<node_id>}}
   source_refs: [{page, box?}]}         // required, non-empty
  ```

- **Contract**: shard contract id becomes `coc.module-graph-shard.v5`; v4 shards remain accepted unchanged. The
  deterministic checker refuses: unknown carrier or owner; owners on kinds other than testimony/voice; testimony or
  voice without owners (the reader must make an owner-less voice a `perception` on `sound`); owners not linked to the
  carrier or to `teaches` by an existing knowledge relation (testimony only); `teaches` pointing at anything but a
  clue or a knowledge claim; missing `source_refs`; surface over the byte cap; a person's display name or alias
  literally in a surface where the reader should have used `{{who:}}` (an exact-name check from the graph's own
  identity fields, not a semantic list).
- **Reader**: the opening and detail read instructions (`content/setup/visual-reader/`) replace "do not extract
  dialogue, mannerisms, read-aloud" with "extract exhibits for the nodes this task makes ready", with the player-safety
  law, the `{{who:}}` rule, and carrier scoping (an exhibit belongs to the node whose pages it cites). No new full-book
  pass. A detail read may be asked for exhibits only with `material: "exhibits"` (precedent: `material: "map"`), which
  is how legacy graphs and `lookup source prepare` obtain them. Prompt byte changes invalidate affected reading caches;
  this is expected.
- **Review**: the existing independent review gains one player-safety item: a surface must not state a Keeper-only
  proposition unless it is exactly what the exhibit teaches. Policy stays module-logic-v1 (logic and safety, not
  word-by-word). A refused exhibit is dropped with a recorded reason; it never blocks the rest of the shard.
- **Catalog**: `DecisionContent` issues `exhibit_N` for exhibits whose carrier is the current scene, a present person,
  an object the investigators hold or can perceive here, or a handout in their possession. The Keeper sees
  `{ref, kind, carrier display, label, stance?, owners as npc_N?, clue: open | needs <check> | discovered}`, never
  the surface. Description, appearance and voice exhibits are not issued (they are used automatically). Exhibits
  share the catalog's existing budget and are omitted last-scene-first with a recorded count.
- **Packet**: `ExistingCommunicationFact` gains `{exhibit_ref}`. In `reveal` it is valid for document and perception;
  in `interactions[].content` it is valid for testimony when the interaction's actor is one of the exhibit's owners
  (same binding rule as existing fact actors). No new verb or field.
- **Settlement**: a revealed or spoken exhibit that teaches a clue compiles that clue's existing discovery effect and
  goes through the clue's existing validation (presence, required check result); any refusal refuses the whole packet
  atomically with a repair naming what is missing. A clue already discovered is not discovered twice. The legacy
  `apply clue` stays for compatibility; packet guidance stops recommending it when an exhibit exists for that clue.
- **Author input**: a selected exhibit hydrates as `{kind, channel, carrier: public display, surface, stance}` among
  the turn's selected material or the speaker's claims. `teaches`, `keeper_note` and `label` never reach the author.
  Stance lie/deflection carries the authority line "What this speaker says, in their terms; not world truth. Render as
  their speech; do not correct or expose it in narration." Verbatim surfaces carry "Render faithfully in the play
  language; do not summarize." The host resolves `{{who:<node_id>}}` before the author sees it: the person's name when
  the table knows it, otherwise their current epithet.
- **First sight**: place first sight is the scene's description exhibits; a person's is their appearance exhibits.
  Without one the row is `undescribed` (the §254.6 grant already covers that). The `properties.description`/`summary`
  and `appearance`/`biography` fallbacks are removed. Hand-authored `properties.description` and `appearance` on
  existing graphs stay valid first-sight sources (they are player-facing by contract); only the Keeper fields go.
- **Voice**: a person's voice exhibits ride in `decisionPerson` as `speech_style` (surfaces joined, `{{who:}}`
  resolved). narration-craft and zh-optimize author sections that speak of voice cards are aligned to `speech_style`
  with version bumps and changelogs.
- **Legacy graphs**: on the first turn a scene without any exhibit becomes current, the host queues one background
  detail read with `material: "exhibits"` for that scene. Until it lands: first sight undescribed; clue disclosure
  falls back to today's `{name, summary}` fact. The read never blocks a turn.
- **Mid-play lookup**: `lookup source answer` stays Keeper-only. `lookup source prepare` produces exhibits through
  the same detail read; the next catalog refresh issues them. The tool description says so.
- **Telemetry**: each turn records issued and selected exhibit refs, refused exhibits with reasons, and the author's
  exhibit bytes, in the existing decision-content telemetry record.

## Testing Decisions

- Test external behavior at the highest seams, preferring existing ones:
  1. **Graph acceptance** through the real kernel process (shard v5 accepted, v4 accepted, each checker refusal with
     its reason). Prior art: `tests/extension/module-graph-integrity.test.mjs`.
  2. **The native turn seam**: a graph with exhibits plus a packet in, settlement plus the author's decision input out.
     Asserts: author input carries surfaces and never `teaches`/`keeper_note`/`label`; a taught clue is discovered once;
     a failed check refuses the packet with the named repair; testimony by a non-owner is refused; `{{who:}}` resolves
     to epithet before an introduction and to the name after. Prior art: `tests/extension/turn-packet-prototype.test.mjs`,
     `decision-only-v4.test.mjs`, `decision-author-bindings.test.mjs`.
  3. **First sight** through the existing first-sight tests, updated: summary/biography no longer appear; exhibits do;
     absence is undescribed. Prior art: `first-sight-native-decision.test.mjs`, `first-sight-kernel.test.mjs`,
     `first-sight-step.test.mjs`.
  4. **Reader instruction** byte and content tests for the changed setup prompts; mod version tests for bumped packages.
- No test asserts model wording. Model behavior is judged by the sandbox probe (kept in `experiments/module-units/`)
  and the live run.
- Heavy suites run on the LAN test box or the owner's Mac. Live acceptance follows Agents.md: MiniMax 3.1 medium, real
  driver, one input per turn, never Opus or Grok; covering first sight, a found handout, testimony, a lie, and a
  mid-play `lookup source prepare` disclosure. Evidence: author task inputs free of Keeper text; prose carrying the
  handout's content; `discovered_clues` written once.

## Out of Scope

- hostile-creatures (`habits`, `what` as appearance/perception exhibits) and historical-reference (search results as
  table-established exhibits): follow-up spec.
- Deterministic writers for NPC knowledge and commitments from the packet's interactions (audit N1/N2).
- narration-audit, NPC voice lanes and natural-npc language barrier under v4 (audit D1/D4/D5).
- Whole-book pre-reading.
- Changing `lookup source answer` to feed the author.

## Further Notes

- Sandbox findings that shaped the rules: full names in surfaces (hence `{{who:}}`), prologue material attached to the
  wrong carrier (hence carrier scoping and the page check in review), an owner-less radio voice (hence the owners rule),
  `teaches` pointing at structural relations (hence the clue/knowledge-claim restriction), and a standalone read
  costing ~4.7 min and ~2.1M input tokens for 5 pages (hence exhibits inside existing reads).
- Author-side observation: a voice exhibit without sample phrasing led the author to describe a manner of speech with
  no line to show it; the reader instruction asks for the book's sample lines in voice surfaces.

## Comments
