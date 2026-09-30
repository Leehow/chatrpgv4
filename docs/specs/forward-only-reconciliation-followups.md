# Forward-only reconciliation — open follow-ups

Status: needs-triage (four defects found while accepting FR-01..FR-05; none fixed; each needs the owner's call before work starts)
Date: 2026-09-29
Parent: [forward-only-reconciliation.md](forward-only-reconciliation.md), [forward-only-reconciliation-tickets.md](forward-only-reconciliation-tickets.md). Contract: §158.
Branch where they were found: `claude/forward-only-reconciliation-20260929` (not merged into 0.9.6a).

The four findings are below. Each one records what was seen, where it lives in the code, the options, and a recommendation. None of them is new scope yet: the owner decides which, if any, becomes a ticket.

Evidence paths are relative to the worktree `~/leehow/code/chatrpgv4-wt-forward-only` and live under its git-ignored `.coc/playtests/`. The excerpts quoted here are the durable copy.

- Live table home: `.coc/playtests/fr05-live-20260929-1419/home/.coc/campaigns/fr05-live/`. Its turn records are `turns/000N.json`, and it holds `owed.json`.
- Driver runs: `.coc/playtests/fr05-live{,-b,-c}/`. Driver turn `-b/turn-3.json` is campaign turn 5.
- Keeper probes: `.coc/playtests/fo-service-outage-*/turn-1.json`.

---

## FR-06: a refused payment is narrated as paid, and the ledger has no owed cash

Status: needs-triage

**Seen.** This happened in both `service-outage` probe trials (turn-23 shape). The player said 「我把两毛五分钱的查阅费放在柜台上…」.

- The Keeper sent a single batch: `person` (the clerk), `cash` (`delta: -0.25`, `source: "quote"`, `with: "Arty Wilmot"`), and `time` or `npc`.
- Admission was unavailable, so the whole batch was refused `admission_unavailable`. The refusal's fix says "do not narrate its effects as having happened".
- Both deliveries narrated the payment as taken anyway: trial 1 wrote 「柜台后那人把钱收下」, trial 2 wrote 「钱收了。」
- The cash never left the sheet.

**Why it matters under the ruling.** What the player was told happened, so the table now owes the quarter. But §158.2's owed kinds are `move`, `time` and `npc`, plus objects through `missing`. The review can only report the cash as a `continuity_finding`, and nothing lands it. The ledger stays a quarter richer than the fiction, permanently.

**The tension underneath.** The refusal fix (`extensions/kernel/admission.ts`, the "Only this batch is unsettled" text) asks the Keeper not to narrate a batch whose effects are the player's own stated action. The player said they put the money down. A delivery that obeys the fix has to write around the player's own sentence, and the model chose the fiction twice out of two trials. §158.6 already says a told effect is canon; the refusal text predates it.

**Options.**

1. **Add a `cash` owed kind.** The review's `owed` grows `{kind: "cash", delta, with, quote}`. The kernel projects it like the others, a clerk step `apply:owed:<name>` lands a `cash` effect with `owed`, and the `told` basis admits it. This is the same three ends as move, time and npc (writer: the review; reader: the capsule and candidates; actor: clerk or Keeper).
2. **Hold the Keeper harder to the refusal.** Change the prompt or fix text only. This is weak evidence-wise: the refusal already says it, and the model did it anyway (the same lesson as turn 23 in the parent spec).
3. **Both.** Keep the fix text for effects the player did not state, and let owed cash catch up the rest.

**Recommendation.** Option 1. It is the ruling applied to one more kind, it reuses every seam §158 built, and it does not depend on the model obeying.

**Owner decisions.**

- Is owed cash in scope?
- Should the `admission_unavailable` fix text stop forbidding the narration of the player's own stated action? Under the ruling that narration is canon, not a defect.

---

## FR-07: an owed effect bundled with other effects loses its `told` basis

Status: needs-triage

**Seen.** Live table, campaign turn 5 (driver `fr05-live-b/turn-3.json`, campaign `turns/0005.json`).

- The capsule carried `t4-owed-1` (the told arrival at `newspaper-morgue`).
- The Keeper did try to land it, in one `apply` with two other effects:

```
{"effects": [
  {"kind": "move", "to": "newspaper-morgue", "travel_minutes": 30, "owed": "t4-owed-1", …},
  {"kind": "npc", "name": "ruth-blake", "to": "here"},
  {"kind": "clue", "clue": "nailed-windows", …}]}
```

- §158.5's `told` basis admits a write only when every effect lands an owed row. This batch was therefore sent to the player-choice review, which was unavailable. The whole batch was refused `admission_unavailable`, the owed move included.
- The refusal's fix then said "do not retry it this turn", so the Keeper could not resend the owed move alone.
- The row stayed open until turn 6, where the clerk's forced step landed it (`move:newspaper-morgue-t6-c1`, `path: "told"`).

This corrects the FR-05 comment in the tickets file. Turn 5's missing catch-up was not only the forcing budget skipping the read (§135.25). The Keeper's own attempt was lost to batching.

**Why it matters.** An outage is exactly when owed state accumulates. The rule "every effect carries `owed`" is right for admission, because a mixed batch must not smuggle a player-choice effect in under `told`. But the Keeper is never told that the owed part could have landed alone.

**Options.**

1. **The refusal names the owed rows.** When a refused batch carries `owed` effects, the `admission_unavailable` (and review-refused) fix says so explicitly. It names those rows, says they can be sent alone this turn under the told basis, and says the rest of the batch stays unsettled. There is no new verb and batches stay atomic. It costs the Keeper one more call.
2. **The host splits the batch.** The owed effects are admitted and landed as their own write, and the rest goes to review. This breaks the batch's atomicity, which the kernel relies on (one call is one receipt set and one rollback unit).
3. **Leave it.** The clerk lands the row on the next turn whose read runs, as turn 6 did. The ledger lags one turn in an outage.

**Recommendation.** Option 1. It keeps atomicity, it follows the error-fix rule that the fix text is executed literally (memory: `error-fix-text-is-executed-literally`), and a test can pin it: a mixed batch refused under an outage, followed by a resend of only the owed effect in the same turn, lands the row.

**Owner decision.** Is one extra Keeper call in an outage turn acceptable, or is a one-turn lag (option 3) good enough?

---

## FR-08: a tool call written as text is delivered to the player as prose

Status: needs-triage

**Seen.** Live table, campaign turn 5. The run budget was spent at the start (`PI_COC_TURN_BUDGET_MS=1`), and the batch above had just been refused.

- Instead of calling `narrate`, the Keeper replied with a text block that was the call itself:

````
```json
{"narrate": {"text": "你把地址报清楚：东区那栋又窄又高的旧宅，从前的房主姓科比特。\n\n柜台后的妇人点了点头…"}}
```
````

- The host closed the turn on that prose-only reply through the implicit narrate (`closed_by: "narrate"`, `closed_how: "implicit"`, `extensions/kernel/index.ts`, the implicit delivery in the agent-end handler).
- The kernel rendered it verbatim, fence, braces and `\n` escapes included. That rendered text is what the player read.
- Speech attribution even ran inside the JSON (`{{say:ruth-blake}}` in `marked_text`).
- No gate refused it. Telemetry records `delivery_accepted`. The post review (the `verifier` lane) ran after the delivery, and the turn record's `warnings` is empty.

**Relation to existing work.** §144 (`prepareArguments`) unwraps tool-call dialect found inside a tool's arguments. This is the mirror case: a tool call inside the text body. The memory `embedded-narrate-placeholder-reached-player` (#22) is the same family: a new delivery shape that bypassed the gates the explicit `narrate` has.

**Options.**

1. **Recognise the dialect structurally and route it.** A prose-only reply whose whole body is one JSON object (optionally in a code fence), with a single top-level key that is a registered tool name and a value that validates against that tool's schema, is that tool call. Run it as that call and record a `lane: "delivery"` row. This is a parse against the tool registry and its schemas, not a reading of what the prose means, so it is not a semantic classifier.
2. **Refuse it and steer.** The same structural test, but the implicit delivery refuses the draft and hands back one fix: "call narrate with this text". This costs a model step, and it has no fallback when the turn's one steer is already spent (the case here).
3. **Prevention only.** Tell the Keeper in the budget-close compose to always use the tool. The same weakness as FR-06 option 2.

**Recommendation.** Option 1, with a test on the real entry point: an agent-end reply that is exactly this fenced call must deliver the inner text, and must not deliver the fence. A mutation that removes the routing must turn the test red.

**Owner decision.** Should the host execute a recognised text-body tool call (option 1), or only refuse it (option 2)? Option 1 is the only one that works when the steer is spent.

---

## FR-09: starting equipment without instances becomes standing owed object rows

Status: needs-triage

**Seen.** Live table `owed.json` after turn 6:

- Five object rows are still open.
- Four are the pregenerated investigator's starting kit: `set of lockpicks`, `flashlight`, `notebook and stub pencil`, `badge that impresses clerks more than cops`.
  - These were first reported on turn 0 (`t0-owed-1..4`).
  - They were superseded by the same four on turn 1 (`t1-owed-1..4`).
- The fifth is 「科比特宅钥匙」 (`t4-owed-3`), handed over in the fiction on turn 2 and never instanced.
- Each row's `what` is the reviewer's own instruction ("define it as an item and use object.adopt…").

**Why.** The sheet lists this kit in `equipment` with no `object_id`. `unregisteredEquipment` (`kernel-ts/read/mods.ts`) already projects it to the reviewer as `unregistered_equipment`, and the reviewer reports each item in `missing`, as it did before §158.

- Before §158 each report was a one-turn `unsettled_object` warning.
- Now §158.3 projects `missing` into persistent owed object rows.
- The clerk's owed steps cover only move, time and npc (`owedCandidates` in `runtime/jev/candidates.ts`). So nothing lands these rows unless the Keeper chooses to adopt the items.
- The rows sort last in the capsule's `owed` section, so they never displace a move. But they take budget every turn, and they are re-reported (and so renamed) whenever the reviewer lists them again.

This is the three-ends rule with a missing actor: the writer (the review) and the reader (the capsule) exist, but no automatic actor lands object rows.

**Options.**

1. **Give the clerk an owed object step.** An open object row whose item is resolvable becomes a forced `apply:owed:<name>` that registers and adopts it for its owner. This closes the three ends for objects the way §158.4 closed them for moves, and it also lands the house keys.
2. **Fix the producer.** Character creation and `campaign.create` register starting kit as instances, so `unregistered_equipment` starts empty and the reviewer has nothing to report. This does not cover things handed over during play, such as the keys.
3. **Do not project `missing` items the kernel already lists.** Skip items whose owner and name match an `unregistered_equipment` row the kernel itself produced (an echoed-handle match, not a reading of prose). This hides the noise but lands nothing.

**Recommendation.** Option 1 first; it covers both starting kit and kit acquired in play. Option 2 is worth doing on its own merits (the engine is authoritative and the sheet is its mirror), but it does not replace option 1.

**Owner decision.** Should objects join the clerk's forced owed steps? That touches object registration (queued registrations land at the next turn's start), which the other owed kinds do not.
