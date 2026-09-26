Status: ready (filed 2026-09-26 from the Masks PDF table; batch 18; P2: the setup guide reads out host internals)
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
