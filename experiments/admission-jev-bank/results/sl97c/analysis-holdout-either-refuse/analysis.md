# SL-97b analysis

Labels: lane verdicts in the replayed set ({"entailed":114,"authorized":106,"not_authorized":44,"not_player_action":65,"uncertain":1}); bank mix used for reweighting: {"not_authorized":726,"authorized":3566,"entailed":723,"not_player_action":170,"uncertain":2,"review_pending":9}.

## holdout-2a.3

typed 330 of 330 labelled; confidence median 0.526 (p25 0.2632, p75 0.76); latency p50 407 ms, p90 602 ms (n=330)

| T | decided | coverage | exact | admit/refuse | false admits | false refusals | settled admits | FA share (sample) | FA share (bank mix) | FA Wilson upper |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 330 | 100.0% | 62.1% | 73.6% | 14 | 73 | 226 | 6.2% | 6.1% | 10.1% |
| 0.5 | 173 | 52.4% | 79.2% | 90.2% | 3 | 14 | 148 | 2.0% | 2.3% | 5.8% |
| 0.6 | 148 | 44.9% | 79.0% | 89.9% | 3 | 12 | 128 | 2.3% | 2.6% | 6.7% |
| 0.7 | 113 | 34.2% | 85.0% | 92.0% | 0 | 9 | 97 | 0.0% | 0.0% | 3.8% |
| 0.8 | 69 | 20.9% | 87.0% | 92.8% | 0 | 5 | 61 | 0.0% | 0.0% | 5.9% |
| 0.85 | 42 | 12.7% | 90.5% | 95.2% | 0 | 2 | 38 | 0.0% | 0.0% | 9.2% |
| 0.87 | 34 | 10.3% | 88.2% | 94.1% | 0 | 2 | 30 | 0.0% | 0.0% | 11.3% |
| 0.9 | 26 | 7.9% | 88.5% | 96.2% | 0 | 1 | 23 | 0.0% | 0.0% | 14.3% |
| 0.95 | 5 | 1.5% | 100.0% | 100.0% | 0 | 0 | 4 | 0.0% | 0.0% | 49.0% |

Source persona-bench only (307 labelled): T -> settled admits / false admits / false refusals / admit-refuse agreement

| T=0 | T=0.5 | T=0.6 | T=0.7 | T=0.8 | T=0.85 | T=0.87 | T=0.9 | T=0.95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 208/14/69/73.0% | 133/3/14/89.2% | 115/3/12/88.9% | 86/0/9/91.2% | 54/0/5/91.9% | 33/0/2/94.6% | 26/0/2/93.3% | 21/0/1/95.8% | 4/0/0/100.0% |

Source table only (23 labelled): T -> settled admits / false admits / false refusals / admit-refuse agreement

| T=0 | T=0.5 | T=0.6 | T=0.7 | T=0.8 | T=0.85 | T=0.87 | T=0.9 | T=0.95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 18/0/4/82.6% | 15/0/0/100.0% | 13/0/0/100.0% | 11/0/0/100.0% | 7/0/0/100.0% | 5/0/0/100.0% | 4/0/0/100.0% | 2/0/0/100.0% | 0/0/0/- |

Per lane label at T=0 (same admission / exact, of decided):

| lane label | of | decided | same admission | exact |
| --- | --- | --- | --- | --- |
| authorized | 106 | 106 | 77 (72.6%) | 62 |
| entailed | 114 | 114 | 101 (88.6%) | 99 |
| not_player_action | 65 | 65 | 34 (52.3%) | 13 |
| not_authorized | 44 | 44 | 31 (70.5%) | 31 |
| uncertain | 1 | 1 | 0 (0.0%) | 0 |

Per batch class, settled admits / false admits by threshold:

| class | of (lane refusals) | T=0 | T=0.5 | T=0.6 | T=0.7 | T=0.8 | T=0.85 | T=0.87 | T=0.9 | T=0.95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| time | 110 (7) | 98/1 | 81/0 | 73/0 | 61/0 | 43/0 | 29/0 | 23/0 | 18/0 | 3/0 |
| move | 110 (29) | 72/10 | 42/2 | 35/2 | 28/0 | 15/0 | 8/0 | 6/0 | 4/0 | 1/0 |
| clue | 110 (9) | 56/3 | 25/1 | 20/1 | 8/0 | 3/0 | 1/0 | 1/0 | 1/0 | 0/0 |
| resolve | 0 (0) | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| other | 0 (0) | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |

Per batch class, false-admit share at the class's own bank refusal rate (upper bound from Wilson bounds on both settle rates):

| class | bank refusal rate | T=0 | T=0.5 | T=0.6 | T=0.7 | T=0.8 | T=0.85 | T=0.87 | T=0.9 | T=0.95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| time | 6.7% | 1.1% (<= 4.0%) | 0.0% (<= 3.5%) | 0.0% (<= 3.9%) | 0.0% (<= 4.9%) | 0.0% (<= 7.2%) | 0.0% (<= 11.0%) | 0.0% (<= 14.1%) | 0.0% (<= 18.2%) | 0.0% (<= 71.7%) |
| move | 15.0% | 7.3% (<= 12.3%) | 2.4% (<= 9.1%) | 2.9% (<= 11.2%) | 0.0% (<= 7.6%) | 0.0% (<= 15.1%) | 0.0% (<= 28.8%) | 0.0% (<= 37.4%) | 0.0% (<= 51.5%) | 0.0% (<= 90.4%) |
| clue | 12.7% | 8.5% (<= 18.0%) | 6.4% (<= 27.7%) | 7.9% (<= 33.8%) | 0.0% (<= 51.7%) | 0.0% (<= 81.1%) | 0.0% (<= 96.1%) | 0.0% (<= 96.1%) | 0.0% (<= 96.1%) | - (<= 100.0%) |
| resolve | 16.9% | - (<= -) | - (<= -) | - (<= -) | - (<= -) | - (<= -) | - (<= -) | - (<= -) | - (<= -) | - (<= -) |
| other | 13.4% | - (<= -) | - (<= -) | - (<= -) | - (<= -) | - (<= -) | - (<= -) | - (<= -) | - (<= -) | - (<= -) |

## holdout-2a.3-single

typed 330 of 330 labelled; confidence median 0.78 (p25 0.5, p75 0.94); latency p50 407 ms, p90 602 ms (n=330)

| T | decided | coverage | exact | admit/refuse | false admits | false refusals | settled admits | FA share (sample) | FA share (bank mix) | FA Wilson upper |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 330 | 100.0% | - | 78.2% | 33 | 39 | 279 | 11.8% | 11.7% | 16.2% |
| 0.5 | 248 | 75.1% | - | 87.1% | 23 | 9 | 235 | 9.8% | 9.2% | 14.3% |
| 0.6 | 222 | 67.3% | - | 90.1% | 15 | 7 | 212 | 7.1% | 6.7% | 11.3% |
| 0.7 | 194 | 58.8% | - | 93.3% | 9 | 4 | 187 | 4.8% | 4.3% | 8.9% |
| 0.8 | 162 | 49.1% | - | 95.1% | 7 | 1 | 160 | 4.4% | 3.6% | 8.8% |
| 0.85 | 141 | 42.7% | - | 97.2% | 4 | 0 | 140 | 2.9% | 2.0% | 7.1% |
| 0.87 | 129 | 39.1% | - | 99.2% | 1 | 0 | 128 | 0.8% | 0.1% | 4.3% |
| 0.9 | 115 | 34.8% | - | 99.1% | 1 | 0 | 114 | 0.9% | 0.1% | 4.8% |
| 0.95 | 70 | 21.2% | - | 100.0% | 0 | 0 | 70 | 0.0% | 0.0% | 5.2% |

Source persona-bench only (307 labelled): T -> settled admits / false admits / false refusals / admit-refuse agreement

| T=0 | T=0.5 | T=0.6 | T=0.7 | T=0.8 | T=0.85 | T=0.87 | T=0.9 | T=0.95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 257/32/38/77.2% | 219/23/8/86.6% | 197/15/7/89.4% | 174/9/4/92.8% | 147/7/1/94.6% | 128/4/0/96.9% | 116/1/0/99.2% | 104/1/0/99.1% | 63/0/0/100.0% |

Source table only (23 labelled): T -> settled admits / false admits / false refusals / admit-refuse agreement

| T=0 | T=0.5 | T=0.6 | T=0.7 | T=0.8 | T=0.85 | T=0.87 | T=0.9 | T=0.95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 22/1/1/91.3% | 16/0/1/94.1% | 15/0/0/100.0% | 13/0/0/100.0% | 13/0/0/100.0% | 12/0/0/100.0% | 12/0/0/100.0% | 10/0/0/100.0% | 7/0/0/100.0% |

