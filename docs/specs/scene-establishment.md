# Arriving somewhere puts the investigator in it

Status: integration-in-progress (worker WIP copied to `codex/handoff-20261008-integration`; contract §203; owner approved the pre-delivery exception on 2026-10-08)

## 1. What the owner asked for

The owner, 2026-10-08, after TR-F2 run 3 (The Haunting, `game-af36b938`, Keeper `flapcode/gpt-6-luna`, narration-craft 2.4.0):

- 「这次测试整个团都很空洞，没有任何环境描写和角色神态描写，也没有参考历史的情景描写」
- On the delivery 「编辑部仍有打字机声，桌上摊着索引卡和剪报」: 「这两句完全没给玩家带入感啊！编辑部什么样？里面有多少人都在做什么，有什么值得关注的装饰物之类的这些完全都没有！」
- 「文笔要的就是要沉浸感！」
- 「我们的mod系统后面出现了大改之后每个mod都可以有自己的长描述了，完全不需要压缩」

The owner chose grok-4.5 as the Keeper from 2026-10-08. The fix must hold for any Keeper model.

**Intent check.** The owner wants the player put inside each new place: what the room is like, who is in it and what they are doing, what is worth a second look, what it sounds and smells like, what century it is, and something that invites the next move. NPCs must arrive with a look and a manner, not just a line.

- **Success:** on arrival turns, delivered prose that a reader judges against that list and finds the list present, on the product path, with the Keeper the owner plays with.
- **Hollow delivery:** a longer prompt nobody measured; a word or character floor; one more period noun in a sentence counted as "history used"; a test suite that is green while the delivered prose stays two dry sentences.

## 2. Evidence

### 2.1 Prose per turn

| campaigns | narration-craft | Keeper | prose median |
|---|---|---|---|
| 33170a20, 7e9db15c, d78dd9ec | 2.2.4 | grok-4.5 | 355–468 chars |
| 56788eff, 565055f1, af36b938 | 2.4.0 | luna | 122–179 chars |

Run 3 (`af36b938`), read from its turn records: median 140 characters over the 17 delivered player turns. The arrival turns (T2, T6, T11, T14, T16) also have a median of 140, so arrivals were no richer than any other turn.

### 2.2 What 2.4.0 cut from 2.2.4

narration-craft's `agent.md` went from 13,788 B (2.2.4, `0d7334861`) to 12,995 B (2.3.1, `70e920bb7`) to 12,478 B (2.4.0, `193253d85`). About 1.3 KB was cut. `style.json` is byte-identical across the three, and so are "This turn" and "The people here".

Cut or compressed in "Sentences and paragraphs" and the preamble:
- "You are the voice of this table, speaking to the player."
- "Each turn is a passage the player reads, not a report of what the tools did."
- "Prefer what is seen, heard and said over what is felt or meant." (cut)
- "Concrete nouns, exact verbs and sensory/material relations carry texture." This was cut from `agent.md`. The style axis keeps "concrete nouns, exact verbs and material relations" without "sensory".
- "An anomaly sits beside its ordinary neighbour in plain words; no verdict names a cause the source has not given." This was cut from `agent.md`. It survives only as the `plain-then-strange` directive, which only the REVEAL, DEEPEN and PAYOFF beats carry.
- "One focus belongs to each paragraph; clauses connect through spatial, temporal, causal or perceptual continuity." This was compressed to "Connect the passage through actual space, time, cause, and perception." The one-focus rule is left to the style lines.
- "Give the moment that matters room and an errand only the space it needs." (compressed)

Cut or compressed in "Scene and detail":
- "Make the present look or chosen movement the centre, and carry one spatial, causal, temporal, or perceptual thread through it." (cut)
- "show where you stand, what that route permits you to see, hear, smell, or touch, and any material change the act causes" (cut; the only explicit sensory duty in the section)
- The first-visit duty lost "along the eye's path, where orientation can guide decisions".
- The return rule lost its list of what may have changed ("object, position, role, attention, light, sound, or route") and the rule against "still", "again" or "the" before a thing's first showing.
- Historical detail lost where it goes: "into the place or people's work, dress, manner, or goods".
- "Pressure lands as a cost in the body or the room and a clock in what people do, never as a label." This became "pressure comes through cost or action", losing body and room.
- 2.2.6/2.2.7's "Let supplied relations of position, contact, consequence, or changing sound carry the passage from detail to detail, and let a final relation grounded in that material complete the look, movement, or listening itself" became "Let supplied relations connect the whole look, movement, and listening, with concrete closure."

