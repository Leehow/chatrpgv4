# 1.2.24

- Tightens the 1.2.23 intelligibility check after its first retained original-save retest still passed malformed actor/body-part phrases and repeated clipped status dialogue. The reviewer now receives concrete language-neutral failure shapes, treats one occurrence as enough to revise, does not exempt terse or archaic character speech, and asks for one whole-candidate rewrite when the pattern repeats. The boundary remains intelligibility rather than literary taste.

# 1.2.23

- Adds a narrow pre-delivery intelligibility check after a retained long-table delivery degraded into omitted subjects, malformed actor/body-part phrases and context shorthand copied as dialogue. This is not a literary score: voice, rhythm, length, description and formality remain outside the audit. A finding only asks the Keeper to preserve the same facts and choices while rewriting genuinely hard-to-understand prose as natural, complete sentences in the play language.

# 1.2.22

- Adds the unmet-question check: each question the player put to someone is answered, deflected in character with a reason, or refused with one; a repeated line is not an answer. Found on a 24-turn table where three NPCs answered every new question with the same three sentences.

# 1.2.21

- Adopts the §101 runtime-file allowlist, so only `mod.json` and `auditor.md` enter campaign homes; the engineering changelog remains source evidence and is never projected by `mods.list`.
- Removes retained campaign ids, run names, turn ranges and acceptance status from the runtime auditor prompt. The normative checked review rules and abstract examples remain unchanged.

# 1.2.20

- Add the checked `outcome_review` required only when `context.outcome_commitments` carries one or more current `passed:false` roll receipts. Its closed shape is `{verdict:pass|revise,basis:failed_rolls_respected|unsupported_positive_result,claims:[exact candidate excerpts]}`. A failed roll may carry consequences or uncertainty but cannot earn the positive action, perception, clue or fact it was meant to decide. `unsupported_positive_result` must revise, quote the candidate exactly and carry an actionable finding; a specific revision overrides an aggregate pass. Turns with no failed roll keep the previous artifact shape.
- Retained failure: H-SIDE turns 141 and 142 each settled a failed Listen roll, yet the delivered prose gave the investigator a new sound under the boards and then treated the second as shorter than the first. The post-delivery verifier correctly wrote `uncommitted_state` and `reveal` findings saying the player had not earned it, but that lane is advisory and ran after the player read the fiction. This sub-review moves that exact judgment into the existing pre-delivery gate without making the broad, high-false-positive `player_agency` class blocking.

# 1.2.19

- **Deliberate design change (2026-09-15, contract §37.3): `reentry_review` revises for damage, not for distance.** With `causal_reentry` present, the sub-review may now return `revise` **only** when the candidate (a) contradicts the selected thread's claim or evidence the player has already acquired, or (b) invents an analogous incident, fabricates a carrier, or claims evidence arrived, was read or was acquired without its receipt. Those two abuses are what this pre-delivery enforcement was written for and they still revise. An unrealized bridge on a turn the player spent on their own chosen line is no longer a revision: the reentry is retained and the turn is delivered.
- Add the `chosen_action` basis: verdict `defer`, lawful under **both** modes, requiring no host-owned field — no `preparation_wait`, no `rebinding_refused`, no authority state and no receipt. `clue` and `relation` are `null`; `quote` is an exact candidate excerpt continuing the action the player actually chose. It is unlawful when current receipts already contain the bridge clue or one of its source handouts (that is `bridge_receipt`) and it never excuses a fabricated arrival (that is `none` with `revise`). It is never `bridge_delivered`, so the next turn carries the reentry again. There are now four structural defers: `bridge_offer`, `chosen_action`, `preparation_wait` and `authority_unavailable`.
- The `none` basis is narrowed to those two abuses, and its one finding names what contradicts or what was claimed without a receipt and how to withdraw it, instead of directing the Keeper to reach a lawful delivery stage. The reviewer never asks for a `source_rebinding` whose only purpose is to satisfy this review. `bridge_offer`, `bridge_receipt`, `acquired_clarification` and `player_discharge` keep their meanings, their authority rules and their `relation`-direction rules unchanged, and the receipt rule for acquired or read contents is unchanged — that rule is anti-fabrication, not the gate.
- The number skips 1.2.18 on purpose: contract §36 already labels the settled-consequence/preparation-wait seam `narration-audit 1.2.18`, and that change landed on the host side (`extensions/kernel`) without altering any Mod byte, so no 1.2.18 package was ever published. Reusing the label would give one version two meanings.
- Retained blocking evidence (`game-83177d61-ab11-4d58-b8ec-cf8b9c98d5a4`, `the-haunting`, turns 87-91): the player held four of the selected thread's five supporting clues and was walking to the newspaper to publish the story that thread is about, but a bridge delivered at turn 47 had locked `mode` to `introduce_evidence` and the single unacquired clue was authored at a sanitarium, so `authority.clue_here` was false everywhere they could stand. With no `preparation_wait` and no `rebinding_refused`, every basis but `none`/`revise` was unreachable; turns 88, 89 and 90 published nothing despite settled receipts while the Keeper burned `max_rewrites` on `source_rebinding` attempts, and turn 91 passed only because the player happened to recite the core claim verbatim. No new field, lane, verb, counter, semantic regex/list or physical-place list is added; the sub-review shape gains one `basis` value.