Per lane label at T=0 (same admission / exact, of decided):

| lane label | of | decided | same admission | exact |
| --- | --- | --- | --- | --- |
| authorized | 106 | 106 | 96 (90.6%) | 0 |
| entailed | 114 | 114 | 104 (91.2%) | 0 |
| not_player_action | 65 | 65 | 46 (70.8%) | 0 |
| not_authorized | 44 | 44 | 12 (27.3%) | 0 |
| uncertain | 1 | 1 | 0 (0.0%) | 0 |

Per batch class, settled admits / false admits by threshold:

| class | of (lane refusals) | T=0 | T=0.5 | T=0.6 | T=0.7 | T=0.8 | T=0.85 | T=0.87 | T=0.9 | T=0.95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| time | 110 (7) | 108/6 | 98/2 | 94/1 | 86/0 | 77/0 | 70/0 | 65/0 | 57/0 | 31/0 |
| move | 110 (29) | 97/22 | 92/19 | 80/12 | 72/8 | 66/6 | 59/4 | 53/1 | 50/1 | 37/0 |
| clue | 110 (9) | 74/5 | 45/2 | 38/2 | 29/1 | 17/1 | 11/0 | 10/0 | 7/0 | 2/0 |
| resolve | 0 (0) | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| other | 0 (0) | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |

Per batch class, false-admit share at the class's own bank refusal rate (upper bound from Wilson bounds on both settle rates):

| class | bank refusal rate | T=0 | T=0.5 | T=0.6 | T=0.7 | T=0.8 | T=0.85 | T=0.87 | T=0.9 | T=0.95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| time | 6.7% | 5.8% (<= 6.8%) | 2.1% (<= 5.0%) | 1.1% (<= 4.2%) | 0.0% (<= 3.3%) | 0.0% (<= 3.7%) | 0.0% (<= 4.1%) | 0.0% (<= 4.5%) | 0.0% (<= 5.2%) | 0.0% (<= 10.3%) |
| move | 15.0% | 12.6% (<= 15.4%) | 11.3% (<= 14.7%) | 8.0% (<= 12.3%) | 5.8% (<= 10.4%) | 4.7% (<= 9.6%) | 3.5% (<= 8.6%) | 0.9% (<= 5.4%) | 1.0% (<= 5.7%) | 0.0% (<= 5.5%) |
| clue | 12.7% | 10.6% (<= 16.7%) | 7.1% (<= 19.3%) | 8.3% (<= 22.8%) | 5.5% (<= 24.1%) | 9.3% (<= 38.8%) | 0.0% (<= 41.3%) | 0.0% (<= 44.3%) | 0.0% (<= 56.2%) | 0.0% (<= 88.9%) |
| resolve | 16.9% | - (<= -) | - (<= -) | - (<= -) | - (<= -) | - (<= -) | - (<= -) | - (<= -) | - (<= -) | - (<= -) |
| other | 13.4% | - (<= -) | - (<= -) | - (<= -) | - (<= -) | - (<= -) | - (<= -) | - (<= -) | - (<= -) | - (<= -) |

## Lane disagreement floor

| pairs | ordered pairs | flip rate | FA share: P(A refuses given B admits) | P(B admits given A refuses) |
| --- | --- | --- | --- | --- |
| same model, repeated | 1640 | 3.2% | 1.8% | 12.6% |
| sl24 opencode-go/deepseek-v4.1-flash | 144 | 2.8% | 1.4% | 100.0% |
| sl30 opencode-go/deepseek-v4.1-flash | 156 | 2.6% | 1.3% | 100.0% |
| sl39-alternatives grok-build/grok-4.7-build-fast | 318 | 7.5% | 4.7% | 19.4% |
| sl39-alternatives opencode-go/deepseek-v4.1-flash | 314 | 1.3% | 0.7% | 8.3% |
| sl39-alternatives opencode-go/qwen3.8-flash | 106 | 0.0% | 0.0% | 0.0% |
| sl39-alternatives xai/grok-4.6 | 318 | 1.3% | 0.9% | 2.3% |
| sl39-latency:a_current opencode-go/deepseek-v4.1-flash | 140 | 2.9% | 1.5% | 20.0% |
| sl39-latency:b_fast_setting opencode-go/deepseek-v4.1-flash | 144 | 5.6% | 3.0% | 33.3% |
| cross model (SL-39 alternatives) | 4342 | 11.3% | 6.7% | 35.3% |

