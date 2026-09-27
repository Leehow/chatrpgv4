# SL-97 phase 1: 20 cases read at typed confidence &lt; 0.6

Pulled from `replay-live.jsonl` (paired with the case's `input.proposal` in `bank.jsonl`), not written from memory.
339 of 429 typed-attempted cases (79%) landed below 0.6. The #23 t2 case named in the ticket is included first;
the other 19 are a seeded random sample (`seed=7`) of the remaining low-confidence cases.

For each: the lane's label (ground truth for this measurement), the typed verdict/confidence, the proposed line(s),
and one line on what seems to make the typed reviewer unsure.

## 1. `longgate23-haunting-1350:2:0` (the ticket's #23 t2 case)

- Player: "我说明来意，请他帮忙调出科比特宅这些年的旧剪报。" (explains why he's there, asks the clerk to pull old clippings)
- Proposal: `apply handout: name="Boston Globe City Desk Copy — Held from Print (1918)"` / `apply time: minutes=45`
- Lane: `review_pending` (no verdict in 13 s live). Typed: `not_authorized` (line 1, conf 0.51) / `entailed` (line 2, conf 0.61) → batch `not_authorized` at 0.51.
- Note: this replay's confidences (0.51/0.61) differ from the ticket's live numbers (0.24/0.57) — the offline reconstruction is not bit-identical to what the table saw; both point the same way (low confidence, line 1 refuses).
- **Why unsure:** criteria/label mismatch — the player asked generically for "old clippings," but the effect commits to one specific named, held-from-print handout the player never named; the reviewer has no player-visible passage that picks that one document out of "clippings" in general.

## 2. `pb-full-p01-cont-t3-74849Z:5:4`

- Player: a long, explicit negotiation for reading-room access (asks for the procedure, offers to pay a fee, states exactly what he wants to see).
- Proposal: `apply time: minutes=15` (granted access after negotiating with the clerk)
- Lane: `not_authorized`. Typed: `authorized`, conf 0.28.
- **Why unsure:** missing context — the line is just the time cost, stripped of the negotiation that earned it; the reviewer sees 15 minutes and a terse `why`, not the multi-sentence argument that (per the lane) still didn't earn entry.

## 3. `pb-full-p11-natu-t3-74849Z:12:1`

- Player: explicit, detailed records request (deed, chain of owners, civil records only, no felony files).
- Proposal: `resolve`, `intent="investigate"`, method quotes the player's own request closely.
- Lane: `authorized`. Typed: `entailed`, conf 0.33.
- **Why unsure:** criteria/label mismatch, not a real disagreement — `authorized` and `entailed` are both admitting verdicts (§32.10's mapping), and the typed↔lane confusion matrix shows most of the authorized/entailed crossover sits exactly here.

## 4. `pb-full-p05-natu-t3-74849Z:4:4`

- Player: out-of-character luck-spend narration ("按七版花幸运改骰...如果这桌不让花幸运改骰，再说") layered over the in-fiction ask.
- Proposal: 3 `clue` + 1 `time`, delivered after an off-screen Library Use roll.
- Lane: `None` (lane-unavailable in the retained row). Typed: `not_authorized`, conf 0.42 (3 of 4 lines refuse, the `time` line entails at 0.42).
- **Why unsure:** missing context — the roll that licenses the clues happened in a separate `resolve` call not carried into this batch's packed input, so the reviewer has no passage showing the check succeeded.

## 5. `pb-full-s01-natu-t2-74849Z:5:1`

- Player: aggressive demand to see a patient now, plus a conditional ("if he still blocks me, I'll push past while he's distracted").
- Proposal: `resolve`, `intent="social"`, goal "walks into the visiting room after being let in."
- Lane: `not_authorized`. Typed: `authorized`, conf 0.23.
- **Why unsure:** genuine ambiguity — the player's own words hold two different actions (ask to be let in vs. force past), and the goal string picks the milder one; it's unclear from the packed text alone which one was chosen.

## 6. `pb-full-p01-natu-t2-71752Z:3:2`

- Player: a multi-step plan (records office, then newspaper morgue, then sanitarium, in that order).
- Proposal: `resolve` goal "first contact with the Hall of Records clerk on arrival" — one step pulled out of the monologue.
- Lane: `not_authorized`. Typed: `entailed`, conf 0.28.
- **Why unsure:** criteria/label mismatch — the goal is the Keeper's own English paraphrase of one clause of a longer plan, not a quotable player passage, so the reviewer's basis selection has nothing exact to point at.

## 7. `pb-full-p04-natu-t1-74849Z:4:1`

- Player: an open-ended gossip probe to an NPC about a family's letters.
- Proposal: `apply clue` (an NPC's specific answer) + `apply time`.
- Lane: `not_player_action`. Typed: `authorized`, conf 0.2 (clue line), 0.47 (time line).
- **Why unsure:** missing context — the clue's content is the NPC's fictional reply, which lives in the Keeper's delivery, not the player's line; the player's ask is generic ("what happened"), so nothing in the packed input picks this specific answer as chosen.

## 8. `pb-full-p04-natu-t1-74849Z:9:1`

- Player: states his own plan to walk to City Hall.
- Proposal: `apply time: minutes=25` for the walk.
- Lane: `entailed`. Typed: `entailed`, conf 0.56 (agrees, but under 0.6).
- **Why unsure:** looks like reviewer calibration on `time` lines specifically — the histogram shows `time`-bearing batches cluster 0.3–0.6 regardless of how explicit the player's stated plan is, more a jaggedness pattern than a case-specific ambiguity.

## 9. `pb-full-p03-cont-t2-74849Z:9:1`

- Player: describes visiting-room rules and refuses to answer for the NPC.
- Proposal: `apply clue` — the NPC (Vittorio) abruptly points at a line in a Bible, unprompted.
- Lane: `not_player_action`. Typed: `not_authorized`, conf 0.39.
- **Why unsure:** genuine ambiguity in what "entailed" means for an NPC-initiated beat during a scene the player did choose to enter — the reviewer and the lane land in different refusing buckets (`not_authorized` vs `not_player_action`) over the same "the player didn't choose this specific reveal" judgment.

## 10. `pb-full-p03-cont-t1-74849Z:1:0`

- Player: accepts a commission, says he'll do his own research.
- Proposal: 3 `clue` lines (NPC's commission recap, research leads, terms) — line 1 clears at 0.87, batch confidence is the minimum (0.34, line 3).
- Lane: `not_player_action`. Typed: `not_authorized` at 0.34.
- **Why unsure:** structural criteria mismatch — these are the NPC's own spoken terms in response to an open "I'll take the job" acceptance; the reviewer's `basis` question wants a player-visible passage that *chooses* each clue, but the natural basis for NPC-delivered exposition is the Keeper's speech, which the reviewer does not read as strongly.

## 11. `pb-full-s01-cont-t2-74849Z:22:1`

- Player: a long, detailed break-in plan (which rooms, in what order, looking for specific things).
- Proposal: 2 `clue` lines (nailed windows, Catholic wards found inside).
- Lane: `None` (unavailable). Typed: `not_player_action` (0.19) / `not_authorized` (0.25).
- **Why unsure:** missing context via clipping — the player's line (per `bank-core.mjs`, clipped to 400 units) is long enough that the specific clause licensing "look at the living room" may have been cut before the model saw it.

## 12. `pb-full-p07-cont-t1-74849Z:8:2`

- Player: forces past a doorman and climbs to a side window.
- Proposal: `apply clue` (what's seen through the window) + `apply time: minutes=5`.
- Lane: `None` (unavailable). Typed: `not_authorized` (0.29, clue) / `entailed` (0.63, time).
- **Why unsure:** genuine ambiguity — the two lines split on whether forcing past the doorman also entails successfully seeing what's on the other side of the window; that's a consequence the text asserts but a reviewer reading only the player's line can't confirm succeeded.

## 13. `pb-full-p01-cont-t3-65211Z:1:4`

- Player: interrogates Knott about the commission and the prior tenant before agreeing to anything.
- Proposal: 3 `clue` (Knott's own answers) + 1 `time`.
- Lane: `entailed`. Typed: `not_authorized`, conf 0.22 (line 1).
- **Why unsure:** same NPC-exposition pattern as #10/#13 — clue content is the answer an NPC gives to an open question, not a specific thing the player's line names.

## 14. `pb-full-p04-natu-t2-74849Z:13:1`

- Player: a dense, multi-clause research instruction (death registration, deeds, one name only checked for "accident," two names cross-checked privately).
- Proposal: `resolve` goal, a partial paraphrase of the ask ("Find Corbitt death registration and the house deeds, later Macario for accident wording").
- Lane: `authorized`. Typed: `entailed`, conf 0.42.
- **Why unsure:** criteria/label mismatch — the goal string compresses several clauses of the player's ask into one English sentence that doesn't quote any of them exactly, weakening whatever basis passage the reviewer tries to cite.

## 15. `pb-full-s01-cont-t3-74849Z:25:0`

- Player: talks to an empty room, demanding the house answer him.
- Proposal: 3 `clue` (smell, blood on the ceiling, a moving bed — Mythos manifestations) + 1 `time`.
- Lane: `not_player_action`. Typed: mixed — `not_authorized` (0.6, 0.52), `not_player_action` (0.79), `entailed` (0.84).
- **Why unsure:** real ambiguity by design — these are pure Keeper-authored environmental responses to a player calling into a void; "did the player choose this" is not really a well-formed question for supernatural manifestations, so the reviewer's answers scatter across all three admitting/refusing buckets within one batch.

## 16. `pb-full-p12-cont-t3-74849Z:10:4`

- Player: explicitly defers the lawsuit file to tomorrow at 9am, just observes the house tonight.
- Proposal: `apply clue` (neighbor lawsuit) + `apply handout` + `apply time: minutes=240` (four hours).
- Lane: `not_authorized`. Typed: `authorized` (0.55) / `entailed` (0.2, handout) / `not_authorized` (0.3, time).
- **Why unsure:** criteria ambiguity on §32.2's time-entailment rule — whether a 4-hour research session is "routine effort the chosen action requires" or a separate voluntary commitment is exactly the line §32.11 leaves to judgment, and the handout (a specific artifact the player never named) drags confidence down further.

## 17. `pb-full-p01-natu-t3-74849Z:9:0`

- Player: explicit, narrow request — copy one specific ledger line, including the executor column.
- Proposal: `resolve`, method quotes the ask closely.
- Lane: `authorized`. Typed: `authorized` (agrees), conf 0.42.
- **Why unsure:** general reviewer calibration on `resolve`/Library-Use lines rather than anything specific to this case — the request is about as unambiguous as the sample gets, yet confidence still sits mid-range, consistent with the low overall median (0.44) across `resolve` and bookkeeping lines alike.

## 18. `pb-full-p10-natu-t3-74849Z:4:0`

- Player: "行，那我去中央图书馆翻。" (OK, I'll go dig at the central library.)
- Proposal: `apply move: to="central-library"` (0.76) + `apply time: minutes=25` (0.57, batch min).
- Lane: `authorized`. Typed: `authorized` (agrees), conf 0.57.
- **Why unsure:** reconstruction gap, not a live weakness — this case's notes carry `registered_destination_omitted` (§32.10's known gap: the move line's destination metadata isn't recoverable offline), so the replayed input is thinner than what the live reviewer actually read; the live confidence may differ from this 0.57.

## 19. `pb-full-p10-natu-t2-74849Z:23:0`

- Player: "它长什么样？" (What does it look like?) — a bare question.
- Proposal: `apply clue` (the NPC's answer content) + `apply time: minutes=5`.
- Lane: `authorized`. Typed: `authorized` (0.19, clue) / `entailed` (0.78, time).
- **Why unsure:** genuine ambiguity in what "authorized" means for a clue that is entirely the NPC's answer to a one-line question — the question licenses *an* answer, not this specific one, so the reviewer is right to be unsure even though it happens to agree with the lane.

## 20. `pb-full-p02-cont-t3-71752Z:7:0`

- Player: asks an NPC a batch of specific questions at a newsstand.
- Proposal: `apply time: minutes=10`.
- Lane: `entailed`. Typed: `entailed` (agrees), conf 0.39.
- **Why unsure:** same `time`-line calibration pattern as #8/#20 — clear, explicit player action, still scores mid-low; the packed context gives the reviewer no per-line signal beyond "some minutes passed for some talking," which is intrinsically low-information regardless of how explicit the underlying dialogue was.

## Rollup across the 20

- **NPC/environment-delivered content** (clues that are an NPC's answer or an environmental beat, not a thing the player's own line names): #1, #4, #7, #9, #10, #12, #13, #15, #16, #19 — 10 of 20. This is the single largest driver of low confidence in this sample.
- **Reconstruction/packing gaps** (offline replay missing what the live call had): #11 (clipped player text), #18 (`registered_destination_omitted`), and #1 itself (confidence differs from the ticket's live numbers).
- **Criteria/label mismatch between `authorized` and `entailed`** (both admit; the reviewer and lane pick different admitting labels): #3, #6, #14.
- **`time`-line calibration** (clear cases that still score mid-low, looks like general jaggedness on this line kind rather than case-specific ambiguity): #8, #17, #20.
- **Genuine ambiguity in the declared action itself**: #5, #12.
