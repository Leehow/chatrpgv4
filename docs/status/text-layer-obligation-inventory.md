# Text-layer obligation inventory (pre-TextGraph)

> **Status:** Read-only inventory. No code, data, or behavior was changed.
> **Date:** 2026-09-01
> **Track:** `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`; Codex-host implementation,
> adapters, prompts, launchers, tests, and documentation remain off-limits.
> **Basis:** `claude/pi-coc-text-graph-20260901` off `0.8.1a@65ca572b`.
> **Play evidence:** `.coc/playtests/dirgraph-smoke-20260901/` (grok-4.5 as live
> KP, The Haunting, zh-Hans, `pi-coc --mode rpc`, 2026-09-01 05:14–05:38 EDT)
> plus the 67-run preserved corpus under `.coc/`.
> **Purpose:** establish what the text layer must own, how often it is actually
> reached, and which parts of it are structure versus semantics versus one-off
> patches. This file is the evidence base for
> `docs/specs/pi-coc-text-graph-runtime.md`.

Every number below names the command that produced it. Where a figure in the
commissioning brief did not reproduce, the correction is stated with its cause
rather than quietly replaced.

## Method

Three kinds of measurement, kept separate:

1. **Reachability** — counted from `logs/toolbox-calls.jsonl`, the canonical
   per-campaign operation log, across every preserved run under `.coc/`. This
   is the question the DirectorGraph work answered last and should have
   answered first.
2. **Vocabulary and literals** — extracted from the source by import and AST
   walk, never by reading the file and estimating.
3. **Actual use of each vocabulary** — counted from
   `logs/narration-reviews.jsonl` and `logs/turn-finalizations.jsonl`, so that
   "the code defines four rule ids" is never confused with "the KP uses four
   rule ids".

`.coc/` is gitignored evidence and was read only. Runs are de-duplicated by
`(file size, campaign id)` because playtest sandboxes contain byte-identical
copies of campaigns that also exist under `.coc/campaigns/`.

---

## 1. Reachability — the text layer is the busiest layer in the product

### 1.1 The cited session

```bash
uv run --frozen python - <<'PY'
import json, collections
p = ('.coc/playtests/dirgraph-smoke-20260901/sandbox/.coc/campaigns/'
     'dirgraph-smoke-20260901/logs/toolbox-calls.jsonl')
c = collections.Counter(json.loads(l)['tool'] for l in open(p) if l.strip())
tot = sum(c.values())
TEXT = ['turn.finalize', 'narration.review', 'turn.output_context']
DIR = ['director.advise', 'storylets.suggest', 'actions.advise',
       'npc.advise', 'threat.query']
for label, keys in (('text', TEXT), ('director', DIR)):
    n = sum(c[k] for k in keys)
    print(f'{label:9s} {n:3d}/{tot} = {n/tot*100:.1f}%  ' +
          ' '.join(f'{k}={c[k]}' for k in keys))
PY
```

| Layer | Calls | Share |
| --- | ---: | ---: |
| Text (`turn.finalize` 6, `narration.review` 7, `turn.output_context` 5) | **18 / 45** | **40.0%** |
| Director (all five advisory ops) | **0 / 45** | **0.0%** |

### 1.2 Correction to the commissioning brief

The brief cited "38% of all tool calls (`turn.finalize` 46, `narration.review`
42, `turn.output_context` 21 of 317)". **Those absolute counts do not
reproduce.** The session preserved at `.coc/playtests/dirgraph-smoke-20260901/`
contains 45 canonical toolbox calls, not 317:

```bash
wc -l .coc/playtests/dirgraph-smoke-20260901/sandbox/.coc/campaigns/\
dirgraph-smoke-20260901/logs/toolbox-calls.jsonl          # 45
uv run --frozen python - <<'PY'
import json, collections
p = '.coc/playtests/dirgraph-smoke-20260901/rpc-events.jsonl'
c = collections.Counter(json.loads(l).get('type') for l in open(p))
print('tool_execution_start:', c['tool_execution_start'])   # 67
PY
```

The host-level event stream records 67 tool executions (45 canonical toolbox
operations plus `read`, `coc_discover`, and setup calls), across one session
running 05:14:11–05:38:13 with six player prompts. The process (`pid 43957`) is
dead and the logs have been stable since 05:38, so this is not a partial read
of a live session. `rpc-wire.jsonl` additionally holds 15 events from an aborted
00:54 attempt; including them changes nothing.

