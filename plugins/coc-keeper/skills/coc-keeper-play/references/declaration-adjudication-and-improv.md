# Declaration Adjudication, Player Knowledge, and Controlled Improvisation

> Normative when routed from `skills/coc-keeper-play/SKILL.md` (Progressive Context Routing). Load this file before adjudicating the matching case. This is not optional flavor.

### Controlled Improvisation Becomes Campaign Canon

When it improves the drama, you may semantically invent an NPC or item's
identity, history, motive, an off-graph event, an interpretation of evidence,
a concrete version of a vague hint, or a future hook. This is not restricted
to source silence. Your invention may appear to conflict, or actually conflict,
with module narrative truth or something previously shown or said at the
table. Do not let a skill, runtime warning, or source comparison veto or roll
back that choice merely because the two narratives disagree.

The moment an invention reaches the player, treat it as campaign-local canon:

1. Give every delivered assertion/observation stable identity and provenance.
   If it conflicts with module source or prior table fiction, preserve **both**
   sides as a structured `continuity contradiction` / `narrative debt` through
   the best-fitting existing route—`state.set_flag`, `state.record_clue`, item
   state, a stable improvised NPC identity plus NPC engagement/fact state, an
   event/time marker, and `state.journal` as applicable. Do not edit module
   source, hand-edit a save, delete the older fact, or pretend the conflict was
   never delivered.
2. What is immediately canonical is that each sourced claim or perception
   happened. You need not decide on the spot which is the final objective
   truth. Carry the debt into later NPC judgment, clues, callbacks, threats,
   and endings instead of blocking the current beat.
3. Later “round it back” with a logically fitting in-world explanation chosen
   from this campaign's people, evidence, horror, and causality. Do not use a
   fixed excuse list, skill-name mapping, or keyword classifier. A later reveal
   may make one side unreliable, but its original provenance remains. Never
   silently replace, erase, or retcon it.

This authority belongs to the KP's semantic judgment. A player's invented
fact or lucky guess is still only input; it becomes true only if the KP
independently adopts it within these constraints and records it. No keyword,
phrase match, or per-turn quota decides when improvisation is valid.

Deterministic dice and authoritative numeric/state values are the remaining
hard boundary. An NPC, document, or perception may misreport them in fiction,
but you must preserve the actual receipt/state and may change it only through
the proper rules/state operation. Module source remains read-only and secrets
still need an earned fictional route; contradiction is not permission for a
gratuitous secret dump.

## Declaration Adjudication

Players declare attempts; they do not author facts. Before settling any
player message, separate what was said into two classes:

- **Attempt / intent** — "I search under the cabinet", "I try to recall
  whether I know anyone at the courthouse". The investigator's chosen
  method, target, and precautions belong to the player; enact them per the
  Core Keeper Response Contract.
- **Fictional fact** — "there is an eye-shaped rune on the ruins", "there
  is a Latin fragment under the cabinet", "I know the court clerk", "the
  living room is packed with Catholic wards and a nailed cupboard of diaries".
  Perception, discovery, item existence, NPC relationships, room contents,
  and what the investigator has already learned belong to the world, and the
  world is yours to adjudicate. A player statement never creates these on its
  own.

Three verdicts are all legitimate:

1. **Accept** when the KP independently chooses to establish the fact—whether
   it matches existing narrative/module truth or deliberately creates a
   contradiction under **Controlled Improvisation Becomes Campaign Canon**.
   The player's wording is not the authority; the KP's semantic adoption and
   structured record are. Preserve conflicting provenance and debt rather than
   overwriting either side.
2. **Revise** when the attempt is sound but the fact is wrong in detail,
   needs a check first, or collides with a constraint. Show the gap in
   fiction — "你摸向柜下——指尖只刮到积灰和一枚生锈的钉子" — or call the
   check whose outcome settles it (`rules.roll`), then narrate from the
   authoritative result.
3. **Reject** when the KP does not choose to adopt the player's asserted fact,
   or when adopting it would covertly rewrite deterministic dice or
   authoritative numeric/state values. Contradiction with module narrative or
   prior table fiction is not, by itself, a rejection reason. A character may
   still speak a false claim without changing the underlying state.

Before confirming any player-declared fictional fact, cross-check the
established narrative (`scene.context`, journals,
`continuity.live_world_flags`) and module source (`clues.query`,
`npc.query`, `secrets.briefing`) so you know whether you are creating a
contradiction and can preserve both provenances. Structured module fields are
source evidence, not an automatic veto on conflicting fiction. A player's
say-so still does not dissolve a route constraint or reveal a hidden answer;
if the KP deliberately introduces divergent testimony/evidence, record the
resulting narrative debt and let play resolve it. Material marked `secret:
true` still needs an earned fictional route rather than gratuitous confirmation
of a guess.

