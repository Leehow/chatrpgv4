# SL-29A follow-up (batch-9) — pre-registered lines, written before the table opens

Table: driver.py, hybrid-v1, `PI_COC_JEV_PRESELECT=1`. **Keeper model change this batch:** grok-build has no
quota, so the Keeper is `opencode-go/deepseek-v4.1-flash` with `--thinking off` (SL-61's provider-data
correction, `content/providers/model-corrections.json`, makes `off` sendable for this model; verified below
against this worktree's own agent home before the table opens). Jev key from the App vault (never printed).
Worktree `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b9` on branch `claude/sl29a-b9-20260925`, build
`1ed666fd0` (integration `claude/integ-single-loop-20260923`, batch 9 merged on top of batch 8: SL-58
(`source_mode=prepare` lookups get the source-answer allowance, then `pending`, then a later landing — never
the full foreground `reading_timeout`), SL-59 (a batch `apply` placing several book-named persons lands each
one line by line, per §32.12.3, instead of refusing the whole batch on the first not-yet-read name), SL-60 (a
displaced read that resumes writes its own `event: "resumed"` telemetry row, not only the field buried inside
the `concurrency` row), SL-61 (the provider-data correction itself: a deepseek Keeper via opencode-go can be
told thinking off, cutting a 60-110s-median table to a low-tens-of-seconds one per long gate #10), SL-62 (a
person's name the Keeper writes or checks is resolved against the scene's known people — present, addressee
rows, the module's people — before `unknown_entity`; a clear match rewrites the target and the receipt carries
`resolved_from`), SL-63 (a run the refusal budget aborts closes through the SL-16 fallback — the held draft or
a fallback notice — instead of stranding with no delivery)).

Home `.coc/playtests/sl29a-b9/home`, copied from the read-only imported home
`chatrpgv4-wt-pdf-a/.coc/playtests/sl29-a-run2/home` (module `book-1`, 血色公路, generation 2, the same graph
batches 4-8 reused, unmodified by this copy; every stale `.lock` file found anywhere under the copied home
removed after the copy, before use — batch-8's note only mentioned `.coc/modules`, but this copy carried
locks under `.coc/locks`, `.coc/mods/jobs/*/review.lock`, `.coc/campaigns/*/setup.lock` and
`.coc/module-campaigns/*` too, all stale from the prior process that made them, all removed). A NEW campaign
will be created via the onboarding worker's `converse` action (title `血色公路`, no `.pdf` suffix), then a live
setup session will make investigator 雷·卡特 replaying batches 4-8's own recorded exchange turn-for-turn
(Private Investigator, same trade/strengths: Drive Auto his own stated strength, Spot Hidden/tracking as his
trade, weak with a gun), then the same 20-turn script (`29-book-a-b8/script.md`, copied unmodified as
`29-book-a-b9/script.md`), one sentence a turn, structural branches only (`present`/`moved`/`hurt`, read from
the turn record — never from prose). This run is measurement only: no product fixes.

**Model-change caveat, stated up front so the numbers are not compared naively against grok tables.** Batches
4-8 all ran on `grok-build/grok-4.7-build-fast` "low"; this table runs on a materially different Keeper model
and provider (`opencode-go/deepseek-v4.1-flash`, thinking off). Wall-time, model-step-count and drop-count
comparisons against batches 4-8 in this entry are reported for continuity only, not scored as regressions or
improvements attributable to the single-loop product code — a slower or faster table this batch could equally
be the model swap. Only the structural/telemetry classes (delivery, routing, admission, binding, reading,
SL-5x/6x mechanism checks) are scored as product findings the same way as before.

Confounds noted before the table opens, not scored as findings:
1. Long gate #11 (campaign `longgate11-haunting-1515`, worktree `chatrpgv4-wt-integ-sl`, pid 86736) is running
   concurrently on this Mac, **on the same provider/model** (`opencode-go/deepseek-v4.1-flash`, thinking off)
   as this table — confirmed by `ps aux` before this table opens. Its daemon will not be touched. Any
   opencode-go rate-limit or latency contention this table sees could be shared with that gate; noted here so
   it is not mis-scored as a single-loop wall-time defect specific to this table.
2. The App's `.pi/coc-agent/auth.json` `opencode-go` entry was copied from `chatrpgv4-wt-integ-sl` (present
   alongside `grok-build`, `xai`, `deepseek-extended`, `google`); `models.json` was deliberately **not**
   copied — it is the product's to write (SL-61's merge, at host preparation) into this worktree's own agent
   home, from `content/providers/model-corrections.json`, which is confirmed present in this worktree with
   the `opencode-go/deepseek-v4.1-flash` `thinkingLevelMap.off: "off"` entry before the table opens.

