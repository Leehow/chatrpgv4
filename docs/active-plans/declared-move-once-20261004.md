# Environment acceptance turn 2/4 state findings (§135.30.10): handoff

Status: ready for the coordinator's review, on branch `claude/declared-move-once-20261004` based on `1e5d64e52` (the 0.9.6a
head accepted at 19:01 UTC). Not merged, not packaged, not pushed.

**Coordinator decisions (2026-10-04):**
- The clerk selects one destination per declaration; the Keeper's own `apply` carries a compound second place.
- NPC movement and owed moves are not part of the clerk's record.
- Knott stays a model error on the 1.4.6 lock, with no special case. The 1.5.0 cue removal is to be verified in the final
  package.
- Time takes option a: the `momentary` row, along the existing closed band choice.

What was not done or touched:
- no paid model call;
- the old live table and the narration-owner candidate were left alone;
- no schema change.

## The table

- Evidence: `/Users/haoli/leehow/code/chatrpgv4-wt-pi-coc-v2/.coc/evaluations/environment-after-mod-refactor-20261004/`.
- Campaign `environment-v225-baseline-20261004` (haunting), source `7b83acc22`, natural-npc 1.4.6.
- Keeper flapcode/gpt-6-luna, thinking low. Driver run `.coc/playtests/environment-v225-baseline-live-20261004`.

## Attribution

| # | what the record shows | who proposed / who wrote | class |
| --- | --- | --- | --- |
| 1 | Turn 2: `move:corbitt-house-ground-t2-c2` and `move:neighborhood-gossip-t2-c3`, 30 min each, for one declared place | Both were proposed by Jev and written by the clerk (`declared_bookkeeping`). The first came from the route (s7, need `now` 0.84). The second came from the compile at the house (s10): `destination` neighbourhood 0.92, cleared. | **Clerk policy defect** (scene selection), not the model or the kernel. The same code is on `1e5d64e52`, and it reproduces there (below). |
| 1b | Turn 3: `move:corbitt-house-ground-t3-c1` (30 min) | The compile at the neighbourhood read the house at 0.64, and the clerk moved back. | **A consequence of 1.** It is gone with the fix. |
| 2 | Turn 2: `npc:steven-knott-t2-c4`, Knott `to: here` (the neighbourhood), and no narration of him | **The Keeper's own `apply`** | **Model error**, not a kernel bug |
| 3 | Turn 4: "我在街边安静停留半分钟…" charged 3 minutes (`time:t4-c1`) | Jev chose the band `quick_observation` (0.99), and the kernel rolled 3 inside `[0, 5]` | **Time-granularity contract gap**, not a bug |

## 1. The double move, and the fix (`a9936a4fa`, narrowed in `b1b7bd99d`)

**Facts.** The turn-2 sentence was "我接下委托，收好诺特给我的钥匙和地址，先去那栋住宅，站在街边查看外观。"
1. The compiles at the office left `destination` split: s3 had the house 0.52 against the neighbourhood 0.46; s6 had 0.37
   against 0.62.
2. The route moved the party to the house.
3. The read there issued a new exit, so §135.30.1 owed a compile.
4. That compile asked "where does the declaration go" from the house, where the house is no row, and "站在街边" took the
   neighbourhood at 0.92.
5. The compile at the neighbourhood (s13) read the house back at 0.84, cleared. Only the house's move key, already consumed,
   kept a third move from landing.

**Contract before.** §135.30.8 says a declaration's act is settled once. Nothing said its destination is.

**The fix: contract §135.30.10, "one declaration, one destination".** It changes `runtime/jev/{step-policy,route-compile,hybrid-engine}.ts`.

The scope is the declaration's one selected move:
- the declared party move (family `move`) that a compile, the route or a staged unlock selected;
- once the clerk executes it, it is kept in `RunView.moved`, whether the kernel took it or refused it.

Once that move stands:
- the `move` predicate decides every move without firing;
- the route selects no move (`moveGated`), and the row records `move_gated`;
- no guarded destination is reported or staged.

