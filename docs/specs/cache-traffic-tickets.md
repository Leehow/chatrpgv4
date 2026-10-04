# cache-traffic tickets

Spec: `cache-traffic.md`. Contract: §179.

## CT-01 The library follows the leading fork

Status: landed 2026-10-04 (806eda7f5, afe201be6 on `claude/cache-traffic-reading-20261004`; merged 357c423a0)

Kernel (`kernel-ts/modules/campaign-scope.ts`, `reading.ts`, `reference.ts`), host (`extensions/module/reading-service.ts`),
tests (`tests/extension/campaign-module-isolation.test.mjs`, `fork-read-ahead.test.mjs`, a new case).

- `syncLibraryFromCampaign(context, campaign, moduleId)` in `campaign-scope.ts`: eligibility, the copy, the library
  `writeGraph`, the private-field exclusions and the lineage record, exactly as §179.1 states. Under the library module's
  `.metadata.lock`; re-check inside the lock.
- Called at the end of `Reading.finish` for a `completed` outcome and after `publishReferencePlace`, only when
  `meta.campaign_scope` names the store's campaign. Its failure never fails the publication: the result carries
  `library_sync: {state, reason?, library_generation?}`.
- The host records one `lane: "reading", event: "library_sync"` row per publication from that field.
- Amend the isolation test to the new rule and add the second-campaign case. Run the extension suite and pytest on the
  box.

## CT-02 The Keeper's request keeps its prefix across turns

Status: landed 2026-10-04 (b0f8aee75, 746bf8e9b on `claude/cache-traffic-context-20261004`)

`extensions/table/context-policy.ts` (`projectedMessages`, a `stableFirst` capsule render with the closed section order
of §179.2), `extensions/table/context-runtime.ts` (render the sent capsule through it on the single-loop engine),
`tests/extension/single-loop-model-call-diet.test.mjs`, `tests/extension/context-policy.test.mjs`.

## CT-03 The context lane fingerprints its request

Status: landed 2026-10-04 (b0f8aee75)

`extensions/table/context-runtime.ts` `record({lane: 'context', event: 'request', …})` gains `at`, `segments`,
`system_digest` (§179.3); a test asserts the shape. Same worker as CT-02.

## CT-04 Reading follows the book's chapters

Status: ready-for-agent

Contract §182. Kernel (`kernel-ts/modules/reading.ts` `queueAheadReading` and `bind`, a new `module.source.outline`
handler registered beside the other private `module.*` methods, `kernel-ts/handlers.ts` method list), host
(`extensions/module/index.ts` table-open backfill, `extensions/module/reading-service.ts` `read_window` row), data
(`content/rulesets/coc7/host-budgets.json` `reading.whole_book_max_pages` 60, `reading.fallback_window_pages` 24), tests.

## Comments

- 2026-10-04 (lead): CT-02's follow-up ordered the keys of `mods` and `known`; moving the two sections after `style`
  was measured on the faux table and rejected on the live tables' change frequencies (§179.2, decision).
- 2026-10-04 (lead): CT-01's lineage test is stricter than the first wording (the library generation the fork last
  published must still be the head); the contract was aligned (20237b4ef).
