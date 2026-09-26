Status: ready (filed 2026-09-26, owner's decision after long gate #11; batch 12)
Stage: SL-71 (P2, kernel resolve; a legal path for what the Keeper keeps asking for)
Spec: docs/kernel-rpc.md §11.5 (a combat defence already names an NPC as `actor`), §11.5.2/§11.5.3 (NPC standing defence / action), `kernel-ts/read/handlers.ts:98` (`no investigator … at the table`), §16.2 (public mechanics names: `actor_is_investigator`)

# SL-71 — An NPC the table knows can be the actor of an ordinary `resolve`: the NPC's own roll

## Evidence (long gate #11 `longgate11-haunting-1515`, ticket 02's entry)
- Five `resolve` calls with an NPC as `actor` ("no investigator 'Steven Knott' at the table", also Gabriela, Mr. Dooley) were refused `unknown_entity`; the Keeper repeated each to the class limit and the refusal budget cut two runs. Call of Cthulhu has NPC rolls (an NPC's own Spot Hidden, Psychology, opposed checks); today the only NPC actor the kernel accepts is a combat defender (§11.5), so the Keeper has no legal path for the rest and can only narrate the outcome unrolled.

## Ruling (owner, 2026-09-26)
A `resolve` whose `actor` is a person the table knows (an authored NPC of the module, an established table person, a `from_passage` person) is the NPC's own roll: the kernel rolls it against the NPC's authored skill where the graph has one, else the standing defaults the NPC profile already carries (§11.5.2's shape), settles it as a roll receipt with `actor_is_investigator: false` (Keeper-side by §16.2: no name and no number reaches the player unless the existing public-combat rule says so), and never touches the investigator's sheet. An actor the table does not know is still `unknown_entity` with the candidates (investigators and known people). Opposed checks stay as they are (the investigator's resolve with a `target`).

## Scope
1. Contract: §11.5 addendum (the NPC's own roll; skill source order; receipt flags; visibility) and the `resolve` action row; `kernel-ts/read/handlers.ts` actor resolution accepts known people; `kernel-ts/resolve/*` rolls with the NPC's values; admission grounds unchanged (the compile does not select NPC rolls; they are the Keeper's).
2. Tests, mutation-killable: an NPC actor with an authored skill rolls it and the receipt carries `actor_is_investigator: false` and no public name; an NPC without the skill uses the profile default; an unknown actor still refuses with candidates; the investigator's sheet is untouched; the gate #11 t0/t6/t19 shapes replayed (recorded Keeper) land instead of refusing.

## Comments
