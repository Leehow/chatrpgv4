# Battle Report Template Addendum

## Epistemic Experience

Every generated battle report includes a deterministic `## Epistemic Experience`
section. The source of truth is `playtest.json.epistemic_metrics`, produced from
structured belief/question events and state—not from transcript keyword scans.

Render these keys in a stable order:

1. `belief_gain`
2. `curiosity_load`
3. `explanation_compression`
4. `reframe_fairness`
5. `confirmation_saturation`
6. `unexplained_surprise`
7. `parse_risk_exposure`
8. `epistemic_health`

### Evidence inputs

- `sandbox/.coc/campaigns/<campaign-id>/logs/belief-events.jsonl`
- `sandbox/.coc/campaigns/<campaign-id>/save/belief-state.json`
- `sandbox/.coc/campaigns/<campaign-id>/scenario/compile-confidence.json`
- `sandbox/.coc/campaigns/<campaign-id>/index/parse-manifest.json`

`parse_risk_exposure` counts only low-confidence compiled nodes or parse ranges
that were actually delivered through a belief-treatment event. Unused
low-confidence material elsewhere in the module remains an authoring concern and
must not be reported as player exposure.

Legacy runs without belief events still render the section with zero-event
metrics so report generation remains backward compatible.
