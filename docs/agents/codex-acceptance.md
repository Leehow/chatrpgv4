# Codex-track acceptance

Only for explicit Codex-hosted product acceptance. Using Codex as the coding assistant while developing Pi-Coc does not select this route. The Keeper/player isolation and dice evidence requirements are unchanged.

Paths and commands below are relative to the repository root unless absolute. Read only this route when the task requires it; it does not expand authorization.

## Plugin-Native Acceptance Contract

Whole-product acceptance uses the real canonical plugin, never a scripted
player, fixed profile, evaluation matrix, or parallel Keeper runtime.

- The **main Codex** is the live Keeper through normal `coc-main` and
  `coc-keeper-play`. One player collaboration agent uses
  `fork_turns: "none"` and receives only player-safe narration, its sheet,
  public rolls, and explicit choices. It never sees module truth, Keeper state,
  tool rationale, or hidden logs.
- Shared filesystem means protocol isolation, not a cryptographic sandbox;
  record that limitation honestly.
- Every run uses a fresh isolated workspace and exact-current-schema campaign.
  Never resume historical test saves or use old reports as runtime state.
- Continue one natural reply at a time until structured ending evidence or a
  true operational blocker. A convenient turn count, multi-NPC contact, or
  coverage target is not an ending.
- Preserve exact Keeper text and player reply; summaries never replace them.
- After play, `coc-export-battle-report` is the sole final report owner for
  `artifacts/battle-report.md` and
  `artifacts/battle-report-evidence.json`. Never hand-fill missing facts or
  reconstruct dice from prose.

Raw-PDF acceptance cannot start from a prebuilt bundle. It includes external
extraction/bundle creation, minimum opening parse, first playable opening, and
subsequent background parsing. Method mismatch invalidates acceptance even when
latency or coordinator evidence is useful.

### Dice Completeness Gate

Structured roll logs are authoritative. Every required `public` or
`consequence_public` roll appears exactly once in `rules-and-dice` with
source-traceable numbers; zero rolls requires an explicit zero count. Missing,
duplicate, malformed, or untraced markers/source logs are hard failures. Never
reconstruct a roll from memory or prose or remove a failed completeness finding.
