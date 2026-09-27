# SL-97c relabel summary

Generated 2026-09-27T03:10:04.629Z. 720 cases (390 main + 330 holdout), 2806 lane calls (1440 batch, 1366 per-line).

## Latency (ms)

| | p50 | p90 | max | n |
| --- | --- | --- | --- | --- |
| all calls | 6558 | 12533 | 60003 | 2806 |
| batch calls only | 6972 | 14016 | 60003 | 1440 |

## Failures

Total 2 of 2806 calls; review_timeout verdicts 0; over the product's 13s cap: 8.7%.

| reason | count |
| --- | --- |
| model_error | 2 |

## Run-to-run agreement (batch level; the same-model floor under today's prompt)

| | pairs | exact | admit/refuse | flip rate | of run1 admits, run2 refused | of run2 admits, run1 refused |
| --- | --- | --- | --- | --- | --- | --- |
| overall | 719 | 85.8% | 95.5% | 4.5% | 3.7% | 1.3% |
| main | 389 | 88.9% | 96.1% | 3.9% | 3.2% | 1.2% |
| holdout | 330 | 82.1% | 94.8% | 5.1% | 4.4% | 1.4% |
| time | 189 | 91.0% | 97.9% | 2.1% | 1.6% | 0.5% |
| move | 148 | 91.9% | 91.9% | 8.1% | 7.5% | 2.6% |
| clue | 229 | 75.1% | 97.4% | 2.6% | 1.8% | 0.9% |
| resolve | 123 | 90.2% | 93.5% | 6.5% | 6.1% | 2.1% |
| other | 30 | 86.7% | 93.3% | 6.7% | 8.7% | 0.0% |

## Agreement with the old bank label, per class

| class | of (old-labelled) | run1 admit/refuse | run2 admit/refuse | both-refuse def | either-refuse def |
| --- | --- | --- | --- | --- | --- |
| time | 190 | 72.5% (n=189) | 73.2% (n=190) | 71.6% (n=190) | 74.1% (n=189) |
| move | 148 | 66.9% (n=148) | 71.0% (n=148) | 64.9% (n=148) | 73.0% (n=148) |
| clue | 222 | 75.2% (n=222) | 76.1% (n=222) | 76.1% (n=222) | 75.2% (n=222) |
| resolve | 122 | 68.8% (n=122) | 68.8% (n=122) | 67.2% (n=122) | 70.5% (n=122) |
| other | 29 | 69.0% (n=29) | 69.0% (n=29) | 69.0% (n=29) | 69.0% (n=29) |
| **overall** | 711 | 71.4% (n=710) | 72.7% (n=711) | 70.8% (n=711) | 73.4% (n=710) |

## Cases labelled for re-scoring (batch level)

| definition | main | holdout |
| --- | --- | --- |
| both-refuse | 390 | 330 |
| either-refuse | 389 | 330 |