Every `toolbox-calls.jsonl` under `/Users/haoli/leehow/code` (390 files) was
searched. No run reports 317 calls with that breakdown. Exactly one run anywhere
has `turn.finalize == 46` — `.tmp/rpc-accept-20260823T113331`, an unrelated
2026-08-23 acceptance run with **864** calls, `narration.review` 49 and
`turn.output_context` 150. The brief's figures appear to mix at least two
sources; they are not recoverable from the cited evidence directory and are not
repeated in this document.

**The structural claim survives the correction, and is stronger than the number
that was cited.** Text share in that session is 40.0%, not 38%; Director share
is 0.0% exactly as stated.

### 1.3 The corpus measurement, which is better evidence than any one session

One session is thin evidence about reachability. The same count over every
preserved run removes the sampling risk that invalidated the DirectorGraph
conclusion:

```bash
uv run --frozen python - <<'PY'
import json, collections, os
TEXT = ['turn.finalize', 'narration.review', 'turn.output_context']
tot = collections.Counter(); n = 0; runs = 0; seen = set()
for dp, _, fns in os.walk('.coc'):
    if 'toolbox-calls.jsonl' not in fns:
        continue
    fp = os.path.join(dp, 'toolbox-calls.jsonl')
    key = (os.path.getsize(fp), dp.split('/campaigns/')[-1])
    if key in seen:
        continue
    seen.add(key)
    local = collections.Counter()
    for line in open(fp, errors='ignore'):
        if line.strip():
            try: local[json.loads(line).get('tool', '?')] += 1
            except Exception: pass
    if local:
        runs += 1; n += sum(local.values()); tot += local
t = sum(tot[k] for k in TEXT)
print(f'runs={runs} calls={n} text={t} ({t/n*100:.1f}%)')
for k, v in tot.most_common(10): print(f'  {v:5d} {k}')
PY
```

| | |
| --- | --- |
| Preserved runs | **67** |
| Canonical operation calls | **3703** |
| Text layer | **807 (21.8%)** |
| `director.advise` + `storylets.suggest` (the only two ops that read Director doctrine) | **2 (0.05%)** |

Corpus-wide operation ranking:

| Rank | Operation | Calls |
| ---: | --- | ---: |
| 1 | **`turn.finalize`** | **321** |
| 2 | **`turn.output_context`** | **286** |
| 3 | `session.resume` | 227 |
| 4 | `state.journal` | 220 |
| 5 | `rules.roll_dice` | 212 |
| 6 | `scene.context` | 209 |
| 7 | **`narration.review`** | **200** |

Restricting to the 21 runs whose build has `narration.review` at all, the text
share is 564 / 2527 = **22.3%**, so the figure is not an artifact of old runs
lacking one of the three operations.

The three operations TextGraph routes through are ranked 1, 2 and 7 out of 147.
This is the opposite situation from DirectorGraph, whose artifact was reached
twice in 3703 calls.

---

## 2. What the text layer already computes correctly

### 2.1 Obligations are derived, not authored

`_build_obligations` ([coc_turn_finalization.py:1554](../../plugins/coc-keeper/scripts/coc_turn_finalization.py))
and `_build_sanity_bout_obligations` (line 1642) build every obligation from
settled receipts. There are exactly three id namespaces in the tree:

```bash
grep -rn 'obligation_id.*f"' plugins/coc-keeper/scripts/*.py
# coc_turn_finalization.py:1577   f"roll:{roll_id}"
# coc_turn_finalization.py:1617   f"first-impression:{source_id}"
# coc_turn_finalization.py:1673   f"sanity_bout:{bout_id}"
```

Confirmed: `coc_turn_finalization.py` is 4526 lines and `_build_obligations`
begins at line 1554, as the brief stated. One refinement — `sanity_bout:` is
built by the adjacent `_build_sanity_bout_obligations`, not by
`_build_obligations` itself.

Observed use across the corpus:

