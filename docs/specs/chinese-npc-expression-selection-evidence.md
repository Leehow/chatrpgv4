# Chinese NPC Expression Selection — Evidence Report

## Status and authoritative facts

Implementation/testing was explicitly authorized with Flapcode GPT Luna and the approved 800 ms first-request wait. Current package: 1.3.6, family 7; full 2122 UTF-8 bytes, brief 1090 bytes, cap 1200. This is a narrower pre-draft selection design, not a release or App-acceptance record. The root was the sole one-utterance player; selected cards were verified as serialized before drafting, not inferred from server acknowledgement. Existing voice ownership, NPC state, and cards remain unchanged.

## Tests

An earlier complete extension test passed 4361/4361 at its prior content snapshot (first-wait implementation and mod 1.3.4 content); it is not the exact final-package suite. The final same-code/current-content full suite was still running when this report was prepared: **{"status":"passed","total":4361,"passed":4361,"failed":0,"seconds":624,"host":"LeehowPC WSL","test_concurrency":4,"source":"8f61cbc5533f84eb11fa2890068fc6578010912c","package":"zh-optimize1.3.6","log":"/Users/haoli/Documents/TRPG/小说/对白研究-20261001/selection-redesign-20261002/final136-ext-4361-0.log"}**. Focused final checks, kernel mod-director 13, typecheck, and LAN runtime build passed as recorded in facts.json. These do not erase the historical red 4334/4338 suite, failed screens, or other historical failures.

Source integration result: **{"status":"integrated","branch":"0.9.6a","commit":"02d76bac1bdcb582f0b88c759e7ccccd118da2f5","source":"8f61cbc5533f84eb11fa2890068fc6578010912c","files":28,"concurrent_files_preserved":true}**. The intended method preserves the main checkout dirty `blood-road-jev-two-chapter-playtest.md` plan and the colliding untracked original proposal; no App packaging or release is included.

## Runtime policy and implementation boundary

Family 7 makes one nullable pre-draft decision batch. Host accepts at most one habit and one interaction, then exact-materializes the selected advisory card material into the existing single Keeper request. The package is 6 habits plus 13 interactions (19 cards). The first eligible request for an exact writing snapshot may wait only to 800 ms from that attempt start. Same-snapshot mandatory preparation spends the window; obsolete provisional snapshots do not; after the first eligible request spends it, no renewal occurs. There are at most two attempts per input and a 1200 ms work allowance. Stale/cancelled/absent advice falls back; no extra prose model, judge, or rewrite is added.

The guide preserves immediate NPC purpose, shared knowledge, stance, observable narration, and natural formal or long answers. One repaired practical example, authored by tool-Pi in Chinese, stops irrelevant room logistics being volunteered in reply to a name introduction; no other example changed.

## Live and literary limits

Live evidence: version 1.3.5 delivered 7/7 turns (224.3 seconds total); version 1.3.6 delivered 2/3, with one empty caused by Flapcode HTTP 429 rate limiting (82.2 seconds total). Observed replies and latency are limited evidence only: they do not prove perfection, statistical quality advantage, causal A/B speed, deployment, release, or App acceptance. Earlier v5/v6 blind trials were inconclusive; retain the old failed static screen, all undelivered evidence, and historical red suite logs. Formal or repetitive replies can be source-directed rather than defects.

The 1.3.6 telemetry records actual selected cards, provider-bound serialized inclusion, waits of 0 ms and 796 ms, a cancelled fallback, and delivered outputs of 1230 and 752 bytes. These observations do not establish general literary quality or whole-turn speed.

## Historical proposal status

The broad original proposal and all its historical requirements remain preserved. Its former candidate/pending-approval clauses are obsolete only as approval status: the user explicitly authorized implementation/testing and the 800 ms wait. Do not mark every proposed gate fulfilled; old quality, held-out, owner, genuine-play, old-world, and release gates remain distinct historical requirements and limits.

```json
{
  "run": "npc-expression-final-close-20261002",
  "version": "1.3.6",
  "turns": 3,
  "delivered": 2,
  "undelivered_with_tools": 1,
  "total_seconds": 134.1,
  "ending_effects": [
    {
      "is_error": true,
      "result": "needs: settle the chapter's rewards and investigator development before ending the campaign\nretryable: false\nnext: change_input\nfix: read the source conclusion/rewards with lookup kind=secret scope=module, whose endings say what this book awards and what it asks for first; resolve development:end-session with the source-authored scenario_san_reward_expr when the source declares one, and without it when the source declares none -- an omitted reward settles the ending with no scenario award, a figure you chose does not exist; or development:settle-ending if a settlement is pending; then retry apply ending"
    },
    {
      "is_error": true,
      "result": "needs: settle the chapter's rewards and investigator development before ending the campaign\nretryable: false\nnext: change_input\nfix: read the source conclusion/rewards with lookup kind=secret scope=module, whose endings say what this book awards and what it asks for first; resolve development:end-session with the source-authored scenario_san_reward_expr when the source declares one, and without it when the source declares none -- an omitted reward settles the ending with no scenario award, a figure you chose does not exist; or development:settle-ending if a settlement is pending; then retry apply ending"
    },
    {
      "is_error": true,
      "result": "needs: settle the chapter's rewards and investigator development before ending the campaign\nretryable: false\nnext: change_input\nfix: read the source conclusion/rewards with lookup kind=secret scope=module, whose endings say what this book awards and what it asks for first; resolve development:end-session with the source-authored scenario_san_reward_expr when the source declares one, and without it when the source declares none -- an omitted reward settles the ending with no scenario award, a figure you chose does not exist; or development:settle-ending if a settlement is pending; then retry apply ending"
    }
  ],
  "records": "/Users/haoli/Documents/TRPG/小说/对白研究-20261001/selection-redesign-20261002/closeout-evidence/live-final-close.json"
}
```
