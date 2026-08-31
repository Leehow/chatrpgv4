# Combat family source review

Verdict: **ACCEPTED** for the complete applicable Combat family.

Reviewer: `codex-worker-combat-source-review-20260831` (independent of the
source-stage1 producer).

Source identity:

- PDF SHA-256: `a860499cf34b40cac385f51b6e667ab37ec0796c7329494def08c8b161fd71eb`
- Reviewed PDF indices: 113-130 and 412-417
- Normalized bundle SHA-256: `5e1a929b0b37f9782fcfb67a24c94846d6e12612f84b3523f9d01cd97413c8eb`

All 24 selected pages were rendered and visually inspected. The scope covers
round/action order, melee opposition, damage and impales, no-push combat,
maneuvers, surprise, outnumbering, ranged/thrown weapons, escape and armor,
firearm initiative/range/modifiers, automatic fire, malfunction, Table XVII
weapon profiles, and Stun/Burn special effects.

The earlier `section-non-session-damage-source` candidate was not promoted as
complete: it covered only one damage adapter. This shard replaces that partial
scope with 22 page-backed combat rules and contains no unresolved exception
nodes. Transport receipts, log schema, and campaign persistence are runtime
contracts rather than rulebook claims and are not asserted here.

The executable graph now names the exact existing typed subsystem phases:

- `combat.context` for the canonical CombatSession snapshot;
- `combat.resolve` decisions for attack, defense, maneuver, aim, reload, and
  flee;
- `combat.end` for the mechanically concluded outcome.

Semantic inputs select candidate/weapon/effect handles, maneuver goals, legal
defense, and optional Luck precommit. Investigator/target identity, authored
affordance, owned weapon/effects, pending attack/command, combat revision, and
the concluded outcome are host-locked. Attack/maneuver offer the structured
defense pending choice and continue to the defense decision. No combat
algorithm or generic `combat_runtime` capability is copied into the shard.

Accepted shard: `shard:coc7:combat:section-combat-complete-source`.

Accepted shard digest:
`a4d583bad2dd9c0d4d5d4b500e908fa82d49ef578026d69b956dd93c46917e00`.
