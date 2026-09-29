Status: ready-for-human
Spec: docs/specs/jev-decides-llm-writes.md D-B B4 · Contract §151.3, §151.3.1
Load the `typesafe-jev` skill first.

# 03 — Jev claim-support check before the vision reviewer

Scope:
1. Family `source-claim-support` v1 (eligibility by structure only; supported/contradicted Nouls per claim, one fanned-out request per candidate; gates as data).
2. Modes `shadow` (shipped default) / `on` / `off`, env over data; `on` removes cleared paths from vision units and writes `reviewer:"jev"` rows; Jev never refuses; outage = off.
3. Kernel publication gate accepts `reviewer:"jev"` rows only under §151.3's conditions.
4. Offline calibration tool over retained verdicts (claim, cited page native text, vision verdict) with a grid over (S, C); run it live on the Mac against this checkout's retained corpus; write the numbers and the bar outcome into this ticket; flip the data default to `on` only if §151.3.1's bar is met.
5. Inventory entry.

Tests: eligibility excludes coverage, image/map paths and pages without native text; shadow changes no review outcome; on skips vision for cleared paths only and a unit left empty is not run; an uncleared or contradicted claim still goes to vision; the gate refuses a jev row on an ineligible path, a mismatched page-text digest, or a path a vision row refused.

## Comments

### 2026-09-29 implementation (worker, branch `claude/jev-reach-20260928-03-claim-check`)