```bash
uv run --frozen python - <<'PY'
import json, collections, os
ns = collections.Counter(); real = collections.Counter()
pih = collections.Counter(); seg = collections.Counter(); n = 0
for dp, _, fns in os.walk('.coc'):
    if 'turn-finalizations.jsonl' not in fns: continue
    for line in open(os.path.join(dp, 'turn-finalizations.jsonl'), errors='ignore'):
        if not line.strip(): continue
        try: d = json.loads(line)
        except Exception: continue
        n += 1
        for r in d.get('coverage') or []:
            ns[str(r.get('obligation_id', '')).split(':')[0]] += 1
            real[r.get('realization')] += 1
            pih[r.get('player_input_handling')] += 1
        for s in d.get('segments') or []:
            seg[s.get('segment_type')] += 1
print(n, dict(ns), dict(real), dict(pih), dict(seg))
PY
```

| Vocabulary | Declared in code | Observed in 506 finalization records / 418 coverage rows |
| --- | --- | --- |
| obligation namespace | `roll`, `first-impression`, `sanity_bout` | `roll` 370, `first-impression` 48, **`sanity_bout` 0** |
| `REALIZATION_VALUES` | `fictional_beat`, `concealed_no_player_visible_beat` | `fictional_beat` 418, **`concealed_no_player_visible_beat` 0** |
| `PLAYER_INPUT_HANDLING_VALUES` | 3 values | `specific_preserved` 352, `not_applicable` 61, `abstract_completed` 5 |
| segment types | `MECHANIC_SEGMENT_TYPES` (4) **+ `fiction`** | `fiction` 1746, `public_check` 346, `asset_delta` 60, `state_delta` 47, `exceptional_effect` 20 |

**Recorded finding — a fifth segment type outside the frozenset.** `fiction` is
not a member of `MECHANIC_SEGMENT_TYPES`; it is spliced in as a bare string at
eight sites (`coc_turn_finalization.py` 537, 552, 563, 3334, 3905, 4199, 4331,
4395) and it is by far the most common segment type in play. `SEGMENT_TYPE_ORDER`
orders only the four mechanic types, while line 563 encodes a separate ordering
law — `segments[0].segment_type` must be `fiction`. Declaration order is
therefore behaviourally observable in two independent places.

### 2.2 `validate_coverage` is already presence-only, not a prose judge

`validate_coverage` ([coc_turn_finalization.py:2999](../../plugins/coc-keeper/scripts/coc_turn_finalization.py))
checks the closed field set, membership in the two closed value sets, and that
`exact_excerpt` appears verbatim in the draft. It never scores prose. This is
the shape TextGraph must preserve, not replace.

### 2.3 `narration.review` already carries a structured, effect-bound plane

```bash
uv run --frozen python - <<'PY'
import json, collections, os
n = claims = bound = withc = 0
disp = collections.Counter(); kinds = collections.Counter()
rules = collections.Counter()
for dp, _, fns in os.walk('.coc'):
    if 'narration-reviews.jsonl' not in fns: continue
    for line in open(os.path.join(dp, 'narration-reviews.jsonl'), errors='ignore'):
        if not line.strip(): continue
        try: d = json.loads(line)
        except Exception: continue
        n += 1
        for f in d.get('findings') or []:
            rules[f.get('rule_id')] += 1
        sar = d.get('state_authority_review') or {}
        if not isinstance(sar, dict): continue
        disp[sar.get('disposition')] += 1
        cl = sar.get('claims') or []
        withc += bool(cl)
        for c in cl:
            claims += 1; kinds[c.get('claim_kind')] += 1
            bound += bool(c.get('source_effect_id'))
print(n, withc, claims, bound, dict(disp), dict(kinds), dict(rules))
PY
```

Across **293 recorded reviews**:

| Half of `narration.review` | Result |
| --- | --- |
| `state_authority_review` — structured claims bound to a settled effect id | 281 reviews carried a disposition (`no_player_state_change_claimed` 249, `claims_listed` 32); **58 claims, 58 of 58 bound to a `source_effect_id`**, in 4 claim kinds (`item` 26, `cash` 17, `condition` 10, `scalar` 5) |
| `findings` — the free prose-quality rule vocabulary | **0 findings, of any rule id, ever** |

This is the empirical core of the two-plane design. The structured,
effect-derived half of the very same operation is used on every turn and lands
correctly 58 times out of 58. The prose-quality half has never fired once — not
even `over_length`, which the code appends automatically when a draft exceeds
twice its budget.

---

## 3. The review-rule vocabulary

Confirmed at [coc_operation_turn_output.py:1190-1192](../../plugins/coc-keeper/scripts/coc_operation_turn_output.py):