## Pre-table confirmation (SL-61, done before the table opens)

- `content/providers/model-corrections.json` present in this worktree with `opencode-go` →
  `deepseek-v4.1-flash` and `deepseek-v4-flash`, both `thinkingLevelMap: {"off": "off"}`.
- After the setup session (or the play table) starts, this worker will read the run's `daemon.json` and
  confirm `model_confirmed.thinkingLevelMap.off === "off"`, and will read this worktree's own
  `.pi/coc-agent/models.json` (not present before the table — the product must write it) to confirm it
  carries the `opencode-go` correction with its `$comment`-derived provenance note, per SL-61's merge rule
  (product entries under user entries, byte-for-byte untouched if a user already had one — this is a fresh
  agent home with none). Both confirmations are recorded in the ticket-29 entry, not just asserted here.

## SL-29A class lines (unchanged, carried from batch-4 through batch-8)

1. **Delivery**: 20/20 turns delivered with prose; any turn with no text is P0.
2. **Wall**: median ≤ 45 s; ≥ 80% of turns ≤ 60 s; max reported. Turns that waited on a reading are listed with
   the wait, and the line is also scored without them. (Caveat above: this line is not compared to grok
   numbers as a regression/improvement; it is scored against its own stated targets.)
3. **Routing**: a declared move to a destination the graph has is selected by the compile; for destinations
   the graph does not have yet, the turn either reads them (`material_pending` / lookup source / SL-47's index
   landing) or the Keeper narrates without inventing a move receipt to an unknown scene; compile rows on every
   run with a candidate.
4. **Admission**: no row over 12 s; clerk writes on `path: compile`; every `review_timeout` listed with its
   write.
5. **Binding**: `infer(bind)` = 0; approach defaults `jev_lead` or Jev.
6. **Looks**: ≤ 1 per turn after a scene's first visit; `lookup kind=source` counted separately (they are
   readings).
7. **Prescreen**: status per read; fallbacks with keys; no run whose decision budget is spent by the
   prescreen.
8. **Drops**: every dropped draft has a `delivery ok:false` row with a reason; no stranded turn.
9. **Fiction and rules**: the prologue's rule holds (turning back or continuing ends the same way; no check
   forced for it); people met in town come from the book, not invented stat blocks; checks the player's
   sentences call for are rolled by `resolve`; NPC speech in tokens; no push without the player's declaration.
10. **Stalls**: none; any provider `error` row listed.
11. **Reading (PDF only)**: every foreground reading has a telemetry row with purpose/focus/ms and an outcome;
    `reading_timeout` rows listed with what the Keeper did next; the graph's generation and node count after
    each turn; readings are published to the campaign's private workspace once it forks; no reading fails on
    a same-span re-transcription.

## Batch-9 lines (this run), keyed to what SL-58/59/60/61/62/63 changed

