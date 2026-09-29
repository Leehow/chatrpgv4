Status: ready-for-human
Spec: docs/specs/jev-decides-llm-writes.md D-C

# 05 — Shadow report reads any home and prints the D6 2a line

Extend `tests/play/jev-steps-report.py`: accept one or more homes (repo checkout `.coc/campaigns`, PipiCOC App homes), aggregate across campaigns, print per class the D6 2a verdict (agreement ≥ 0.9 where the Keeper acted, FP ≤ 1 per table, added Jev ms/turn ≤ 1.5 s) with table counts. Read-only; never edits the execute list. Test with fixture telemetry including an App-home layout.

## Comments

### Implementation notes (worker, 2026-09-28; revised after the coordinator's two corrections)

**What changed.** `tests/play/jev-steps-report.py` (existing per-campaign sections untouched) now takes one or more homes and ends with the D6 2a verdict:

- `resolve_home` recognises the campaign layout by which directory exists: `<p>/.coc/campaigns` (a repo checkout, and the packaged App's home), `<p>/campaigns` (the `.coc` dir itself), `<p>/pi-coc/.coc/campaigns` (the App userData dir), or a `campaigns` dir given directly. The same campaigns dir named two ways is one home. A positional that is an existing directory but no home is an error (a typo must not read as no data).
- `load_campaign` (pulled out of `report_campaign`), `d6_rows`/`d6_table`/`aggregate`/`render_verdict`, and a new `main`: `--campaign GLOB` (repeatable, default `*`), `--detail` (per-campaign sections before the verdict). The original form `<root> <glob> ...` still works, prints the per-campaign sections and then the verdict.
- Hardenings that App homes need: `load_turn` treats an unreadable turn file (a live App mid-write) as missing instead of crashing the run; turn files with non-numeric names are ignored; `corrected_npc_reaction` no longer lets a first-impression roll with no `npc` field match a target nobody resolved.
- Read-only: nothing is opened for writing; a test snapshots both fixture trees (sizes and mtimes) and a copy of `content/rulesets/coc7/host-budgets.json` before and after.

**The App's real layout (read from code, confirmed by listing, nothing written).** Packaged App: `home = PI_COC_HOME || join(userData, 'pi-coc')` (`Electron/apps/electron/src/main/runtime-assets.ts`); `userData` is `~/Library/Application Support/Pipi/pipicoc` (`pipicoc/product.json`, `userDataDirname: "Pipi/pipicoc"`). The kernel workspace is `<home>/.coc`, so a table is `~/Library/Application Support/Pipi/pipicoc/pi-coc/.coc/campaigns/<cid>/{telemetry.jsonl,turns/NNNN.json}` (55 campaigns there today), identical to a checkout's `.coc/campaigns/<cid>/`. Source-layout App runs use `PI_COC_HOME || repo`, i.e. the checkout. Two older acceptance userData dirs exist (`Pipi/pipicoc-masks-latency-20260910`, `Pipi/pipicoc-pdf-opening-acceptance-20260910`, same `pi-coc/.coc/campaigns` shape). `PipiUI`, `@pipiui/electron`, `Pipi/pipiui`, `pipi-hydra`, `pipi-paper` hold no `campaigns` directory.

**How the verdict reads D6 2a** (also in the script docstring and in the spec's D-C bullets; deliberately not in `docs/kernel-rpc.md`, the report is a read-only test tool, not contract).

1. *Agreement* = `tp/(tp+fp)`, precision over the cleared rows the Keeper's receipts can judge (`keeper_did` true, false or `other`; `tp` is `true`). This is the owner's precedent: SL-78 opened `clue_follow_up` on "agreement 6/6, 6/6, false positives 0/0/1", and SL-77 explains those 6/6 as "every one of its 6 cleared rows paired `true` (6/6 precision on cleared rows)". A `keeper_did: null` row has no verdict and is not counted. The first version of this report had used recall (`tp/(tp+fn)`); that was wrong and is now printed beside agreement as information only, not in the verdict.
2. *False positives* = cleared rows with `keeper_did` false or `other`, per table, worst table decides, at most 1. "Reads as wrong on the transcript" stays a human read; the only automatic exemption is the pre-SL-83 label/handle artifact (`corrected_npc_reaction`: proven the same entity by the turn's own person and roll receipts), counted as the Keeper's own action and reported as `artifacts`.
3. *Cost* = per-table mean of `consequence_budget` ms over the turns that made a shadow call (last row per `(turn, run)`, summed over runs of a turn), every table at or under 1500 ms (inclusive). One number for all classes; median and max printed beside it.
4. *Table* = a campaign with at least one consequence route row; other campaigns are counted as scanned only.
5. *Not counted, and printed as such*: stranded turns; `executed` rows; `direct` rows (a stated amount the host clears without asking Jev); unanswered rows (`confidence` null: outage or incomplete batch); rows with no `keeper_did` verdict; duplicate `(turn, class, key)` rows (last written kept: SL-85 pre-fix double writes).
6. No evidence is never a pass: a class with no cleared row the receipts can judge reads NOT MET (no evidence), and so does a run with no `consequence_budget` row anywhere.
7. *Whole-table exclusion of tables that executed a class: dropped.* It was needed only while agreement was recall (an executing table's cleared rows leave the Keeper's own action unobservable, so its leftover uncleared rows could only read as misses). Under precision it is not: executed rows are excluded one by one by being `executed`, and the cleared shadow rows beside them are ordinary shadow decisions. It survives in one place: the informational recall is read over the tables that only shadowed the class, because an executing table's hits are not observable there (the recall line says over how many tables).

**Tests.** `tests/play/test_jev_steps_report.py`, 21 tests, `uv run --frozen python -m pytest tests/play/test_jev_steps_report.py` (21 passed, also with `-n 0`): every layout resolver form; a checkout home plus an App userData home with per-number pins (duplicates, stranded, direct, unanswered, no-verdict, executed, label/handle artifact, `exists` rows ignored); agreement as precision (0.9 inclusive across two tables at one false positive each, recall printed but not in the verdict: `time_cost` misses one filed row and still meets 2a); a ratio of 26/29 printed as 0.897, never as the line; the per-table cost judgement (a pooled mean would hide the slow table) at 1500/1501; one versus two false positives; no evidence; executed rows out individually with the executing table still in the verdict; the same campaign id in two homes; `--campaign`; the original `<root> <glob>` form; a directory that is no home; a mid-write turn file; nothing written and the execute list unchanged.

**Mutation checks** (script copied aside, one line changed, test file run, script copied back): agreement over `tp+fn`; recall added to the verdict; no-verdict rows counted; executed rows kept; recall read over every table; agreement strict `>`; `other` not a false positive; fp threshold `>=`; artifact correction off; no dedupe; stranded kept; cost boundary `>=`; `app-userdata` layout dropped; 3-digit agreement display reduced to 2. All killed.

**Real run (this Mac, read-only), the two homes the ticket names.** `python3 tests/play/jev-steps-report.py /Users/haoli/leehow/code/chatrpgv4-wt-pi-coc-v2 "$HOME/Library/Application Support/Pipi/pipicoc"`:

```
====================================================================================================
D6 2a verdict (docs/specs/jev-driven-steps.md): per class, agreement (precision over the cleared rows the Keeper's receipts can judge) >= 0.90; false positives <= 1 per table; added Jev <= 1500 ms per turn
  h1: /Users/haoli/leehow/code/chatrpgv4-wt-pi-coc-v2/.coc/campaigns  [home]
  h2: /Users/haoli/Library/Application Support/Pipi/pipicoc/pi-coc/.coc/campaigns  [app-userdata]
  campaigns scanned: 389; tables with consequence telemetry: 0 (389 without: setup sessions, tables run with COC_JEV_STEPS=off, or older builds)

[npc_reaction] NOT MET -- 0 of 0 tables have rows of this class
  agreement (cleared rows the Keeper's receipts can judge, tp/(tp+fp)): n/a -- no such row (tp 0, fp 0): NOT MET, no evidence
  recall tp/(tp+fn), information only, over the 0 tables that only shadowed the class: n/a
  false positives per table: worst 0 (<= 1): met
  added Jev ms per turn: no table has a consequence_budget row: NOT MET, no evidence

[clue_follow_up] NOT MET -- 0 of 0 tables have rows of this class
  agreement (cleared rows the Keeper's receipts can judge, tp/(tp+fp)): n/a -- no such row (tp 0, fp 0): NOT MET, no evidence
  recall tp/(tp+fn), information only, over the 0 tables that only shadowed the class: n/a
  false positives per table: worst 0 (<= 1): met
  added Jev ms per turn: no table has a consequence_budget row: NOT MET, no evidence

[time_cost] NOT MET -- 0 of 0 tables have rows of this class
  agreement (cleared rows the Keeper's receipts can judge, tp/(tp+fp)): n/a -- no such row (tp 0, fp 0): NOT MET, no evidence
  recall tp/(tp+fn), information only, over the 0 tables that only shadowed the class: n/a
  false positives per table: worst 0 (<= 1): met
  added Jev ms per turn: no table has a consequence_budget row: NOT MET, no evidence

added Jev ms per turn (mean over the turns that made a shadow call; each table must be <= 1500 ms), all classes:
  no tables
```

Reading it: 389 campaigns scanned (334 in the checkout, 55 in the App home), zero tables. That is a true zero, not a query that missed: `grep -E '"purpose": ?"consequence"'` over the same `telemetry.jsonl` files finds nothing, and the same script and grep do find rows in 14 gate worktrees. Neither the App nor the shared checkout holds shadow evidence yet. Open finding, not investigated: the installed App bundle (`pipicoc-build/PipiCOC.app`, runtime `pi-hybrid.mjs`) contains `consequence_budget`, and 3 of its campaigns have `lane:"route"` rows (newest 2026-09-28 21:27), all `purpose:"route"`; none has `purpose:"consequence"`. Whether no candidate was offered, or the App's tables did not reach the shadow turn-close, is for the D-A ticket or a real App table to answer.

**Real run over the gate worktrees (read-only; the only place on this Mac with `purpose:"consequence"` rows: 14 homes, 27 tables).** Per-table lines removed here for length, the slow table kept:

```
====================================================================================================
D6 2a verdict (docs/specs/jev-driven-steps.md): per class, agreement (precision over the cleared rows the Keeper's receipts can judge) >= 0.90; false positives <= 1 per table; added Jev <= 1500 ms per turn
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
  agreement (cleared rows the Keeper's receipts can judge, tp/(tp+fp)): 4/14 = 0.286 (>= 0.90): NOT MET
  recall tp/(tp+fn), information only, over the 27 tables that only shadowed the class: 4/19 = 0.21
  false positives per table: worst 3 (<= 1): NOT MET in h6:longgate19-haunting-1043, h7:longgate20-haunting-1050
  added Jev ms per turn: NOT MET in h11:longgate17-haunting-0831 (see below)
  label/handle pairing artifacts read as the Keeper's own action (not false positives): 15
  rows not counted: {'duplicate': 15}

[clue_follow_up] NOT MET -- 25 of 27 tables have rows of this class
  agreement (cleared rows the Keeper's receipts can judge, tp/(tp+fp)): 26/29 = 0.897 (>= 0.90): NOT MET
  recall tp/(tp+fn), information only, over the 19 tables that only shadowed the class: 26/37 = 0.70
  false positives per table: worst 2 (<= 1): NOT MET in h14:time-skip-b
  added Jev ms per turn: NOT MET in h11:longgate17-haunting-0831 (see below)
  rows not counted: {'executed': 49, 'duplicate': 42, 'unanswered': 14}

[time_cost] NOT MET -- 0 of 27 tables have rows of this class
  agreement (cleared rows the Keeper's receipts can judge, tp/(tp+fp)): n/a -- no such row (tp 0, fp 0): NOT MET, no evidence
  recall tp/(tp+fn), information only, over the 27 tables that only shadowed the class: n/a
  false positives per table: worst 0 (<= 1): met
  added Jev ms per turn: NOT MET in h11:longgate17-haunting-0831 (see below)

added Jev ms per turn (mean over the turns that made a shadow call; each table must be <= 1500 ms), all classes:
  h11:longgate17-haunting-0831: 14/21 turns with a call; mean 1708 ms; median 1524 ms; max 3102 ms
```

Findings: (a) `clue_follow_up` reads 26/29 = 0.897, just under the 0.90 line, and one table (`time-skip-b`) has 2 false positives; the executing tables no longer distort it (recall 26/37 = 0.70 over the 19 shadow-only tables is information only); (b) `npc_reaction` precision is 4/14 = 0.286 with 15 label/handle artifacts already read as the Keeper's action, two tables with 3 and 2 false positives, recall 4/19; (c) `time_cost` has never produced a candidate row on any of the 27 tables, so it has no evidence; (d) one table (`longgate17-haunting-0831`) is over the 1.5 s line (mean 1708 ms) and turns every class's cost line NOT MET; every other table is under.

**Not done / notes for the lead.** No live Jev or model calls. `docs/kernel-rpc.md` is unchanged (the first commit added an Implementation-decision paragraph under section 150.1; this revision removes it, per the coordinator). The reading rules live in `docs/specs/jev-decides-llm-writes.md` D-C and the script docstring. One pytest file, no kernel build needed; include `tests/play/test_jev_steps_report.py` in the full-suite run on the box.