```python
allowed_rule_ids = {
    "agency_violation", "semantic_repetition", "scope_overreach", "over_length",
}
```

Two refinements to the brief. It is a **`set` literal named `allowed_rule_ids`**,
not a Python `enum`. And the four ids are not equals: `agency_violation` is the
sole hard gate; the other three are advisory.

**Recorded finding — three of the four ids are enforced but never published.**
A `rule_id` outside the set raises `invalid_param`, yet the model-visible
contract never lists the set:

```bash
uv run --frozen python - <<'PY'
import json
d = json.load(open('plugins/coc-keeper/references/mcp-operation-contracts.json'))
print('operation_count:', d['operation_count'])                       # 147
f = d['operations']['narration.review']['inputSchema']['properties']['findings']
print('findings schema:', json.dumps(f)[:120])
PY
grep -c agency_violation plugins/coc-keeper/references/mcp-operation-contracts.json   # 3
grep -c semantic_repetition plugins/coc-keeper/references/mcp-operation-contracts.json # 0
```

`findings` is declared as a bare `{"type": "array"}` with no `items` and no
`enum`. Only `agency_violation` appears anywhere in the model-visible contract,
inside prose descriptions. `semantic_repetition`, `scope_overreach` and
`over_length` are enforced by the validator and never told to the only caller
that could emit them. Zero findings in 293 reviews (§2.3) is the expected
consequence, not a surprise.

---

## 4. `coc_narration_style.py` — the honest split

519 lines, confirmed by `wc -l`. Eight `re.compile` objects, confirmed by
`grep -c 're\.compile'`. Table sizes measured by import rather than by reading:

```bash
uv run --frozen python - <<'PY'
import sys; sys.path.insert(0, 'plugins/coc-keeper/scripts')
import coc_narration_style as m
for name in ('_INNER_STATE_TERMS _ABSTRACT_ACTIONS _AI_SUMMARY_PHRASES '
             '_EXPLANATION_PHRASES _UNNATURAL_SPATIAL_PHRASES '
             '_ZH_FINAL_REWRITE_REPLACEMENTS _CRISIS_RENDER_REQUIRED_SLOTS '
             '_PLAYER_VISIBLE_MUST_NOT _HORROR_AXES _HORROR_STAGE_BASE '
             '_HORROR_TAG_WEIGHTS _EXPOSITORY_CHOICE_SUMMARY_RES').split():
    print(f'{name:34s} {len(getattr(m, name))}')
PY
```

### 4.1 Corrections to the brief's table census

| Table | Brief | Measured | Note |
| --- | ---: | ---: | --- |
| `_INNER_STATE_TERMS` | 11 | **11** | confirmed |
| `_ABSTRACT_ACTIONS` | 7 | **7** | confirmed |
| `_EXPLANATION_PHRASES` | 4 | **4** | confirmed |
| `_UNNATURAL_SPATIAL_PHRASES` | 2 | **2** | confirmed |
| `_CRISIS_RENDER_REQUIRED_SLOTS` | 7 | **7** | confirmed |
| `_HORROR_AXES` | 7 | **7** | confirmed |
| `_PLAYER_VISIBLE_MUST_NOT` | 3 | **3** | confirmed |
| `_ZH_FINAL_REWRITE_REPLACEMENTS` | 25 | **13** | **corrected** — 13 `(old, new)` pairs |
| `_AI_SUMMARY_PHRASES` | — | **11** | **omitted from the brief** |
| `_HORROR_STAGE_BASE` | — | **4 stages / 10 weights** | **omitted from the brief** |
| `_HORROR_TAG_WEIGHTS` | — | **5 tags / 5 weights** | **omitted from the brief** |
| `_EXPOSITORY_CHOICE_SUMMARY_RES` | — | **4 regexes** | **omitted from the brief** |

Three tables missing from a census of eight is the reason slice T1's residue
gate must cover the whole file rather than a named list of tables. This is
DirectorGraph correction 3 arriving one slice earlier.

### 4.2 The zh-only claim, demonstrated

```bash
uv run --frozen python - <<'PY'
import sys; sys.path.insert(0, 'plugins/coc-keeper/scripts')
import coc_narration_style as m
zh = "这表明危险。他没有回头，眼睛盯着通信壕里那段暗处。"
en = ("This shows the danger. He did not turn; his eyes stayed fixed on "
      "that dark stretch of the trench.")
for lang, text in (("zh-Hans", zh), ("en", en)):
    f = m.audit_player_visible_text(text, lang)
    print(lang, [x['rule_id'] for x in f],
          m.player_facing_style_contract(lang)['deterministic_guard'])
print(m.guard_player_visible_text(zh, "zh-Hans")["final_text"])
PY
```

