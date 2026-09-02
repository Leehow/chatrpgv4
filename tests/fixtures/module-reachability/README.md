# Module reachability lint — fixture corpus

Data-only fixtures for the module reachability lint
(`plugins/coc-keeper/scripts/coc_module_reachability.py`), built against the
frozen contract `coc.module-reachability-lint.v1` and the specification
`docs/specs/pi-coc-module-reachability-lint.md` (§3 completeness classes,
§5 check catalogue, §9 testing).

Nothing here is test code. The cases are pure JSON; the test module that drives
them is owned elsewhere.

## Case file shape

`cases/<case-name>.json`, where `<case-name>` equals the file's `case` field:

```json
{
  "case": "gate-self-locks-trigger",
  "intent": "one sentence saying what this case proves",
  "documents": {
    "story-graph.json": {"scenes": []},
    "clue-graph.json": {"conclusions": []},
    "module-meta.json": {}
  },
  "expect": {
    "findings": [
      {
        "code": "gate-self-locks",
        "subject_id": "scene-a",
        "subject_kind": "scene",
        "severity": "defect",
        "completeness": "dead",
        "related_ids": ["clue-cellar-key", "scene-b"]
      }
    ],
    "codes_not_measured": ["front-scene-unknown", "quest-destination-unknown"]
  }
}
```

- `documents` is handed straight to `lint_scenario_set` as its `documents`
  value. Filenames and record shapes mirror real scenario documents.
- `expect.findings` asserts a subset of each finding's closed field set: the
  five identity/classification fields plus `related_ids`. `declared`,
  `counted`, and `reason` are deliberately not asserted here — `reason` is
  `REASONS[code]` by contract, and the two counters are asserted against real
  scenario sets rather than against synthetic ones.
- `expect.findings` is sorted by `(code, subject_id, related_ids)`; every
  `related_ids` list is itself sorted.
- `expect.codes_not_measured` is sorted and disjoint from the codes appearing
  in `findings`.

## The rule this corpus exists to enforce

**Every one of the fifteen check codes owns a trigger and a near-miss.**

- `<code>-trigger.json` produces that finding and, except where noted below,
  no other finding.
- `<code>-near-miss.json` is the trigger one small, genuinely adjacent edit
  away from firing, and produces **no finding at all**.

The near-miss is the half that kills mutations. Widen a check later and its
near-miss goes red; delete a check and its trigger goes red. A suite with only
triggers proves nothing about a check's boundary.

One documented exception: `conclusion-behind-unreachable-scenes-trigger`
carries two findings. A conclusion can only sit behind unreachable scenes if
some scene is unreachable, so `scene-unreachable` co-occurs by construction.

## Fixture conventions

- Every case is built from one skeleton (`baseline-clean.json`): `scene-a`
  (`is_start`, holds `clue-a`) routes to `scene-b` (`is_final`, holds
  `clue-b`), and one conclusion declares `minimum_routes: 2`, which the two
  placements satisfy. Each trigger is that skeleton plus exactly one defect.
- `is_final` is declared only on scenes that are final, matching the committed
  starter, which carries the key exactly once.
- `quests.json` and `threat-fronts.json` are omitted unless the case is about
  them, so most cases carry `quest-destination-unknown` and
  `front-scene-unknown` in `codes_not_measured` — the absent-document rule,
  exercised everywhere rather than in one place.
- `related_ids` convention used throughout: the ids that make the finding
  actionable, and only those. Missing target for `edge-target-unknown`,
  `quest-destination-unknown`, `front-scene-unknown`; the unknown clue for
  `available-clue-unknown`; the owning conclusion for `clue-unplaced`; the gate
  clue for `gate-clue-unobtainable`; the gate clue plus the scenes it is
  trapped in for `gate-self-locks`; the declaring scenes for
  `start-scene-count`; the unreachable scenes for
  `conclusion-behind-unreachable-scenes`; the placed clues and their scenes for
  `conclusion-clues-share-one-scene`; the holding document for `duplicate-record-id`;
  empty for the rest.

## Cases beyond the thirty

| Case | What it pins |
| --- | --- |
| `baseline-clean` | the skeleton every other case perturbs is itself silent |
| `progressive-pair-progressive` / `progressive-pair-complete` | identical scenario content; `progressive: true` in `module-meta.json` is the only difference, and it is the difference between `pending-materialization` / `observation` and `dead` / `defect`. Spec §9 calls getting this backwards the worst regression in the feature |
| `parse-state-shallow-not-measured` | `parse_state != "deep"` forces `not-measured` even in a complete scenario, where the finding would otherwise be `dead` |
| `evidence-gap-not-measured` | a truthy `evidence_gap` forces `not-measured` on a scenario that is `progressive` with `source_refs` on the edge — `not-measured` beats `pending-materialization` |
| `quests-absent-not-measured` | an absent document yields `codes_not_measured`, never a clean pass and never a finding |
| `no-is-final-anywhere-not-measured` | where no scene uses `is_final`, `scene-terminal-undeclared` is not measured rather than firing on every leaf |
| `start-scene-count-zero-starts` | zero `is_start` scenes; see the ambiguity note below |
| `progressive-scene-fields` | a real progressive scene reduced to the minimum that still carries all nine top-level fields the graph registry does not govern; pins `PROGRESSIVE_SCENE_FIELDS` in `coc_module_reachability.py` through `tests/test_progressive_scene_fields.py`, so a tenth field is a decision rather than a silence |

## Where the contract left a choice

These three expectations are the fixture author's reading, not a contract
quotation. If the implementation disagrees, settle the contract first and edit
the fixture deliberately — do not quietly relax it.

1. **`duplicate-record-id` subject.** The contract fixes `subject_kind` as
   `collection` but not what `subject_id` names. These fixtures use the
   duplicated record id as `subject_id` (spec §6: the lint mints no
   identifier) and the holding document filename in `related_ids`. The
   in-flight implementation currently does the inverse — `subject_id`
   `"story-graph.json/scenes"`, `related_ids` `["scene-b"]`. Only one of the
   two can stand; settling it is a one-line edit to
   `duplicate-record-id-trigger.json` once the contract says which.
2. **Zero start scenes.** `start-scene-count-zero-starts` expects only
   `start-scene-count`, with `scene-unreachable`,
   `conclusion-behind-unreachable-scenes`, and `gate-self-locks` in
   `codes_not_measured`: with no declared origin, traversal has nothing to
   measure from, which is the same shape as an absent document. The other
   reading — every scene reported unreachable — turns one accounting
   observation into a wall of them.
3. **`is_final: false`.** No fixture relies on whether an explicit
   `is_final: false` counts as "the scenario uses `is_final`".
   `no-is-final-anywhere-not-measured` omits the key entirely from every
   scene; every other case declares `is_final: true` on at least one scene.