The compile is still owed. The new scene's clues, checks and obligations reach their predicates as before. The fix reads no
player words and no scene names.

**Not counted, and not gated:**
- **A person's own movement.** An `npc` effect or an `npc_act` step moves a person, not the party. `family: "move"` is minted
  only from `table.apply.options` party move rows (`runtime/jev/candidates.ts:406`).
- **Owed moves** (family `owed`, §158.4). These still run after the move.
- **The Keeper's own `apply move`.** That includes a rename (a `move` to where the party stands) and a relocation the Keeper
  rules. After such a move the declaration's own move is still the clerk's; a test covers this.
- **Another investigator's declaration.** A run is one input. A `move` moves the whole party (the kernel has no party subset),
  and the next input's run starts with nothing kept.
- **Chases and fights** (families `chase`, `combat`).

**Trade-off for you to decide.** A declaration that names two places in turn ("先去图书馆，再去警局") gets one clerk move, and
the Keeper carries the second.
- *Alternative, not built:* make the current place a `destination` row at a later compile, so Jev can answer "here".
- *Why it was not built:* it relies on Jev reading the vantage shift correctly, which is what s10 got wrong.

**Residual, not observed.** A Keeper's own move followed by a later clerk compile in the same run could still produce a second
move. It was left out to keep the scope to the one selected move.

## 2. Knott `to: here`

**Facts:**
- The Keeper's call was `{"kind":"npc","name":"Steven Knott","to":"here","owed":"steven-knott"}`.
- Before that call, the clerk's `coc-clerk` note listed all three clerk steps in `clerk_did`, and the scene's `present` held
  Mr. Dooley only.
- The Keeper's own prose has the investigator leave Knott's office.
- In the turn-2 capsule, `owed: []` and `unrecorded: []`. The only occurrence of `steven-knott` anywhere in the capsule is
  natural-npc 1.4.6's `pending_contacts` row: Knott's first-impression contact, `handle: "steven-knott"`.
- The kernel took the call as an ordinary staging. It left the `owed` out and said so: `owed_unknown`, "the unrecorded section's
  lines are not owed rows".

**Contract:**
- Staging a person is the Keeper's authority.
- `owed` must name an owed row, and the kernel enforced that.
- No rule was broken by the kernel.

**Assessment.** This is a model error. The likely cue is the pending-contact handle; that is not proven without a model call. On
`1e5d64e52`, natural-npc 1.5.0 (§178) rolls the meeting and keeps presence pairs out of `pending_contacts`, so a new campaign
loses this cue. A campaign locked to ≤1.4.6 keeps it.

**Options:**
- (a) No change. Recommended.
- (b) After review, add "nor a `pending_contacts` handle" to the `owed_unknown` note. This is model-specific note wording, so
  it is not proposed now.

## 3. Turn-4 time granularity: option a, built (contract §138.10.1)

**Facts.**
- Jev chose `quick_observation` with confidence 0.99.
- The kernel rolled 3 inside `[0, 5]` (default 1), and the receipt has `basis: banded`.
- `speak_briefly` is `[0, 3]`.

**Contract:**
- Clock minutes are integers, so seconds would need a schema change, which is not proposed.
- §138.10 has the clerk land the declared action's band before the Keeper, and time is charged once a turn, so the Keeper
  cannot correct it afterwards.
- No path takes a duration the player stated.

**Options:**

| option | change | covers | cost |
| --- | --- | --- | --- |
| a (narrowest) | One data row in `content/rulesets/coc7/rules-json/time-costs.json`, e.g. `momentary` `{min 0, default 0, max 1}`, offered to Jev's existing band choice | "听半分钟", "看一眼": rolls 0–1 | No code or schema. The kernel reads `rules-json` from `content/` at runtime (`context.content`), not from the campaign, so existing campaigns get it with the app. Jev picks by row name only. |
| b | A closed Jev question in the time bind asking whether the player stated a duration, as a rung of a fixed ladder mapped to minutes, used instead of the roll | any stated duration | A new question and a §138.10 amendment. Wider. |
| c | No change | — | A momentary act can still cost up to 5 minutes. |