| Language | Findings | `deterministic_guard` |
| --- | --- | --- |
| `zh-Hans` | 3 — `ai_summary_voice`, `camera_direction_staging`, `unnatural_spatial_phrase` | `non_authoritative_surface_smoke` |
| `en` (same semantic content) | **0** | `unavailable` |

Confirmed: `audit_player_visible_text` returns `[]` for any language other than
`zh-Hans`, so the layer silently does nothing in an English session.

The same command shows the second, worse property. Given the zh input, the
guard **silently rewrites the Keeper's prose**:

> `他没有回头，眼睛盯着通信壕里那段暗处` → `他没看你，仍盯着壕沟前面的暗弯`

That substitution is not a review finding the KP can weigh. It replaces
KP-authored fiction from a fixed table, which is the authority AGENTS.md
reserves to the Keeper.

### 4.3 The split

Every table and regex in the file is placed. Nothing is left unclassified.

#### A. Structurally expressible — goes in the graph (no prose is read)

| Item | Size | Why it is structure |
| --- | ---: | --- |
| `_CRISIS_RENDER_REQUIRED_SLOTS` | 7 | named render slots; `validate_crisis_scene_render_frame` checks presence of a slot, never its wording. **Order is observable** — `build_crisis_scene_render_frame` emits `render_sequence` in declaration order, so these need an explicit `ordinal` |
| `_PLAYER_VISIBLE_MUST_NOT` | 3 | three constraint ids (`slot_labels`, `expository_choice_summary`, `if_then_option_dump`); identity only |
| `required_rules` in `player_visible_style_guard_contract` | 6 | craft-directive ids already semantic |
| `avoid` / `prefer` lists | 5 zh, 4 non-zh / 4 | semantic ids. The zh/non-zh divergence (`translationese` present only for zh) is a real applicability fact to encode, not to erase |
| `repetition_policy.expand_only_when` + 3 policy keys | 4 + 3 | structured triggers |
| `final_output_pass.invoke_when` | 4 | structured triggers |
| `not_for` triple | 3, repeated 4× in the file | one authority law, currently copy-pasted at four sites |

#### B. Genuinely semantic — becomes a review rule or craft directive; the regex is deleted

All eight `re.compile` objects and the tables that exist only to build them.

| Deleted | Size | Replaced by |
| --- | ---: | --- |
| `_AI_SUMMARY_PHRASES` + `_EXPLANATION_PHRASES` + `_EXPOSITORY_CHOICE_SUMMARY_RES` | 11 + 4 + 4 regex | review rules `ai_summary_voice`, `expository_choice_summary`, each carrying its existing `rewrite_directive` as craft prose |
| `_INNER_STATE_TERMS` + `_ABSTRACT_ACTIONS` + `_RHETORICAL_EXPLANATION_RE` + `_ABSTRACT_METAPHOR_RE` | 11 + 7 + 2 regex | review rule `abstract_psychological_explanation`. The two tables exist **only** to interpolate the two regexes and have no other reader |
| `_PASSIVE_TRANSLATION_RE` | 1 regex, 13 inline verbs | review rule `passive_translation_ese`; as a semantic id it stops being zh-specific |
| `_CAMERA_DIRECTION_RE` | 1 regex | review rule `camera_direction_staging` |

Six of these rule ids already exist as strings in the file's own findings. The
migration keeps the id and the directive and deletes the matcher.

#### C. One-off instance patches — deleted outright, replaced by nothing

| Deleted | Size | Why |
| --- | ---: | --- |
| `_ZH_FINAL_REWRITE_REPLACEMENTS` | 13 pairs | a silent substitution table. Pairs 1–6 are fragments of **one verbatim sentence from one past playtest** (`布鲁诺没有回头，眼睛盯着通信壕里那段暗处。` — a White War trench scene). Pairs 7–13 restate `_AI_SUMMARY_PHRASES` entries as rewrites. Substituting KP prose from a table is the authority violation §4.2 demonstrates |
| `_UNNATURAL_SPATIAL_PHRASES` | 2 | both entries (`那段暗处`, `通信壕里那段暗处`) are fragments of that same sentence |
| the two `re.sub` cleanups in `guard_player_visible_text` | 2 | whitespace/punctuation repair that only runs inside the substitution block |
| `audit_final_text`, `append_narration_audit_records` | 2 functions | **zero callers** anywhere in `plugins/`, `runtime/`, `web/`, `desktop/` or `tests/`; and no `narration-audit.jsonl` exists in any of the 67 preserved runs |

