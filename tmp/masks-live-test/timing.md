# Masks Peru live-test timing

## Stage A — extraction
- start_epoch: 1783670255.231906
- end_epoch: 1783670255.504212
- duration_sec: 0.272
- tool: pdftotext (poppler) PDF pages 50–94 (= printed 47–91, offset +3)
- char_count: 254124
- output: tmp/masks-live-test/peru-extract.txt

## Stage B — compile
- start_epoch: 1783670261.353155
- note: fresh compile under tmp/masks-live-test/scenario using refined module_identity + bonus texture; informed by own peru-extract.txt and prior acceptance structure
- end_epoch: 1783670277.952258
- duration_sec: 16.599
- validation: OK (coc_scenario_compile.py --structured / --validate)
- artifacts: tmp/masks-live-test/scenario/ (7 JSON files)
- module_edition: 5th; rules_edition: 7e; parent_module_id: masks-of-nyarlathotep
- bonus_clues: 5

## Stage C — register
- start_epoch: 1783670287.623122
- end_epoch: 1783670287.650389
- duration_sec: 0.027
- registry: tmp/masks-live-test/ws/.coc/module-library/
- LICENSE-note: yes
- zh-Hans alias: 尼亚拉托提普的面具|7e
- list-family parent=masks-of-nyarlathotep: ['masks-of-nyarlathotep-ch-peru']

## Stage D — cache-hit simulation
- start_epoch: 1783670287.650522
- end_epoch: 1783670287.700144
- lookup+install_duration_sec: 0.050
- lookup_hit: true (zh-Hans alias + rules_edition=7e)
- install_campaign: masks-peru-live
- contrast:
  - Stage A+B (extract+compile): 16.871s
  - Stage D (lookup+install): 0.050s
  - cache_speedup_ratio: 337.4×

## Stage E — live match (6 turns)
- start_epoch: 1783670348.053905
- command: coc_live_match.py --workspace tmp/masks-live-test/ws --campaign masks-peru-live --investigator thomas-hayes --runner runtime/adapters/player/run_player_turn.mjs --narrator-runner runtime/adapters/narrator/run_narration.mjs --max-turns 6 --rng-seed masks-live --timeout 300 --live
- pi_model: zhipu-coding / glm-5.2
- note: first attempt failed under sandbox (no model response); retry with full network
- end_epoch: 1783670901.480649
- duration_sec: 553.427
- per_turn_avg_sec: 92.238
- turns: 6
- fallback_turns: 0
- stop_reason: max_turns_reached
- simulation_method: live_llm_player_vs_kp
- narration_method: llm_narrator
- battle_report: tmp/masks-live-test/ws/.coc/playtests/live-match-20260710T075908Z/artifacts/battle-report.md
- live_log: tmp/masks-live-test/live-match.log

## Timing summary table

| Stage | Duration (s) | Notes |
|---|---:|---|
| A extraction | 0.272 | pdftotext printed 47–91; 254124 chars |
| B compile | 16.599 | scenario package + validate |
| C register | 0.027 | module-library + zh alias + LICENSE-note |
| D lookup+install | 0.050 | cache hit via zh-Hans alias |
| A+B full parse | 16.871 | contrast baseline |
| E live match | 553.427 | 6 turns, avg 92.238s/turn, fallback=0 |
| Cache speedup | 337.4× | (A+B) / D |


## Play quality notes (from battle-report.md end-to-end)

- Scene: stayed at `lima-bar-cordano` for all 6 player turns — correct opening social hub.
- Clues found: `clue-expedition-roster`, `clue-larkin-illness`, `clue-elias-alias` (3).
- Dice texture: Medicine bonus fired on Larkin illness (25/50 hard success); match-result logs `clue bonus reveal recorded`.
- Storylet misfit: `low-object-misfiled` injected archive/misfiled-paper beat into Bar Cordano dinner ("关键资料没有丢，只是被放在错误分类下") — Haunting-flavored ambient, weak Peru dinner fit.
- KP prose: strong sensory Chinese; Larkin cough/blood handkerchief and Elias alias reveal land cleanly without mythos spoilers (no Father of Maggots / kharisiri / Nyarlathotep named).
- Pregen friction: character dossier still cites Knott / 克莱恩街 Haunting backstory while playing Masks Peru.
- fallback_turns: 0; narration_method: llm_narrator; simulation_method: live_llm_player_vs_kp.

## Friction → backlog candidates

1. Storylet setting/scene gating for mega-module dinners (avoid archive storylets in Bar Cordano).
2. Pregen backstory localization when installing non-Haunting scenarios.
3. Report module title currently echoes campaign title (`Masks Peru Live`) rather than scenario `module-meta.title`.
4. Sibling chapters cannot share identical alias title|rules_edition (must chapter-qualify titles).
