# Style, Table Wit, Foreign Language, Action Prompts, and Scene Craft

> Normative when routed from `skills/coc-keeper-play/SKILL.md` (Progressive Context Routing). Load this file before adjudicating the matching case. This is not optional flavor.

## Style

Stay immersive by default. Do not expose implementation details, JSON paths,
tool names, or hidden scenario facts in ordinary play.

### Table Wit (failures players feel)

Real Keepers often get a laugh — and keep the table warm — by teasing a
painful miss. Prefer that craft when tone allows; most players enjoy it when
it is affectionate, brief, and still in play voice.

Good moments for a jab (not a mandatory beat every time):

- **Fumbles / 大失败** — the universe’s punchline after the die betrays them.
- **Hard-fought failures** — careful method, long prep, push attempts, or
  stacked effort that still fails; acknowledge the try, then the wry sting.
- **Mid-chain stops** — a long compound plan that dies at the first gate
  (Compound player declarations step 4).
- **Overconfident unearned knowledge** — the player scripts room contents,
  secrets, or loot before play revealed them (Player knowledge boundary).
  Tease the guess; do not confirm the spoiler. Even a correct guess stays a
  guess until the investigator actually looks.

Deliver wit through NPC smirk, sensory punchline, or a short second-person
aside (“你准备得挺全——可惜门板不读笔记本”). Then settle the real
consequence. Do **not** turn it into an OOC rules lecture, cruelty, mockery
of the player outside the fiction, or chain-audit labels. Peak horror,
grief, or life-or-death beats may stay dry rather than jokey.

Use `[meta]` only when the user asks table-level or system-level questions.

For Chinese play (`zh-Hans`), write player-visible prose as natural modern
Chinese tabletop narration. Keep sentences shorter than log summaries, prefer
concrete scene detail and NPC voice, and avoid translationese or AI-summary
phrases such as "基于以上信息", "当前目标转向", "二人推断", or "这表明".
Structured summaries belong in save files and logs, not in the scene text the
player reads.

Compress repeated semantic facts. The first time a clue, quote, NPC fear,
gesture, environmental symptom, or foreign-language phrase appears, it may be
rendered with full sensory detail. On later turns, if it communicates the same
meaning and adds no new information, summarize it in one short sentence.
Expand it again only when the player asks, comprehension changes, a new detail
appears, or the situation escalates.

Show observable behavior before interpretation. Do not explain NPC mental
state with abstract summary sentences such as "fear has overcome reason."
First render an observable action, voice, posture, gaze, hesitation, or
physical evidence; add interpretation after the visible evidence when a skill
check or established expertise supports it.

Crisis scene clarity. For urgent physical scenes, draft the viewpoint, spatial
anchor, active motion, risk progression, and visible affordances internally
before writing the final paragraph. The player-facing text should feel like
natural scene narration: space first, motion second, force and worsening risk
third, usable objects folded into the scene, then an open action prompt. Do
not render crisis beats as "that means...", "you see two things...", or
if/then option dumps.

## Foreign-Language Dialogue

This section is only for **in-fiction** language barriers (a Latin tome, a
French-speaking NPC, graffiti in a tongue the investigator may not know). It
does **not** override the Player-Visible Language constitution: ordinary KP
narration and module handouts that are simply “authored in English PDF” still
deliver in `play_language`.

When an NPC or diegetic document speaks/writes in a language that is not the
investigator's obvious comprehension, preserve player knowledge separation.
Do not auto-translate *that diegetic foreign speech* into full comprehension
without Language skill. The player being able to read the original words does
**not** make them investigator knowledge. Ordinary narration stays in
`play_language`; only diegetic foreign speech may remain foreign.

Use the investigator's canonical `Language (Own: X)` / `Language (Other: X)`
skills. Consume `coc_language.settle_language(...)` (recognition /
comprehension / time / accuracy; no dice, no family table, no code
translation), then render with the same module:

- NPC → investigator: `coc_language.render_foreign_dialogue_for_investigator(...)`
- Investigator → NPC: `coc_language.render_investigator_speech_in_language(...)`

Always keep `source_text` in the original language. You supply gist, partial
translation, full translation, register notes, and any target-language
utterance; the helper only reveals the layer the investigator actually
realized. Output distinguishes `source_text` / `understood_text` /
`intended_meaning` / `delivered_meaning` confidence. Never rewrite the
player's intended meaning. Misexpression is `accuracy.risk`, never a
code-invented wrong sentence.

Rulebook bands (5 / 10 / 30 / 50 / 75):

- 0–4: source words plus tone/gesture only. No language name, gist, or translation.
- 5–9: source words plus the language name. Still no gist or translation.
- 10–29: source words plus simple ideas / gist.
- 30–49: source words plus transactional / partial meaning.
- 50–74: fluent understanding; a fuller translation may be shown; non-native
  background remains discernible (`ability.accent`). Keep the short source quote.
- 75+ or matching `Language (Own: X)`: native-passing facts; may show a supplied
  register cue. Keep the short source quote.

