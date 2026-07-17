---
name: coc-keeper
description: >-
  Thin Cursor entry for COC Keeper. Use after the user explicitly activates COC
  mode (e.g. "Activate COC mode", "进入 COC 模式"), or when a Cursor try/demo
  prompt asks to use the plugin in a concrete/useful way or show why it is
  valuable. Routes to coc-main onboarding — not a rules-engine demo. Canonical
  skills live under plugins/coc-keeper/skills/. Portrait generation is
  Codex-only; skip imagegen on Cursor. Cursor must keep AI-coding / Codex KP
  craft parity: director and narration advisory layers are part of play, not
  optional Codex-only extras.
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

## Skill routing (hard load order)

After activation, **read these files before the first in-game play turn**
(same tree Codex uses; do not improvise a thinner Cursor path):

1. `plugins/coc-keeper/skills/coc-main/SKILL.md`
2. `plugins/coc-keeper/references/mode-protocol.md`
3. `plugins/coc-keeper/skills/coc-keeper-play/SKILL.md` (full file)
4. `plugins/coc-keeper/skills/coc-story-director/SKILL.md` (full file)

Then route as needed to `coc-campaign-state`, `coc-character`,
`coc-scenario-import`, `coc-meta`, `coc-combat`, `coc-chase`, `coc-sanity`,
`coc-magic`, `coc-development`, `coc-playtest`, `coc-export-battle-report`,
and other skills under `plugins/coc-keeper/skills/`.

Runtime scripts and rules JSON also stay under `plugins/coc-keeper/`
(`scripts/`, `references/`). Prefer the installed plugin copy under
`~/.cursor/plugins/local/coc-keeper/` when that tree is what Cursor loaded;
it must stay byte-synced with the repo via
`plugins/coc-keeper/scripts/install-cursor-plugin.sh`.

## Cursor / Codex KP craft parity

Cursor is not a rules-engine facade. A path that mainly calls `scene.*` /
`state.*` / `rules.*` and wraps the results in prose is **not** an acceptable
COC KP session on Cursor.

Use the same toolbox Codex uses:

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_toolbox.py list
uv run --frozen python plugins/coc-keeper/scripts/coc_toolbox.py <tool> --root <workspace> --campaign <id> --json '<args>'
```

### When advisory layers must be consulted

Follow `coc-keeper-play`. In particular, on Cursor you must actually call the
tools (not merely know they exist) at these natural moments:

1. **Scene entry, repeated failed approaches, or stalled momentum** →
   `director.advise` with structured semantic `intent_evidence`. Offer its
   `candidate_plan` to `storylets.suggest` when a callback / atmospheric beat
   would help. Consult `npc.advise`, `personal_horror.query`, `threat.query`,
   or `epistemic.query` when that dimension is relevant.
2. **After rules/state for a complex beat are settled** → follow the player-
   visible prose pipeline below (not a one-shot `narration.brief` dump).
3. **Whenever you consulted advisory output** →
   `evidence.record_adoption` (`adopted` / `modified` / `ignored`) so audit
   can tell “available” from “influenced play.”

Advisory tools never block play and never replace your judgment. Skipping one
call because the fiction already has clear momentum is fine. Skipping the
entire director/narration layer for convenience is not.

### Always-active player-action uptake

Follow the Core Keeper Response Contract in canonical
`coc-keeper-play/SKILL.md` on every ordinary in-game reply. When the player
commits to an in-fiction action or speech, enact it from the investigator's
in-world viewpoint before or while revealing the settled outcome. Preserve the
method, target, precautions, constraints, and meaningful spoken words without
echoing the whole message or inventing extra investigator choices. Do not jump
from a command straight to a check result, destination, or clue as if the
declared method never occurred.

This responsibility applies whether or not `narration.brief` or
`narration.review` is useful on that turn. Those tools can reinforce and review
the prose for complex beats, but they do not enable the behavior and they are
not a fixed player-visible prose pipeline. Meta questions, pure planning,
hypotheticals, and deferred actions are not forced into fiction; classify that
distinction semantically, never with phrase matching. Never paste an envelope,
tool JSON, clue-ID list, or roll payload into player-visible prose.

When an advisory tool is consulted, record its disposition with
`evidence.record_adoption`. A semantic `narration.review` may recommend a
rewrite but never blocks delivery.

Forbidden player-facing voices (also listed in `style_contract.avoid`):
`log_style_summary`, `ai_summary_voice`, translationese, abstract
psychological explanation, and restating `scene.context` / roll results /
clue lists as if they were finished table prose.

Anti-repetition compresses already-established clues, explanations, and
sensory facts. It does **not** treat the current turn's `action_uptake` as
semantic repetition to be skipped.

Transcript rows and any later battle-report KP text must be this final prose.
Do not backfill the transcript with a post-hoc summary after the fact, and
do not invent missing action uptake in the exporter.

### Three hard rules (unchanged)

1. Dice and HP/SAN/skill arithmetic are authoritative (`rules.*`).
2. State writes are transactional via tools (`state.*` with `decision_id`).
3. Module truth is read-only; reveal secrets only through play.

## Acceptance routing

Deterministic contract tests may run on Cursor, but whole-product acceptance is
Codex-only: the main Codex opens this canonical plugin as KP and a collaboration
subagent created with `fork_turns: "none"` acts as the player. Only player-safe
content crosses that boundary, and every run starts in a fresh exact-schema
workspace. Follow root `AGENTS.md` and
`plugins/coc-keeper/skills/coc-playtest/SKILL.md`; do not create a Cursor-
specific player, test harness, or evaluation skill.

Only `coc-export-battle-report` may produce the final readable
`artifacts/battle-report.md` and completeness evidence. Never rewrite generated
facts or reconstruct missing dice by hand. Deterministic fixture evidence is
not gameplay evidence.

A Cursor smoke play may still export a battle report for local inspection; if
director/narration advisory were never called, or if KP text is still
`log_style_summary` / tool restatement, say that limitation plainly — do not
present the run as craft-parity or prose-parity evidence.

## Platform gating

Investigator portrait generation is **Codex-only**. It is gated inside
`CODEX_ONLY_IMAGEGEN` markers in
`plugins/coc-keeper/skills/coc-character/SKILL.md`. On Cursor (and Claude Code),
**skip portrait generation** and continue with the rest of character creation.

No other craft layer may be silently dropped on Cursor.

## Plugin install alternative

When installing COC Keeper as a Cursor plugin (not just using this repo), the
manifest at `plugins/coc-keeper/.cursor-plugin/plugin.json` points
`"skills": "./skills/"` at the same canonical tree. After repo plugin changes:

```bash
bash plugins/coc-keeper/scripts/install-cursor-plugin.sh
```

Then reload the Cursor window so the local plugin matches the repo.