# 1.2.17

- Add the `authority_unavailable` basis to the checked `reentry_review`: verdict `defer`, permitted only under `mode: introduce_evidence` when host-owned `context.rebinding_refused` records that the independent source review contradicted the placement this bridge needs, `causal_reentry.authority.clue_here` is `false`, and no bridge clue or source-handout receipt is current. `clue` and `relation` copy `causal_reentry.bridge`; `quote` is an exact candidate excerpt that continues the action the player chose while claiming no evidence, no acquisition, no placement and no preparation that is not running. The reentry is retained and never `bridge_delivered`. A refused placement is no longer a reason to revise forever or to demand the same `source_rebinding` again.
- Retained failed evidence (`midgame-bridge-live-21`, campaign turn 3): with `authority.clue_here` false, `known` empty and the required rebinding contradicted by the independent review, no basis remained at all. The review paused, every `narrate` returned `continuity_review_unavailable`, and the campaign turn could never be delivered.

# 1.2.16

- Add `relation` to the checked `reentry_review` shape: `{"verdict":...,"basis":...,"quote":...,"clue":...,"relation":"supports"|"contradicts"|null}`. For `acquired_clarification` and `player_discharge`, `clue` must name one row in `causal_reentry.known` and `relation` must be exactly that row's relation; `quote` must use that evidence with that relationship — a `supports` row cannot be quoted to argue against the selected thread and a `contradicts` row cannot be quoted to argue for it. For `bridge_receipt` and `bridge_offer`, `relation` must be exactly `causal_reentry.bridge.relation`. For `preparation_wait` and `none`, `relation` is `null`.
- Retained failed evidence (`midgame-reentry-live-20-run`, turn 5): mode was `clarify_known` with known row `globe-unpublished-story` (`relation: supports`) and the player still explicitly `misframed` about `house-haunted-by-corbitt`. The candidate quoted that article to argue the opposite direction — that the unrelated fates were a manufactured scare rather than Corbitt's will — and the reviewer passed `acquired_clarification`. That wrong-direction clarification is failed evidence, not a pass. Raw `midgame-reentry-live-18` evidence was accidentally deleted by a worktree closeout and is `invalid-for-acceptance`; `midgame-reentry-live-19` and `midgame-reentry-live-20` are retained. P5 remains open until a retest records a clarification argued in the selected row's own direction.

# 1.2.15