#### D. Out of TextGraph scope — Director doctrine that happens to live in this file

| Item | Size | Owner |
| --- | ---: | --- |
| `_HORROR_AXES`, `_HORROR_STAGE_BASE`, `_HORROR_TAG_WEIGHTS`, `build_horror_profile` | 7 axes, 4 stages, 5 tags, **15 authored-doctrine weights** | consumed only by `coc_story_director.py:4419`, inside the `director.advise` payload. These are pacing doctrine, not presentation. They are named here so that the residue gate can exclude them **explicitly** rather than by omission |

### 4.4 Where the module is actually reached

```bash
for fn in guard_player_visible_text audit_player_visible_fields \
          audit_final_text player_facing_style_contract build_horror_profile; do
  echo "-- $fn"; grep -rn "$fn" plugins/ runtime/ web/ desktop/ \
    | grep -v 'coc_narration_style.py:'; done
```

| Entry point | Production caller | Reached on the pi-coc path? |
| --- | --- | --- |
| `guard_player_visible_text` (the regex engine) | `coc_narration_contract.audit_player_visible_fields` → `coc_live_turn_runner.py:1399` → `runtime/adapters/debug/adapter.py` | **No.** `runtime/` is the headless acceptance interface; the pi-coc product turn channel is the toolbox operations |
| `audit_final_text` | none | **No — zero callers** |
| `player_facing_style_contract` | `narration.brief` (`coc_operation_turn_output.py:657`) | Technically yes; `narration.brief` was called **2 times in 3703** |
| `build_horror_profile` | `director.advise` (`coc_story_director.py:4419`) | `director.advise` was called **2 times in 3703** |

**Recorded finding — the 519-line style module has effectively no production
reach on the pi-coc path, and none at all for its regex engine.** Its enforced
half runs only under the headless debug adapter and produced zero audit records
in the entire preserved corpus. Meanwhile the three operations TextGraph routes
through carry 807 calls. Deleting the matchers costs nothing that play is
currently getting.

---

## 5. Doctrine numbers: the text layer is not a tuning problem

```bash
uv run --frozen python - <<'PY'
import ast, collections
for fp in ('coc_turn_finalization.py', 'coc_operation_turn_output.py',
           'coc_narration_style.py', 'coc_narration_contract.py'):
    p = 'plugins/coc-keeper/scripts/' + fp
    tree = ast.parse(open(p, encoding='utf-8').read())
    lits = [n.value for n in ast.walk(tree)
            if isinstance(n, ast.Constant)
            and isinstance(n.value, (int, float)) and not isinstance(n.value, bool)]
    nt = [v for v in lits if v not in (0, 1, -1, 2)]
    print(f'{fp:32s} total={len(lits):4d} non-trivial={len(nt):3d} '
          f'distinct={len(set(nt))}')
PY
```

| File | Lines | Numeric literals | Non-trivial | Distinct |
| --- | ---: | ---: | ---: | ---: |
| `coc_turn_finalization.py` | 4526 | 117 | **9** | 8 |
| `coc_operation_turn_output.py` | 3548 | 136 | **30** | 23 |
| `coc_narration_contract.py` | 2322 | 62 | **12** | 9 |
| `coc_narration_style.py` | 519 | 25 | **15** | 10 |

**66 non-trivial numbers across 10,915 lines**, and 15 of those belong to the
Director's horror profile (§4.3 D). DirectorGraph had ~119 unexplained tunables
in a single file; TextGraph has almost none.

The one genuine authored-doctrine ladder is `_narration_budget`
([coc_operation_turn_output.py:390](../../plugins/coc-keeper/scripts/coc_operation_turn_output.py)):
four modes, eight numbers, eight trigger event ids, first match wins.