Cut or compressed in "Opening the table":
- 2.2.4's prose form became a list.
- "Take the room this needs" was cut.

**The plain reading.** The compression was small, and it is not the main cause of thin prose. Neither 2.2.4 nor 2.4.0 has an establishing duty. Both carry a per-turn close, "Stop with enough on the page to judge: what is seen, who is here and how they stand, what is in hand", which pulled the 10-04 static tableau ([[tableau-closer-is-instructed]]). The style lines open with "plain sentences with clear agents and clauses" and say "ordinary texture may simply be texture" and "a quiet turn owes no event". Nothing asks for an establishing description or an NPC's demeanor. The register `purist` (Chaosium's Purist play style: "philosophical horror … atmosphere of menace and dread over action", `content/craft/text-graph.json`) is named in the capsule and expressed nowhere. The Keeper model also differed between the two rows of the table. Run 3 is luna.

### 2.3 Run 3, turn by turn (read-only, the App's campaign directory)

- **Arrivals.** `scene-moved` at T2 (newsroom), T6 (library), T8 (records hall), T11 (chapel ruins), T14 (the house) and T16 (the basement). Every move went to a scene never visited before (`world.visited_scenes`). The record at T8 is `closed_by: "stranded"`, so the hall's first prose came at T9 (71 characters). The brief's "T15 house" is T14; T15 is the same scene handle, relabelled.
- **Places.** No `first_sight.place` on any turn. Every Haunting scene's summary repeats its name ("scene newspaper morgue") and none has `properties.description`. §168.5's "a name is not a description" leaves first sight nothing to carry. `first-sight.json` was never created and the check lane never ran. `table.first_sight.view` was called at T2, T6, T8 and T14 and returned null each time. At T11 and T16 the Keeper's own `apply move` and its `narrate` went in one batch, so no later step existed to hand anything over.
- **People.** The doorman (`npc-arty-wilmot`), Ruth Blake (`npc-ruth-blake`) and the records clerk (`npc-records-clerk`) are book-seated graph `npc` nodes. They are not Keeper-minted.
  - All three are `visibility: keeper-only` with a summary that repeats the name and no `biography`. Nine of the module's ten `npc` nodes are keeper-only; none is `player-safe`.
  - §168.5 carries only `player-safe` people, and only when the book has words for them. Both exclusions hold, so `first_sight.people` is empty for this whole module by construction.
  - The capsule's `present[]` gives the Keeper role, wants, fears, hides, voice and personality, and no appearance field.
  - The prose gave the doorman 「衣着整齐，神情端着」, Ruth 「神色比门边那人友善」 and the clerk 「站在索引柜旁」: no age, build, dress or face.
  - narration-craft's first-meeting paragraph says to show "everything the book describes of their looks". The book describes nothing, and nothing says what to do then.
- **History.** The host lookup ran on every new scene the run started in:
  - newsroom: 1 source, 4.6 KB, a garbled 1926 *Special Libraries* text;
  - library: 2 sources, 9.3 KB, Boston Public Library bulletins, both `direct`;
  - records hall: 2.9 KB, a 1920 Municipal Register;
  - house: 9.3 KB, a triple-decker memoir and an NPS page on a Brookline house.

  It reached the prose as one or two dry facts, as `HISTORY_SUPPLIED` literally asks ("put one or two concrete details"):
  - 「桌上摊着索引卡和剪报；有人把资料按主题归档」;
  - 「书架深处的藏书供两处共用」;
  - 「街上的房屋多有窄走廊与前厅」.

  Four of six selections were `analogous`, and none describes a person.

  The lookup follows the scene a run starts in. The chapel (T11) and the basement (T16) were arrived at inside a run and got none of their own history at arrival. The chapel never received an excerpt.

### 2.4 The standard

`what-scene-description-is` (memory) and the Keeper Rulebook (40th Anniversary). The rulebook advises that descriptions become more real with two or more senses, and lists texture, smell, taste and quality of light. Its Garrie example gives the floor's layout, then a smell, then what is in the room. It also advises atmosphere through pacing and tension. An establishing description carries:

- **the space:** size, layout, light and period materials;
- **the people:** how many, what each is doing, their look and demeanor, and how they react to the arrival;
- **things:** one or two specific objects worth attention;
- **senses:** at least two senses beyond sight;
- **period texture:** from the historical reference, rendered as things seen and heard;
- **a hook.**

## 3. Decisions (lead, contract §203)

