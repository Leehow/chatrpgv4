# Playable progress, investigation stalls and AI GM loops

Research date: 2026-10-05. Analysis only; Codex worker, pinned gpt-6.1-sol. No code, tests, model calls, player inputs, campaign saves or module truth inspected. Only this document is written; existing untracked work is preserved. Research skill applied within the already-delegated research lane; no nested worker. Sources were read on the public web. This is design evidence, not an official Call of Cthulhu ruling, product diagnosis, prevalence estimate or implementation contract.

## Firsthand community cases

| Case and date | Original reporter's experience | Evidence boundary |
| --- | --- | --- |
| Human table: [Player who wants all the answers…](https://www.reddit.com/r/rpg/comments/10zr4xb/player_who_wants_all_the_answers_and_doesnt_like/), u/NervousFritter221, 2023-02-11 | Reporter, both player and occasional DM, says one player repeatedly questions NPCs after their information is exhausted; continued pushing makes NPCs angry and unwilling to help. Reporter believes the group already has clues and connections, and says other players generally enjoy the mysteries. | One participant's interpretation, without transcript or the disputed player's account. Cannot conclude the player is wrong, information was actually clear, or every refusal is a design failure. |
| Human table: [As a GM, how can you help your players overcome analysis paralysis…](https://www.reddit.com/r/rpg/comments/mg2smu/as_a_gm_how_can_you_help_your_players_overcome/), u/Kodiologist, 2021-03-29 | GM reports open-ended problems with no predetermined solution, yet discussion lasts 15–30 minutes and once an hour. Time pressure sometimes helps but sometimes feels forced. | Demonstrates that an open solution space alone does not ensure decisions. No measured incidence or comparison group. |
| AI GM: [GPT breaks after a bit](https://www.reddit.com/r/ChatGPT/comments/1hpx57f/gpt_breaks_after_a_bit/), u/0_Raziel_0, 2024-12-30 | Reporter uses GPT-4o as DM in text RPGs and says twice, after roughly two months in one thread, it repeatedly returned the last thing it said despite changed prompts. OP clarifies this is a custom GPT. | Firsthand symptom report, no available transcript, token counts or controlled reproduction. Comments blaming context size and recommending a summary/new thread are hypotheses, not verified causes or durable repairs. Does not establish behavior of current models or this runtime. |

Reddit calendar dates above are recovered from each readable page's dated “Top Posts” footer; the main header displays relative ages. The OP text and OP follow-ups, rather than vote counts or commenters' diagnoses, are the evidence. All three pages were readable on research date.

The human NPC case and AI case should not be collapsed. The former may involve information closure, deduction or table preference; the latter describes generation repetition despite new input. Both feel stationary, but they have different possible causes. This distinction is an inference from the reports, not a demonstrated causal model.

## Author and official guidance

**Justin Alexander, [Three Clue Rule](https://thealexandrian.net/wordpress/1118/roleplaying-games/three-clue-rule), 2008-05-08.** His rule is: “For any conclusion you want the PCs to make, include at least three clues.” Redundancy addresses missed, ignored or misinterpreted evidence. He also allows unexpected player solutions. Applicability: scenario bottlenecks, not an instruction to grant every answer, manufacture module facts or have NPCs solve deductions. Three is a design heuristic, not experimentally established reliability.

**Justin Alexander, [Node-Based Scenario Design, Part 1](https://thealexandrian.net/wordpress/7949/roleplaying-games/node-based-scenario-design-part-1-the-plotted-approach), 2010-05-27.** A linear sequence makes each required transition a chokepoint; alternative-looking paths can still amount to a pseudo-option. He explicitly warns that three redundant clues all pointing to the same next scene may feel like spoon-feeding. Applicability: distinguish several accessible routes from cosmetic choice. His author's [inverted rule explanation](https://thealexandrian.net/creations/misc/node-design/node-design2.html) describes distributing clues among nodes; this legacy page exposes no publication date. Neither article requires every branch to succeed or all dead ends to disappear.

**Pelgrane Press, [Clues vs. Leads](https://pelgranepress.com/2020/02/21/clues-vs-leads/), 2020-02-21.** The publisher distinguishes information essential to understanding the mystery from a lead that enables another scene; these overlap but are not identical. Some survival-helpful facts are not essential to progress. Applicability: a newly acquired fact can be real information without enabling an action, so count informational and navigational progress separately. This is GUMSHOE publisher guidance, not CoC rules. The page was readable in an initial fetch; later fetches intermittently failed.

**Pelgrane Press, [Read This Before Running GUMSHOE, Part Two](https://pelgranepress.com/2018/06/01/read-this-before-running-gumshoe-part-two/), 2018-06-01.** Indexed publisher text advises providing reasonable information, indicating when nothing remains, accepting plausible investigative approaches and working around blockages. Applicability: an NPC's exhausted information need not be an endless invitation to repeat interrogation. Acquisition differs from solving the whole mystery. Access limitation: full page fetch failed twice; only the search engine's indexed publisher excerpt was readable, so this is corroborative guidance, not the strongest textual basis. No long quotation or claim of complete inspection.

**Dungeon World official site, [About the Game](https://www.dungeon-world.com/about/), publication date not exposed, accessed 2026-10-05.** The creators' site presents “Play to find out what happens,” evolving fronts and GM moves, and dice outcomes that drive action. This confirms a distinct design orientation toward emergent outcomes. It is a short overview, not sufficient to transfer particular moves or declare all investigative failures invalid in another game. It does not mean authored mystery truth must change to match guesses.

**Justin Alexander, [The Art of Pacing, Part 2: Scene-Framing](https://thealexandrian.net/wordpress/31520/roleplaying-games/the-art-of-pacing-part-2-scene-framing), 2013-07-17.** He frames a scene around why this moment matters and an impetus for consequential choice; its agenda may change in play. Abstract narration can move between scenes while retaining input. Applicability: summarize uneventful transitions after the player's decision; avoid deciding their reaction or skipping a preparation they care about. Pace is not a license to teleport to the author's preferred outcome.

## Tensions that prevent a single prescription

- More clues can reduce discovery bottlenecks, but redundant clues on one forced route can still feel like coercion. Alexander's node discussion qualifies his redundancy heuristic; robustness and agency require examining connectivity as well as clue quantity.
- In the paralysis thread, OP says pressure sometimes works; u/Rladal recommends supplying missing knowledge, while u/Kautsu-Gamer warns timers can create stress and confuse player discussion time with character time. These are conflicting practitioner opinions, not an adjudicated rule. Pressure is especially questionable when players lack the information needed to choose.
- Clear information closure can end repeated NPC questioning, but refusing every new method would erase agency. A materially new question, evidence or leverage differs from rephrasing an exhausted request. The NPC case alone cannot tell which happened.
- Emergent play and a prepared mystery need not be opposites: outcomes can remain open while established truth remains fixed. This is a synthesis, not a Dungeon World or CoC rule quotation.
- Faster scene transitions and meaningful choice can conflict if framing silently supplies player intent. Giving an actionable lead helps navigation; choosing it for the player changes ownership of the decision.

## Bounded conclusions for later product diagnosis

The following are research-derived questions, not authorized repairs:

1. Did the player learn something usable, settle uncertainty, choose a course, alter a relationship/resource/location, or encounter a changed situation? New wording alone should not establish progress.
2. If an investigation repeats, is the obstruction clue acquisition, interpretation, access, insufficient decision information, an exhausted source, or generation repetition? These cases need different evidence.
3. Does an offered choice allow different consequences or methods, including a justified refusal/retreat, or funnel every answer into the same confirmation request? The latter is a candidate false choice, not proof from menu count alone.
4. After an NPC has provided what they know, is that closure legible while other genuine avenues remain available? Do not invent secrets solely to reward repeated requests.
5. Does a completed player action persist and change the next interaction? For an AI host, this asks about authoritative state and subsequent behavior, beyond prose novelty. This operational question is our inference; the community AI report does not identify the failed subsystem.

A usable outcome can be a setback, discovered dead end or costly commitment; it need not be success or movement toward one prescribed ending. Conversely, elapsed turns, rolls, repeated promises and attractive prose do not by themselves demonstrate a changed playable situation. This working distinction should be checked against actual public gameplay evidence and the lead's separately inspected rules before any source change.

## Limits

Three accessible firsthand cases meet the community requirement, with human/AI contexts explicitly separated. Selection is purposive, small and complaint-biased; no statistical claim follows. No controlled AI-GM study was used to establish a looping mechanism. Official CoC texts are outside this lane. No local module or save material was used, and no proposed rule/prompt/cache/scheduler was implemented. Research can guide questions; only the actual game's evidence can show which mechanism is responsible.
