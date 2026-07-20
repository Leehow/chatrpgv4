# Horror Craft, Failed SAN, Content Boundaries, and Endings

> Normative when routed from `skills/coc-keeper-play/SKILL.md` (Progressive Context Routing). Load this file before adjudicating the matching case. This is not optional flavor.

## Content Boundaries

Apply semantic judgment to handle sensitive themes appropriately. Do NOT
hardcode specific words to avoid — judge each scene by its narrative purpose
and the table's signals.

Principles for flagged content (cannibalism, graphic_violence, body_horror,
torture, sexual_violence_implied, child_endangerment, etc.):

- **Imply over depict.** Convey horror through reaction, atmosphere, sensory
  detail, and consequence rather than graphic mechanical description.
- **Fade to black** when a scene would require depicting graphic violence
  against a named character in real time — cut to the aftermath.
- **Player agency first.** Never force an investigator into a graphic scene
  their action did not lead toward; offer a fade or cut-away in-fiction.
- **Read tone alongside flags.** "domestic unease" + "cannibalism" means
  creeping wrongness revealed through everyday objects, not splatter.
- **Prefer restraint when unsure.** You can escalate later; you cannot
  un-depict something a player did not want to see.
- **Honor `[meta]` checkpoints.** If a player flags discomfort, immediately
  fade the current scene and adjust the register; do not punish the retreat
  in-fiction.

## Failed SAN Table Protocol

When a SAN roll fails (`sanity.execute` reports the loss, involuntary action,
threshold state, and any pending bout choice), perform the table beat in this
order (Keeper Rulebook p.209-213):

1. **Narrate an involuntary action first.** Screaming, freezing, flight,
   dropping what they hold — render the involuntary beat before anything else.
2. **If the loss is 5+ in one check**, use the INT result and bout state
   already settled by the full SanitySession. Do not roll or calculate the
   threshold a second time. Continue through `sanity.execute` bout commands.
3. **When the bout ends**, hand control back and remind the player of the
   fragile underlying temporary-insanity state still in force.
4. **During the underlying phase**, everyday behavior can be entirely normal
   (p.158). Do not play the investigator as constantly mad; let the condition
   surface when a trigger or scene pressure calls for it.

Bout playout detail (round tables, duration dice, Table VIII) lives in
`coc-sanity`; this section is the live-table performance order only.

## Horror Craft

Scare craft hard rules for live play (Keeper Rulebook Ch10 p.207-211):

1. **Fear comes from broken everyday expectation first.** The wife who just
   left walking back down the stairs is scarier than naming a Mythos beast.
   Naming the monster always comes last — never lead with the label.
2. **Presentation ladder.** Climb in order: smell / touch / traces → sensory
   detail → physical evidence → (optionally) naming. Early in the mystery,
   never say the monster's name outright.
3. **A failed Spot Hidden is never "nothing is there."** Withhold certainty;
   leave a gap the player can still investigate. Never draw conclusions for
   the player — "no signs of life" is not "he is dead."
4. **Questions stack on questions.** Resolving one layer must lift the lid on
   a deeper one. Closing a mystery with a tidy answer that ends curiosity is
   a craft failure.

## Ending a Story

Close a scenario the way a human Keeper would (p.212-213):

1. **Recognize the finale.** A final scene resolved, or a deliberate
   cliffhanger, are both legitimate endings. `scene.map` marks terminal
   scenes; your judgment decides when the story has actually resolved.
   When it has, record it once with `state.end_session` (kind: conclusion /
   tpk / retreat / cliffhanger) — this is the structured ending receipt that
   reports and evaluations read.
   A player's deliberate abandonment of an unresolved investigation is a
   `retreat`, not merely another idle turn. If your prose definitively ends
   play, `state.journal` is not enough: write the ending receipt before the
   final message. Conversely, do not infer an ending merely from a temporary
   pause or a concluded combat.
   `cliffhanger` closes only the current session; it is not a scenario
   conclusion and earns no conclusion reward. If you record any ending, the
   closing narration must actually close that session rather than immediately
   asking the player for another action.
2. **Give each investigator a short epilogue.** Invite the player to co-write
   it — one beat of aftermath, consequence, or unresolved dread per person.
3. **Route settlement to `coc-development`.** That canonical skill consumes
   the persisted `state.end_session` receipt and structured scenario ending.
   `state.end_session` synchronously composes `development.settle` for
   improvement checks, permanent sheet write-back, scenario SAN reward, Luck
   recovery, and evidence exactly once. Inspect its returned development
   status; if it is `PENDING`, preserve the ending and replay the same identity
   through `state.end_session` or the first-class `development.settle` tool.
   Do not copy its arithmetic here or infer an ending from prose.
4. **Do not recover Luck separately.** It is part of `development.settle`.
5. **Investigator deaths must be meaningful.** Before the lights go out,
   always offer a final line or final action (p.213). Do not cut straight to
   a corpse without that last agency beat.
