Status: ready-for-human (filed 2026-09-29, found in passing during SL-104; fixed on `claude/admission-effect-signature-20260929`)
Stage: SL-105 (admission: the reuse key missed fields the reviewed kinds declare, so a verdict on one time cost was reused for another)
Spec: docs/kernel-rpc.md §32.4 (reuse key), §32.4.1 and §32.4.2 (this ticket), §32.12.3.1.1 (SL-104's batch-mates in a line key), §32.12.3 (whole-batch resend recognition), §32.12.3.1 (line keys); `extensions/kernel/admission.ts` (`effectSignature`, `admissionRequest`), `extensions/kernel/tools.ts` (the `apply` effect schemas, the `resolve` action, `SENTENCE_FIELDS`)

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
- `resolve` (§32.4.2, decided on the owner's "行，你就尽管做", 2026-09-29, after this ticket left it open): one list,
  `RESOLVE_REVIEWED_FIELDS`, is both the reviewer's line and, less `stakes` (`RESOLVE_RATIONALE_FIELDS`), the key. The
  invariant for both tools: the key is exactly what the reviewers read, less the Keeper's rationale -- narrower and a verdict
  is reused for something it never saw, wider and a key change re-sends the reviewer the same input. So "does this field
  identify a `resolve`" became "should the reviewer read it", answered by §32.2 (the choice, never the result):
  - read and keyed, new: `skills`, `support`, `rule`, `obligation`, `intent_ref`, `intent_outcome`; `outcome` was already
    read and is now keyed (a verdict on `investigators_win` was reused for `fled`); `usage` was already keyed;
  - read, not keyed: `stakes` (unchanged);
  - neither: `modifiers`, `coercion`, `surprise`, `motive`, `mode`, `step`, `san_loss`, `involuntary`, `interrupted`, `rest`,
    `ending`, `scenario_san_reward_expr`, `decision`, `choice`.
  A `resolve` without the added fields reads and keys byte for byte as before (checked against the pre-change module).

## Tests (`tests/extension/admission-effect-signature.test.mjs`)

- Through the real `apply` admission seam (real extension, scripted lane, fake kernel), one player turn: `time band=speak_briefly`
  admitted and landed, then `time band=sleep_night` reviewed again (two lane calls, two keys) and refused, not landed.
- Same seam: a `why`-only resend reuses the kept refusal (one lane call, second row `reused: true`, same key).
- Schema guard: for each of `TRIGGER_KINDS`, every field the `apply` schema declares for that kind, set to a value of its
  declared type, changes `effectSignature` and `admissionRequest`'s key; `why` and `how` change neither.
- The missed fields one by one (eight distinct `time` keys; `cash.stated`; `move.via`; `object.document`/`part`;
  `intent_outcome`), and `why`/`how` outside.
- Through the real `resolve` admission seam: a Persuade roll admitted and rolled, then the same roll with `support` (a clue
  laid on the table) reviewed again, its line showing the clue, refused and not rolled; a roll whose resend changes only
  `stakes` and `modifiers` reuses the kept refusal.
- Schema guard on the `resolve` action: every declared field is either read (then shown in the line, and keyed unless
  rationale) or named a rules parameter of the result (then in neither), never both; no stale names on either list.
- A legacy-shaped `resolve` keeps its exact line and key; `outcome` splits the key.

## Not done here

- No live table. The change is to what the lane reads of a `resolve` only when a roll carries one of the added fields; how
  often the Keeper sends `support`, `rule`, `obligation` or `skills`, and whether the lane now refuses them more, is for the
  next long gate's admission rows to show (`lane: "admission"`, `verb: "resolve"`, the line in `proposed`).
- SL-104 (§32.12.3.1.1) landed in 0.9.6a while this was open; the branch was rebased onto it (c85f040c4). Its batch-scoped
  line key (`besideBatch`) reads `effectSignature`, so it carries this fix.
  One of its tests used a move's `via` as its example of a batch-mate field outside `effectSignature`; §32.4.1 keys `via`
  (the route), so that case now uses `why` and also asserts that a batch-mate's `via` is inside the key
  (`admission-line-batch-context.test.mjs`, found by the box's ext run after the rebase).

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

**2026-09-29, `resolve` mutations** (same method, on `RESOLVE_REVIEWED_FIELDS` / the key). Every one red.

| id | mutation | red tests |
| --- | --- | --- |
| R1 | `support` not read | support seam, resolve schema guard |
| R2 | `stakes` keyed | stakes/dice seam, legacy line/key |
| R3 | the pre-change key list | support seam, resolve schema guard, legacy line/key (outcome) |
| R4 | the pre-change line list, new key | support seam, resolve schema guard |
| R5 | `modifiers` read and keyed | stakes/dice seam, resolve schema guard |
| R6 | `outcome` dropped from the key only | resolve schema guard, legacy line/key (outcome) |
