# Story continuity — memory-resume playtest record (2026-09-12)

This is a bounded evidence record for continuing the `continuity-venue-live` campaign after the
memory-repair commit. It separates observed facts from interpretation, keeps every finding short of
acceptance, and names what is still unimplemented. The lead has classified this run as
**failed-acceptance**: the driver was verified and stopped after the fifth genuine round fully
settled, paused after confirmed source-grounding defects. It is not a completed story and not a
technical transport blocker. No product code was changed during the test. Human UI/full feature
acceptance remains pending.

## Scope and provenance

- Owned branch `codex/story-continuity` at `0789496f` (`fix: retire corrected memory reports before recall`).
  Source-audit checkpoint `ca127652` remains prior history on the same branch.
- Primary advanced independently to `2dda9a05` when inspected. This task did not merge, push, or
  modify primary, and made no product source changes this turn.
- Evidence root: `.coc/playtests/continuity-memory-resume`, campaign `continuity-venue-live`.
- One live player (the main Codex session) sent one natural utterance at a time through
  `tests/play/driver.py`. Every Keeper/admission/memory/verifier/audit model call in this run used
  `deepseek/deepseek-v4-flash` with thinking off. No Astra or Grok calls, no scripted player.
- Campaign turns `0017.json`–`0021.json` exist and are committed. `turn.json` shows campaign turn 22
  `awaiting_player`. No claim is made that turn 22 is finished; it was not interrupted and no input
  was sent to it.

## 1. The scoped memory repair still holds

Facts:

- `memory/candidates.jsonl` keeps `mem:t12-2` superseded by `mem:t15-1`, and `mem:t12-3` plus
  `mem:t13-3` superseded by `mem:t14-1` (each with `valid_until_turn` and `superseded_by`).
- The recall capsules actually injected on turns 17, 18 and 19 (`turns/0017.json`–`0019.json`,
  `capsule.memory`) lead with the corrections `mem:t15-1` and `mem:t14-1` and do not carry the
  withdrawn reports.
- The turn-17 capsule leads with `mem:t15-1`, `mem:t14-1`, then `mem:t15-2`, `mem:t14-3`; the
  turn-18 capsule leads with `mem:t15-1`, `mem:t14-1`, then `mem:t17-1`. No withdrawn report
  reappears on either turn.
- After the first two corrections, the turn-19 capsule includes `mem:t18-1` and `mem:t18-2`.

Interpretation: the correction/supersession and recall-priority fixes remain effective on the resume
path in a genuine session. This is a scoped result, not proof of universal hallucination elimination.

## 2. What the player actually did and where clarity landed

Facts (from the driver summaries and committed campaign turns):

- Turn 17 (driver turn 1): the player declined the bible, left the sanitarium and researched at the
  Hall of Records. The accepted text introduced Corbitt's will and its executor, Michael Thomas of
  the Chapel of Contemplation.
- Turn 18 (driver turn 2): the player separated the register transcript from the executor name and
  asked the clerk to distinguish general filing limits from case-specific involvement, explicitly
  declining to record guesses as fact.
- Turn 19 (driver turn 3): the player asked for the church register itself. The clerk produced it and
  the register showed the Chapel of Contemplation cancelled in 1912, with no reason and a redirect to
  the state archive; the text noted this was six years before the Macario tenancy (1918).
- Turns 20–21 (driver turns 4–5): the player went to Central Police, then offered a written request;
  the Persuade attempt failed (roll 70 vs target 50).

Interpretation: turn 19 delivered a meaningful public chronological link (chapel closed 1912, before
the 1918 tenancy, cause unknown), grounded in the module's `clue-chapel-closed-1912` and the 1918
tenancy clue. This is useful midgame clarity. It does not show the whole plot is understood, the
culprit identified, or the story resolved.

## 3. New source fabrication still passes review

Facts:

- Turn 17 accepted text (`turns/0017.json`, commit `c303d09`; preserved in
  `turn-1-actual-delivery.json`) asserts a property register whose owner column holds only
  "沃森特·科比特" throughout with no other hand, and cut page corners with the cause absent from the
  register. The module source has no such register content.
- Turn 18 accepted text (`turns/0018.json`, commit `b674f0a`) invents an 1860s register sealing and a
  follow-on volume "产权一过手就另立新册" to explain the mismatch with Knott.
- The source reviewer accepted this in
  `.coc/mods/jobs/fa4bb21fb600d6ddd048d62cebeb8148902326e60fcb328759aa36dc6b3d32d8/accepted.json`,
  citing `original.json` `"invent minor clerks and filing quirks"` plus an `"1866 obituary"`.
  Those citations do not establish the claimed ledger cutoff or transfer-filing practice; the 1866
  obituary concerns the basement-burial lawsuit, not the property register.
- The turn-18 extraction then carried the invented cutoff forward as `mem:t18-1`
  (`kind: knowledge`, `state: accurate`, `authority: conversation_report`), and the turn-19 capsule
  surfaces it.

Interpretation: unsupported documentary facts can still pass source review in a records scene, and
`mem:t18-1` becomes a new unreliable conversational assertion available upstream. This does **not**
mutate canonical module truth, and it is **not** a defect in correction linking: faithfully extracting
delivered text (even wrong text) is working as designed here. The failure is at the source-evidence
bar, where an atmospheric-improv permission was treated as licensing a specific evidentiary date and
a filing practice.

## 4. Audit blocks some inventions but costs repeated rewrites

Facts (turn 17, all preserved under `.coc/mods/jobs/`):

