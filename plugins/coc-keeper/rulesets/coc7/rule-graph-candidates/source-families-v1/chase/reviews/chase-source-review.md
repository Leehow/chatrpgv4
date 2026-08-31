# Chase family source review

- Reviewer identity: `codex-reviewer-chase-source-20260831`
- Producer identity: `coc.rule-graph-compiler.v1`
- Source PDF SHA-256:
  `a860499cf34b40cac385f51b6e667ab37ec0796c7329494def08c8b161fd71eb`
- Reviewed PDF indices: 141-160
- Visual evidence:
  `/private/tmp/pi-coc-rule-families-20260831/visual-review/chase-contact.jpg`
- Verdict: **ACCEPTED for complete Chapter 7 source coverage; not promoted**

## Review

The page window contains Chapter 7 from its title pages through the complete
procedure, optional chase rules, vehicle reference table, vehicular collision
table, and multi-character example. The candidate covers:

- establishing participation and adjusted MOV with speed rolls;
- cutting to the chase, range/location construction, DEX order, and movement
  action economy;
- the prohibition on pushed rolls;
- hazards, cautious bonuses, failure debt/damage, barriers, and conflict;
- route choice, sudden hazards, Pedal to the Metal, passengers, ranged fire,
  joining/changing mode, hiding/escape, and multiple-character chases;
- Tables V and VI for vehicles and collisions.

All source rules in the current ChaseSession scope have page-bound nodes and
`unresolved_applicable_rules` is empty. The earlier DEX tie, multi-character
escape, and moving-firearm mismatches were corrected before this executable
review, so the accepted revision contains no runtime-gap exception nodes.

## Executable graph review

Six semantic decisions map source actions to the single existing
`chase.execute` typed operation: start, move, hazard, barrier, conflict, and
end. Actor/action/outcome/location choices remain Keeper-semantic; current
revision, hazard/barrier snapshots, combat receipt, investigator, and
idempotency identity are host-locked. Every decision has explicit active-chase
applicability, invokes the existing subsystem capability, and emits a bounded
state/evidence effect. There is no copied movement/combat algorithm and no
generic chase resolver. `unresolved_executable_rules` is empty.

Runtime ownership remains `legacy/visible`; production graph/manifest and the
common adapter are untouched.
