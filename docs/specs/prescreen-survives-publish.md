# Prescreen survives a library publish; the read-ahead stops re-reading the same pages

Status: ready-for-human (PS-01 and PS-02 implemented on `claude/prescreen-publish-20261008`; PS-03 is the lead's TR-F2 acceptance)

Owner (2026-10-08): 「我发现自从你这边改了方法之后，kp出现找不到模组内容的情况比之前多了，你最好留意一下接线的问题」, then
「开这个切片，和两本账一起在 TR-F2 验收」. Contract `docs/kernel-rpc.md` §195. Accepted together with
`docs/specs/two-ledgers.md` on TR-F2.

## Evidence (App `d944b6b07`, TR-F, Cold Harvest, campaign `game-56788eff`)

- **Prescreen thrown away.** `lane: prescreen, event: fallback, reason: source_stale` on turns 11 (07:01:41Z) and 13
  (07:03:01Z). Each came 1–3 s after a reading job's `library_sync … published` (read-55 07:01:40.676Z, read-58
  07:02:58.020Z). The provider's `check()` (`runtime/jev/prescreen-source-provider.ts` ~215–255) returns stale when the
  module's materials `revision`/`answers_revision` moved at all, so 5–7 s of prepared evidence (8–10 Jev calls) was
  discarded and the Keeper got no prepared material that turn. Across the App's ~23 tables of 2026-10-02..10-07 there is
  no `source_stale` fallback; after 10-07 there are 3 (one on the 10-07 17:13 session).
- **Publishes during play.** `library_sync published` per hour in the App's reading telemetry: 0 for 10-02..10-07 (3 on
  10-04T18), 52 at 10-08T06 and 18 at 10-08T07 — TR-F was a book with no graph yet, read during play (§182 short book).
- **The read-ahead re-reads.** 48 pages; `read-59` was still starting 26 min into play. Pages repeat across jobs:
  read-55 [6,15,16,17,23,45], read-56 [6,13,15,17,46], read-57 [6,7,20,21,25,33], read-58 [8,16,20,25,45]; 21
  `source_need` rows at 07h. Each job publishes, and each publish can stale a prescreen.

## Tickets

### PS-01 A prescreen stays valid when what it used did not change
Status: ready-for-human (implemented on `claude/prescreen-publish-20261008`; contract §195.1 implementation decision; awaiting integration and PS-03)
- Replace the whole-revision comparison with a check of the prescreen's own read set: the units/records/pages it
  supplied are re-read (by digest) and compared; the prescreen is current when they are unchanged, whatever else the
  publish added. When one did change, re-select once against the current materials within the remaining allowance
  instead of delivering nothing; only when that also fails, fall back as today.
- Telemetry: the fallback row names the actual check reason (`source_material_changed`, `source_extraction_changed`, …),
  not only `source_stale`; a kept prescreen across a publish records `revalidated: true`.
- Tests through the real provider/host path: a publish of unrelated nodes during the prescreen → delivered; a publish
  that changes a supplied unit → re-selected; mutation-check.

### PS-02 Why the read-ahead re-reads the same pages, and the fix
Status: ready-for-human (implemented on `claude/prescreen-publish-20261008`; root cause and decision in contract §195.2;
awaiting integration and PS-03). The producer is §151.4's background need reads of `deferred` needs, asked after the
window had read every page.
- Find, from TR-F's artifacts (App home `~/Library/Application Support/Pipi/pipicoc/pi-coc/.coc/reading-telemetry.jsonl`,
  the campaign's and `modules/book-2`'s reading work dirs; read only), which producer queues the repeat jobs (source
  needs §187.7, claim support, repair §187.6, DUP-03 repair §192, window §182/§191.5) and why a page already read and
  published is read again.
- Fix at the producer so a page is read again only for a reason the earlier read did not cover; record the decision in
  §195. A finding that the repeats are correct by contract is an acceptable outcome if argued from the artifacts.
- Tests reproduce the repeat shape and show it gone; mutation-check.

### PS-03 Acceptance
Status: ready-for-human (TR-F2, lead).
TR-F2 (lead): on the fresh Cold Harvest table, zero `source_stale`-class fallbacks caused by a publish whose changes the
prescreen did not use; the read-ahead's jobs and repeated pages counted and compared with TR-F.
