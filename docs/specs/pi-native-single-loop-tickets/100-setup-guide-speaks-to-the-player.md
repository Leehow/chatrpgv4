Status: ready-for-human (filed 2026-09-26 from the Masks PDF table; batch 18; P2: the setup guide reads out host internals; implemented 2026-09-26 on claude/sl98-20260926 with SL-98)
Stage: SL-100 (setup: waits and failures are told in the player's terms)
Spec: prompts/setup.md, `extensions/onboarding/index.ts` (the error texts the guide paraphrases), docs/kernel-rpc.md §14.18 / §98

# SL-100: the setup guide tells the player about job ids, quotas and the host

## Evidence (the Masks PDF table, player transcript)
- "系统仍卡在同一份任务上"
- "刚才卡过一次额度，现在重试中" (this was the reader's internal token budget, not a quota)
- "任务换了一号，说明有在往前走"
- "系统说「选中的开场没法生成人物指引」"
- "可能要换模组源、换开场数据，或等宿主修好这份 PDF 的引导"
- "也可以考虑换一份更干净的 PDF"

The guide paraphrases the host's machine-facing `error` and `fix` strings and job telemetry straight to the player.

## Ruling
- The guide says what the player needs: the book is still being read (roughly how long), which choice is theirs to make, and what they can do now.
- Job numbers, budgets, quotas, "host" and internal step names never reach the player.
- The fix is structural. The host gives the guide a player-facing reason with each wait or refusal, as §55's notices do for the Keeper; the machine text stays machine-facing. Plus the setup prompt's rule.
- No word lists filtering the guide's output.

## Scope and tests
- The setup refusal and wait payloads carry a player-facing reason.
- prompts/setup.md tells the guide to use it.
- A test that the setup wait result exposes it.
- The live check is the Masks re-run's transcript.

## Comments

- 2026-09-26, implementation with SL-98 (claude/sl98-20260926, from 6f1b2f5be): contract `978961a74` (§14.19.4),
  code and tests `f87f79b0b`.
  - Every setup wait or refusal the player can act on carries `player_reason`: a reading still running (by
    `details.read.purpose`: the book's structure, the chosen opening, the character's introduction, plus roughly how
    long this setup has waited on that same reading), a failed reading being retried, an opening to choose, a blocked
    turn by kind and cause, a failed guidance preparation, `setup.complete`'s `opening_preparing`, an unreadable PDF,
    a reader model without vision. Chosen by `extensions/onboarding/reasons.ts` `playerReason` from closed codes only
    (never the result's prose); attached by `withReason` (`extensions/onboarding/index.ts:730`) and
    `setupBlockRefusal` (`:104`). The machine half is unchanged. A refusal of the guide's own call has none.
  - `prompts/setup.md` "Waits, refusals and the book's openings": say `player_reason` in play_language, never job
    numbers, budgets, quotas, reviewers, the host, tools or step names; a result without it is the guide's own call.
  - **Language.** There is no existing mechanism for guide-relayed reasons: the caption lane (§23) projects host-placed
    words the player reads directly (notices, the status line), and a sentence the guide relays is the guide's to
    write. So the reason is English-sourced and the guide writes it in play_language (§23's first leg), with no table
    per language and no reading of the guide's output.
  - Tests: `tests/extension/setup-player-reasons.test.mjs` (4, incl. the prompt names the emitted field), the wait,
    block and question cases in `setup-opening-choice.test.mjs` (the reading-timeout reason names no job id, step or
    op, and says "about 5 minutes" on a clock moved 5 minutes). Mutations M14-M16 and M18 killed.
  - **Open.** The live check (the Masks re-run's transcript); `bad_pdf` / `vision_required` reasons are unit-tested
    only, not driven through the setup tool.
