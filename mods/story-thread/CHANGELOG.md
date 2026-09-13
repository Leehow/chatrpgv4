# Story Thread

## 1.2.5
- Adds the deterministic reentry `mode` (`clarify_known` | `introduce_evidence`) to the row and tells the Keeper which action each mode takes; the mode is selected by the kernel from the acquired evidence on the chosen thread plus the prior same-worldline/loop/thread assessments, and physical location never decides it.
- `clarify_known`: the chosen thread already has acquired `known` evidence and no earlier assessment on this line/loop/thread recorded `bridge_delivered` true. The row needs no new bridge; the Keeper uses one already acquired `known` row, states explicitly how it supports or contradicts the selected core claim and why it matters now, then continues the player's chosen action — opening no adaptation and inventing or delivering no new clue. This is the first misunderstanding on evidence the player already holds.
- `introduce_evidence`: `known` is empty, or an earlier assessment on the same line/loop/thread already recorded `bridge_delivered` true and a later player frame is still `misframed`/`detached`. The Keeper keeps the existing concrete `bridge`, `authority`, `source_rebinding`, `bridge_offer` and `bridge_receipt` flow, so a renewed deviation introduces one new source-grounded carrier instead of repeating a clarification that already landed.
- `bridge_delivered` remains the feedback from the post-commit assessment. The matching audit (`narration-audit` 1.2.15) accepts only `acquired_clarification` or `player_discharge` under `clarify_known` (neither may revise; no bridge receipt/offer or source rebinding may be demanded) and keeps `bridge_receipt`/`bridge_offer` for `introduce_evidence`. No new lane, verb, counter, semantic regex/list, physical-place list or automatic adaptation is added.
- Retained failed evidence: `midgame-reentry-live-17b-run` turn 6. The player already held `globe-unpublished-story` as acquired evidence (`acquired: true`, delivery turn 4) and was explicitly `misframed` about `house-haunted-by-corbitt`, but the Keeper opened `source_rebinding` for `dooley-macario-madness` instead of clarifying the existing article, causing a 46.5 s undelivered turn (`wall_seconds` 46.499, `settle_class` `undelivered_with_tools`). P5 remains open pending retest: a first misunderstanding with known evidence must complete without adaptation, and after a successful clarification a later renewed misframe may introduce one new source-grounded bridge.

## 1.2.4
- Clarifies reentry placement for a `new_destination` scene whose initial description says it has no scenario clue. That description records only the creation-time graph state; it is not a permanent prohibition. A later reviewed `source_rebinding` is precisely the authorized way to add an existing clue's delivery relation at that scene.
- When `authority.clue_here` is `false`, the Keeper follows the projected bridge and prepares `source_rebinding`. The Keeper never creates a flag, ruling, note or new adaptation whose purpose is to forbid the bridge, freeze the scene as clue-free, or override the reentry; none of these can supersede source graph/adaptation authority.
- Preserves player agency after rebinding: use `bridge_offer` when the player has not chosen acquisition, or the minimal receipt path when they have.
- Retained failed evidence for the clarification: `midgame-reentry-live-16c-run` around open campaign turn 2. After the Athens destination acceptance and move, the Keeper read the scene's initial no-clue description as permanent, attempted rejected flag/ruling writes forbidding source clues, and omitted the required `source_rebinding`. P5 remains open pending retest.

## 1.2.3
- The reentry action now follows two-stage player agency after accepted `source_rebinding`. When `authority.clue_here` is `false`, the Keeper prepares/accepts `source_rebinding` before asserting the carrier arrived. Once it is `true`, the Keeper inspects the current `player_text`: an explicit choice to receive/read/examine the bridge settles only the exact clue and/or source handout receipt that chosen action needs and then states the causal relation and current stakes, without bundling extra item transfer, elapsed reading time, movement or another unchosen commitment; without such a choice the Keeper forces no receipt and instead narrates a `bridge_offer` — the exact carrier within reach, how it bears on the selected causal claim, why the choice matters now — then stops with the choice open, claiming no taking/reading/accepting/spending/believing/acting and minting no receipt (the audit reads this as `defer`). After action admission refuses a bundled or unchosen acquisition, the Keeper honors the refusal and uses the `bridge_offer` path when authority is `true`, without resending the batch or replacing it with unrelated ordinary pacing.
- Retained live finding motivating the action instruction: in `midgame-reentry-live-15f-run` the run attempted a forced clue/handout/item/time batch after accepted `source_rebinding`, action admission correctly refused it, and the Keeper then omitted the carrier entirely. The seam was real on both sides — the rules forbade settling a choice the player had not made and also forbade offering it — so this version tells the Keeper the lawful two-stage action. Not yet accepted.