12. **SL-58 (`prepare`-mode lookups do not hold the turn).** Batch 8's own new P1 finding was three
    `lookup {kind:"source", source_mode:"prepare"}` calls each blocking exactly 120,003 ms in the foreground
    (29% of that table's wall). Success line: any `source_mode: "prepare"` lookup this table returns within
    the source-answer allowance (SL-36's ~8 s) with `status: "pending"` rather than blocking the full
    `reading_timeout`; its result is carried once on a later note when it lands. Record every
    `source_mode: "prepare"` call's `ms` and outcome; pre-registered target: zero at `120003` ms exactly (the
    old signature), any that occur return `pending` near the 8 s mark.
13. **SL-59 (a batch of npc/person effects lands line by line).** Batch 8's own new P2 finding was a batch
    `apply` naming three book NPCs at once refusing whole (22 ms, `unknown_entity`, zero receipts) when the
    turn's own carried text named all three verbatim — batch 8's worker note also flagged that the *actual*
    turn-8 shape was `material_pending`/`requireMaterial`, a related but separate mechanism not fully covered
    by this ticket's scope (`unknown_entity`/§11.5.4 only). Success line: a batch of several named persons in
    one `apply` lands each one it can (a receipt per resolvable line) and refuses only the unresolvable line(s)
    (`not_landed`, line-level) rather than refusing the whole batch. Record every multi-person `apply` this
    table: effect count, receipt count, and any refused lines with reasons — pre-registered target: receipt
    count equals resolvable-effect count, never zero when at least one effect is resolvable.
14. **SL-60 (the `resumed` telemetry row).** Batch 8 confirmed the displacement/resume *mechanism* itself works
    (a displaced read resumed and completed) but found no dedicated `event: "resumed"` row in
    `reading-telemetry.jsonl` — only a field inside the `concurrency` row. Success line: if a slot-contention
    displacement/resume happens this table, a `{lane: "reading", event: "resumed", ...}` row appears (not only
    the `concurrency` row's `resumed` field). Not expected to be exercised without 3-slot contention; record
    whether it fires and, if so, whether the dedicated row appears.
15. **SL-61 (deepseek Keeper thinking off — the whole table's own confirmation).** Success line: every provider
    call's `usage.reasoning` (or equivalent reasoning-token field) is 0; no call is stuck in a >60s thinking
    stall attributable to reasoning tokens. Record model-call wall-time p50/p90 and any call over 45 s
    (this is the ticket's own instruction, not just a class line) — compare against long gate #10's own
    p50 2.6s / p90 7.1s as a sanity check, not a pass/fail gate (different script, different table).
16. **SL-62 (a person's name is resolved before `unknown_entity`).** Success line: any `resolve`/`apply` naming
    a person the scene already knows under a different rendering (a variant of a present NPC, an addressee-row
    name) resolves via the scene-candidate fan-out and the receipt carries `resolved_from`, rather than
    refusing `unknown_entity` outright. A name matching nobody in the scene still refuses `unknown_entity`
    (that path is correct and expected). Record every `resolved_from` occurrence and every `unknown_entity`
    refusal, so a true genuinely-unknown-name refusal is not mistaken for a regression. `look` is explicitly
    out of this ticket's scope (per its Comments) — a `look npc <variant name>` refusing `unknown_entity` on
    its own is not a regression of this ticket.
17. **SL-63 (a refusal-budget abort still delivers).** Not expected to be exercised by this script under
    normal play (it needs a real refusal-budget runaway, which needs repeated same-class refusals) — watch
    for it anyway. Success line: if the refusal budget trips this table, the turn still delivers (the held
    draft or the fallback notice), never `settled_without_delivery`/stranded. Record any `reason:
    "refusal_budget"` row and the turn's own delivery outcome.

## Batch-4 through batch-8 lines (carried; still worth watching)

18. **SL-34** (move into a mapped scene lands without the map): the town's own arrival (`welcome-to-abattoir`)
    lands on first declaration, no `material_pending` on it.
19. **SL-35** (large book opening does not die in a fixed lease): no import-stage turn dies against a fixed
    lease.
20. **SL-36** (source answers do not hold the turn): `lookup kind=source source_mode=answer` returns `pending`
    within the turn, no turn blocks past the 8 s allowance on a source answer.
21. **SL-37** (a reading wait still delivers fiction): any turn waiting on a reading still delivers Keeper
    prose.
22. **SL-40** (a guard is a condition the place exists): no `refused` verdict citing a missing place the graph
    already has; ordinary checks roll a skill on 雷·卡特's own sheet, never an off-sheet skill.
23. **SL-41** (in-play reads get a book-sized lease): no `provider_refused` with `reason: budget_input_tokens`
    on any in-play `detail`/`answer` read of this book.
24. **SL-44** (prescreen fallbacks): no read's prescreen falls back with `key: source_revision`; `allowance_ms`
    equals the configured default (12000 ms) measured from its own start.
25. **SL-45** (blocking reads go first): a blocking `detail` read claims a free slot at once or displaces the
    youngest background read; no blocking read starved for its whole run.
26. **SL-47** (a move into an unread scene lands on the index's text): a move into a sub-location whose
    `detail` is not yet read lands immediately with `material: "index"`/`scene_text` carried and a `pending`
    row.
27. **SL-48** (index cites a discovered scene's own pages): confirmed live in batches 6, 7, 8 for every read
    raised, including refused ones — watch whether it holds a fifth table running.
28. **SL-49** (a review disagreement on a classification field is `contested`, not a refusal): not exercised in
    batches 6-8 (all disputes seen were fact-level).
29. **SL-51** (a person the carried source text names is accepted `from_passage`): watch again this table.
30. **SL-53** (background `index`/`skeleton` job runs under the book-sized lease): confirmed fixed in batches
    6-8 (every job got a `stage_budget` row, zero `budget_input_tokens` refusals) — watch it continues to hold
    on a fourth-successive table (now fifth, with this one).
31. **SL-54** (a displaced background read resumes under the current generation): confirmed live in batch 8
    (state-level: the job resumed and completed) but its dedicated telemetry row was missing — this is exactly
    SL-60's own target (line 14 above); watch together.
32. **SL-55** (an answer running through a publication lands or re-reads once): not exercised in batch 7, soft
    positive in batch 8 (generation advanced 2→5 with no `source_context_changed` failure, but not via a
    `finished_under`/`focus_changed` sequence specifically) — watch for any generation move.
33. **SL-52** (ask fan-out / accept-obligation yields): not expected to be exercised by this script (血色公路's
    4-node starting graph carries no obligation/accept node) — watch anyway, don't force it.
34. **SL-56** (NPC material never holds a turn): confirmed fixed in batch 8 for the table-person shape; the
    book/index-person landing-on-carried-text half was posed (finding 3, batch 8) and did not land — SL-59
    (line 13 above) is the direct follow-up to that gap; watch whether it is now closed.
35. **SL-57** (a refused detail read is retried once, then settles unusable): confirmed live end to end in
    batch 8 (the retry succeeded); the second-refusal/`unusable` half still unposed — watch again.
36. **SL-50 stage 2** (writes-are-silent; first clerk note carries `head` once per run): report this table's
    own steps/drops/turns≥3-steps counts for comparison, not as a pass/fail gate — and not compared numerically
    against grok tables per the model-change caveat above.

## Captures this batch specifically re-collects (carried from batch-5 through batch-8's own capture design)

A. **For every detail/answer/prepare/index read raised during this table**, record from the campaign fork's
   `deepen-queue.json`/`findings.json` (kept, not deleted after the table): whether it published or was
   refused, the kernel's refusal text verbatim when refused, whether it carries a `stage_budget` row (SL-53),
   whether a `displaced`/`resumed`/`finished_under`/`requeued` row appears on it (SL-54/55/57/60), and whether
   a second refusal on the same focus settles `unusable` (SL-57). New this batch: whether a `prepare`-mode
   lookup on the same focus got `pending` before a background job completed it (SL-58). Evidence path
   pre-committed to: `.coc/playtests/sl29a-b9/home/.coc/module-campaigns/<campaign-id>/modules/book-1/
   {deepen-queue.json,findings.json,module.json}` and `.coc/playtests/sl29a-b9/home/.coc/reading-telemetry.jsonl`.
B. **For every scene entered on index text (SL-47 landing)**, record which pages the index cited for it before
   and after its detail read settles (SL-48), whether those are the scene's own pages, and whether the
   Keeper's scene view ever shows `where.contested` (SL-49). Evidence path: the driver's per-turn JSON under
   `.coc/playtests/sl29ab9-<campaign>-<run-id>/turn-*.json` plus the same `deepen-queue.json`/`module.json`.
C. **For every `person`/`npc` write refused or accepted this table**, record the name, whether it appears in
   the turn's carried text, whether it is `established: "table"` versus `"passage"`/`from_passage` versus a
   book node, whether a `resolve`/check on that person waited on `reading_timeout`/`material_pending` at all
   (SL-56), whether a batch containing it landed line-by-line if refused elsewhere in the same call (SL-59),
   and whether its name was resolved against scene candidates before any refusal (SL-62, `resolved_from`).
   Count total `from_passage`, table-person registrations, pending-person rows, `resolved_from` rows, and
   `unknown_entity` refusals.
D. **Turn-by-turn**: which sub-locations were entered and on which turn (carried forward from batch-4 through
   batch-8's own table format).
E. **New this batch**: every `source_mode: "prepare"` lookup and its outcome (SL-58); every multi-person
   `apply` batch's effect/receipt/refusal counts (SL-59); every `event: "resumed"` row, dedicated or embedded
   (SL-60); `usage.reasoning` per provider call, table-wide, and any call over 45 s (SL-61); every
   `resolved_from` and `unknown_entity` row (SL-62); every `reason: "refusal_budget"` row and its turn's
   delivery outcome (SL-63).

## Stop conditions

Do not stop the table short of no-delivery / hang, per instruction. Never kill a `driver.py` daemon not
started by this worker (long gate #11, campaign `longgate11-haunting-1515`, is running concurrently in
`chatrpgv4-wt-integ-sl` on this Mac — confirmed by `ps aux` before this table opens; noted as a possible
account-contention confound, not touched). Keep the campaign fork and reading workspace after the table (do
not delete), continuing the procedural change batches 5-8 made.

Triage after the table (`29-book-a-b9/triage.py`, adapted from `29-book-a-b8/triage.py`, same columns plus
batch-9's SL-58/59/60/61/62/63 sections): every finding classed (P0 delivery/stall/import, P1 wall > 60 s
cause, P2 routing/admission/reading, P3 fiction/rules, P4 cost), one root cause per finding, evidence paths;
cross-referenced against batch-8's findings (this file's sibling `29-pdf-modules-live-tables.md` batch-8
Comments entry) — which are fixed, which remain, which are new to batch 9. The Keeper-model change (grok-build
→ opencode-go/deepseek-v4.1-flash, thinking off) is stated up front in the entry so wall/step/drop numbers are
not compared naively against grok tables.
