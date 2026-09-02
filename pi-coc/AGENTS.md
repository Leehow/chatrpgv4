# AI implementation contract

1. Read `spec/00-constitution.md`.
2. Read the specification named by the assigned work package.
3. Return a file/test plan before editing.
4. Stay within the work-package paths.
5. Add deterministic tests and evidence.
6. Report changed files, requirement IDs, tests, and unresolved risks.

Non-negotiable boundaries:

- World state changes only through committed domain events.
- Narration never mutates world state.
- Randomness comes from an injected RNG and leaves a receipt.
- Branch-head mismatch is an error, never an implicit rebase.
- Fictional-time rewind requires `TemporalReset`.
- Keeper-only information is removed before player-facing serialization.
- Rule changes use explicit `ENABLES`, `DISABLES`, `AUGMENTS`, or `OVERRIDES` relations.
- Live Keeper lanes do not receive Bash, arbitrary filesystem, or arbitrary network tools.
- Do not change architecture outside the assigned work package without an ADR and approval.
