Status: ready-for-human (filed 2026-09-29, found in passing during SL-104; fixed on `claude/admission-effect-signature-20260929`)
Stage: SL-105 (admission: the reuse key missed fields the reviewed kinds declare, so a verdict on one time cost was reused for another)
Spec: docs/kernel-rpc.md §32.4 (reuse key), §32.4.1 (this ticket), §32.12.3 (whole-batch resend recognition), §32.12.3.1 (line keys); `extensions/kernel/admission.ts` (`effectSignature`, `admissionRequest`), `extensions/kernel/tools.ts` (the `apply` effect schemas, `SENTENCE_FIELDS`)

# SL-105: the admission key read a fixed field list that the schema outgrew

## Evidence (pure, no table)

`effectSignature` built each effect's part of the admission reuse key (§32.4: "each effect's kind and its identifying
fields") from a fixed list. Every field added to a reviewed kind after the list was written was missing from it:

| kind | declared, not read by the key |
| --- | --- |
| `time` | `band` (§138), `until` (§145.1), `stated` (§136.22), `beyond_travel` (§156), `intent_ref`, `intent_outcome` (§142.2) |
| `cash` | `stated`, `intent_ref`, `intent_outcome` |
| `move` | `via`, `intent_ref`, `intent_outcome` |
| `object` | `document`, `part` |
| `clue`, `item`, `handout` | `intent_ref`, `intent_outcome` |
| `map`, `usage` | none |

Verified: `effectSignature({kind: "time", band: "speak_briefly"}) === effectSignature({kind: "time", band: "library_research"})`,
and both equal `{kind: "time", until: {...}}` and `{kind: "time", stated: "x"}`. Within a turn a verdict on a word at the
desk is therefore reused for an afternoon of research or a night's sleep (an admission lands the larger cost unreviewed; a
refusal refuses a different cost the player may have chosen), and §32.12.3's whole-batch resend recognises landed lines by
the same too-coarse signature. The lane is shown every field of a line (`describe` in `admissionRequest`), so its verdict
can turn on any of them; §32.4's reuse is sound only when a verdict depends on nothing outside the key.

## The class

Not these fields: the list is kept by hand and nothing tied it to the schema, so it drifts every time a kind grows a field.
Fixing the class means the next field cannot slip past unnoticed.

## Fix

- Contract first: §32.4.1 (dated addendum; §32.4 gets a pointer). The rule: an `apply` effect's identifying fields are every
  field its kind declares except the rationale sentences `why` and `how` (`SENTENCE_FIELDS`, §135.21), with a table per
  reviewed kind. It also corrects §32.4's stale "`label` ... outside the key" (a move's `label` has been in the key since
  2026-09-12 and is judged as the place it names) and records that `intent_ref`/`intent_outcome` identify (the effect settles
  that intention, §142.2: a write, not a rationale).
- `effectSignature` reads `IDENTIFYING_FIELDS`, which now includes `via`, `band`, `until`, `stated`, `beyond_travel`,
  `document`, `part`, `intent_ref`, `intent_outcome`. One list for all kinds, so a same-named field on an unreviewed kind
  (a `damage`'s `band`, an `npc`'s `intent_ref`) now also enters the batch key: finer, never coarser.
- `TRIGGER_KINDS` is exported so the guard can walk exactly §32.1's reviewed kinds.

## Tests (`tests/extension/admission-effect-signature.test.mjs`)

- Through the real `apply` admission seam (real extension, scripted lane, fake kernel), one player turn: `time band=speak_briefly`
  admitted and landed, then `time band=sleep_night` reviewed again (two lane calls, two keys) and refused, not landed.
- Same seam: a `why`-only resend reuses the kept refusal (one lane call, second row `reused: true`, same key).
- Schema guard: for each of `TRIGGER_KINDS`, every field the `apply` schema declares for that kind, set to a value of its
  declared type, changes `effectSignature` and `admissionRequest`'s key; `why` and `how` change neither.
- The missed fields one by one (seven distinct `time` keys; `cash.stated`; `move.via`; `object.document`/`part`;
  `intent_outcome`), and `why`/`how` outside.

## Not done here

- `resolve`'s key (§32.4's first list) is a separate choice-centred design and was not re-derived; its code also reads
  `usage`, which §32.4.1 records. Fields such as `surprise`, `coercion`, `modifiers`, `rule` and `obligation` are outside
  it today. Whether any of them should identify a `resolve` is an owner question, not decided here.
- SL-104 (branch `claude/sl104-admission-batch-context-20260929`, §32.12.3.1.1) was not merged into 0.9.6a when this was
  written; its batch-scoped line key (`besideBatch`) reads `effectSignature`, so it inherits this fix when both land.

## Comments

**2026-09-29, mutations** (a copy of `extensions/kernel/admission.ts`, restored by `cp` and md5-checked after each; against
`admission-effect-signature.test.mjs`, on the Mac, one file). Every one red.

| id | mutation of `IDENTIFYING_FIELDS` | red tests |
| --- | --- | --- |
| M0 | the pre-fix list | band seam, schema guard, missed fields |
| M1 | drop `band` | band seam, schema guard, missed fields |
| M2 | add `why` | why-only seam, schema guard, missed fields |
| M3 | drop `intent_ref` | schema guard, missed fields |
| M4 | drop `intent_outcome` | schema guard, missed fields |
| M5 | drop `via` | schema guard, missed fields |
| M6 | drop `document` | schema guard, missed fields |
| M7 | drop `part` | schema guard, missed fields |
| M8 | drop `until` | schema guard, missed fields (after a second `until` was added to the case: with one, only the guard caught it) |
| M9 | drop `stated` | schema guard, missed fields |
| M10 | drop `beyond_travel` | schema guard, missed fields |

A trial merge with SL-104's branch (`git merge-tree` against `claude/sl104-admission-batch-context-20260929` at 158e4b076)
is clean.
