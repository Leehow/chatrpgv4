# mod-section-index — can Jev pick the package rules a turn needs?

Offline measurement for `docs/specs/mod-section-index.md` §6. Nothing here touches the product or the App home.

- `cards.json` — every section of the five built-in packages' live `agent.md`, with `trigger` (always / state / host / jev) and a one-line `when` per `jev` card (English, plus a Chinese variant). `sections.mjs` cuts the text from the shipped files; `node experiments/mod-section-index/sections.mjs` lists them with their bytes.
- `decoys.json` — 60 plausible cards of packages that do not exist, for the catalogue-size runs.
- `extract-inputs.py` — real player turns with context from the App home's campaigns (read-only). `sample.py` — a stratified 120.
- `harness.mjs` — one Jev fan-out per turn (a Noul per card, the semantic-locate shape), through the product's `packDecisionBatch`; configurations by flag. The key comes from the App vault, as the single-loop prototype reads it.
- `analyse.py` — scores rows against the judge labels: precision/recall/F1 by threshold, top-k, per card, decoy firing, latency and tokens, judge agreement.

Runs, labels and results of 2026-10-04 live in the session's scratch directory and are summarised in the spec's §7.
