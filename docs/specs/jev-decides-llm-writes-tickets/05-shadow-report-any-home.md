Status: ready-for-agent
Spec: docs/specs/jev-decides-llm-writes.md D-C

# 05 — Shadow report reads any home and prints the D6 2a line

Extend `tests/play/jev-steps-report.py`: accept one or more homes (repo checkout `.coc/campaigns`, PipiCOC App homes), aggregate across campaigns, print per class the D6 2a verdict (agreement ≥ 0.9 where the Keeper acted, FP ≤ 1 per table, added Jev ms/turn ≤ 1.5 s) with table counts. Read-only; never edits the execute list. Test with fixture telemetry including an App-home layout.

## Comments