### Player knowledge boundary (KP owns the intercept)

Guessing, baiting, and trying to induce a spoiler are normal player moves.
They are **not** a defect and must not be banned. The defect is a Keeper who
treats unearned claims as established knowledge or who obligingly dumps
module truth because the player "already said it."

1. **Track what the investigator actually knows.** Use play-established
   player-visible fiction: scenes entered, clues recorded, public rolls, NPC
   speech already delivered, and sheet facts. Do not invent a keyword list of
   "forbidden spoilers"; judge the epistemic gap semantically.
2. **Intercept unearned facts.** If the player narrates room contents, secret
   names, unvisited layout, or unrevealed loot as if already true ("进门后
   客厅摆满天主教圣物，我撬开橱柜取日记"), do **not** montage those facts
   into reality. Keep the legal attempt ("I go to the house and search the
   ground floor") and strip or rewrite the assumed inventory until play earns
   it.
3. **Lucky guesses stay guesses.** Even when the player happens to name the
   correct cupboard, dagger, or cult fact, do not auto-confirm, skip the
   search, or speak as if the investigator already knew. Discovery still
   happens in the world after the attempt is settled.
4. **Push back with craft, not a rules lecture.** Prefer play voice: the
   investigator does not yet know what is inside; they can open the door and
   look. Table Wit is welcome when tone allows — a dry jab that overconfident
   itineraries are not floor plans ("门还没开，圣坛和日记就已经在脑内排好
   队了？") — then invite a real action. Do not OOC-scold or punish curiosity.
5. **Never let guess-bait replace KP judgment.** "Tell me if I'm right" or a
   laundry list of secret nouns is table talk until play produces evidence.
   Answer the gap; do not grade the spoiler quiz.

Convenience has a cost. When a player declares a shortcut to skip play —
instant research, an off-screen contact, a prepared item never established —
let the fiction charge for it: a skill check, spent time
(`state.advance_time`), a resource, or a complication. A declaration that
would bypass an authored check gate or NPC route constraint is exactly the
case to revise or reject, not to waive.

### World-assertion cost (not a ban, a threshold)

The KP never flat-prohibits a player from asserting world state, but neither
does a bare assertion create it. When a player narrates world facts that have
not been established ("楼上的东西想让我上去", "这面墙后面肯定有暗室",
"他其实已经死了"), follow this graduated procedure:

1. **Do not echo.** Never repeat the player's world-assertion as established
   narration. The KP's prose describes only what the investigator perceives
   from the external viewpoint — observable behavior, environment, NPC
   reactions.
2. **Invite a logical grounding.** In play voice, ask the investigator to
   justify the assertion from what they can actually perceive or deduce in the
   current scene. "你凭什么判断楼上的东西在'邀请'你？你听到了什么，看到了什
   么？" This is not an OOC challenge; it is the world asking for evidence.
3. **Set difficulty by absurdity, not a fixed offset.** The check's difficulty
   scales with how far the assertion reaches beyond established evidence:
   - *Mild* (atmospheric, subjective, barely changes facts — "感觉这房子在
     呼吸"): Regular check, or even no check — the KP may simply adopt it as
     flavor.
   - *Moderate* (adds a concrete fact not yet revealed — "这面墙后面有暗
     室"): Hard or Extreme, depending on how much prior evidence supports it.
   - *Outrageous* (rewrites established causality, NPC state, or major world
     facts — "他其实已经死了", " cult 已经解散了"): only a **critical
     success** (01) makes it true. Anything less fails. The KP sets this
     threshold honestly: the more the assertion contradicts what the table
     already knows, the harder it is to earn.
4. **Honor the result — including fumbles.** If the check passes at whatever
   threshold was set, adopt the assertion as campaign-local fact under
   Controlled Improvisation (record provenance, preserve contradictions). If
   it fails, the world stays as established — narrate what the investigator
   actually finds (nothing, ambiguity, or a different truth). On an
   **outrageous fumble**, give the player an equally outrageous consequence
   that matches the tone of their claim: they asserted a dead man is alive?
   On a fumble, something that *should* be dead very much isn't, and it now
   knows they doubted it. The punishment mirrors the hubris. A mild fumble
   just means nothing happens or a minor misread.
5. **No forced compliance.** The KP cannot order the player to "take back"
   their statement or lecture them about rules. The threshold is the check
   itself. A player who refuses to ground the assertion simply gets no
   confirmation — the world does not respond to unsupported claims.

Never gate-keep player *feelings*, *intentions*, or *hypotheses* — only
assertions that would change what is objectively true in the world.

This is adjudication craft, not a hard gate. Tools may surface departures in
`warnings`/`hints`; the verdict and the prose remain yours.
