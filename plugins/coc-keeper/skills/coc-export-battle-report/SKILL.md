---
name: coc-export-battle-report
description: Produce the single final player-readable battle-report.md and its structured evidence JSON directly from a real COC Keeper playtest run.
---

# Export the Final COC Battle Report

Use this skill after a real plugin-native playtest has finished. This skill
is the only final battle-report writer: it reads the run evidence directly
without invoking a legacy evaluator, formatter, or audit pipeline.

From the repository root, run:

```bash
uv run --frozen python plugins/coc-keeper/skills/coc-export-battle-report/scripts/export_battle_report.py <run-dir>
```

On success, the CLI exits zero and prints a player-safe JSON summary containing
only the completeness classification and the two player artifact paths. The
internal `report_id` remains audit-only in `artifacts/audit/manifest.json`.

Canonical run identity is the campaign-owned `save/run-identity.json` record
(`schema_version: 1`) read through `coc_state.load_run_identity`. Required
fields are `campaign_id`, `run_segment_id`, `session_id`, `plugin_version`,
`ruleset_id`, and `ruleset_version`. The first successful
`evidence.table_opening` or later canonical table-transcript write freezes it
via `bind_run_identity`; later calls must repeat the same campaign / run /
session or raise `run_identity_conflict` without rewriting the file. A missing
record returns `None`. A present but incomplete, sentinel, identity-mismatched,
or non-current record raises `UnsupportedSaveSchema` (clean-slate; no
migration or dual reader).

External `run.json` / `playtest.json` may supply non-authoritative harness
metadata only. They must not override the canonical record or discard matching
table-transcript rows. When the canonical record is present, the exporter binds
report identity and filters canonical transcript rows to that run/session.
Missing, corrupt, or harness-conflicting identity fails the `run_identity`
dimension closed and keeps the unfiltered transcript rows. The run directory
should contain:

- allowlisted `host_model` metadata recording the exact model, reasoning
  effort, acceptance lane, pre-activation selection, mid-run switch status,
  and `background_model_policy=inherit_parent`; this remains structured
  development evidence and is not rendered into the player report;

- `transcript.jsonl` with ordered Keeper and player dialogue;
- `sandbox/.coc/campaigns/<campaign-id>/logs/rolls.jsonl` as the authoritative
  structured dice log;
- the campaign's investigator state under `save/investigator-state/`, with
  optional static character sources under `sandbox/.coc/investigators/`.
- `save/world-state.json` and `save/flags.json` for the visited scene path and
  explicitly discovered clue receipts;
- `logs/events.jsonl` plus ending development-settlement receipts for the
  structured conclusion, visible consequences, and final growth;
- optional `save/npc-engagement-receipts.json`; only receipt identity
  (`npc_id`, scene, interaction kind, decision, timestamp) is exported. Its
  Keeper-only `identity_contract`, agenda, voice, schedule, and source material
  are never report sources.

Use `--allow-partial` only for an interrupted run containing
`partial-transcript.jsonl`. The report remains visibly `INCOMPLETE`.

The exporter atomically writes the final player pair under `artifacts/`:

- `battle-report.md`: the final readable, player-safe actual-play report;
- `battle-report-evidence.json`: explicitly allowlisted player-safe evidence.

Keeper/development evidence is emitted separately under `artifacts/audit/`,
including exact transcript, all rolls, rule decisions, social resolutions,
concealed Psychology, scene-budget/drift evidence, narration revisions,
genuine typed state diffs, report validation, and deterministic manifest/hash
files. Neither player artifact contains `keeper_internal`, the source manifest,
concealed identifiers, raw session/decision/source/NPC/clue/roll identifiers,
or raw audit objects. Player-facing checks use presentation order and labels;
multi-ending settlements use stable player-safe ending ordinals; exact machine
identities remain in Keeper/development audit evidence only.

