# The table stands where the story is

Status: proposed (owner 2026-10-07, 「两个一起开 spec，按你推荐的来」; this spec records the lead's recommended design; implementation waits for the owner's word)
Date: 2026-10-07
Baseline: `claude/reading-delivery-20261006` at `8a02972ea`. Spec branch: `claude/scene-told-specs-20261007`.
Contract: §190 of `docs/kernel-rpc.md` (written with this spec). Amends §158 (gives owed moves a producer again), §166 (one
owner-authorized exception: a post-delivery read of position that changes no prose), §143.15 (one retry for a transient
provider failure of the admission lane), §148/§22.4.7 (when a reference book's places exist).
Tickets: `docs/specs/told-position-tickets.md`.
Companion: `docs/specs/scene-reading.md` (§189) reads the places this spec makes exist.

## Problem Statement

On RD-08 (Blood Road, 20 real turns, `rd-accept-blood-01-play`) the Keeper narrated the gas station on turn 2, the town on
turn 7 and the motel on turns 8–10, while the ledger kept the party in the prologue (`source-entry-16`) until turn 11.
What that cost the table: the book seats three men under the station's awning, the capsule's `present` was empty because
the party was "in the prologue", and on turns 2–3 the Keeper told the player there was nobody there; the people the
player came to question appeared only on turn 6, after the Keeper looked the book up itself. The player's view and the
table's state disagreed for ten turns, and nothing ever noticed.

Four causes, read from the turn records, the driver's tool calls and the campaign telemetry:

1. **§158 has no producer any more.** §158 (2026-09-29, owner: 「TRPG 只能向前开」) made the ledger follow what the
   player was told: a post-delivery continuity review names an owed move, `owed.json` records it, and the clerk lands it
   first on the next run. §166 (2026-10-01, single-pass narration) stopped every automatic post-delivery reviewer
   (`SINGLE_PASS_NARRATION`, `kernel-ts/runtime/narration-policy.ts`; `afterDeliveryReview` runs only with a prepared
   review, which is never prepared). The consumers — `owed.json`, the capsule's `owed`, the clerk's `apply:owed:*`
   candidates, the `told` admission basis — all remain. On RD-08 there is no `owed.json` and no continuity-review row.
   §166 retired prose review and repair; it did not decide to stop the ledger following the story, and nothing replaced
   that half (a §31 three-ends break).
2. **A reference book's places do not exist until someone asks to go there.** `scene-source-place-*` identities are minted
   on demand for a named destination (`runtime/jev/source-reference.ts`). On turn 2 the station was not in the graph, the
   prologue had no exits, and the `apply` candidates held no move at all. The station arrived with background unit 17–18
   at 05:37; play began at 05:34.
3. **One transient provider error refuses a move for the whole turn.** Turn 7's `apply move` to the station failed
   admission with `reason: model_error` after 524 ms and one attempt; §143.15 retries only a malformed answer. The
   refusal tells the Keeper not to retry and not to narrate the move; the Keeper narrated the drive into town anyway. The
   admission row carries no failure detail, so the cause cannot be read afterwards.
4. **So the minted places float.** Turns 11 and 19 minted 警长办公室 and 旅馆外的街道 from the prologue: §187 gave them a way
   back, but the way back led to the prologue, and the placement lane placed them inside the town that the party was never
   recorded as having entered.

**The hollow delivery to avoid:** a prompt sentence telling the Keeper to call `move` (it already had one for the station on
turn 7 and was refused); reading prose with patterns; correcting or retracting what the player was told (§158.6 stands:
the ledger moves forward to the story, never the reverse).

## Solution

**TP-01 The window's places exist before they are read (§190.1).** At table open and whenever the §182 window changes, the
reading service asks Jev, one Noul per flattened bookmark entry inside the window ("is this heading a place the
investigators can be at"; heading text and its page's first lines as state; bar in data), and mints an identity-only place
scene for each entry that clears it, through the existing `publishReferencePlace` (one page, excerpt, no model reading).
These are the referenced move candidates `apply-operation` already offers, the placement candidates of §187.2.3 and the
told-position candidates of TP-02. A move into one lands on the book's text (§22.4.7), and §189 S4 reads its section next.

**TP-02 The ledger follows the told position (§190.2).** After every delivery (an explicit or implicit close), a host lane
(family `told-position`, Jev, the §12.5 pattern) reads the delivered text against host-enumerated candidates: the active
scene, its exits, `back` and `within`, the window's place identities, the table's established places, and `none`. One
fanned-out request: a Noul `moved` (at the end of the text the investigators are somewhere other than the active scene), a
Choice `place` over the candidates, and a Choice `sentence` over the delivered sentences (split structurally at Unicode
sentence terminators, at most 24) for the quote. When `moved`, the place's confidence and the sentence's confidence clear
their bars (data), the chosen place is not the active scene, and no move landed in that turn, the host calls a new kernel
method `table.owe` with `{kind: "move", to, quote}`; the kernel writes the owed row through §158.3's own projection
(anchor, resolve, record, warnings), and §158.4's clerk lands it first on the next run, with the people the book seats
there offered by §187.3. Nothing reads prose with patterns, nothing edits or reviews the prose, and a place outside the
candidates is not owed (it is the Keeper's to mint). Ships `shadow` (rows written, nothing owed) until the owner turns it on
after the rows are read, as §187.2.3 did.

**TP-03 A transient provider failure is asked again once (§190.3).** The admission lane retries a provider failure whose
HTTP status is 429 or 5xx, or whose transport ended before a response (connection reset, stream closed before the first
byte), once, after `admission.transient_retry_ms` (data, shipped 1500), inside the round's existing deadline. A missing
model, an auth failure, a timeout and a verdict are not retried (§143.15 unchanged for them). The admission row carries the
lane's failure `detail` (status, provider message clipped to 200 bytes) so every refusal's cause is readable. A refusal
that still happens is recorded on the turn record as `refused_moves: [{to, reason}]`, which TP-02 reads: a move the
Keeper tried, was refused and then narrated is still owed.

## Success, pre-registered (TP-05)

Rerun the RD-08 script (`scratchpad/rd08-full.sh`: the five setup lines and the same 20 player lines) in a fresh home on
the merged head with TP-01..03 on and `told-position` on. Before reading any ledger, the lead labels each delivered turn's
told position from the transcript alone (written to the run directory first). Measures:

- **agreement**: turns where the ledger's active scene at the start of the next turn equals the labelled position; bar
  ≥ 17 of 20. The RD-08 transcript is labelled the same way first and is the control; its count is recorded
  before TP-05 runs, not estimated;
- **arrival people**: on every turn the party is labelled at a book place that seats people, those people are offered
  (`source_presence`) or present by the next turn; bar: every such turn;
- **no retraction**: zero deliveries that contradict an earlier delivery's told position (read by the lead);
- **cost**: told-position Jev input per turn and wall time after delivery (recorded, no bar).

## Out of Scope

- Prose review or rewriting of any kind (§166 stands for everything except the read in TP-02).
- Owed time, owed people and owed objects (§158's other kinds); only the position gets a producer here.
- The two-epithet rendering on RD-08 turn 13 (belongs to `names-in-the-request-rename.md`).

## Comments
