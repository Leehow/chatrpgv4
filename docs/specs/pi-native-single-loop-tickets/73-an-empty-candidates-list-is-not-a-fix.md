Status: ready-for-human (landed 2026-09-26 on claude/sl71-20260926, commit a603b4922)
Stage: SL-73 (P3, kernel `unknown_entity` on a person; the fix text points at an empty list)
Spec: docs/kernel-rpc.md §11.5.6/§11.5.7 (name resolution, candidates), `kernel-ts/read/module-graph.ts:374` (`no ${what} named … in the module graph`, `fix: "pick a name from details.candidates or look first"`), §8 (an error's `fix` is executed literally: memory `error-fix-text-is-executed-literally`)

# SL-73 — `unknown_entity` on a person with `candidates: []` tells the Keeper to pick from nothing; the investigator's own name is refused as "no npc"

## Evidence (long gate #12 `longgate12-haunting-2016`, campaign telemetry + run events)
- t14 `apply npc name:"turn 10-11 已交付"`, t17 ×2 `apply npc name:"地下室木板"` (the basement boards, an object), t19 `apply npc name:"托马斯·海斯"` (the investigator himself): all four answered `unknown_entity … fix: pick a name from details.candidates or look first, candidates: []`. The Keeper did what the fix said: retried (t17 twice, 6.6 s + 9 ms), then looked, then narrated. Nothing told it *what* the name was (an object, the PC, not a person at all), so the same class repeats on the next table.
- t10 `apply map regions:["corbitt-house-ground"]` refused `no map region` with the level list as candidates: correct and self-explanatory; not in scope.

## Ruling (filed for the owner; the shape follows §8 and §11.5.7)
1. When the ranked candidates are empty, the error does not say "pick from details.candidates". It names what the query *is* when the kernel can tell: an investigator at the table (`details.is_investigator: true`, `fix` says the investigator's sheet is written with the investigator subject, not an npc effect); an object/clue/scene the graph knows (`details.matched_kind`, `fix` names the effect that takes that kind); else `fix` says the person is not in the graph or the roster and the effect must establish them (`from_passage`, §11.5.7) or `look npc` first. A `candidates` list is present only when it has members.
2. No hard-coded name/kind lists: the kind comes from the graph's own node kinds and the party's sheets.

## Scope
- `kernel-ts/read/module-graph.ts` resolve/candidates error shaping (a helper the person path and the npc effect path share), `kernel-ts/apply/entities.ts` `personOfEffect` refusal; contract §11.5.7 addendum with the three shapes; tests in `tests/extension/ts-kernel-name-phrase.test.mjs` / `passage-person.test.mjs`: the investigator's name → `is_investigator` and the sheet fix; an object's name → `matched_kind`; an unknown name with no similar person → no `candidates` key and the establish/look fix; a name with similar people → candidates as today (mutation: revert the helper, the old empty-list fix comes back).

## Comments

**Landed 2026-09-26**, branch `claude/sl71-20260926`, commit `a603b4922` (done last, after SL-71/SL-72,
since it touches the same `kernel-ts/read/module-graph.ts` candidates path, per the coordinator's brief).

**Contract:** docs/kernel-rpc.md §11.5.7 addendum 2 (a second addendum beside SL-70's, both under §11).

**Files:** `kernel-ts/read/module-graph.ts` (new `personRefusal`, exported, placed just before the
`ModuleGraph` class), `kernel-ts/apply/entities.ts` (`personOfEffect` made `async` for
`context.campaign.party()`; its two existing `throw error` sites now route through `personRefusal`).

**A wrinkle found in review, not anticipated by the ruling's text.** The natural implementation --
`graph.find(name)` (unrestricted kind) once the person-only search has failed -- silently returns `null`
even when the name is an exact match, for the ordinary case of a scene sharing its exact name with the
graph's own paired "beat" bookkeeping node (`resolve()` calls that ambiguous and throws; `find()` catches
every `RpcError`, ambiguity included, and returns `null`). Verified empirically against the real
`the-haunting` starter (every scene checked has a same-named beat) before writing the fix: switched to
`graph.candidates(name, undefined, 6)` (which ranks rather than resolves, so it is never ambiguous) with an
exact-normalized-name filter and a `"beat"` exclusion, justified the same way `graph.actor` already looks
past a scene to find an npc rather than as an open kind judgement.

**Empirical grounding.** The exact evidenced shape (`apply npc {name: <investigator's Chinese name>,
skill: {...}}` refusing `unknown_entity` with `candidates: []`) was reproduced against the real kernel
before writing the fix, and reproduced as fixed (`is_investigator: true`, no `candidates` key) after --
using a disposable local probe script, not committed. A bare `apply npc {name, to, why}` on the same three
evidenced names (no skill/archetype/condition field) was also checked and confirmed unaffected: it still
mints a table person exactly as before this ticket, since minting itself was never in scope, only the
refusal's shape when a pin, not a plain stage, is what asked for a person that could not be found.

**Tests, mutation-killed** (`tests/extension/npc-effect-refusal-shape.test.mjs`, real kernel via
`kernel-ts/testing/api.ts`, same pattern as SL-71's own suite rather than the ticket's suggested
`ts-kernel-name-phrase.test.mjs`/`passage-person.test.mjs`, whose existing fixtures serve a different,
heavier synthetic-graph-node style not needed here): investigator-name pin refuses with
`is_investigator: true` and no `candidates` key; a scene-name pin refuses with `matched_kind: "scene"`;
a name unknown to both graph and roster still refuses, with none of the three added/kept fields present
except the bare refusal itself; a name with real ranked similar candidates keeps today's `candidates` list
unchanged. Reverting `personOfEffect`'s two `throw personRefusal(...)` calls to bare `throw error` via a
scratch copy reproduces gate #12's exact `candidates: []` shape for the first three tests and is caught by
them; the fourth is unaffected, proving the ordinary-candidates path untouched.

**Full suites on leehow-pc** (branch head `a603b4922`): `test:ext` 3199/3199, `test:loop` 196/196,
`pytest` 1730 passed/2 skipped -- unmodified baseline plus this ticket's and SL-71/SL-72's new tests, no
regressions. (Three different single-test flakes surfaced across the session's several dozen remote runs
under box load -- `keeper-call-cap`, `single-loop-prescreen-budget`, `admission-line-level` -- each gone
on an immediate re-run of its own file alone, none touching a file any of these three tickets changed.)

Status: **ready-for-human**.
- Live (gate #13, 91ed5fee0): no `apply npc` on an unknown name this table, so the new shapes were not exercised live; unit tests cover the three.