- Add the deterministic reentry `mode` (`clarify_known` | `introduce_evidence`) to the checked reentry sub-review and close which bases may pass for each mode. The kernel selects the mode from the acquired evidence on the chosen thread plus the prior same-worldline/loop/thread story assessments; physical location never decides it, and `bridge_delivered` remains the post-commit feedback.
- Under `mode: clarify_known` (the thread already has acquired `known` evidence and no earlier assessment on that line/loop/thread before the current one recorded `bridge_delivered: true`) the audit accepts **only** `acquired_clarification` or `player_discharge`; neither may revise, and neither may demand a bridge receipt, a bridge offer or a source rebinding. The candidate connects one already acquired `known` row, states how it supports or contradicts the selected core claim and why it matters now, opens no adaptation and invents and delivers no new clue. A `none` revise under this mode tells the Keeper to connect one acquired `known` row and continue the chosen action, never to prepare an adaptation.
- Under `mode: introduce_evidence` (`known` is empty, or an earlier assessment on that line/loop/thread already recorded `bridge_delivered: true` and a later player frame is still `misframed`/`detached`) the existing `bridge_receipt` and `bridge_offer` bases and their authority rules apply, and `acquired_clarification`/`player_discharge` remain available for evidence the player already holds. A basis outside its mode's permitted set does not pass and does not revise silently: the auditor returns exactly one finding naming the mode and the lawful basis.
- No schema, basis or field changes. Retained failed evidence (`midgame-reentry-live-17b-run`, turn 6; `wall_seconds` 46.499, `settle_class` `undelivered_with_tools`): the player had acquired `globe-unpublished-story` (delivery turn 4) and was explicitly `misframed` about `house-haunted-by-corbitt`, but the Keeper opened `source_rebinding` for `dooley-macario-madness` instead of clarifying the existing article, and the reviewer revised `reentry_review` `{verdict: revise, basis: none}`. These are failed evidence, not a pass; P5 remains open until a retest records a first misunderstanding with known evidence completing without adaptation and, after a successful clarification, a later renewed misframe introducing exactly one new source-grounded bridge.

# 1.2.14

- Make the two stages of the projected causal reentry unambiguous, because retained live evidence showed the reviewer contradicting itself. **Placement/offer stage:** when `causal_reentry.authority.clue_here` is `true` and there is no current bridge clue or source-handout receipt, the effective graph already authorizes the exact carrier to appear at this scene; a candidate that shows the carrier's visible identity and provenance and explains how examining it could bear on the selected causal claim and the current stakes, while leaving taking/opening/reading/accepting/spending/believing/acting to the player, is `bridge_offer` with verdict `defer`. It needs no clue or handout receipt, is never `bridge_delivered`, and must not be told to `source_rebind` again: the accepted rebinding that made authority true is already its placement authority. **Acquisition/delivery stage:** quoting or realizing the evidence contents as learned, or claiming acquisition, requires the existing clue or source-handout receipt and is reviewed under `bridge_receipt`; `bridge_delivered` continues to require acquired evidence. The old blanket sentence that new evidence always needs its own receipt is now scoped to acquired/read contents and is explicitly subordinate to the `bridge_offer` exception. When `authority.clue_here` is `false`, `source_rebinding` is still required; when it is `true`, it is never required again and a compliant offer is never revised for a missing receipt. The `none` finding and overall-pass wording now name which stage is missing instead of defaulting to a receipt or rebinding, and one worked `bridge_offer` example remains in the base output section. No schema or basis changed; there is no new field. Bumped because 1.2.13 was installed and exercised in retained live evidence. Retained failed evidence (`midgame-reentry-live-15h-run`, driver attempts around campaign turn 9; run `2026-09-13T06:30:55Z`, four undelivered turns, `final.json`): after the accepted `source_rebinding` made `authority.clue_here` `true`, the candidates put the exact Globe carrier within reach and explained its bearing on the selected causal claim and the current stakes while leaving the reading open, yet the reviewer returned `reentry_review` `{verdict: revise, basis: none, quote: null, clue: null}`, invoked the old receipt-first rule, and in one attempt demanded `source_rebinding` again. These are failed evidence, not a pass; item 11 stays unaccepted and P5 remains open until a retest delivers a `bridge_offer` that the player's next chosen action takes up.

