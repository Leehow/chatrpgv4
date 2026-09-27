# SL-97b analysis

Labels: lane verdicts in the replayed set ({"entailed":119,"authorized":116,"not_authorized":28,"not_player_action":67}); bank mix used for reweighting: {"not_authorized":726,"authorized":3566,"entailed":723,"not_player_action":170,"uncertain":2,"review_pending":9}.

## holdout-2a.3

typed 330 of 330 labelled; confidence median 0.526 (p25 0.2632, p75 0.76); latency p50 407 ms, p90 602 ms (n=330)

| T | decided | coverage | exact | admit/refuse | false admits | false refusals | settled admits | FA share (sample) | FA share (bank mix) | FA Wilson upper |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 330 | 100.0% | 61.2% | 73.3% | 6 | 82 | 226 | 2.6% | 4.6% | 5.7% |
| 0.5 | 173 | 52.4% | 76.3% | 87.9% | 2 | 19 | 148 | 1.4% | 2.5% | 4.8% |
| 0.6 | 148 | 44.9% | 75.7% | 87.2% | 2 | 17 | 128 | 1.6% | 2.9% | 5.5% |
| 0.7 | 113 | 34.2% | 81.4% | 88.5% | 0 | 13 | 97 | 0.0% | 0.0% | 3.8% |
| 0.8 | 69 | 20.9% | 82.6% | 88.4% | 0 | 8 | 61 | 0.0% | 0.0% | 5.9% |
| 0.85 | 42 | 12.7% | 85.7% | 90.5% | 0 | 4 | 38 | 0.0% | 0.0% | 9.2% |
| 0.87 | 34 | 10.3% | 82.3% | 88.2% | 0 | 4 | 30 | 0.0% | 0.0% | 11.3% |
| 0.9 | 26 | 7.9% | 80.8% | 88.5% | 0 | 3 | 23 | 0.0% | 0.0% | 14.3% |
| 0.95 | 5 | 1.5% | 80.0% | 80.0% | 0 | 1 | 4 | 0.0% | 0.0% | 49.0% |

Source persona-bench only (307 labelled): T -> settled admits / false admits / false refusals / admit-refuse agreement

| T=0 | T=0.5 | T=0.6 | T=0.7 | T=0.8 | T=0.85 | T=0.87 | T=0.9 | T=0.95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 208/6/78/72.6% | 133/2/19/86.7% | 115/2/17/85.9% | 86/0/13/87.3% | 54/0/8/87.1% | 33/0/4/89.2% | 26/0/4/86.7% | 21/0/3/87.5% | 4/0/1/80.0% |

Source table only (23 labelled): T -> settled admits / false admits / false refusals / admit-refuse agreement

| T=0 | T=0.5 | T=0.6 | T=0.7 | T=0.8 | T=0.85 | T=0.87 | T=0.9 | T=0.95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 18/0/4/82.6% | 15/0/0/100.0% | 13/0/0/100.0% | 11/0/0/100.0% | 7/0/0/100.0% | 5/0/0/100.0% | 4/0/0/100.0% | 2/0/0/100.0% | 0/0/0/- |

Per lane label at T=0 (same admission / exact, of decided):

| lane label | of | decided | same admission | exact |
| --- | --- | --- | --- | --- |
| authorized | 116 | 116 | 82 (70.7%) | 65 |
| entailed | 119 | 119 | 103 (86.6%) | 101 |
| not_player_action | 67 | 67 | 35 (52.2%) | 14 |
| not_authorized | 28 | 28 | 22 (78.6%) | 22 |
| uncertain | 0 | 0 | 0 (-) | 0 |

Per batch class, settled admits / false admits by threshold:

| class | of (lane refusals) | T=0 | T=0.5 | T=0.6 | T=0.7 | T=0.8 | T=0.85 | T=0.87 | T=0.9 | T=0.95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| time | 110 (3) | 98/0 | 81/0 | 73/0 | 61/0 | 43/0 | 29/0 | 23/0 | 18/0 | 3/0 |
| move | 110 (19) | 72/5 | 42/1 | 35/1 | 28/0 | 15/0 | 8/0 | 6/0 | 4/0 | 1/0 |
| clue | 110 (6) | 56/1 | 25/1 | 20/1 | 8/0 | 3/0 | 1/0 | 1/0 | 1/0 | 0/0 |
| resolve | 0 (0) | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| other | 0 (0) | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |

Per batch class, false-admit share at the class's own bank refusal rate (upper bound from Wilson bounds on both settle rates):

| class | bank refusal rate | T=0 | T=0.5 | T=0.6 | T=0.7 | T=0.8 | T=0.85 | T=0.87 | T=0.9 | T=0.95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| time | 6.7% | 0.0% (<= 4.5%) | 0.0% (<= 5.7%) | 0.0% (<= 6.4%) | 0.0% (<= 7.8%) | 0.0% (<= 11.3%) | 0.0% (<= 17.0%) | 0.0% (<= 21.3%) | 0.0% (<= 26.8%) | 0.0% (<= 80.7%) |
| move | 15.0% | 5.9% (<= 11.9%) | 2.0% (<= 10.9%) | 2.4% (<= 13.4%) | 0.0% (<= 11.8%) | 0.0% (<= 22.4%) | 0.0% (<= 39.6%) | 0.0% (<= 49.2%) | 0.0% (<= 63.2%) | 0.0% (<= 93.8%) |
| clue | 12.7% | 4.4% (<= 15.9%) | 9.5% (<= 33.8%) | 11.7% (<= 40.6%) | 0.0% (<= 59.0%) | 0.0% (<= 85.2%) | 0.0% (<= 97.1%) | 0.0% (<= 97.1%) | 0.0% (<= 97.1%) | - (<= 100.0%) |
| resolve | 16.9% | - (<= -) | - (<= -) | - (<= -) | - (<= -) | - (<= -) | - (<= -) | - (<= -) | - (<= -) | - (<= -) |
| other | 13.4% | - (<= -) | - (<= -) | - (<= -) | - (<= -) | - (<= -) | - (<= -) | - (<= -) | - (<= -) | - (<= -) |

