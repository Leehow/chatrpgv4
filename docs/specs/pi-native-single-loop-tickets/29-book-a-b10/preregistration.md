# SL-29A follow-up (batch-10) — pre-registered lines, written before the table opens

Table: driver.py, hybrid-v1, `PI_COC_JEV_PRESELECT=1`, zh-Hans. Keeper: `opencode-go/deepseek-v4.1-flash` with
`--thinking off` (unchanged from batch 9; SL-61's provider-data correction, `content/providers/
model-corrections.json`, confirmed present in this worktree before the table opens — see below). Jev key from
the App vault (never printed). Worktree `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b10` on branch
`claude/sl29a-b10-20260925`, build `9c63c2bd6` (integration `claude/integ-single-loop-20260923`, batch 9 plus
SL-64 merged on top: **a campaign mints as many table persons as the Keeper introduces; existing table persons
are SL-62 resolution candidates only, never a bar to minting** — the direct fix for batch-9's own new P1
finding, "once one table-established NPC exists, every subsequent brand-new name refuses `unknown_entity`
instead of minting").

Home `.coc/playtests/sl29a-b10/home`, copied from the read-only imported home `chatrpgv4-wt-pdf-a/.coc/
playtests/sl29-a-run2/home` (module `book-1`, 血色公路, generation 2, the same graph batches 4-9 reused,
unmodified by this copy). Every stale `.lock` file found anywhere under the copied home was removed before use
(35 found: `.coc/locks`, `.coc/modules/{.registry.lock,book-1/*.lock}`, `.coc/campaigns/*/setup.lock`,
`.coc/mods/jobs/*/review.lock`, `.coc/module-campaigns/*/modules/{.seed-book-1.lock,book-1/*.lock}` — the same
categories batch-9 found, same root cause: each prior batch's own process left its locks behind in this shared
read-only source). A NEW campaign will be created via the onboarding worker's `converse` action (title
`血色公路`, no `.pdf` suffix; `module_id: book-1`; `start_scene: scene-prologue` and
`guidance_key: d333f1696b5ad89dee941f694408ee4f45c637c1e0a56c1946467b5048ca097b`, both read from the copied
module's own `module.json` — `opening.start_scene` and `reading.completed.read-1.guidance_key`), then a live
setup session will make investigator 雷·卡特 (or whatever this Keeper renders the name as — batch-9's own
setup truncated it to 雷·卡; recorded, not scored) replaying batches 4-9's own recorded exchange turn-for-turn
(Private Investigator, same trade/strengths: Drive Auto his own stated strength, Spot Hidden/tracking as his
trade, weak with a gun), then the same 20-turn script (`29-book-a-b9/script.md`, copied unmodified as
`29-book-a-b10/script.md`), one sentence a turn, structural branches only (`present`/`moved`/`hurt`, read from
the turn record — never from prose). This run is measurement only: no product fixes.

Confounds checked before the table opens: `ps aux` shows no other `driver.py`, `pi-coc`, or opencode-go/
deepseek-v4.1-flash process running on this Mac at table-open time — no shared-account contention noted (unlike
batch-9, which had a concurrent long-gate #11 on the same provider/model).

`.pi/coc-agent/{auth.json,pipiui-settings.json,grok-build-models.json,models-store.json}` copied from
`chatrpgv4-wt-integ-sl`; `models.json` deliberately **not** copied — it is the product's to write at host
preparation (SL-61's merge rule), confirmed below.

## Pre-table confirmation (SL-61, done before the table opens)

- `content/providers/model-corrections.json` present in this worktree with `providers.opencode-go.
  modelOverrides["deepseek-v4.1-flash"].thinkingLevelMap: {"off": "off"}` (and the same for
  `deepseek-v4-flash`) — confirmed by direct read before the table opens.
- After the setup session (or the play table) starts, this worker will read the run's `daemon.json` and
  confirm `model_confirmed.thinkingLevelMap.off === "off"`, and will read this worktree's own
  `.pi/coc-agent/models.json` (not present before the table — the product must write it) to confirm it carries
  the `opencode-go` correction with its `$comment`-derived provenance note. Both confirmations will be recorded
  in the ticket-29 entry, not just asserted here.

## SL-29A class lines (unchanged, carried from batch-4 through batch-9)

1. **Delivery**: 20/20 turns delivered with prose; any turn with no text is P0.
2. **Wall**: median ≤ 45 s; ≥ 80% of turns ≤ 60 s; max reported. Turns that waited on a reading are listed with
   the wait, and the line is also scored without them. Not compared numerically to grok-model tables (batches
   4-8); comparable in shape to batch-9's own deepseek/thinking-off numbers.
3. **Routing**: a declared move to a destination the graph has is selected by the compile; for destinations the
   graph does not have yet, the turn either reads them (`material_pending` / lookup source / SL-47's index
   landing) or the Keeper narrates without inventing a move receipt to an unknown scene; compile rows on every
   run with a candidate.
4. **Admission**: no row over 12 s; clerk writes on `path: compile`; every `review_timeout` listed with its
   write.
5. **Binding**: `infer(bind)` = 0; approach defaults `jev_lead` or Jev.
6. **Looks**: ≤ 1 per turn after a scene's first visit; `lookup kind=source` counted separately (they are
   readings).
7. **Prescreen**: status per read; fallbacks with keys; no run whose decision budget is spent by the prescreen.
8. **Drops**: every dropped draft has a `delivery ok:false` row with a reason; no stranded turn.
9. **Fiction and rules**: the prologue's rule holds (turning back or continuing ends the same way; no check
   forced for it); people met in town come from the book, not invented stat blocks; checks the player's
   sentences call for are rolled by `resolve`; NPC speech in tokens; no push without the player's declaration.
10. **Stalls**: none; any provider `error` row listed.
11. **Reading (PDF only)**: every foreground reading has a telemetry row with purpose/focus/ms and an outcome;
    `reading_timeout` rows listed with what the Keeper did next; the graph's generation and node count after
    each turn; readings are published to the campaign's private workspace once it forks; no reading fails on a
    same-span re-transcription.

## Batch-9 carried lines (SL-58/59/60/61/62/63) — watch again, not the primary target this batch

12. **SL-58** (`prepare`-mode lookups do not hold the turn): confirmed fixed live in batch 9 (3/3 `pending`
    near the 8s allowance, no `120003ms` block) — watch it continues to hold.
13. **SL-59** (a batch of npc/person effects lands line by line): confirmed fixed for its stated scope in
    batch 9 (t11: 卡尔 landed, 霍默 isolated `not_landed`) — now that SL-64 lets a second table person mint,
    watch whether a batch naming two *new* people (not one new + one already-established) also lands both.
14. **SL-60** (the dedicated `resumed` telemetry row): not exercised in batch 9 (6 displacements, 0 resumes
    before the daemon stopped) — watch again; not expected to be forced by this script.
15. **SL-61** (deepseek Keeper thinking off): confirmed fixed live in batch 9 — watch it continues to hold a
    second table on this model. Record model-call wall p50/p90 and any call over 45s; compare against batch-9's
    own p50 3.4s/p90 7.6s as a sanity check, not a pass/fail gate.
16. **SL-62** (a person's name resolved before `unknown_entity`): not exercised in batch 9 (every refusal named
    a genuinely different person). With SL-64 now minting a second person, and this table's own script asking
    about several distinct people (attendant, shopkeeper, shop-girl, bar owner, diner patrons) by different
    phrasings across turns, this batch has a real chance to exercise a variant-name match against *either*
    established table person (卡尔, and whichever second person SL-64 lets mint) — record every `resolved_from`
    row and every genuine `unknown_entity` refusal.
17. **SL-63** (a refusal-budget abort still delivers): batch 9 saw the ordinary three-strikes block (not the
    runaway-abort path) trip twice, both turns still delivered. If SL-64 removes the root cause of those trips
    (the mint refusal), this batch may see fewer or zero refusal-budget rows — record whatever occurs, don't
    force it.

## SL-64 (this batch's primary target): a campaign mints as many table persons as the Keeper introduces

Batch-9's own new P1 finding, reproduced five times on one table (t11, t14, t15, t17, t18): once one table
person exists (卡尔, minted at t11), every subsequent brand-new (book-absent) name the Keeper tried to
introduce (霍默, 马瑟, 店里的姑娘, 柜台后梳发油的男人 — a gas-station attendant, a shopkeeper, his shop-girl, a
bar owner) refused `unknown_entity` with `candidates: ["卡尔"]`, because `module-graph.ts`'s `candidates()`
unconditionally appended the whole table roster to any npc-kind query and `entities.ts`'s `personOfEffect`
read a non-empty candidate list as "refuse, offer these" rather than "nothing matches, mint." SL-64's fix
(`8bf96d62`, `candidates()` gains `{roster:false}` for the minting gate's own check, so it asks only the
book/graph's own ranking, never this table's established people) is now merged into this batch's build.

**Success line, pre-registered before the table opens:** every distinct table person the Keeper introduces
this batch mints its own `npc-ledger.json` entry and its own `establishPerson`/`world.table_people[]` receipt
— not just the first one. Concretely:
- Count `.coc/campaigns/<campaign>/npc-ledger.json` entries at the end of the table. Batch-9's own ledger (same
  script, same book, pre-SL-64) held exactly **one** entry for the whole campaign despite the Keeper trying at
  least four more distinct people across nine attempts. This batch's target: **more than one entry**, ideally
  one per genuinely distinct person the Keeper actually introduces (the exact count depends on how many
  distinct people this run's Keeper tries to name, which cannot be fixed in advance — the script's sentences
  are identical to batch-9's, but a different live conversation may introduce people in a different order or
  count).
- Zero `unknown_entity` refusals whose *cause* is "this name isn't 卡尔 [or any other already-minted table
  person], so the table roster blocked it" — i.e., a name that is genuinely new to both the book and the table
  should mint, not refuse. A name that collides with an *existing* candidate (a variant spelling of 卡尔, or of
  a second minted person) may still legitimately resolve via SL-62 or refuse if truly ambiguous — that is a
  different, acceptable outcome, not a SL-64 regression.
- Record, per multi-person `apply`/`resolve` this table: every name attempted, whether it minted (new
  `npc-table-*` receipt), resolved to an existing person (`resolved_from`), or refused `unknown_entity` — and
  for every refusal, whether the candidate list offered was the *book's own* ranking (legitimate) or the
  *table roster* dragged in regardless of relevance (the batch-9 defect shape; should not recur post-fix).

Evidence path pre-committed to: `.coc/playtests/sl29a-b10/home/.coc/campaigns/<campaign>/npc-ledger.json`;
`.coc/playtests/<run-id>/turn-*.json` (`tools[].name in ("apply","resolve")`, `result_text`/`not_landed`
carrying `unknown_entity`/`candidates`); `docs/kernel-rpc.md` §11.5.7 (the ticket's own contract addendum).

## Captures this batch specifically re-collects (carried from batch-5 through batch-9's own capture design)

A. **For every detail/answer/prepare/index read raised during this table**, record from the campaign fork's
   `deepen-queue.json`/`findings.json` (kept, not deleted after the table): whether it published or was
   refused, the kernel's refusal text verbatim when refused, whether it carries a `stage_budget` row (SL-53),
   whether a `displaced`/`resumed`/`finished_under`/`requeued` row appears on it (SL-54/55/57/60), and whether
   a second refusal on the same focus settles `unusable` (SL-57). Whether a `prepare`-mode lookup on the same
   focus got `pending` before a background job completed it (SL-58).
B. **For every scene entered on index text (SL-47 landing)**, record which pages the index cited for it before
   and after its detail read settles (SL-48), whether those are the scene's own pages, and whether the
   Keeper's scene view ever shows `where.contested` (SL-49).
C. **For every `person`/`npc` write refused or accepted this table**, record the name, whether it appears in
   the turn's carried text, whether it is `established: "table"` versus `"passage"`/`from_passage` versus a
   book node, whether a `resolve`/check on that person waited on `reading_timeout`/`material_pending` at all
   (SL-56), whether a batch containing it landed line-by-line if refused elsewhere in the same call (SL-59),
   whether its name was resolved against scene candidates before any refusal (SL-62, `resolved_from`), and —
   new this batch — whether it minted its own table person distinct from any already established (SL-64).
   Count total `from_passage`, table-person registrations (and their count, the SL-64 headline number),
   pending-person rows, `resolved_from` rows, and `unknown_entity` refusals.
D. **Turn-by-turn**: which sub-locations were entered and on which turn (carried forward from batch-4 through
   batch-9's own table format).
E. **SL-64 specifically**: every distinct name the Keeper attempts to establish as a table person, in order,
   with the outcome (minted / resolved-existing / refused) and, for every refusal, the exact `candidates` list
   returned, so a legitimate book-ranking refusal can be told apart from a stale table-roster block.

## Stop conditions

Do not stop the table short of no-delivery / hang, per instruction. This worker starts its own `driver.py`
daemons only; if any other worktree's daemon is found running, it is confound-noted and never touched. Keep
the campaign fork and reading workspace after the table (do not delete), continuing the procedural change
batches 5-9 made.

Triage after the table (`29-book-a-b10/triage.py`, adapted from `29-book-a-b9/triage.py`, same columns plus a
new SL-64 section: `npc-ledger.json` entry count, every mint/resolve/refuse row for a person name, and a check
for any `unknown_entity` refusal whose candidate list is the stale table roster rather than the book's own
ranking): every finding classed (P0 delivery/stall/import, P1 wall > 60 s cause, P2 routing/admission/reading,
P3 fiction/rules, P4 cost), one root cause per finding, evidence paths; cross-referenced against batch-9's
findings (this file's sibling `29-pdf-modules-live-tables.md` batch-9 Comments entry) — which are fixed, which
remain, which are new to batch 10.