# 1.2.13

- Two-stage player agency for the projected causal reentry. Once the kernel-projected `causal_reentry.authority.clue_here` is `true` and no current bridge clue or source-handout receipt exists, a candidate that puts the exact carrier within reach, states how it bears on the selected `causal_reentry.thread.claim`, states why the choice matters now, and leaves the choice with the player is a structural `bridge_offer` defer, not a revise. `reentry_review.basis` gains `bridge_offer` and its closed shape is now `bridge_receipt|bridge_offer|acquired_clarification|player_discharge|preparation_wait|none`. A `bridge_offer` defers with verdict `defer`, `clue` exactly copying `causal_reentry.bridge.clue`, and an exact candidate quote; it must claim no act of taking, reading, accepting, spending time on, believing or acting on the evidence, mints no clue or handout receipt, and is never `bridge_delivered`, so the next turn retains the reentry until the player acts or a later valid discharge occurs. When bridge authority is false the fix is `source_rebinding` first, and when a bridge receipt already exists the basis is `bridge_receipt`. Ordinary candidates still omit `reentry_review`; causal reentry candidates may use `bridge_offer`. All prior bases and rules remain. Retained live failure (`midgame-reentry-live-15f-run`, attempts 2-4 around campaign turn 9): after `source_rebinding` made the bridge discoverable at the Athens pension, the Keeper's batched clue/handout/reading was refused for settling an unchosen action, while offering that choice was rejected, so no lawful narration existed; this basis closes that seam and item 11 remains unaccepted until retest.

# 1.2.12

- Accept a new bridge receipt only when the kernel-projected `causal_reentry.authority.clue_here` is true, which comes from the effective graph at the current scene after accepted adaptation. When it is false, revise and require `source_rebinding` before the evidence can be handed out. `bridge_receipt` now requires both the existing exact bridge clue/source-handout receipt and `clue_here` true; `acquired_clarification` and `player_discharge` stay valid for already acquired evidence without requiring the clue to remain at the current scene, and `preparation_wait` and all other prior rules are unchanged.

# 1.2.11

- Require a checked reentry_review sub-review whenever context.causal_reentry exists and the overall verdict is not unavailable. Its exact shape is {verdict: pass|revise|defer, basis: bridge_receipt|acquired_clarification|player_discharge|preparation_wait|none, quote: string|null, clue: string|null}, with these closed cases: bridge_receipt passes when current receipts contain the supplied bridge clue or a source handout and the candidate realizes it, clue copies causal_reentry.bridge.clue exactly, and quote is an exact candidate excerpt explicitly stating the relation and current stakes; acquired_clarification passes when causal_reentry.known is nonempty, clue names one known row, and quote is an exact candidate excerpt explicitly connecting that evidence and the stakes; player_discharge passes when causal_reentry.known is nonempty, clue names one known row, and quote is an exact current_input excerpt demonstrating the selected core connection and informed refusal or action; preparation_wait defers only when context.preparation_wait exists, with clue null and quote exactly copying the candidate's honest wait-only notice; none revises with quote and clue null and exactly one finding telling the Keeper to settle the supplied bridge authority if needed and then explicitly state the relation plus the stakes. Overall pass needs a passing reentry_review or a structural defer; a structured revise overrides a contradictory aggregate pass and is not duplicated as a conflict. Retained live finding (midgame-reentry-live-15, turn 6): causal_reentry was present, no context.preparation_wait existed, and neither a clue/handout receipt nor any acquired known evidence had landed, yet the reviewer claimed a generic Chandler Street item discharged the bridge and passed. That proves prose-only audit guidance was insufficient and motivates this checked sub-review; it is failed evidence, not a pass. Bumped because 1.2.10 was already installed and exercised.

# 1.2.10

