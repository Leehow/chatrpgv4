# Untold-name spans probe (contract §177.15, 2026-10-04)

Whether Jev can tell a place where a text writes an untold person's printed name from the same characters inside another
word (Chinese has no word boundaries). Cases come from Blood Road's own text and table 27's delivery.

- `cases-round1.json`: pre-registered at 0.5; 21 of 22 right, the miss was the English modal "Will" at 0.55/0.52.
- `cases-round2.json`: held out, the bar fixed at 0.75 before running; 16 of 16 right. Other words 0.03-0.65, names 0.85-0.98.

Run (reads `EXT_JEV_APIKEY` from the App vault, never prints it): `T=0.75 CASES=./cases-round2.json node probe.mjs 2`.
- `probe-product.mjs`: both sets through the product's own `nameSpanBatch` and `markSpan` (40-character windows, the
  product's policy text): 38 of 38 right at 0.75; the lowest name 0.87, the highest other word 0.68 ("Camp David" in Chinese).
- `cases-round3.json` (table 28): the request kept 「布伦纳医生」 at 0.73 under the old question. With "with a title" in the question
  and the bar at 0.5 (pre-registered, lower because a kept name is a leak), all 49 cases: names 0.88-0.98, none kept; three other
  words above 0.5 are renamed (the modal "Will" 0.60, Camp David 0.50, a shop's family name inside a person's line 0.91).
  Run: `T=0.5 node probe-product.mjs`.