1. **narration-craft 2.5.0: full guidance, no compression.**
   - Restore everything 2.2.x had for environment, first visit, readout and sensory relations (2.2.4 plus 2.2.6/2.2.7).
   - Keep 2.4.0's people guidance verbatim, and add one paragraph for a person the book gives no look.
   - Write the purist register's atmosphere (menace and dread, the uncanny beside the ordinary) as real guidance.
   - Replace the per-turn closer's "who is here and how they stand" with a close that does not set an established room out again. No per-turn closer is added.
   - Length is not a cost to minimise. The package stays within §183's budget and uses its sections; the measured total is in §203.9.
2. **An establishing duty, told in the turn's capsule.**
   - The kernel computes `mods.establish` when the party stands in a place this table has not yet established, or when the Keeper looks the place over. The host carries it to the Keeper in three ways:
     - the capsule;
     - the step note after a mid-run move;
     - the `look` result.
   - Other turns carry nothing and keep their economy.
   - The package supplies what the duty owes (`establish.json`); the base carries only the interface.
3. **An NPC's first appearance carries look and demeanor.** §168.5's first sight carries every person present not yet shown, whatever the node's knowledge visibility. A person the book gives no look is marked `undescribed`, and the Keeper gives them one. The check lane asks one verdict for such a person: did the prose show how they look or carry themselves?
4. **Historical reference shaped for this** (historical-reference 1.2.0 and the host lookup):
   - the query objective asks for concrete sensory and social detail of that kind of place in that period;
   - the selection orders kept excerpts by a texture Noul;
   - `HISTORY_SUPPLIED` asks for the excerpts to furnish the establishing description as perceived things.
5. **Checked before delivery** (narration-audit 1.3.0):
   - On an establishing turn the host asks a model to judge the draft against the package's list.
   - A thin draft is steered once through the existing one-steer machinery: no loop, within the turn's provider budget.
   - The check runs on every delivery path, the implicit close included.
   - Telemetry records it, and the delivery record keeps the verdict.
   - This is a second carve-out from §166.1's one-pass rule, in the shape of §166.2's refused-document boundary.

   **The owner's 2026-10-01 ruling for §166 approved one-pass delivery. On 2026-10-08 the owner explicitly approved this bounded pre-delivery exception in the Codex continuation: one fast-model check, at most one rewrite, up to 20 seconds, unavailable review delivers.**

## 4. Tickets

| # | Ticket | Status |
|---|---|---|
| SE-01 | Contract §203 and this spec | done |
| SE-02 | narration-craft 2.5.0: full guidance, establishing section, `establish.json`, style lines | done |
| SE-03 | Kernel: `context.establish.v1`, `mods.establish`, the `establish` gate, `table.establish.view`, the look result, the delivery record | done |
| SE-04 | First sight carries every person present; `undescribed`; lane verdict | done |
| SE-05 | narration-audit 1.3.0 `establish_review`; host lane `establish-review`; the delivery guard on every path; telemetry | done |
| SE-06 | Hybrid step note `establish` after a mid-run move | done |
| SE-07 | historical-reference 1.2.0; query objective, texture Noul, `HISTORY_SUPPLIED` | done |
| SE-08 | Live probe: replay run 3's arrival turns, blind judge | see §5 |

## 5. Validation

- **Tests on the real entry, each mutation-checked:**
  - a new place yields the item, and a revisit does not;
  - the audit steers a thin draft once and passes a rich one;
  - first sight reaches an NPC's first appearance.
- **Live probe on the Mac, pre-registered** (`.coc/playtests/scene-establish-20261008/PREREGISTRATION.md`):
  - replay run 3's arrival turns from a `cp -c` clone with the Keeper the App's provider store offers (grok-4.5 if present);
  - a separate model judges each delivered prose against the list, blind to arm.
- **Box:** `focused`, then `all` once.

## Comments

- Codex continuation (2026-10-08): the stopped worker left `kernel-ts/read/mods.ts` in a mutation state
  (`if (item && false)`). Its `.mutbak` differs by that one line. The integration copy restores the ordinary conditional;
  the original checkout and backup remain intact. The mutation backup is not shipped.
- Local real-kernel diagnostics: first run 3/6, with every failure caused by the missing capsule item; restored path 6/6.
  Lane/guard/step/first-sight diagnostics 8/8. Default-on instruction text is 65,374 bytes, all full, under 65,536.
  Conflicts retain §199's appearance-only epithet source, §200's unconfirmed-recording channel and fallback behavior,
  and §201's combined told reads alongside the establishing data. Existing localized description seeds are preserved;
  changes to product-authored descriptions are English source only.
- The owner approved the pre-delivery exception on 2026-10-08. No installed App, model setting, campaign,
  or live table has been changed by this continuation. Host-path, focused/all and live prose verification remain pending.
