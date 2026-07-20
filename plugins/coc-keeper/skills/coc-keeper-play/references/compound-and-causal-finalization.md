# Compound Declarations and Causal Finalization

> Normative when routed from `skills/coc-keeper-play/SKILL.md` (Progressive Context Routing). Load this file before adjudicating the matching case. This is not optional flavor.

### Compound player declarations (settle in order)

Players often pack several in-fiction steps into one message (ask the clerk,
then leave for the library, then search the stacks). That is legal table talk.
It is **not** permission to montage the whole chain into one destination or
one roll.

Settlement is **internal KP craft**. The player-facing reply must still read
as immersive table narration — never as a chain-audit worksheet.

1. **Decompose semantically** into ordered atoms: speech/ask, social gate,
   travel, search, force entry, attack, flee, etc. Do not keyword-split; read
   the intended sequence. Keep the atom list in notes / audit files only.
2. **Settle the first unsettled atom** with uptake, then any check / NPC
   permission / scene move / clue record that atom earns. Consult
   `actions.list` / `scene.context` when a threshold affordance (door clerk,
   locked gate, SAN trigger) sits on that atom.
3. **Stop the chain when fiction or mechanics block it.** A failed or refused
   gate, a fumble that ejects the investigator, an NPC denial, or a SAN/combat
   interrupt means later atoms in the same message **do not auto-happen**.
   Show the stop as fiction (the clerk bars the door; the stairs give way;
   the investigator’s stated limit holds).
4. **After a mid-chain stop, acknowledge the unplayed remainder in fiction.**
   Long compound plans feel wasted if the reply ends at the failed gate with
   no nod to what they also wrote. Still do **not** auto-settle those later
   atoms. Instead, in diegetic voice:
   - Make clear *why* the rest did not happen yet (the gate holds; the NPC
     refused; the stumble ate the beat) — never as “本回合不结算 / 原子截断.”
   - **Tease like a real table KP when tone allows.** A dry jab at the
     overstuffed itinerary is welcome — the same energy as a live Keeper
     laughing that the player wrote a whole afternoon’s agenda and bounced
     off the first clerk (“宏大行程刚写到图书馆，铁栅已经替你改了日程”).
     Prefer wit through NPC smirk, sensory punchline, or a short
     second-person aside that stays in play voice. See **Table Wit** under
     Style for the same craft on fumbles and hard-fought failures.
   - Soft-surface **alternate ways past or around** the same goal when the
     fiction supports it (another entrance, a different social approach, a
     nearby open lead they already know about). Keep it as sensory/NPC cues
     or one short open question — not a numbered bypass menu, and not a
     spoiler that invents a free skip of an authored stake.
5. **Compress only true connective tissue.** Crossing a room, putting on a
   hat, or walking an already-open street may stay in narration. Authored
   gates, skill stakes, SAN triggers, scene unlocks, and NPC permission rolls
   are never skipped by bundling.
6. **One reply may cover more than one atom** when earlier atoms succeed and
   stakes remain light — but each atom that needed a check must still show its
   own uptake and `【明骰】` (or clear no-roll adjudication) before the next
   atom’s outcome. Prefer stopping after a meaningful fork rather than
   resolving an entire evening in one breath.
7. **Diegetic delivery only.** After settling, use `narration.brief` when a
   complex beat needs a drafting envelope. Draft fresh prose and consult
   `narration.review` only when the beat is genuinely difficult to self-review:
   long or multi-stage causality, several speaking NPCs, a tonal climax, or a
   draft the Keeper suspects is summary-like or translated. Do not call it on
   every turn merely to record an empty review. Public rolls stay as `【明骰】`
   in table language. Do **not**
   put settlement bookkeeping on the table: no `【串联】`, “本回合不结算”,
   “执行备选”, “原子”, “deferred”, “blocked_or_stop”, clue-id lists, or
   CRPG-style option dumps that restate the unplayed remainder of the player’s
   compound plan. Contingency branches the player already committed to may
   continue in fiction (“门禁过了，你这才下到剪报库…”) without labeling them
   as contingencies. Acknowledging a blocked later step (step 4) is allowed
   and expected; listing every deferred atom as a checklist is not.

This remains KP craft rather than a fixed Director/Storylet pipeline. Tools
never reject a compound message. The one mandatory boundary is the settled
turn's final output: `turn.finalize` structurally proves that every actual
check was causally realized and inserts each deterministic mechanic at its
declared causal paragraph boundary.