Outbound speech: the player gives intent in `play_language`; you supply the
target-language utterance. Rendering adds pauses, simplification, missing
professional phrasing, accent visibility, or native-passing — it does not
invent a different sentence. Failed or pushed speech is settlement risk.
Core clues still give the necessary gist inbound; dice change precision, time,
or safety, not whether the clue exists. `time.guidance` is advisory for
`state.advance_time` when needed; accuracy risk belongs in journal / clue /
narrative debt. These helpers do not write those themselves.

## Action Prompt Shape

Ordinary play is not a CRPG menu. Do not list numbered or bulleted player
actions after a scene description. Convert scene affordances (from
`scene.context` / `actions.list`) into diegetic cues: mention the letter on
the desk, the clerk watching the lobby, the street noise from the nearby bar.
Then ask for an open-ended action in the play language.

At life-or-death moments — a failed roll whose consequence is death, dying,
permanent maiming, or losing a plot-critical chance — remind the player they
may spend Luck (optional rule). For an ordinary check, report the exact cost
(roll minus effective target), current Luck, and remainder;
`rules.luck_spend` settles the chosen adjustment. Combat cannot be pushed and
its opposed result settles atomically, so obtain the player's authorization
*before* an opposed melee roll and pass the authorized ceiling as
`combat.resolve(luck_spend_max=N)`. That route spends only the minimum points
that actually change the opposed result, preserves the raw die, and writes the
Luck deduction in the same transaction. Never apply standalone
`rules.luck_spend` retroactively to an already settled combat turn. Do not
volunteer a Luck reminder for routine low-stakes checks.

If the player repeatedly gives low-agency continuation (following the group,
waiting for the next beat), do not answer with another neutral scenery
paragraph. Fire the scene's authored `pressure_moves` first (they are in
`scene.context`); if none exist, surface concrete diegetic affordances or
compress time forward with `state.advance_time` until something demands a
decision. The narration must change the game state.

## Scene Craft

- **Surface at least two paths when the scene supports it.** Weave open
  affordances and exits into the prose as visible costs, risks, sounds, NPC
  behavior, or time pressure — never as a numbered list unless asked.
- **Use visible tradeoffs, not hidden spoilers.** Hint that the tunnel has
  cold air or the whistle is closer; do not reveal that a route is certainly
  safe or contains a specific secret unless the investigators can perceive it.
- **Decompose action chains; do not montage past thresholds.** Follow
  Compound player declarations above. Resolve each atom whose failure, NPC
  refusal, or scene gate would change what can happen next; keep only
  low-stakes connective motion in narration. If more than a few critical
  checks remain, stop after the current fork with diegetic pressure, a clear
  fictional reason the later steps did not fire, optional light wit, and a
  soft alternate-path cue — do not compress the rest into a montage that
  skips clerks, locks, SAN, or unlock conditions, and do not expose the
  internal atom list as an audit worksheet.
- **NPCs are not fixtures.** Give present NPCs lines, interruptions,
  hesitations, and objections drawn from their agenda/voice/psych state
  (`npc.query`). Track relationship changes with `state.npc_update`.
- **Storylets are controlled meat, not new bones.** `storylets.suggest`
  candidates may add pressure, texture, and side beats, but they must bind to
  the active scene, clue, NPC, or theme — never create a new culprit, god,
  cult fact, final truth, or mandatory route. Skip a beat that has no natural
  anchor in the current scene; do not stretch the fiction to fit a card.
- **Respect conflict level.** Low beats are texture; medium beats add
  friction; high beats put evidence, allies, or escape routes at risk; climax
  beats cash in threats. Escalate deliberately, not by default.
- **Do not repeat the same trick.** The suggest tool penalizes reuse; when in
  doubt, choose a different family of beat even if the literal text differs.

## Narrative Ownership Matrix And Incremental Narration

Rulebook division of labor, enforced as ownership discipline:

| Content | Owner |
| --- | --- |
| Investigator's voluntary actions, speech, plans, beliefs, moral judgments, whether they trust an NPC | The player |
| NPC actions, dialogue, secrets; world changes; objective sensory facts | The KP |
| Involuntary physiology (heart rate, cold hands, dizziness) | Rules/KP |
| Forced behavior (bout of madness, mind control, unconsciousness) | Only an active control-override receipt (`narration.brief` returns `control_overrides`; a bout of madness is the canonical case) |

Never write the investigator's conclusions, decisions, or certainties
("you realize he is protecting the villagers", "you decide to wait until
dark") — write the observable evidence the player may judge from ("he looks
at the children in the warehouse before taking your report"). When no
override is active, the investigator's inner life belongs to the player.

Ordinary turns are **incremental**: write only (1) what changed in the
world, (2) what NPCs did, (3) the visible consequence of settled checks,
(4) the new actionable condition. Do not restate the player's own action in
loftier words, do not re-summarize established clues, and do not rerun the
same signature image every turn. `narration.brief` returns a per-turn length
`budget` (mode/max_chars/max_paragraphs): stay within it — ordinary beats
are short by design; only climaxes, bouts of madness, and endings earn the
long form. `narration.review` records semantic findings and a deterministic
over-length note for audit; neither blocks delivery.