## holdout-2a.3-single

typed 330 of 330 labelled; confidence median 0.78 (p25 0.5, p75 0.94); latency p50 407 ms, p90 602 ms (n=330)

| T | decided | coverage | exact | admit/refuse | false admits | false refusals | settled admits | FA share (sample) | FA share (bank mix) | FA Wilson upper |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 330 | 100.0% | - | 81.5% | 19 | 42 | 279 | 6.8% | 11.0% | 10.4% |
| 0.5 | 248 | 75.1% | - | 90.3% | 13 | 11 | 235 | 5.5% | 8.6% | 9.2% |
| 0.6 | 222 | 67.3% | - | 93.2% | 6 | 9 | 212 | 2.8% | 4.6% | 6.0% |
| 0.7 | 194 | 58.8% | - | 95.4% | 3 | 6 | 187 | 1.6% | 2.6% | 4.6% |
| 0.8 | 162 | 49.1% | - | 97.5% | 2 | 2 | 160 | 1.3% | 1.9% | 4.4% |
| 0.85 | 141 | 42.7% | - | 98.6% | 1 | 1 | 140 | 0.7% | 1.1% | 3.9% |
| 0.87 | 129 | 39.1% | - | 99.2% | 0 | 1 | 128 | 0.0% | 0.0% | 2.9% |
| 0.9 | 115 | 34.8% | - | 99.1% | 0 | 1 | 114 | 0.0% | 0.0% | 3.3% |
| 0.95 | 70 | 21.2% | - | 100.0% | 0 | 0 | 70 | 0.0% | 0.0% | 5.2% |

Source persona-bench only (307 labelled): T -> settled admits / false admits / false refusals / admit-refuse agreement

| T=0 | T=0.5 | T=0.6 | T=0.7 | T=0.8 | T=0.85 | T=0.87 | T=0.9 | T=0.95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 257/18/41/80.8% | 219/13/10/90.0% | 197/6/9/92.8% | 174/3/6/95.0% | 147/2/2/97.3% | 128/1/1/98.5% | 116/0/1/99.2% | 104/0/1/99.1% | 63/0/0/100.0% |

Source table only (23 labelled): T -> settled admits / false admits / false refusals / admit-refuse agreement

| T=0 | T=0.5 | T=0.6 | T=0.7 | T=0.8 | T=0.85 | T=0.87 | T=0.9 | T=0.95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 22/1/1/91.3% | 16/0/1/94.1% | 15/0/0/100.0% | 13/0/0/100.0% | 13/0/0/100.0% | 12/0/0/100.0% | 12/0/0/100.0% | 10/0/0/100.0% | 7/0/0/100.0% |

Per lane label at T=0 (same admission / exact, of decided):

| lane label | of | decided | same admission | exact |
| --- | --- | --- | --- | --- |
| authorized | 116 | 116 | 104 (89.7%) | 0 |
| entailed | 119 | 119 | 109 (91.6%) | 0 |
| not_player_action | 67 | 67 | 47 (70.1%) | 0 |
| not_authorized | 28 | 28 | 9 (32.1%) | 0 |
| uncertain | 0 | 0 | 0 (-) | 0 |

Per batch class, settled admits / false admits by threshold:

| class | of (lane refusals) | T=0 | T=0.5 | T=0.6 | T=0.7 | T=0.8 | T=0.85 | T=0.87 | T=0.9 | T=0.95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| time | 110 (3) | 108/2 | 98/1 | 94/0 | 86/0 | 77/0 | 70/0 | 65/0 | 57/0 | 31/0 |
| move | 110 (19) | 97/14 | 92/11 | 80/5 | 72/3 | 66/2 | 59/1 | 53/0 | 50/0 | 37/0 |
| clue | 110 (6) | 74/3 | 45/1 | 38/1 | 29/0 | 17/0 | 11/0 | 10/0 | 7/0 | 2/0 |
| resolve | 0 (0) | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| other | 0 (0) | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |

Per batch class, false-admit share at the class's own bank refusal rate (upper bound from Wilson bounds on both settle rates):

| class | bank refusal rate | T=0 | T=0.5 | T=0.6 | T=0.7 | T=0.8 | T=0.85 | T=0.87 | T=0.9 | T=0.95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| time | 6.7% | 4.6% (<= 6.6%) | 2.5% (<= 6.3%) | 0.0% (<= 4.7%) | 0.0% (<= 5.3%) | 0.0% (<= 6.0%) | 0.0% (<= 6.7%) | 0.0% (<= 7.2%) | 0.0% (<= 8.4%) | 0.0% (<= 15.9%) |
| move | 15.0% | 12.4% (<= 15.7%) | 10.3% (<= 14.3%) | 5.3% (<= 10.5%) | 3.5% (<= 9.1%) | 2.6% (<= 8.4%) | 1.4% (<= 7.5%) | 0.0% (<= 5.8%) | 0.0% (<= 6.2%) | 0.0% (<= 8.7%) |
| clue | 12.7% | 9.6% (<= 16.7%) | 5.4% (<= 19.8%) | 6.4% (<= 23.3%) | 0.0% (<= 22.0%) | 0.0% (<= 35.2%) | 0.0% (<= 48.6%) | 0.0% (<= 51.7%) | 0.0% (<= 63.3%) | 0.0% (<= 91.5%) |
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