## 1.2.2
- The reentry row now carries one concrete `bridge`, selected deterministically from an existing undiscovered clue that supports or contradicts the selected core thread. Shape: `{clue, relation, fact, source_handouts, knowledgeable_people, source_scenes, delivery}`. Selection prefers a source handout, then a knowledgeable NPC, then an authored source scene — closed graph roles, not keyword semantics — and it never creates a new clue or story fact.
- `delivery` says to carry that exact evidence into the chosen direction, use reviewed `source_rebinding` when its placement changes, settle the existing clue or handout receipt before narration, then state how it supports or contradicts the selected core thread and why that matters now. The reentry action requires realizing this supplied bridge before ordinary pacing; an invented analogous incident, generic atmosphere, a detached recap, a route name, or a menu does not satisfy it.
- Retained live finding: in `midgame-reentry-live-9`, turn 4 projected `detached` correctly, but the Keeper invented an analogous unnamed empty-house newspaper brief with no receipt and did not connect it to Corbitt; the next assessment correctly kept `bridge_delivered` false. This motivated the concrete bridge. Not yet accepted.

## 1.2.1
- Core causal threads outrank hook/procedure threads: refusing a commission, hook, route, destination, NPC request, or procedure is not informed refusal of a deeper core claim the player has not demonstrated understanding of, and does not discharge the reentry.
- Detached re-entry respects the refused hook while carrying the core relation into the chosen direction, rather than retrying the declined hook.

## 1.2.0
- Adds the midgame causal re-entry bridge (contract §37). When `mods.thread.reentry` exists, the current `player_text` can discharge it semantically (explicit connection or informed refusal); otherwise the Keeper makes the causal relationship and its current stakes explicit before ordinary pacing through one source-grounded carrier (a consequence already set in motion, a knowledgeable person, a document or clue, or an event that reaches the chosen direction). A route name, atmosphere, a recap of disconnected facts, or a menu is not enough.
- Reentry keeps existing clue/source/knowledge authority and receipts; if durable topology must follow the player, it uses reviewed adaptation/`source_rebinding` first. It never chooses the investigator's response, invalidates an informed refusal, forces a return to an authored scene, rewrites the mystery, or repeats a bridge already marked delivered. The status is semantic evidence, not a counter and not a physical-location requirement; the next post-commit assessment is the feedback.
- Conclusion lines remain opportunities, never a per-turn plan; all earlier guidance is preserved unchanged.

## 1.1.3
- Reminders fit the combined budget after NPC-journal/provider integration; full guidance stays unchanged.
- Source roles and unknown causes stay explicit during clarification.

## 1.1.2
- Compresses the per-turn reminder without changing its gates or meanings.

## 1.1.1
- Clarifies continuity lookup/recall, acquired-versus-understood clues, and source-grounded adaptation boundaries.

## 1.0.4
- Updates gate wording to the repaired kernel contract: named checks stay as declared; `check required (skill unspecified)` means the delivery is a check with no projected skill name; `check unspecified` means no projected named check and is not evidence of no roll or permission to invent one. Costs stay only where rules, source or investigator actions establish them; thread structure is unchanged.

## 1.0.3
- Historical #80 wording. This version tried to say what a `here` row's `gate` asked for using the now-retired phrases `no check in the book` and `the book names no skill`, after `knq-live-1` spent six failed Strength checks and thirteen turns on a boarded cupboard. Version 1.0.4 corrects the missing-key/null distinction and replaces the active guidance.

## 1.0.2
- The lines are opportunities, not a per-turn plan (contract §30.12); structural semantics (`handed`, critical first, `fallback`) unchanged.

## 1.0.1
- Adds `brief.md`, the per-turn reminder form of the instructions (contract §30.7); the first turn of a process still carries the full text.

## 1.0.0
- First release: reads `context.thread.v1`, the kernel's projection of open conclusions by clues here, next door and beyond.