**What changed.**
- Contract first: §151.3 gains an "Implementation decision (ticket 03)" paragraph — the unit of the check is the record (a claim, or a node with all its fields, i.e. `reviewUnits`' pointer group); structural eligibility is one import-free function both ends load; the evidence file `claim-support.json`; the merge rule; the gate's three refusal rules; a Jev row never settles a contest mark; data block and env switch; outage = the record stays with vision.
- `kernel-ts/modules/claim-support.ts` (new, import-free): `claimRecordRoot`, `claimRecordPages`, `claimSupportIneligibility` (not a record / image source / map region / no or invalid citation / region `box` citation / a cited page without native text), protocol and rule names.
- `runtime/jev/source-claim-support.ts` (new, pure): budget reader (`source_claim_support` in `host-budgets.json`; unreadable = off), mode resolution (`PI_COC_CLAIM_SUPPORT` over data, source recorded), fact-record grouping (never the `/coverage` unit), the code-rendered statement (claim: subject/relation/object by name and kind, truth status, condition, asserted/known by; node: kind, name, aliases, summary, properties; never `reason` or `visibility`), batches (one fan-out per candidate, split only past packing or `max_pages_per_request`, grouped by cited pages), the gate `supported >= S and contradicted <= C`.
- `extensions/module/claim-support.ts` (new): `createClaimSupport({env, contentRoot})` — native text via the runtime's `sourceText` pinned to the bound digest, own lease (`timeout_ms`, token bound from the packed batches, one network retry), writes `claim-support.json` (work dir + `verify-<round>/` copy), returns the paths to skip (`on` only) and a `settle(review.json)` that appends Jev rows in `on` (none where a vision row gave an overlapping path anything but `supported`) and pairs every asked record with the vision verdicts. Telemetry rows `claim_support` and `claim_support_paired` on the reading lane.
- Hooks (kept minimal for ticket 02's merge): `reviewCandidate` takes an optional `claimSupport(units)` and drops the returned paths from the units (an empty unit is not run; guidance and source-answer reviews are never asked); `ReadingService` gains the `claimSupport` dependency, passes it into `reviewCandidate` and calls `settle` after the review; `extensions/module/index.ts` wires `createClaimSupport`.
- Kernel gate: `checkReview` judges `reviewer:"jev"` rows first (`checkJevRow`): one record's paths, `supported`, eligible, evidence file of the bound source (`claimEvidence`: protocol, `source_sha256`, every page text hashing to its digest), matching `extraction_version`, `page_text_sha256` naming exactly the record's cited pages, a distribution, no overlapping vision negative. Refusals: `review_jev_ineligible`, `review_jev_evidence`, `review_jev_overruled`. Jev paths count as reviewed, never as `supported` for settling contest marks. `module.read.finish` loads `claim-support.json` only when a Jev row is present.
- Data: `content/rulesets/coc7/host-budgets.json` `source_claim_support` {mode `shadow`, `supported_min` 0.8, `contradicted_max` 0.1, `timeout_ms` 30000, `page_text_max_bytes` 12000, `record_max_bytes` 6000, `max_pages_per_request` 4}.
- Inventory: `extensions/module/claim-support.ts` `createClaimSupport` `createDecisionAdapter` added to `inventory-SL-00.json`/`.md` (owner, budget, gate, fallback in the note).

**Tests** (single files, this Mac): `tests/extension/claim-support.test.mjs` 6/6 (eligibility; mode/budget; shadow at the `ReadingService` seam changes no unit and no review row; `on` skips cleared records only, an empty unit is not run, uncleared and contradicted records still go to vision, Jev rows carry digests/version/distribution; a vision negative overrules; outage and `off`), `tests/extension/claim-support-gate.test.mjs` 2/2 (the TS kernel bundled from source with esbuild, through `module.read.finish`: accepted shape; no evidence file; image record; `/coverage`; a Jev "negative"; wrong digest; tampered text; foreign source; other extraction version; vision overrule; a Jev row does not settle a contest mark). Also run: `control-flow-inventory` 4/4, `system-language` 5/5, `travel-fill` 8/8, `consequence-host-budgets` 13/13, `reader-review` 23/24 and `reading-service` 35/36 (the one failure in each needs the emitted kernel under `build/`, absent in this worktree — not run here, not caused by this change).

**Mutation checks** (file copied aside, mutated, test run, copied back): 19 mutations, all killed — unit filtering removed; settle writes no rows; vision negative ignored; settle never called; gate `and`→`or`; image source eligible (both files); `box` eligible; digest unchecked; overrule unchecked; Jev rows settle marks; evidence not passed by `module.read.finish`; page text hash unchecked; shadow skips; env ignored; page without text eligible; coverage unit asked (killed after adding a direct case); extraction version unchecked; Jev allowed to refuse.

**Calibration (§151.3.1), run live 2026-09-29 on this Mac.** Tool `tests/play/jev-claim-calibrate.mjs --home /Users/haoli/leehow/code/chatrpgv4-wt-pi-coc-v2` (read-only on that checkout); output `.pi/jev-claim-calibration-20260929/` in this worktree (`records.jsonl`, `summary.json`, `grid.md`). It replays the product's own eligibility, statement, batching and questions through the real adapter (`jev-1.13.0`), native text from the retained `native-navigation-v2.json` (same `pdfjs-6.3.289:native-text-v1`) or `sourceText`.
- Corpus: 350 retained verify rounds; 150 are guidance/answer (not asked by design), 2 had no module, 12 duplicates merged → 186 fact rounds; 3,460 eligible record instances asked (ineligible: 144 no native text, 100 image source, 2 region citation, 1 too large); 494 requests, 3.48 M input tokens, $0.146; 11 instances unanswered (`packing_limit`).
- Labels per instance: 3,386 supported, 59 negative, 4 contested (excluded). Unique claims (same statement on the same page texts of the same source): 2,184 = 2,130 supported + 54 negative (a unique negative counts as cleared if any reading clears; a unique supported only if every reading clears).
- Grid (S × C, unique claims):

| S | C | cleared supported | share | cleared negatives |
|---|---|---|---|---|
| 0.5 | 0.1 | 1058/2130 | 49.7% | 6/54 (11.1%) |
| 0.5 | 0.2 | 1117/2130 | 52.4% | 9/54 (16.7%) |
| 0.6 | 0.1 | 879/2130 | 41.3% | 4/54 (7.4%) |
| 0.7 | 0.1 | 660/2130 | 31.0% | 1/54 (1.9%) |
| 0.75 | 0.1 | 519/2130 | 24.4% | 1/54 (1.9%) |
| 0.8 | 0.1 | 337/2130 | 15.8% | 0/54 |
| 0.85 | 0.1 | 161/2130 | 7.6% | 0/54 |
| 0.9 | 0.1 | 30/2130 | 1.4% | 0/54 |

  (full 12 × 7 grid in `grid.md`; C = 0.02 clears nothing, C ≥ 0.2 changes little; S ≥ 0.97 clears nothing.)
- **Bar not met.** With 54 negatives, "≤ 1 and ≤ 1 %" means zero cleared negatives; the best such point (S 0.8, C 0.1) clears 15.8 % of the supported claims, far below 50 %; every point that clears ≥ 50 % clears 6–9 negatives. The data default stays `shadow`; S/C in the data are set to that zero-false-accept point (0.8 / 0.1) so the shadow rows on new books measure it. Not flipped to `on`.
- Why (read from `records.jsonl`, not tuned): Jev's `supported` on reviewer-supported records has median ≈ 0.55 (p90 ≈ 0.85); on negatives median 0.16, p90 0.53, max 0.75 — separated but overlapping. Claims clear best (24.6 % at 0.8/0.1); node records rarely do (npc median 0.35, scene 0.38, location 0.27, module 0.07): a node carries reader-derived fields (voice, relationship, summary synthesis) the page never states literally, which is exactly what "with nothing added" refuses. English (Masks, 18.2 %) and Chinese (Blood, 23.6 %) are close. The cleared negatives at 0.5/0.1 are subtle wording/role errors (an NPC called "crew" when the page does not say so; an actor linked to a rule the book gives investigators; an advisory difficulty flag).

**Not done / open.**
- Any redesign that might pass (claims-only eligibility, per-field node questions, a different statement) needs a new pre-registered bar and a held-out split: re-running on this same corpus after seeing it would be fitting the threshold to the numbers. Owner's call.
- The kernel gate test bundles `kernel-ts/rpc.ts` with esbuild inside the test (no `build/` needed). The emitted-kernel tests (`reader-review` "owner timeout", `reading-service` "reviewed selected entrance", and every test that spawns `build/kernel/rpc.mjs`) need `npm run build:runtime` on the box.
- Ticket 02 changes the same two files (`reader-review.ts`, `reading-service.ts`); this ticket's hook is three lines in `reviewCandidate` (option, call, splice) and one block plus one `settle` line in the verify phase.

### 2026-09-28 — lead decision after reading the calibration records
- The pre-registered bar failed. The data default stays `shadow` (S 0.8 / C 0.1 in data, so new books' shadow rows measure the zero-false-accept point). This is the §151.3.1 outcome, not a tuning target.
- Read of `records.jsonl`: many reviewer-supported records that Jev scores low are structural graph relations the pipeline derives, not sentences on a page. Example: the claim that 血色公路 contains 蛇洞 scores 0.07. Jev's literal reading, a documented failure mode, is behaving as designed.
- No redesign in this round:
  - Review units are grouped by page and run in parallel. A unit runs its vision review if any record in it stays uncleared, so clearing 15–25% of records rarely empties a unit.
  - Measured wall time per two-page fragment is roughly two-thirds author and one-third review.
  - Even a redesigned check (claims only, per-field node checks, rendered structural relations) would move little wall time. Tickets 02 and 04 carry the speed.
- A redesign later needs a new pre-registered bar and a held-out split fixed before any run.
- Calibration output is preserved at `chatrpgv4-wt-jw03/.pi/jev-claim-calibration-20260929/` (gitignored; do not remove the worktree without copying it).
