---
name: coc-keeper
description: >-
  Thin Cursor entry for COC Keeper. Use after the user explicitly activates COC
  mode (e.g. "Activate COC mode", "进入 COC 模式"), or when a Cursor try/demo
  prompt asks to use the plugin in a concrete/useful way or show why it is
  valuable. Routes to coc-main onboarding — not a rules-engine demo. Canonical
  skills live under plugins/coc-keeper/skills/. Portrait generation is
  Codex-only; skip imagegen on Cursor.
---

# COC Keeper (Cursor thin entry)

This file is a **host adapter only**. All keeper behavior lives in the single
canonical plugin tree:

```text
plugins/coc-keeper/skills/
```

Do not create a parallel skill copy under `.cursor/skills/` or elsewhere.

## Passive activation

COC mode is passive. Load keeper skills only after explicit user activation, or
after a host try / plugin demo prompt (Cursor’s “use the plugin in one
concrete, useful way…” / “show why it’s valuable”). See
`plugins/coc-keeper/references/AGENTS-coc-mode-template.md`.

For try/demo prompts: open `coc-main` onboarding (welcome + campaign/scenario
wizard). Do not answer with a standalone rules-engine roll demo or a plugin
capability brochure.

## Skill routing

After activation, read and follow these canonical skills (same tree Codex uses):

1. `plugins/coc-keeper/skills/coc-main/SKILL.md`
2. `plugins/coc-keeper/references/mode-protocol.md`
3. Then route to `coc-campaign-state`, `coc-character`, `coc-scenario-import`,
   `coc-keeper-play`, `coc-meta`, `coc-combat`, `coc-chase`, `coc-sanity`,
   `coc-playtest`, and other skills under `plugins/coc-keeper/skills/` as needed.

Runtime scripts and rules JSON also stay under `plugins/coc-keeper/`
(`scripts/`, `references/`).

## Canonical evaluation routing

For official testing, report generation, report verification, baseline
compare, matrix planning, calibration, or holdouts, follow the root
`AGENTS.md` **Canonical Evaluation Contract** and
`plugins/coc-keeper/skills/coc-playtest/SKILL.md` (official evaluation
section). Invoke the shared CLI only — do not create a parallel `coc-eval`
skill under `.cursor/skills/` or `plugins/coc-keeper/skills/`:

```bash
python3 plugins/coc-keeper/scripts/coc_eval.py run --suite <smoke|pr|nightly|release|diagnostic> --root .
python3 plugins/coc-keeper/scripts/coc_eval.py report <run-dir>
python3 plugins/coc-keeper/scripts/coc_eval.py verify <run-dir>
python3 plugins/coc-keeper/scripts/coc_eval.py compare --baseline <a> --candidate <b>
python3 plugins/coc-keeper/scripts/coc_eval.py baseline --source <run-manifest> --output <baseline.json>
python3 plugins/coc-keeper/scripts/coc_eval.py matrix --suite nightly --root . --plan-only
python3 plugins/coc-keeper/scripts/coc_eval.py calibrate --reviews <reviews.json>
python3 plugins/coc-keeper/scripts/coc_eval.py holdouts --bundle <holdout-dir>
```

Do not replace a named suite with Cursor-specific commands. Status vocabulary
is `PASS`, `FAIL`, `INELIGIBLE`, `NOT_RUN`, and `NON_COMPARABLE`. Read
`artifacts/report-completeness.json` before delivering a battle report, bind
delivery to report hashes, and **must not rewrite** generated factual content
or reconstruct missing dice by hand. Deterministic fixture evidence is not
external-model gameplay evidence.

## Platform gating

Investigator portrait generation is **Codex-only**. It is gated inside
`CODEX_ONLY_IMAGEGEN` markers in
`plugins/coc-keeper/skills/coc-character/SKILL.md`. On Cursor (and Claude Code),
**skip portrait generation** and continue with the rest of character creation.

## Plugin install alternative

When installing COC Keeper as a Cursor plugin (not just using this repo), the
manifest at `plugins/coc-keeper/.cursor-plugin/plugin.json` points
`"skills": "./skills/"` at the same canonical tree.
