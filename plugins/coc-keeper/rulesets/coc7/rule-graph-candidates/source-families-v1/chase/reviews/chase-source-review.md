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
`unresolved_applicable_rules` is empty. Three source/runtime differences are
preserved as explicit exception nodes rather than hidden:

1. equal DEX should use an opposed DEX roll, while runtime uses actor-id order;
2. source multi-character setup permits individually outpaced participants to
   leave, while runtime's initial escape check is all-or-nothing;
3. moving firearms should use ordinary combat weapon options, while runtime
   currently applies a generic handgun damage stand-in.

These mismatches block promotion/parity but do not make the source extraction
incomplete. Runtime ownership remains `legacy/visible`; no production graph,
manifest, archive, or runtime code changed.