| Mode | `max_chars` | `max_paragraphs` | Triggered by |
| --- | ---: | ---: | --- |
| `climax_or_madness` | 1500 | 8 | active bout, or `bout_of_madness`/`indefinite_insanity`/`permanent_insanity`/`session_ending` |
| `reveal_or_transition` | 900 | 5 | `scene_transition`/`major_reveal`/`exceptional_effect_apply` |
| `costly_result` | 550 | 3 | `hp_change`/`sanity_loss`/`luck_spend` |
| `routine_resolution` | 350 | 2 | fallback |

It is keyed entirely on structured event ids — no prose — so it is
structurally expressible. Its ladder order is behaviourally observable
(first match wins) and needs an explicit `ordinal`. It is also the input to
`over_length`, the only automatically generated review finding, which has
never fired.

**Consequence for the spec:** TextGraph's payload is vocabulary and obligation
derivation, not a doctrine ledger. The DirectorGraph gate "every value is
bit-identical to the value it replaced" still applies, but it governs a much
smaller set.

---

## 6. Pre-emptive duplicate scan (DirectorGraph correction 6, applied before T1)

DirectorGraph excluded `coc_director_apply.py` from migration and therefore also
from scanning, and it turned out to hold private copies of four migrated values.
The equivalent scan was run **before** declaring TextGraph's scope.

```bash
grep -rn 'first-impression:\|sanity_bout:' plugins/ runtime/ web/ desktop/ \
  | grep -v node_modules | grep -v 'coc_turn_finalization.py:'
grep -rn 'semantic_repetition\|scope_overreach\|agency_violation\|over_length' \
  plugins/ runtime/ web/ desktop/ | grep -v node_modules \
  | grep -v 'coc_operation_turn_output.py:'
```

The obligation namespace has copies in **seven places outside its owner**:

| Location | Copies | Kind |
| --- | ---: | --- |
| `plugins/coc-keeper/pi/lib/tool-contract-projection.ts` (8138 lines) | **4** (lines 4349, 7047, 7048, 7784) plus prose at 7432 | **TypeScript** — a Python-only residue gate cannot see this file at all |
| `plugins/coc-keeper/pi/prompts/host-system-play.md` | 2 rows | model-facing prompt |
| `plugins/coc-keeper/skills/coc-keeper-play/references/turn-tooling-and-typed-ops.md` | 2 rows | Skill reference |
| `coc_npc_state.py:1290` | 1 | builds `first-impression:` memory ids |
| `coc_operation_turn_output.py:433` | 1 | builds a `sanity_bout:` `source_ref` |
| `export_battle_report.py:485` | 1 | parses the `sanity_bout:` prefix |

The review-rule vocabulary has copies in `mcp-operation-contracts.json` (prose,
`agency_violation` only), `host-system-play.md:479`, three
`coc-keeper-play` reference documents, `export_battle_report.py:2355`, and
`semantic_repetition` appears as an `avoid` token in both
`coc_narration_contract.py:2098` and `coc_narration_style.py:351,371`.

**Consequence for the spec:** the T1 residue gate must be cross-language and
must cover `pi/lib/*.ts`, `pi/prompts/*.md` and `skills/**/references/*.md`, not
only `plugins/coc-keeper/scripts/*.py`. A gate that scanned only Python would
have declared the migration complete with four live copies remaining in the
model-facing projection layer.

---

## 7. RuleGraph effect nodes available for grounding

```bash
uv run --frozen python - <<'PY'
import json, collections
d = json.load(open('plugins/coc-keeper/rulesets/coc7/rule-graph.json'))
eff = [n for n in d['nodes'] if n['node_kind'] == 'effect']
em = [r for r in d['relations'] if r['relation_kind'] == 'emits']
print('effects', len(eff), 'emits', len(em),
      'effects with an incoming emits', len({r['to_node_id'] for r in em} & {n['node_id'] for n in eff}))
print(dict(collections.Counter(n['node_id'].split(':')[2] for n in eff)))
for f in ('authority', 'audience', 'visibility'):
    print(f, dict(collections.Counter(n.get(f) for n in eff)))
print('with evidence spans', sum(1 for n in eff if n.get('evidence_span_ids')))
PY
```

| | |
| --- | --- |
| `effect` nodes | **23** |
| `emits` relations | **23** — every effect has exactly one incoming `emits` from a `decision` |
| Families | `magic` 7, `chase` 6, `development` 5, `healing` 3, `push-luck` 1, `social` 1 |
| `authority` | `deterministic` 23/23 |
| `visibility` | `public` 22, `keeper-only` 1 (`push-luck:luck-spend-mutate`) |
| `hard_gate` | `false` 23/23 |
| Carrying `evidence_span_ids` | **23 / 23** |

