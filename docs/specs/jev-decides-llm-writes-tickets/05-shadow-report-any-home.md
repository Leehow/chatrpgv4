Status: ready-for-human
Spec: docs/specs/jev-decides-llm-writes.md D-C

# 05 — Shadow report reads any home and prints the D6 2a line

Extend `tests/play/jev-steps-report.py`: accept one or more homes (repo checkout `.coc/campaigns`, PipiCOC App homes), aggregate across campaigns, print per class the D6 2a verdict (agreement ≥ 0.9 where the Keeper acted, FP ≤ 1 per table, added Jev ms/turn ≤ 1.5 s) with table counts. Read-only; never edits the execute list. Test with fixture telemetry including an App-home layout.

## Comments

### Implementation notes (worker, 2026-09-28)

**What changed.** `tests/play/jev-steps-report.py` (existing per-campaign sections untouched) now takes one or more homes and ends with the D6 2a verdict:

- `resolve_home` recognises the campaign layout by which directory exists: `<p>/.coc/campaigns` (a repo checkout, and the packaged App's home), `<p>/campaigns` (the `.coc` dir itself), `<p>/pi-coc/.coc/campaigns` (the App userData dir), or a `campaigns` dir given directly. The same campaigns dir named two ways is one home. A positional that is an existing directory but no home is an error (a typo must not read as no data).
- `load_campaign` (pulled out of `report_campaign`), `d6_rows`/`d6_table`/`aggregate`/`render_verdict`, and a new `main`: `--campaign GLOB` (repeatable, default `*`), `--detail` (per-campaign sections before the verdict). The original form `<root> <glob> ...` still works, prints the per-campaign sections and then the verdict.
- Two hardenings that App homes need: `load_turn` treats an unreadable turn file (a live App mid-write) as missing instead of crashing the whole run; turn files with non-numeric names are ignored. `corrected_npc_reaction` no longer lets a first-impression roll with no `npc` field match a target nobody resolved.
- Read-only: nothing is opened for writing; a test snapshots both trees (sizes and mtimes) and a copy of `content/rulesets/coc7/host-budgets.json` before and after.

**The App's real layout (read from code, confirmed by listing, nothing written).** Packaged App: `home = PI_COC_HOME || join(userData, 'pi-coc')` (`Electron/apps/electron/src/main/runtime-assets.ts`); `userData` is `~/Library/Application Support/Pipi/pipicoc` (`pipicoc/product.json`, `userDataDirname: "Pipi/pipicoc"`). The kernel workspace is `<home>/.coc`, so a table is `~/Library/Application Support/Pipi/pipicoc/pi-coc/.coc/campaigns/<cid>/{telemetry.jsonl,turns/NNNN.json}` (55 campaigns there today), identical to a checkout's `.coc/campaigns/<cid>/`. Source-layout App runs use `PI_COC_HOME || repo`, i.e. the checkout. Two older acceptance userData dirs exist (`Pipi/pipicoc-masks-latency-20260910`, `Pipi/pipicoc-pdf-opening-acceptance-20260910`, same `pi-coc/.coc/campaigns` shape). `PipiUI`, `@pipiui/electron` and `Pipi/pipiui`, `pipi-hydra`, `pipi-paper` hold no `campaigns` directory.

**Decisions on what the spec leaves open (D6 2a text: "agreement with the Keeper >= 0.9 where the Keeper acted; false positives <= 1 per table per class; Jev cost per turn <= 1.5 s added"). Recorded in the script docstring and in kernel-rpc.md section 150.1 (Implementation decision). Owner may overrule any of them; each is one line in `d6_rows`/`aggregate`.**

1. *Agreement* = `tp/(tp+fn)`: of the rows whose entity the Keeper filed the same turn (`keeper_did: true`), the share Jev also cleared. That is the SL-86 recall. The older per-campaign figure `true/(true+false)` mixes cleared and uncleared rows and stays as it was, per campaign only.
2. *False positives* = cleared rows with `keeper_did` false/`other`, per table, the worst table decides. "The pairing reads as wrong on the transcript" stays a human read; the only automatic exemption is the label/handle artifact the script already diagnosed (`corrected_npc_reaction`: a pre-SL-83 row keyed on a display label, proven the same entity by the turn's own person and roll receipts). Those rows count as the Keeper's own action and are reported as `artifacts`.
3. *Cost* = the per-table mean of `consequence_budget` ms over the turns that made a shadow call (last row per `(turn, run)`, summed over runs of a turn), every table at or under 1500 ms (inclusive). One number for all classes. Median and max are printed beside it.
4. *Table* = a campaign with at least one consequence route row. Other campaigns are counted as scanned only.
5. *Not counted, and printed as such*: stranded turns; `direct` rows (a stated amount the host clears without asking Jev, not a Jev decision); unanswered rows (`confidence` null: outage or incomplete batch); duplicate `(turn, class, key)` rows (last written kept: the SL-85 pre-fix double writes); and any class-table that executed the class (an `executed` row exists). The last one matters: under `on`, a cleared `clue_follow_up` becomes a clerk write, so the Keeper's own action is unobservable, and the leftover uncleared rows can only read as misses. Dropping only the executed rows drove `clue_follow_up` to 0.37 agreement on the gate worktrees (every leftover row was a miss); leaving those class-tables out whole gives 0.70.
6. No evidence is never a pass: a class with no row in which the Keeper acted reads NOT MET with that reason, and so does a run with no `consequence_budget` row anywhere.

**Tests.** `tests/play/test_jev_steps_report.py`, 19 tests, `uv run --frozen python -m pytest tests/play/test_jev_steps_report.py` (19 passed, also with `-n 0`): every layout resolver form; a checkout home plus an App userData home with per-number pins (duplicates, stranded, direct, unanswered, executed class-table, label/handle artifact, `exists` rows ignored); the 0.9 agreement and 1500 ms lines each on both sides of the boundary; the per-table cost judgement (a pooled mean would hide the slow table); one versus two false positives; no evidence; the same campaign id in two homes; `--campaign`; the original `<root> <glob>` form; a directory that is no home; a mid-write turn file; nothing written and the execute list unchanged.

**Mutation checks** (script copied aside, one line changed, test file run, script copied back; 18 distinct mutants, all killed): dropped `app-userdata` layout (7 tests fail); cost boundary `>=`; pooled instead of per-table cost; no dedupe; executed class-table kept (the whole-table exclusion off, and the exclusion reduced to the executed rows only); unanswered kept; stranded kept; artifact correction off; roll-without-npc match restored; fp threshold `>=`; agreement over `tp+fp`; agreement strict `>`; per-(turn,run) cost dedupe off; every campaign a table; directory-no-home error off.

**Real run (this Mac, read-only), the two homes the ticket names.** `python3 tests/play/jev-steps-report.py /Users/haoli/leehow/code/chatrpgv4-wt-pi-coc-v2 "$HOME/Library/Application Support/Pipi/pipicoc"`:

```
====================================================================================================
D6 2a verdict (docs/specs/jev-driven-steps.md): per class, agreement >= 0.90 where the Keeper acted; false positives <= 1 per table; added Jev <= 1500 ms per turn
  h1: /Users/haoli/leehow/code/chatrpgv4-wt-pi-coc-v2/.coc/campaigns  [home]
  h2: /Users/haoli/Library/Application Support/Pipi/pipicoc/pi-coc/.coc/campaigns  [app-userdata]
  campaigns scanned: 389; tables with consequence telemetry: 0 (389 without: setup sessions, tables run with COC_JEV_STEPS=off, or older builds)

[npc_reaction] NOT MET -- 0 of 0 tables have rows of this class
  agreement where the Keeper acted: n/a -- no row in which the Keeper acted on this class (tp 0, fn 0): NOT MET, no evidence
  false positives per table: worst 0 (<= 1): met
  added Jev ms per turn: no table has a consequence_budget row: NOT MET, no evidence

[clue_follow_up] NOT MET -- 0 of 0 tables have rows of this class
  agreement where the Keeper acted: n/a -- no row in which the Keeper acted on this class (tp 0, fn 0): NOT MET, no evidence
  false positives per table: worst 0 (<= 1): met
  added Jev ms per turn: no table has a consequence_budget row: NOT MET, no evidence

[time_cost] NOT MET -- 0 of 0 tables have rows of this class
  agreement where the Keeper acted: n/a -- no row in which the Keeper acted on this class (tp 0, fn 0): NOT MET, no evidence
  false positives per table: worst 0 (<= 1): met
  added Jev ms per turn: no table has a consequence_budget row: NOT MET, no evidence

added Jev ms per turn (mean over the turns that made a shadow call; each table must be <= 1500 ms), all classes:
  no tables
```

Reading it: 389 campaigns scanned (334 in the checkout, 55 in the App home), zero tables. That is a true zero, not a query that missed: `grep -E '"purpose": ?"consequence"'` over the same `telemetry.jsonl` files finds nothing, and the same script and grep do find rows in 14 gate worktrees. Neither the App nor the shared checkout holds shadow evidence yet. Open finding, not investigated: the installed App bundle (`pipicoc-build/PipiCOC.app`, runtime `pi-hybrid.mjs`) contains `consequence_budget`, and 3 of its campaigns have `lane:"route"` rows (newest 2026-09-28 21:27), all `purpose:"route"`; none has `purpose:"consequence"`. Whether no candidate was offered, or the App's tables did not reach the shadow turn-close, is for the D-A ticket or a real App table to answer.

**Extra run, not asked for: where the real shadow rows are.** The only `purpose:"consequence"` rows on this Mac are in the 14 `chatrpgv4-wt-gate-*`, `-npc-actor`, `-pkg-b088de327`, `-time-skip` worktrees (27 tables). Same command over those homes (per-table lines removed here for length; the slow table only):

```

====================================================================================================
D6 2a verdict (docs/specs/jev-driven-steps.md): per class, agreement >= 0.90 where the Keeper acted; false positives <= 1 per table; added Jev <= 1500 ms per turn
  h1: /Users/haoli/leehow/code/chatrpgv4-wt-gate-13ce6a7dd/.coc/campaigns  [home]
  h2: /Users/haoli/leehow/code/chatrpgv4-wt-gate-32e1d584f/.coc/campaigns  [home]
  h3: /Users/haoli/leehow/code/chatrpgv4-wt-gate-6ba21726d/.coc/campaigns  [home]
  h4: /Users/haoli/leehow/code/chatrpgv4-wt-gate-6ba21726d-masks/.coc/campaigns  [home]
  h5: /Users/haoli/leehow/code/chatrpgv4-wt-gate-d08fa2ebb/.coc/campaigns  [home]
  h6: /Users/haoli/leehow/code/chatrpgv4-wt-gate-d08fa2ebb-43/.coc/campaigns  [home]
  h7: /Users/haoli/leehow/code/chatrpgv4-wt-gate-d08fa2ebb-43low/.coc/campaigns  [home]
  h8: /Users/haoli/leehow/code/chatrpgv4-wt-gate-d64c7a7c4/.coc/campaigns  [home]
  h9: /Users/haoli/leehow/code/chatrpgv4-wt-gate-dc37c6b7e/.coc/campaigns  [home]
  h10: /Users/haoli/leehow/code/chatrpgv4-wt-gate-dc37c6b7e-masks/.coc/campaigns  [home]
  h11: /Users/haoli/leehow/code/chatrpgv4-wt-gate-f332d72bc/.coc/campaigns  [home]
  h12: /Users/haoli/leehow/code/chatrpgv4-wt-npc-actor/.coc/campaigns  [home]
  h13: /Users/haoli/leehow/code/chatrpgv4-wt-pkg-b088de327/.coc/campaigns  [home]
  h14: /Users/haoli/leehow/code/chatrpgv4-wt-time-skip/.coc/campaigns  [home]
  campaigns scanned: 28; tables with consequence telemetry: 27 (1 without: setup sessions, tables run with COC_JEV_STEPS=off, or older builds)

[npc_reaction] NOT MET -- 21 of 27 tables have rows of this class
  agreement where the Keeper acted (tp/(tp+fn)): 4/19 = 0.21 (>= 0.90): NOT MET; precision 4/14 = 0.29
  false positives per table: worst 3 (<= 1): NOT MET in h6:longgate19-haunting-1043, h7:longgate20-haunting-1050
  added Jev ms per turn: NOT MET in h11:longgate17-haunting-0831 (see below)
  label/handle pairing artifacts read as the Keeper's own action (not false positives): 15
  rows not counted: {'duplicate': 15}

[clue_follow_up] NOT MET -- 17 of 27 tables have rows of this class
  agreement where the Keeper acted (tp/(tp+fn)): 26/37 = 0.70 (>= 0.90): NOT MET; precision 26/29 = 0.90
  false positives per table: worst 2 (<= 1): NOT MET in h14:time-skip-b
  added Jev ms per turn: NOT MET in h11:longgate17-haunting-0831 (see below)
  rows not counted: {'class_executes': 426, 'duplicate': 42, 'unanswered': 14}

[time_cost] NOT MET -- 0 of 27 tables have rows of this class
  agreement where the Keeper acted: n/a -- no row in which the Keeper acted on this class (tp 0, fn 0): NOT MET, no evidence
  false positives per table: worst 0 (<= 1): met
  added Jev ms per turn: NOT MET in h11:longgate17-haunting-0831 (see below)

added Jev ms per turn (mean over the turns that made a shadow call; each table must be <= 1500 ms), all classes:
  h11:longgate17-haunting-0831: 14/21 turns with a call; mean 1708 ms; median 1524 ms; max 3102 ms
```

Findings from that run: (a) `time_cost` has never produced a candidate row on any of the 27 tables, so it has no agreement to measure; (b) `npc_reaction`: 15 of the 19 rows where the Keeper acted are label/handle artifacts (pre-SL-83 rows), and even with them counted as the Keeper's action Jev cleared 4 of 19; (c) one table (`longgate17-haunting-0831`) is over the 1.5 s line (mean 1708 ms), every other table is under.

**Not done / notes for the lead.** No live Jev or model calls. `docs/kernel-rpc.md` gains one Implementation-decision paragraph under section 150.1 (no code-visible contract change; the report is test-side). The test file is one pytest file, no kernel build needed (`tests/play/test_jev_steps_report.py` reads only synthetic fixtures). Include it in the full-suite run on the box: `tests/play/test_jev_steps_report.py`.
