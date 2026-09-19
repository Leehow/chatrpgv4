# Keeper latency trial — 2026-09-19

## Decision

**No latency improvement demonstrated. The experimental product changes were withdrawn; stop this optimization trial.** Do not interpret the observed slowdown as caused by the change: the sample is small, model outputs differ, and the targeted refusal did not occur in the baseline.

The experiment removed the obsolete twelve-character shared-substring speech refusal from `ask`/`narrate`, retaining speech extraction, the existing independent narrative review and transactional delivery. Contract §113 already rejects a character-count/subsequence narrative gate, but the implementation and its existing test still contain it. This discrepancy remains a separate finding, not a performance fix retained without evidence.

## Method

- Baseline checkout: `0.9.3a`, `6f830a057`; existing unrelated working-tree changes were preserved.
- Build each variant with `npm run build:runtime`.
- Start each fresh campaign with `tests/play/driver.py`, `bin/pi-coc`, `--model xai/grok-4.6`, `--pregen thomas-hayes`, `--module the-haunting`, `--play-language zh-Hans`. The play profile selected `low` thinking.
- The main session acted as the only player, sending one natural-language input at a time and reading each response before continuing. The second campaign used the same three player inputs; there was no scripted player or substitute Keeper.
- Each variant contains one live three-turn run, not a randomized crossover or a statistical benchmark.
- This was a shared working tree, not an isolated frozen A/B checkout. During the trial, another task advanced HEAD to `302e2dd31` and left unrelated NPC/healing/rules edits. These changes were not reverted or included in this task's commit. This further prevents attributing timing differences solely to the experimental change.
- Both runs are stopped. Evidence and the experimental source snapshot are retained.

### Timing definitions and limitations

`total` is the driver's `wall_seconds`, from the turn request through settlement. The first request can queue behind the automatic opening; turn 1 is therefore reported but excluded from the warm-turn means.

`story event` is the earliest successful `narrate`/`ask` `tool_execution_end` whose `result.details.rendered_text` exactly matches that turn's final accepted story. It uses the RPC receive timestamp relative to the same turn start. Opening text from a different turn, thinking, raw tool arguments, notices and progress labels are excluded. The corresponding host `coc-delivery` event arrived within milliseconds of this event in these samples.

**This is an accepted-story delivery timestamp, not a measured DOM paint or actual first visible streamed character.** The driver owns its Pi process and has no existing connection to the application's renderer. The requested exact UI first-character measurement remains unmeasured; it must not be presented as a pass or replaced by provider TTFT. Millisecond differences between the driver monotonic duration and event wall clock are not an improvement.

Both variants encountered the starter's missing-original-PDF lookup refusal; the baseline also never exercised the removed `repeated_line` gate. Results apply to these conversations only, not all campaigns or a successfully configured reranker.

## Results

Seconds, rounded to one decimal:

| Player turn | Baseline total | Trial total | Baseline story event | Trial story event |
| --- | ---: | ---: | ---: | ---: |
| 1 — includes opening queue | 140.9 | 191.3 | 140.9 | 191.3 |
| 2 | 62.8 | 84.2 | 62.8 | 84.2 |
| 3 | 73.2 | 131.8 | 73.2 | 131.8 |
| Mean of turns 2–3 | 68.0 | 108.0 | 68.0 | 108.0 |

Warm-turn total and story-event means were approximately **58.9% higher** in the trial. Both warm turns took three Keeper provider rounds in either variant. There is no observed reduction in model round trips, and no successful rerank experiment was performed.

## Verification and disposition

- Trial `npm run check:kernel`: passed.
- Trial `npm run build:runtime`: passed.
- Trial `uv run --frozen python -m pytest tests/kernel/test_speech.py -q`: 11 passed.
- Cold code review: no blocking code defect; it noted that `prompts/keeper.md` still describes the removed refusal. Because the entire trial was withdrawn, no separate prompt change was made.
- The trial changes to `kernel-ts/write/index.ts`, `kernel-ts/write/speech.ts`, `tests/kernel/test_speech.py` and the added §113 implementation paragraph were reversed precisely. Unrelated concurrent contract edits were preserved.
- After withdrawal, `npm run check:kernel`, `npm run build:runtime` and the restored `tests/kernel/test_speech.py` suite passed (10 tests). The three code/test paths no longer have a diff; the remaining contract diff belongs to the other task.
- No renderer streaming change, package installation or application restart was performed. No further optimization is included in this task.

## Retained evidence

- `.coc/playtests/latency-trial-before-20260919/`
- `.coc/playtests/latency-trial-after-20260919/`
- `.coc/campaigns/latency-trial-before-20260919/`
- `.coc/campaigns/latency-trial-after-20260919/`
- `.coc/playtests/latency-trial-comparison-20260919/comparison.json`
- `.coc/playtests/latency-trial-comparison-20260919/measure.mjs`
- `.coc/playtests/latency-trial-comparison-20260919/experimental-source/`

Recompute the measurements without model calls:

```bash
node .coc/playtests/latency-trial-comparison-20260919/measure.mjs
```
