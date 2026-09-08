# Real-table defect repairs, 2026-09-07

Scope: the user's two-session report, items 7–21. The three explicitly excluded
behaviors are unchanged. Work is on `0.9.0a`; existing unrelated changes are retained.
No original campaign or playtest evidence was removed or migrated.

| Item | Change and evidence |
| --- | --- |
| 7 | Queue streaming player input until agent settlement, then enter the ordinary prompt hook. Extension regression passes. Fresh Grok play recorded the first message verbatim as player turn 1 and answered it. |
| 8 | Reuse combat wound triage for environmental damage and chase HP loss. Zero HP yields unconsciousness; major wounds can produce dying; a hit above maximum HP produces death. Add `apply ending`, committed by `narrate`, with completed campaign metadata and replay/read access. RPC coverage and a real Grok ending both passed. |
| 9 | Do not supply maneuver's undeclared weapon semantic slot. Route flee during a chase through its movement/combat intent. Combat and chase RPC regressions pass. |
| 10 | An attack with target, weapon and defense=none settles against a non-resisting target through the existing pending-attack resolver in the same call. A real roll/receipt is required by the regression. |
| 11 | Keep the object's item name separate from the Keeper-selected rules profile. Guidance now explains this existing path. Regression obtains a sledgehammer bound to club_large and attacks using sledgehammer. No object-name classifier or invented damage table. |
| 12 | **Unresolved.** Current source history API returns 279 and 251 entries for the two found playtest sessions. Their files now contain 520 and 462 lines; neither matches the reported 116-line snapshot. The reported port 5175 was unavailable through browser tooling. No speculative cursor change was made. Exact session filename/port requested. |
| 13 | Opening host instructions carry the actual play_language. Fresh Grok opening was Chinese on its first delivery, without a language refusal. |
| 14 | Keeper instructions require exact candidate names and explicitly identify push-luck:luck-roll. This is prompt guidance, not a new alias for a guessed decision. Repeated-error behavior still needs a longer live check. |
| 15 | Opening ask is legal at turn zero; opening instructions route needed choices to ask. Fresh Grok opening produced one coc-choice entry with four options. Actual GUI clicking is not claimed. |
| 16 | Handout delivery records take precedence over their same-named assets; exact semantic handles take precedence over display aliases. The reported map name passes through apply in an RPC regression. |
| 17 | Existing player glossary travels from narrate/ask through coc-mechanics and bus events into renderer details. Fresh play emitted two mechanics entries, each with 88 glossary labels. Frontend projection tests pass. |
| 18 | Choice names use ASCII binding/turn identity, never the prompt. Regression requires ask-story-t0. Earlier real evidence has ask-none-t0, also ASCII; the subsequent fallback correction is tested separately. |
| 19 | Extend language guard to PipiCOC agent, sheet, bridge and RPC sources. Player renderer strings remain outside agent-side scope. |
| 20 | README Web instructions now require pipicoc/install first. |
| 21 | A tool-enabled Pi reader supplied a concise Crane clue title. Source clue data carries the title separately; the projector preserves it; generated graph and manifest are rebuilt. Reprojection/digest tests pass. Existing module evidence was not overwritten. |

## Validation

- Full kernel/play suite before the final source-data regeneration: 1075 passed,
  two failures, both starter graph/digest consistency for the corrected clue title.
- After regeneration and final fixes: all 59 targeted starter, narration, apply,
  session and item/cash tests passed, including both previously failing cases.
- Extension suite: 119 passed after final extension changes.
- Frontend projection/panel checks: 12 passed.
- Web production build passed (`npm --prefix Electron run build:web`).
- Fresh Grok setup: `.coc/playtests/defect-repair-setup/`.
- Fresh Grok play: `.coc/playtests/defect-repair-play/`; campaign
  `.coc/campaigns/haunting-zh-hayes/`. Opening plus two actual player turns,
  ending in refusal of the commission. Turn 1 contains the startup player message;
  turn 2 contains the campaign-ending receipt and committed conclusion.
- Both task-owned drivers were stopped; their evidence remains.

The short live run validates startup, language, structured-choice emission, glossary
transport and campaign conclusion. Combat/wound paths have deterministic RPC evidence,
not a new 45-turn live acceptance. Item 12 and GUI choice interaction remain open.

## Isolated commit-snapshot validation

The staged tree was exported without the unrelated PDF/onboarding changes or
untracked source files. Its kernel/play suite passed 1060 tests with 1 skip;
its extension suite passed 108 tests; its frontend projection suite passed 5 tests.
All three commands exited with status zero. The language guard in this commit
covers the tracked PipiCOC agent/sheet/bridge/RPC sources; onboarding additions
remain with their separate uncommitted implementation.