The Markdown renders the full initial investigator card, final `current_*`
state, development deltas, personal-horror weave/payoff receipts, visited path,
discovered clues only, player-safe NPC interactions, a focused public
social-skill roll view (Charm / Fast Talk / Intimidate / Persuade only;
Psychology is Keeper-concealed and never listed), recorded major decisions
and consequences, the structured ending/recap, exact ordered transcript, and
the complete public-roll appendix. Static card values are not presented as
final values, and numeric zero is never treated as missing.

Every `public` or `consequence_public` roll must have a unique `roll_id` and
source-traceable numerical evidence. Each is rendered exactly once. A missing
roll log, duplicate ID, or malformed required public roll makes the report
`INCOMPLETE`; a valid empty log reports a public roll count of zero.

Both player artifacts exclude Keeper-only rolls, Keeper-view logs,
module/scenario truth, hidden event logs, runner prompts, structured audit
objects, and secret/private fields. Audit files may preserve structured Keeper
results and must never be included in the player distribution.
Never reconstruct missing dice or hidden facts from prose. Before delivery,
read `battle-report.md` end to end and inspect the evidence JSON's
`completeness` and `public_rolls` sections. State an `INCOMPLETE` result
honestly.

Completeness explicitly includes run identity, exact accepted transcript, dice,
state, settlement uniqueness, scene scope, agency, secrecy, and projection
hashes, while retaining useful legacy source subfindings. Agency is
`NOT_PROVEN` without a semantic review whose frozen raw-draft hash binds every
accepted narration revision; an empty agency-claim list is not proof. Every
recorded voluntary claim must bind the exact frozen `player_input`, physiology
must bind a typed ownership source, and forced behavior must bind its full
active frozen override. The compatibility
`COMPLETE`/`INCOMPLETE` classification
means report-source evidence completeness only. It does **not** certify prose
quality, Director/Storylet use, or whole-product KP quality.

Formal accepted-transcript, dice, state, and agency evidence is authoritative
only when every referenced schema-v2 receipt passes the canonical
`coc_turn_finalization._valid_finalization` validator. Legacy/unbound transcript
is partial evidence and cannot pass accepted-transcript completeness. The
canonical player row must bind the exact run segment, session, turn, and
`state.journal` decision, while its Keeper row binds the exact accepted
revision and finalization receipt.

Player evidence is schema 8; the Keeper/development audit envelope is schema 2.
State completeness consumes
`coc_git_history_verify.state_integrity_proof(...).to_dict()` and maps
`PASS` / `FAIL` / `NOT_PROVEN` 1:1 onto the `state` dimension. Player
`state_integrity` is the bounded projection (`status`, `reason_codes`,
`repo_present`, `history_valid`, `fsck_ok`, `tree_clean`, `history_reset`,
counts). The full proof lives only in audit
`finalization_binding.git_history`. A later `COC-History-Reset` commit is
`NOT_PROVEN`, never `PASS`. Never read or recreate `save/commit-snapshots`;
those fields are gone from both schemas. Unregistered or shape-only state
calls never become `state-diffs.jsonl` rows. Dice completeness is unchanged:
every required public or consequence-public roll still needs a unique
`roll_id` and source-traceable numbers.

Both outputs also carry an observational **Play Conduct Signals** section
(`play_conduct_signals` in the evidence JSON). It restates structured facts
only: dialogue turn count, public roll count, per-turn toolbox-call counts
(when the keeper-internal log is present), how many recorded clues had
module-authored `delivery_kind=skill_check` without any roll of the authored
skill in `rolls.jsonl`, and how many NPC engagement receipts were improvised
(no authored `identity_contract`). The exporter reads
`scenario/clue-graph.json` for these counts only — clue content is never
projected. The section makes no pass/fail judgment and never changes the seven
completeness dimensions or the `COMPLETE`/`INCOMPLETE` classification; it is
listed in `completeness.not_claimed` as no quality judgment. Use it in human
review to spot unconstrained-play red flags — for example the combination of
many dialogue turns, zero public rolls, and skill-check clues without roll
evidence greater than zero suggests checks were narrated away instead of
rolled.
