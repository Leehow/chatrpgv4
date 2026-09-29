# Forward-only reconciliation: what the player was told is canon

Status: proposed; owner ruling recorded 2026-09-29; nothing implemented. Tickets: [forward-only-reconciliation-tickets.md](forward-only-reconciliation-tickets.md).
Date: 2026-09-29
Baseline inspected: 0.9.6a at beafa3019; evidence from the installed App at ce1fa4138.
Related contract: §130.4 (continuity verdicts point forward), §135.2 (candidates come from real state), §135 budget (deferred candidates), §36.14 (continuity audit), §32 (admission).

## Owner ruling (2026-09-29, verbatim)

> KP 崩坏时账和故事分叉这个可以单独立项，但是肯定不能纠正啊！trpg本来就是一个只能向前开不能回头的车！除非玩家抬杠（强行要求），不然不要认错，就直接编剧情把逻辑圆回来

Read as design law:

1. **Delivered prose is the past.** What the player was told happened, happened. It is not rewritten, retracted or contradicted later.
2. **The ledger follows the fiction forward.** When the ledger (scene, clock, possessions, who is present, …) disagrees with what the player was told, the fix is to land the missing state as something that already happened, then carry on from there.
3. **No confession.** The Keeper does not tell the player the table made a mistake, does not narrate a correction, and does not step out of the fiction to explain. It improvises whatever makes the logic hold.
4. **The one exception is the player.** When the player explicitly disputes what happened and asks for it to be otherwise (抬杠), that is the player's choice, and the Keeper follows it.

## Problem

Installed App, campaign `game-5d82fd23-6c33-4efc-b8ef-bb65ccadf046` (Dust to Dust), turns 25–28:

- **Turn 26.** The player drives to Martin's Beach and goes straight to the Poe Street cemetery. The main model's first call hangs 60 s (provider outage). The Keeper spends its one write on re-registering a newspaper it already owns (`define` + `object`), which fails validation (`effects.1.to` missing). The run budget is spent (83 s of 45 s); the budget compose says close the turn with prose and leave further bookkeeping for the next turn. The Keeper narrates the arrival at the Poe Street cemetery. **No move and no time landed.** The ledger still has the investigator at the Arkham newsstand.
- **The divergence was detected.** Turn 26's post continuity review wrote: 「候选草稿把马丁滩波街公墓写成玩家已经抵达…没有任何已结算的移动凭证…属于未结算的位移」. It became a `continuity_finding` row whose kernel fix reads *"Already delivered: do not rewrite it. Let the next delivery avoid the same problem."* That fix treats the prose as the defect. Nobody is told that the ledger owes an arrival.
- **Turn 27.** The player kneels by the open grave. The single-loop clerk builds candidates from the ledger's position (§135.2: real state), binds `apply:move:arkham-church-cemetery` (a visited cemetery reachable from the newsstand), and lands a clue there. The Keeper's own thinking says *"The player is at the wrong cemetery… Turn 26 has a continuity error"*, and then narrates along with the ledger: 「昨夜盗走的，是马丁·海沃森的遗体」. The ledger overwrote what the player had been told. That is exactly backwards under the ruling.
- **Turn 28.** The player disputes it (「等等，我刚才明明是开车到了马丁滩的波街公墓…」). This is the ruling's exception, and the Keeper handled it well: it wrote a continuity note, moved the investigator to Martin's Beach, and continued from 「你从波街那头的栏外上车」 without apologising. But the player should never have had to do that.

The same family also appeared on turn 23 in a different shape: the Keeper told the player 「桌边这边暂时接不上账目与收付」 after an admission outage. That is a confession of a service failure inside the fiction, which the refusal's own text had forbidden.

## Where the product points the wrong way

| Seam | Today | Under the ruling |
| --- | --- | --- |
| Post continuity review → `table.warn` (§130.4) | `unsettled_object` already says "register it with an ordinary apply". Everything else unsettled is a free-text `continuity_finding` whose fix is "avoid the same problem". | Unsettled state of every kind gets the `unsettled_object` treatment: a structured owed effect, with a forward fix saying to land it as already happened. |
| Budget close (§135 budget) | Only the clerk's own deferred steps are carried, as a session-memory note (`deferred_last_turn`) that a restart loses. The Keeper's failed or unsent writes are not carried at all. | What the delivered prose established and no receipt carries is owed state, in the world, surviving restart. |
| Next run's candidates (§135.2) | Built from the ledger only, so a clerk move is bound against the stale position. | Owed state comes first. Candidates are built from the told position, and a clerk step never lands a move that contradicts an open owed position. |
| Keeper | Knows about the finding (capsule warnings) and still sides with the ledger. | The told fiction wins for the past. The ledger is brought forward; nothing is narrated as a correction. |
| Admission (§32) | An owed move would be judged on player consent. | An owed effect is judged on whether the delivered text established it: "was this told", not "did the player choose it". |

## Decisions

- **Detection stays semantic and stays where it already works.** The post continuity review is an LLM lane that already caught turn 26. No regex, keyword or table decides what the prose established.
- **Owed state is state, not a note.** It lives in the campaign world (and the turn record), survives restart, is cleared only by a receipt that lands it, and is visible to the Keeper and the clerk.
- **Owed effects land through the ordinary tools.** There is no new verb. `apply` lands the move, time or object as a consequence of what was told, under an admission basis `told`.
- **Prevention is secondary.** Outages, validation failures and budget closes will keep happening. Making the budget close narrate less is worth doing, but the product has to reconcile forward whatever the cause.
- **Three ends (Agents.md, §31).** *Writer:* the post continuity review, which emits owed effects, and the kernel, which records them. *Reader:* the capsule, the clerk's candidate builder, and admission. *Actor:* the Keeper or the clerk, whose ordinary `apply` lands them and clears the row.

## Out of scope

- Rewriting delivered turns, rewinding, or worldline tools as a repair for divergence.
- Service-failure notices the host itself shows outside the fiction (the provider-outage row). These are host UI, not the Keeper confessing.
- SL-104 (admission line isolation), which caused the turn-25 refusal upstream. It is tracked separately.

## Further notes

- The turn-23 in-fiction confession is in this family. Ticket FR-04 covers the Keeper's wording; the refusal text already forbids it, and the fact that the model still did it is the evidence that wording alone is not enough.
- Turn 28 is the reference for the exception path: the player disputed, and the Keeper moved forward without apologising.
