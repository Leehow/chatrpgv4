# SL-29A follow-up (batch-11) — pre-registered lines, written before the table opens

Table: driver.py, hybrid-v1, `PI_COC_JEV_PRESELECT=1`, zh-Hans. Keeper: `opencode-go/deepseek-v4.1-flash` with
`--thinking off` (unchanged from batch 10; SL-61's provider-data correction, `content/providers/
model-corrections.json`, confirmed present in this worktree before the table opens — see below). Jev key from
the App vault (never printed). Worktree `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b11` on branch
`claude/sl29a-b11-20260925`, build `a9d8f9619` (integration `claude/integ-single-loop-20260923`, batch 10 plus
SL-65/SL-66/SL-67 merged on top):

- **SL-65** — the reading lease's input-token floor now scales with the reader's own context window,
  `max(4,000,000, 8 × contextWindow)`, never lower than the fixed 4,000,000 default. Direct fix for batch-10's
  own new P2 finding (5 `budget_input_tokens` refusals across 3 background jobs, fork stuck at generation 2 —
  the reader's actual 1,000,000-token window meant the old fixed 4,000,000 floor was only 4 reservations, not
  the intended 8).
- **SL-66** — a selected investigator name stops at the word boundary: leading/trailing Unicode
  punctuation/space (category `\p{P}`/`\p{Z}`, not a character list) is trimmed from a `profile.name` range
  selection before the card is stamped. Direct fix for batch-10's own new P3 finding (the setup sentence's
  trailing full-width comma was baked into the investigator's stored name, `"雷·卡特，"`, and echoed into
  prose on turns 3/9/10).
- **SL-67** — SL-62's name-resolution candidate set now includes the campaign's whole established roster
  (`table.look {focus:"scene"}`'s new `roster` field), not just the present scene's own people; presence
  decides what a check can *target*, not whether a name *resolves*. Direct fix for batch-10's own SL-62 partial
  miss (t14: three shortened names of already-established persons — 拉斯/内特/史蒂夫 — refused
  `unknown_entity` instead of resolving, because the three were established but no longer present in the
  party's current scene).

Home `.coc/playtests/sl29a-b11/home`, copied from the read-only imported home `chatrpgv4-wt-pdf-a/.coc/
playtests/sl29-a-run2/home` (module `book-1`, 血色公路, generation 2, the same graph batches 4-10 reused,
unmodified by this copy). Every stale `.lock` file found anywhere under the copied home was removed before use
(37 found: `.coc/locks`, `.coc/modules/{.registry.lock,book-1/*.lock}`, `.coc/campaigns/*/setup.lock`,
`.coc/mods/jobs/*/review.lock`, `.coc/module-campaigns/*/modules/{.seed-book-1.lock,book-1/*.lock}` — the same
categories every prior batch found, same root cause: each prior batch's own process left its locks behind in
this shared read-only source). A NEW campaign will be created via the onboarding worker's `converse` action
(title `血色公路`, no `.pdf` suffix; `module_id: book-1`; `start_scene: scene-prologue` and
`guidance_key: d333f1696b5ad89dee941f694408ee4f45c637c1e0a56c1946467b5048ca097b`, both read from the copied
module's own `module.json` — `opening.start_scene` and `reading.completed.read-1.guidance_key`, confirmed
identical to batch-10's own values since the same source book was copied unmodified), then a live setup
session will make investigator 雷·卡特 replaying batch-10's own recorded 5-turn setup exchange turn-for-turn
(read from `chatrpgv4-wt-sl29a-b10`'s own `turn-{1..5}.json`, the same Private Investigator identity/backstory
— Drive Auto his own stated strength, Spot Hidden/tracking as his trade, weak with a gun), then the same
20-turn script (`29-book-a-b10/script.md`, copied unmodified as `29-book-a-b11/script.md`), one sentence a
turn, structural branches only (`present`/`moved`/`hurt`, read from the turn record — never from prose). This
run is measurement only: no product fixes.

Confounds checked before the table opens: `ps aux` shows no other `driver.py`, `pi-coc`, or opencode-go/
deepseek-v4.1-flash process running on this Mac at table-open time.

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

## SL-29A class lines (unchanged, carried from batch-4 through batch-10)

1. **Delivery**: 20/20 turns delivered with prose; any turn with no text is P0.
2. **Wall**: median ≤ 45 s; ≥ 80% of turns ≤ 60 s; max reported. Turns that waited on a reading are listed with
   the wait, and the line is also scored without them. Not compared numerically to grok-model tables (batches
   4-8); comparable in shape to batches 9-10's own deepseek/thinking-off numbers.
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

## Batch-9/10 carried lines (SL-58/59/60/61/62/63/64) — watch again, not the primary target this batch

12. **SL-58** (`prepare`-mode lookups do not hold the turn): confirmed fixed live in batches 9-10 — watch it
    continues to hold.
13. **SL-59** (a batch of npc/person effects lands line by line): confirmed fixed in batches 9-10 — watch it
    continues to hold, now with SL-67 potentially letting more multi-person batches resolve fully instead of
    partially refusing.
14. **SL-60** (the dedicated `resumed` telemetry row): not exercised in batches 9-10 (no displacement/resume
    forced by the script) — watch again; not expected to be forced by this script.
15. **SL-61** (deepseek Keeper thinking off): confirmed fixed live in batches 9-10 — watch it continues to hold
    a third table on this model. Record model-call wall p50/p90 and any call over 45s; compare against
    batch-10's own p50 4987ms/p90 9045.5ms as a sanity check, not a pass/fail gate.
16. **SL-62** (a person's name resolved before `unknown_entity`): batch-10 found a partial miss (shortened
    names of persons established but not present refused instead of resolving) — this is exactly SL-67's
    target; watch whether the same shortened-name shape (拉斯/内特/史蒂夫 or whichever names this table's
    Keeper uses) now resolves via the roster.
17. **SL-63** (a refusal-budget abort still delivers): batch-10 saw zero `refusal_budget` rows (plausibly
    downstream of SL-64 removing the mint-refusal loop) — record whatever occurs, don't force it.
18. **SL-64** (a campaign mints as many table persons as the Keeper introduces): confirmed fixed live in
    batch-10 (`npc-ledger.json`: 4 entries with 3 table persons already established before the 4th genuinely
    new name minted) — watch it continues to hold on this table's own cast of names.

## SL-65/66/67 (this batch's primary targets)

### SL-65 — the reading lease's input-token floor scales with the reader's context window

**Success line, pre-registered before the table opens:** zero `budget_input_tokens` refusals across every
background/foreground reading job this table raises (batch-10 had 5, across `read-1`/`read-2`/`read-4`, fork
stuck at generation 2). Record, per read raised: job id, purpose, `stage_budget` telemetry row (`ceiling`,
`floor`, `contextWindow` if present), whether it published or refused, and the reader model's own context
window (read from `models-store.json` or the `stage_budget` row itself) so the floor's arithmetic
(`max(4,000,000, 8×contextWindow)`) can be checked against the actual ceiling used. If the fork advances past
generation 2 this table (unlike batch-10, which stayed at 2), record the new generation directory.

### SL-66 — a selected name stops at the word boundary

**Success line, pre-registered before the table opens:** the confirmed investigator card's `name` field (and
every echo of it into prose) carries no trailing or leading punctuation — specifically, if this table's live
setup transcript happens to place a comma or other punctuation mark immediately after the stated name (as
batch-10's own setup sentence did), the trimmed name lands clean. Record the exact `profile.name` value from
`party/investigator.json`, the setup turn's `create-investigator` args (`source`/`range`), and every turn
whose `narrate` prose contains the investigator's name, checked for trailing punctuation.

### SL-67 — a shortened name of an established person resolves regardless of current presence

**Success line, pre-registered before the table opens:** any shortened/variant name of a person the campaign
has already established (via `from_passage` or a table mint) resolves via `resolved_from`, even when that
person is not present in the party's current scene — the same shape batch-10 failed (t14's 拉斯/内特/史蒂夫).
Record every `apply`/`resolve` call naming a person, whether shortened or full, whether it resolved
(`resolved_from`) or refused (`unknown_entity`, with `candidates`), and cross-reference against
`table.look {focus:"scene"}`'s own `present`/`roster` fields for that turn to confirm the resolved/refused
name's establishment status. Per ticket 67's own live-Jev finding (not every shortened name necessarily
clears the row — `拉斯` alone did not, live, three times, purely on ambiguity grounds, not availability —
report the actual live outcome honestly rather than assuming every shortened name must resolve).

## Captures this batch specifically re-collects (carried from batch-5 through batch-10's own capture design)

A. **For every detail/answer/prepare/index read raised during this table**, record from the campaign fork's
   `deepen-queue.json`/`findings.json` (kept, not deleted after the table): whether it published or was
   refused, the kernel's refusal text verbatim when refused, whether it carries a `stage_budget` row (SL-53/
   SL-65) and that row's `ceiling`/`contextWindow`, whether a `displaced`/`resumed`/`finished_under`/
   `requeued` row appears on it (SL-54/55/57/60), and whether a second refusal on the same focus settles
   `unusable` (SL-57). Whether a `prepare`-mode lookup on the same focus got `pending` before a background job
   completed it (SL-58).
B. **For every scene entered on index text (SL-47 landing)**, record which pages the index cited for it before
   and after its detail read settles (SL-48), whether those are the scene's own pages, and whether the
   Keeper's scene view ever shows `where.contested` (SL-49).
C. **For every `person`/`npc` write refused or accepted this table**, record the name, whether it appears in
   the turn's carried text, whether it is `established: "table"` versus `"passage"`/`from_passage` versus a
   book node, whether a `resolve`/check on that person waited on `reading_timeout`/`material_pending` at all
   (SL-56), whether a batch containing it landed line-by-line if refused elsewhere in the same call (SL-59),
   whether its name was resolved against scene *or roster* candidates before any refusal (SL-62/SL-67,
   `resolved_from`), and whether it minted its own table person distinct from any already established (SL-64).
   Count total `from_passage`, table-person registrations (and their count), pending-person rows,
   `resolved_from` rows, and `unknown_entity` refusals — split by whether the named person was present or
   only in the roster (the SL-67 distinction).
D. **Turn-by-turn**: which sub-locations were entered and on which turn (carried forward from batch-4 through
   batch-10's own table format).
E. **SL-65 specifically**: every reading job raised, its `stage_budget` row's `ceiling` and (if present)
   `contextWindow`, and whether it refused `budget_input_tokens`.
F. **SL-66 specifically**: the investigator card's stored `name`, the setup `create-investigator` call's
   `range`, and every prose echo of the name, checked for stray leading/trailing punctuation.
G. **SL-67 specifically**: every shortened/variant name attempted, whether the named person was `present` or
   only in `roster` that turn, and the resolve/refuse outcome.

## Stop conditions

Do not stop the table short of no-delivery / hang, per instruction. This worker starts its own `driver.py`
daemons only; if any other worktree's daemon is found running, it is confound-noted and never touched. Keep
the campaign fork and reading workspace after the table (do not delete), continuing the procedural change
batches 5-10 made.

Triage after the table (`29-book-a-b11/triage.py`, adapted from `29-book-a-b10/triage.py`, same columns plus
new SL-65/66/67 sections: reading-job `stage_budget`/`contextWindow` rows and refusal count, the investigator
card's `name` field and prose echoes checked for stray punctuation, and every shortened/variant person-name
attempt split by present-vs-roster-only with its outcome): every finding classed (P0 delivery/stall/import, P1
wall > 60 s cause, P2 routing/admission/reading, P3 fiction/rules, P4 cost), one root cause per finding,
evidence paths; cross-referenced against batch-10's findings (this file's sibling
`29-pdf-modules-live-tables.md` batch-10 Comments entry) — which are fixed, which remain, which are new to
batch 11.