- `e972fc3a62dc…` — verdict `unsupported`, 4 findings: invented lot split/merge ~1900, an
  inheritance and a mortgage-redemption transfer, red-ink rent-arrears/litigation annotations, and a
  clerk claim that the church intervened in the burial dispute. None are source-supported.
- `8313760f9d0a…` — `result.json` semantic verdict identified a deed dated 1935 where the source
  fixes construction/sale in 1835, but the submission failed deterministic evidence validation
  because it cited `request.json`, which is not one of the eight allowed source evidence files. Two
  distinct issues: the semantic date error and the disallowed evidence file. There is no
  `accepted.json` for this failed job.
- `b3a18fc68864…` — verdict `unclear`, 1 finding: relocated/unreceipted disclosures (will and burial
  clause narrated at the Hall of Records although that material belongs to the Central Library).
- `f13c6775d243…` — verdict `supported`, accepted (this is the text that was delivered).

Facts (turn 19, from `turn-3.json` and `.coc/mods/jobs/`):

- Two `narrate` calls, 237.4s total for the driver turn.
- `840bff5b1737…` was rejected with realization findings: the draft did not clearly name the register
  produced (the settled `clue:chapel-closed-1912` clue never reached the counter as a perceptible
  register) and gave no felt passage of the settled 20 minutes. Its `source_review.verdict` was
  `supported`; the findings were about realization, not source error.
- `aa08cc3767e1…` was accepted after the rewrite.

Interpretation: the source reviewer blocks some genuine inventions but its judgments and costs are
inconsistent across near-identical drafts (turn 17 needed four jobs; turn 19 needed a costly rewrite
for presentation rather than invention). This is evidence of inconsistent review judgment and latency.
It is not a deterministic claim that any particular finding is wrong.

## 5. Test-driver race truncated turn-1 accounting

Facts:

- `events.jsonl`: `agent_end` at `14:11:34.816Z`, then `agent_start` at `14:11:34.823Z` (7ms later),
  then `turn_start`/`message_start` and continued work. The driver's turn-1 summary ended early at
  `14:11:36.327Z` reporting `stop_reason=agent_end`, `wall=99.207s`. The real `agent_settled` arrived
  at `14:15:59.107Z` (actual wall 361.988s).
- `tests/play/driver.py`: `STOP_SETTLE_GRACE = 1.5`. On a terminal `agent_end` the loop sets
  `settle_deadline = time.monotonic() + STOP_SETTLE_GRACE`. The turn loop does not handle
  `agent_start` at all. `turn_start`, `tool_execution_start`, `message_update` and `message_end` set
  `saw_work` and clear `stale_deadline`, but none of them clears the armed `settle_deadline` (nor does
  `agent_start`, which is unhandled). `tool_execution_end` is handled for recording but does not set
  `saw_work` in that condition. `settle_deadline` is only cleared or re-armed by a later `agent_end`.
  So the armed 1.5s fallback fired ~1.5s after `agent_end` and ended the turn mid-work.
- `turn-1-actual-delivery.json` preserves the real accepted `rendered_text` and receipts for
  campaign turn 17 (commit `c303d09`). The original `turn-1.json` is invalid for final delivery and
  latency acceptance and is left unmodified.

Interpretation: this is a reproducible diagnostic finding in the test harness. It is not fixed in
this documentation task, and no source or test file was edited.

## 6. Cross-checks and limits

- Only turns already present were summarized. Driver turns 2–5 each report `agent_settled` matching
  the committed campaign turns (`b674f0a`, `d0e599c`, `dbe8fb9`, `0942e16`).
- Campaign turns 17–21 are the only bounded current records read (`0017.json`–`0021.json`).
- No precise clock/day contradiction is asserted: the module start clock has not been fully checked.

## Bounded recommendations (all unimplemented)

1. **Driver continuation accounting.** Clear the `STOP_SETTLE_GRACE` fallback (or re-arm it) when
   `agent_start`/`turn_start`/message/tool work resumes after a terminal `agent_end`, so a resumed
   automatic run is not summarized as a completed turn. This is a test-harness fix only.
2. **Constrain unsupported evidentiary specifics.** An atmospheric-improv permission ("invent minor
   clerks and filing quirks") should not license invented ownership histories, ledger cutoffs,
   transfer/custody practices, or evidentiary dates. Source review should treat these as unsupported
   unless a source node establishes them.
3. **Improve review focus and cost before claiming reliability.** Reduce repeated rewrite loops for
   presentation-level findings and make the accept/revise line more consistent across equivalent
   drafts. Until then, do not claim the reviewer reliably distinguishes invention from realization.

Deliberately out of scope: regex semantics, a new memory database, additional mandatory always-on
model lanes, and generic architecture changes.

## Retained artifacts

- Campaign: `.coc/campaigns/continuity-venue-live/turns/0017.json`–`0021.json`, `turn.json`,
  `memory/candidates.jsonl`, `memory/episodes.jsonl`.
- Run: `.coc/playtests/continuity-memory-resume/` (`turn-1.json`, `turn-1-actual-delivery.json`,
  `verification.json`, `turn-2.json`–`turn-5.json`, `driver.log`, `events.jsonl`, `heartbeat.json`).
- Audit jobs: `.coc/mods/jobs/fa4bb21fb600d6ddd048d62cebeb8148902326e60fcb328759aa36dc6b3d32d8/`,
  `.coc/mods/jobs/e972fc3a62dc…`, `8313760f9d0a…`, `b3a18fc68864…`, `f13c6775d243…`,
  `840bff5b1737…`, `aa08cc3767e1…`.