**Built (option a).** `time-costs.categories` gains `momentary` `{min 0, default 0, max 1}` as its first row.
- It reaches Jev through the existing declared-time band choice (`rules.bands` → the candidate's closed options). There is no
  new question, no keyword and no inferred seconds.
- **Integer approximation:** the kernel rolls 0 or 1 whole minute. "半分钟" is never 30 seconds.
- The route's fact question is unchanged; its `none` already covers a glance that costs no clock time.
- Not touched:
  - `director-graph.json`'s unread `time-cost-category` nodes (no `momentary` node; §13.10, digest-guarded);
  - `rule-index.json`'s unread `category_count`.

Tests:
- `tests/extension/time-band-momentary.test.mjs`. On the emitted kernel, `rules.bands` lists the row, and a banded time rolls
  0 or 1, both across eight seeds. Through the hybrid engine over the haunting, the band question offers `momentary` beside the
  other rows, and naming it charges one receipt of 0 or 1 minute.
- `band-shadow.test.mjs`'s pinned shipped rows were updated.
- Three data mutations (row dropped, `max` 5, `default` 1) each turn a case red.

## Reproduction and verification (no model call)

**The original failure, deterministically.** `tests/extension/single-loop-one-destination.test.mjs`, "on the emitted kernel".
- Setup: the haunting, through the hybrid engine, on the emitted kernel built at `1e5d64e52`. That kernel was built on the box
  by `build-fetch`; the change touches no kernel code. A stub Jev carries the live turn's answers.
- With the three runtime files swapped back to `1e5d64e52` by copy, the run lands:
  1. `t2-c1`, the accept;
  2. `t2-c2`, the house;
  3. `t2-c3`, the neighbourhood;
  4. then it reads the house back at 0.86, cleared, with nothing selected.
  This is the live s3–s13 sequence.
- On the fix there is one move, `commission-briefing → corbitt-house-ground`.

**Other cases:**
- At the policy seam, five cases, each with a no-move control.
- A route-only engine case, with the compile off.
- 14 one-line mutations, each made by copy and restored by copy, all turn a case red.

**Related files, run one file at a time on the Mac:**

| file | result |
| --- | --- |
| single-loop-compile | 17/17 |
| one-check | 6/6 |
| guard-unlock | 7/7 |
| ask-fanout | 18/18 |
| destination-rows | 6/6 |
| candidates | 18/18 |

**Box suites.** Both ran on leehow-pc WSL, on source `a9936a4fa`, against the emitted kernel built on the box from that tree.
They cover only `a9936a4fa`.

| suite | result | wall | task | log |
| --- | --- | --- | --- | --- |
| loop | 306/306, exit 0 | 243 s | `bh3v20srm` | `/home/box/chatrpgv4-testbox/wt/chatrpgv4-wt-declared-move/remote-loop.log` |
| ext | 4560/4560, exit 0 | 649 s | `brvem6xuq` | `/home/box/chatrpgv4-testbox/wt/chatrpgv4-wt-declared-move/remote-ext.log` |

**Not covered by any full suite:**
- the narrowing (`b1b7bd99d`);
- the `momentary` row (the commit after it).

By the coordinator's rule, no further full suite was started. Those two were verified by their own files and the related single
files.

Narrowing:
- `single-loop-one-destination` 7/7;
- compile 17, one-check 6, guard-unlock 7, ask-fanout 18, destination-rows 6, candidates 18;
- 14/14 mutations killed.

Momentary:
- `time-band-momentary` 2/2;
- band-shadow 7, single-loop-band-clerk 6, jev-band-shadow-domain 9, owed-state 12, travel-fill 8,
  admission-effect-signature 9;
- pytest, single files on the Mac (`uv run --frozen`): `test_rules_bands.py` 6, `test_band_operations.py` 12,
  `test_route_travel.py` 11;
- 3/3 data mutations killed.