- Replace the causal-reentry deferral rule with structure: a reentry may be deferred for an honest background wait only when context.preparation_wait exists with kind source or adaptation. No receipts, no new mail, an empty or quiet turn, generic waiting, or a candidate that merely says preparation is happening cannot establish pending preparation. When context.preparation_wait exists, the candidate must only tell the player that the exact retained preparation is pending and must claim no result, movement, new evidence, elapsed fictional time or unrelated event. Without it, a projected reentry must be discharged by current_input at the selected core causal level or realized from the supplied bridge before delivery. Record the evidence rule: bridge_delivered requires at least one acquired supporting/contradicting evidence row on the selected thread, and new information must first land through its existing clue or handout receipt; vague warning or atmosphere cannot count. The host passes preparation_wait only from its actual retained background state. Retained live finding: midgame-reentry-live-15 turn 5 had causal_reentry in context, but the auditor passed a quiet no-new-mail scene by incorrectly treating absence of receipts as a pending-preparation deferral; the next assessment had not yet established success. This is not a pass. Bumped because 1.2.9 was installed and exercised in retained live evidence.

# 1.2.9

- Enforce a projected causal_reentry before delivery: discharge it only by an explicit current-input connection to the selected core causal claim and its present stakes, or informed refusal at that level; otherwise require the candidate to realize the supplied bridge. An analogous invented incident, vague warning, atmosphere, detached recap, route name, menu, or a bare claim that preparation is happening is not realization. New evidence needs its existing clue/handout receipt, and changed persistent placement needs settled reviewed source_rebinding; the audit creates neither. When the bridge is unmet, add one actionable finding whose fix names causal_reentry.bridge.clue and sets overall continuity_review to revise, without requiring a duplicate conflict for an omitted bridge. An honest pending-preparation notice may defer reentry only when no move, clue, or rebinding is settled in current receipts and the prose does not claim the prepared result happened. locus_review schema is unchanged; no new output field. Bumped because 1.2.8 retains live use.

# 1.2.8

- Make locus_review the single structured scene-promotion decision; its revision is actionable without a duplicate conflict.

# 1.2.7

- Treat active_scene as a persistent gameplay locus. Review scene promotion by future play and durable location-bound state, never by physical motion vocabulary or enumerated micro-locations.

# 1.2.6

Location authority covers asserted arrival or residence at a distinct persistent destination, not ordinary repositioning, a threshold, leaving the room or building, or travel in progress; location conflicts cite the short exact context rule or move_status string.

# 1.2.5

Location authority distinguishes elapsed time from movement and rejects arrival or residence outside the current scene without a settled move.

# 1.2.4

Use typed read-only evidence views for targeted lookups instead of repeatedly exploring raw JSON layouts. Include executable sheet weapons in focused actor context.

# 1.2.3

The reviewer must not invent unexpressed illusions or off-screen events to justify a contradiction; preserve explicitly marked subjective perception.

# 1.2.2

Use the kernel clock in continuity checks; retain prior player choices and distinguish atmosphere from unperformed time changes.

# 1.2.1

Expose evidence layout and the bounded submission workflow; preserve English review instructions and withdraw unchosen actions instead of manufacturing them.

# 1.2.0

Use bounded campaign-continuity review with compatible improvisation, checked submission, precise artifact repair and shared runtime limits. Legacy source-review verdicts keep their original meaning.

# Narration Audit

## 1.1.2
- Adds immutable `current.json` evidence for citable current declarations, settled receipts, and party facts; candidate text remains in `request.json` and cannot support itself.

## 1.1.1
- Checks presuppositions and distinguishes grounding from prior disclosure; bounded evidence reading avoids redundant self-checking.

## 1.1.0

- Added source, accepted-adaptation, and full-history checks using exact excerpts; unsupported or unclear claims are explicitly refused, not treated as acceptance. Existing receipt authority remains controlling. Source timeouts and implicit text follow the same audit. This does not claim acceptance passed.

## 1.0.1
- Auditor brief covers the concealed roll-visibility tier: a concealed receipt needs an outward-behaviour beat, never the die or its grade.

## 1.0.0
- First release: a receipt-grounded realisation check before delivery, in the shared audit job.