This is an always-on prompt-level drafting responsibility. It applies on turns with or
without dice and **whether or not** the Keeper consults
`director.advise`, `narration.brief`, `narration.review`, or any other optional
advisory tool. It is not a fixed workflow or post-hoc battle-report rewrite.
The transcript and readable battle report must preserve the exact
`turn.finalize.rendered_text` actually delivered to the player.

### Causal Realization at the Final Boundary

`turn.output_context` is Keeper-only drafting material. It returns exact
`obligations`, a deterministic `mechanics_bundle`, and candidate structured
factors that were actually consulted. It never asks you to recite unused
character-sheet values.

For every obligation:

- If the player's declaration was abstract ("I con him with some story"),
  safely complete the concrete words or behavior from the current situation
  and investigator portrayal. Do not add a new goal or consequential choice.
- If the player supplied concrete words or actions, preserve them. Show why
  the NPC, obstacle, or world found that exact approach convincing,
  insufficient, alarming, graceful, clumsy, or otherwise causally effective.
- A higher achieved success tier buys fictional finesse, speed, confidence,
  discretion, durability, or quality appropriate to the settled goal. It does
  not silently enlarge the authorized goal.
- A critical, fumble, or failed pushed roll needs both a nonempty exceptional
  beat and one source-bound substantive effect applied through
  `state.exceptional_effect` before `state.journal`. Prose alone cannot close
  it. A critical creates a benefit within the same goal or a real new
  opportunity; a fumble/pushed failure creates a cost or danger caused by the
  attempted method. Choose semantically from the current event, never from a
  skill-name lookup.
- A substantive effect is one of: an authoritative resource delta; a one-shot
  bonus/penalty die; a bounded condition or restriction; an actual
  relationship/threat/deadline change; or a bounded scene event. It always has
  a player-visible impact, causal link, and explicit duration/consumption
  boundary. Elapsed time by itself is not substantive unless it actually fires
  a deadline/threat/closure; an arbitrary flag name is never sufficient.
- One-shot bonus/penalty effects declare exact investigator + skill + optional
  scene scope. The next matching `rules.roll` fails closed unless it carries
  the declared die, and must then be consumed with
  `state.exceptional_effect(action="consume", consuming_roll_id=...)` before
  journaling. `scene.context.continuity.active_exceptional_effects` exposes
  active conditions, restrictions, events, and modifiers on the normal path;
  honor their boundary without turning them into hard scene/action gates.
- Related rolls may cite the same exact fictional excerpt, but each
  `obligation_id` appears in exactly one coverage row. An unobservable hidden
  check may use `concealed_no_player_visible_beat`; an observable hidden
  consequence still needs fiction but never a numeric disclosure.

Each `turn.finalize.coverage` row uses exactly these fields:
`obligation_id`, `realization`, `action_realization`, `response`,
`causal_explanation`, `persona_fit`, `player_input_handling`, `exact_excerpt`,
and `exceptional_beat`. `exact_excerpt` must occur verbatim in the draft. This
is structured semantic evidence from the Keeper, not keyword scoring.

Each `turn.finalize.mechanics_placements` row uses exactly
`after_paragraph`, `segment_type`, and `source_ids`. Paragraphs are zero-based
blocks separated by one blank line. Use source IDs from the matching
`mechanics_bundle` array; every public mechanic must appear exactly once. For
example, with paragraphs `[attack setup, hit/miss result, aftermath]`, place
the attack/reaction `public_check` IDs after paragraph `0`, damage after the
paragraph that establishes the hit, and HP/state deltas beside their fictional
consequence. The finalizer supplies all mechanic text and rejects a roll placed
after its coverage excerpt.

Validation reports **all** violations in one response (`error.violations`,
each with `stage`, `code`, and `message`), in the same order they would
otherwise have been raised one at a time; the top-level `error.code` is the
first violation for backward compatibility. Before committing a complex turn,
you may preflight the exact same payload with `turn.finalize`
`validate_only: true` — it runs the full validation and writes nothing, so an
empty violation list means the commit call succeeds unchanged.

Never copy a rendered `【明骰】` / `【变化】` / `【特殊影响】` block into
`draft`; `mechanics_placements` is its only player-visible source and the
finalizer rejects deterministic block labels in fiction. If a finalized output
has not been delivered or acknowledged yet and its prose/placement needs
correction, call `turn.finalize` once more with the exact settled `coverage`, a
new `decision_id`, and `repair_finalization_id` naming that latest receipt.
This narrow repair cannot rerun or change rules, state, journal, coverage, or
the mechanics bundle, and it is refused after delivery confirmation.