**Correction to the brief.** The brief said "three exist today". That was true
at `0.8.1a@60c1c4b4`, the DirectorGraph baseline:

```bash
git show 60c1c4b4:plugins/coc-keeper/rulesets/coc7/rule-graph.json \
  | uv run --frozen python -c "import json,sys,collections; d=json.load(sys.stdin); \
print(collections.Counter(n['node_kind'] for n in d['nodes'])['effect'], \
sum(1 for r in d['relations'] if r['relation_kind']=='emits'))"
# 3 3
git log --oneline 60c1c4b4..65ca572b | wc -l   # 80
```

Eighty commits of RuleGraph family work later, the production artifact has 23
effects across six families, each source-bound and each already carrying the
`visibility` field an obligation plane needs. **The obligation plane is roughly
eight times better supplied than the brief assumed.**

---

## 8. Registry state and surface size

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_toolbox.py list \
  | uv run --frozen python -c "import json,sys; print(len(json.load(sys.stdin)['tools']))"
# 147
```

`147` is confirmed twice — by the live toolbox listing and by
`mcp-operation-contracts.json`'s own `operation_count`. TextGraph must not
change it.

`plugins/coc-keeper/references/system-ontology-contract-v1.json` already
reserves everything the design needs, verbatim:

- graph kind `text`, `authority_plane: "presentation"`,
  `node_ontology_contract: null` — so TextGraph must supply its own contract id;
- relation `renders-settled-output`: source `text` → target `rule` (`effect`) or
  `live-state` (`live-state-fact`), `authority_effect: "presentation-only"`;
- authority law: *"Text and finalization render settled effects or obligations
  and have no rules, execution, or state authority."*

`system-ontology-registry-v1.json` records `graph:text:production` as
`absent-production-artifact`, reason: *"Finalization and output-context
machinery exist, but there is no source-controlled TextGraph machine artifact
to reference."*

**Recorded finding — stale registry prose.** The `module` coverage row still
reads *"the current production healing-only RuleGraph"* while the `rule` row
next to it correctly says *"ten source-accepted families"*. Recorded, not
repaired; it is a Codex-track-adjacent shared file and outside this slice.

---

## 9. Verdict

| Claim | Status |
| --- | --- |
| The text layer is the most-called layer in play | **Verified.** 40.0% of one session; 21.8% of 3703 calls across 67 runs; ranks 1, 2 and 7 of 147 operations |
| Obligations are already derived from settled state | **Verified.** 3 namespaces, 418 coverage rows, 0 authored |
| `narration.review` already works structurally and not textually | **Verified.** 58/58 claims bound to a settled effect id; 0/293 prose findings |
| The style module is zh-only | **Verified**, and it silently rewrites KP prose from a 13-entry table seeded by one playtest |
| The style module's regex engine is reached in play | **Refuted.** Zero production reach on the pi-coc path; zero audit records in 67 runs |
| The text layer is a doctrine-tuning problem | **Refuted.** 66 non-trivial numbers in 10,915 lines, 15 of them Director-owned |
| Three RuleGraph effects exist to ground against | **Corrected: 23**, each with an `emits` relation and source spans |
| 317 tool calls in the cited session | **Corrected: 45** canonical calls (67 host tool executions) |
| `_ZH_FINAL_REWRITE_REPLACEMENTS` has 25 entries | **Corrected: 13** |
| The style module has 8 tables | **Corrected: 12** |

**The headline: the text layer is reached 400× more often than the Director
layer, computes its obligations from settled state already, and its only
prose-matching component is unreachable in the product, untriggered in 293
recorded reviews, and silently rewrites the Keeper's own sentences when it does
run.** That is what makes TextGraph affordable where DirectorGraph stalled, and
it is what slice T4 exists to delete.

## Boundary

This inventory covers the **presentation** surface: obligation derivation,
coverage verification, review vocabulary, and narration style. It deliberately
does not inventory rules settlement, state transactions, or the Director's
pacing doctrine. `build_horror_profile` and its 15 weights are named in §4.3 D
as explicitly excluded rather than silently skipped, because the residue gate
must know the difference between "out of scope" and "not looked at" — the
distinction that cost DirectorGraph a whole extra slice.
