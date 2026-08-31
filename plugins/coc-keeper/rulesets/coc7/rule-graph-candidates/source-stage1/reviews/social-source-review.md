# Social independent source review

- Reviewer: `codex-rule-families-core-social-source-review-20260831:social`
- Executable decision re-review: `codex-execgraph-core-push-social-review-20260831:social-v2`
- Exact source: *Call of Cthulhu Keeper Rulebook 40th Anniversary*
- PDF SHA-256: `a860499cf34b40cac385f51b6e667ab37ec0796c7329494def08c8b161fd71eb`
- Reviewed PDF indexes: 70, 71, 75, 77, 82, 84, 104, 208
- Verdict: **ACCEPT** for source coverage of the `social` family after correcting the strong-opposition feasibility bug. This review does not grant production promotion.

The review checked the complete applicable social family represented by the current rules surface:

- player-described method to Keeper-selected Charm/Fast Talk/Intimidate/Persuade approach;
- player intention as the exact goal;
- higher of matching social skill or Psychology for base Regular/Hard/Extreme difficulty;
- positive inclination, neutral motive, one/two-level strong opposition, one-level supporting case, Extreme ceiling, and rare no-roll goals;
- verbal-conflict feasibility and story-position limits;
- the source-specific scope/duration of the four interpersonal skills;
- player-character agency: success never compels another player's investigator, while refusal can create one non-stacking, non-indefinite penalty die for one later chosen roll. The graph expresses this as a pending choice plus typed effect; execution remains on the existing canonical one-use modifier path rather than a new social state engine.

The pre-review resolver incorrectly made every two-level opposition result conditional, including Regular + 2. PDF index 104 requires that case to remain an Extreme roll; only a result beyond Extreme is conditional/no-roll. The focused runtime regression now pins Regular + 2 = Extreme/roll and Hard + 2 = conditional.

No fixture-only motive, leverage, or feasibility semantics are treated as source authority. Canonical `accept()` and `build()` receipts are stored beside the accepted family graph.

Executable re-review confirms `social_difficulty/resolve` receives motive direction and intensity as Keeper-semantic judgment, while the supporting motive evidence is a separate host-locked input derived from canonical authored NPC/social evidence. The explicit source-evidence subsystem plus `locks-input` and `requires-fact` relations prevent free prose from becoming evidence and give the later single adapter owner a deterministic hydration contract.

Gap re-review `codex-execgraph-gap-review-20260831:social-v3` adds Keeper-semantic `target_ref` and `commitment_ref`. The retained SocialInteractionCandidate supplies `social-target:<npc_id>` and durable commitment identity, which the host binds to canonical NPC/conversation/commitment fields without parsing free goal prose. The secondary `social_skill_names` dependency is `requires-fact`, leaving exactly one executable `invokes -> social_difficulty` capability.
