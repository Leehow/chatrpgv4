# Untold names: the Keeper still writes names the player was never told (handoff, 2026-10-03)

Status: done. §5 implemented as contract §103.6 (owner, 2026-10-03: 「那你直接把日志同步这一步修了吧」), commit `0c3242da5`. Live acceptance (§6) passed on table 15 (installed App `cae9cbeb0`, campaign `game-e8e9249b`):
- Turns 1–4 at the gas station: no name in the prose and no `named_at`. Table 13 and table 14 both failed at turn 2.
- Turn 5: the owner introduced himself in dialogue (「拉斯。拉塞尔也行，镇上都叫我拉斯。」). The lane gave `named: true` with exactly those words as `named_quote`, and only he got `named_at: 5`.
- Turn 6: the prose used his name and still called the other two by epithet.

Still open, separate: the journal lane attaches labels and descriptions to the wrong person when the turn has no attributed speech. Its packet gives book names and aliases, not what the prose calls each person.

Owner, 2026-10-03: 「你写个交接文档，看是什么问题，你推荐怎么解决，我让别的ai处理这个」.

Rulings in force:
- **§103 (2026-09-17).** A name the player was not told is not on the player's card.
- **Owner, 2026-10-03, 「都按照你推荐的做就行」.** This approved the structural fix: until a name is said, the Keeper's information carries epithets and handles, and the book's name is set aside for the moment it is said.
- **§166 (owner, 2026-10-01).** Narration is delivered in one pass. A finished draft is not reviewed, refused or rewritten. Any fix has to act before the Keeper writes, not on what it wrote.

## 1. Where the code is

| | |
|---|---|
| Work branch | `claude/first-sight-20261002`, worktree `/Users/haoli/leehow/code/chatrpgv4-wt-speech-edit` (merged into `0.9.6a`) |
| Packaging branch | `claude/first-sight-pkg-20261002`, worktree `/Users/haoli/leehow/code/chatrpgv4-wt-pkg-a0f0a720e`, head `58761eda8`. It is on the old Pi base and gets every fix by `git cherry-pick -x`. The main checkout's dependencies are not to be swapped. |
| Installed App | `8feb98795` (packaging branch). It does **not** include `89244dfae` / `58761eda8` (speech-span fix, §4.4). |
| Mainline `0.9.6a` | Everything below is merged into `0.9.6a` (owner, 2026-10-03: 「合并回0.9.6a去」), together with the four commits other sessions had added (`39c9bc7a7`..`dec6deae3`). **Start from `0.9.6a`.** The packaging branch still needs each new fix cherry-picked before packaging. |

The work branch's commits from this effort, oldest first:
- `86aef486a` first attempt. Its section is mis-numbered §103.1 and was renumbered to §103.5 in the next commit.
- `4dd724094` the §103.5 fix.
- `89244dfae` the speech-span fix.

The same branch also carries:
- `db15a16b1` / `3574789f1` opening clock pin, §23/§86, verified live.
- `534cb1983` new session never starts on the model placeholder, verified live.
- `7894cf1e5` foreground retry 8 on 429.
- `5ef29661d` `Agents.md` ban on gpt-6-astra.

## 2. The defect, with evidence

Installed App, Blood Road (`book-4`), Keeper `flapcode/gpt-6-luna` thinking `low`, each table a new campaign played as a first-time player, one sentence a turn. Log: `.coc/playtests/speech-replay-20260930/newplayer-20261002/turns.md` in `/Users/haoli/leehow/code/chatrpgv4-wt-pi-coc-v2` (gitignored).

| table | App | turn | what the player read |
|---|---|---|---|
| 13 (campaign `game-91d04b3a-fad7-4f7b-b516-492102e8eab6`) | `4b80f2cc7` | 1 | Prose names nobody; the say token is `{{say:拉塞尔·威廉姆斯}}` and the card shows that name on hover |
| 13 | | 2 | 「拉塞尔拿起油枪……」 -- the name in the narration |
| 14 (campaign `game-99780158-2384-41ee-bce2-1a90bba93201`) | `8feb98795` | 1 | The Keeper first applied epithets to all three men (`apply person` -> 高瘦的加油站老板 / 啤酒肚的退休卡车司机 / 短灰发的退伍老兵), then wrote prose and say tokens with them only. Clean. |
| 14 | | 2 | 「拉塞尔看了你一眼……棚下的内特把啤酒瓶放到膝盖上」 |

Campaign data: `~/Library/Application Support/Pipi/pipicoc/pi-coc/.coc/campaigns/<id>/` -- `turns/000N.json` (`rendered_text`, `speech`), `npc-journal.json`, `npc-journal/jobs/journal:<id>:tN.json` (the journal lane's packet and what it submitted). Session transcripts (persisted `coc-capsule`, `coc-clerk`, tool results): `…/pi-coc/agent/ui-sessions/play/%2FUsers%2Fhaoli%2Fleehow%2Fplaytests%2Fjev-gui-20260928/2026-10-03T01-21-36-628Z_2d677b8b-5a12-4e06-b83e-4806855ce41c.jsonl` (table 13) and `…/2026-10-03T02-41-45-574Z_199252d1-1207-4035-b522-f5ad13151e23.jsonl` (table 14).

## 3. The root causes

The name reaches the Keeper the moment the system believes the player has been told it: the person's capsule row then loses
`untold` and carries the book's name, and the §103.5 rename skips them. Both tables crossed that line on turn 1 without the
player being told anything:

1. **Table 13 -- a say token.** `{{say:拉塞尔·威廉姆斯}}` resolved to the book's name, which the card shows on hover, so the
   kernel's floor (`toldTurn`, `kernel-ts/journal/naming.ts`) counted it as told (`told: {npc-book-4-lars-williams: 1}` in the
   turn-1 journal job). Fixed by §103.5 (`shown`, §4 below).
2. **Table 14 -- the journal lane's `named: true`, wrong for all three.** The turn-1 journal job's packet lists all three under
   `unnamed`; the prose and both spoken lines name nobody. The lane (`opencode-go/deepseek-v4.1-flash`) submitted, for each of
   the three, a `label` **and** `named: true` (verbatim in `npc-journal/jobs/journal:game-99780158-…:t1.json`: e.g. `{"person":
   "person:1", "description": "看起来快七十岁的男人……", "exchange": "他始终没说话……", "label": "棚下手臂有海军纹身的老头",
   "named": true}` -- the veteran never spoke). `journal.submit` (`kernel-ts/journal/jobs.ts`) accepts `named: true` with no
   evidence and does not refuse it beside a `label`, although its own instruction says "give named: true instead of a label".
   `npc-journal.json` got `named_at: 1` for all three, and turn 2's capsule gave the Keeper 拉塞尔·威廉姆斯 and 内特·帕特森
   as plain names.

So the right sidebar's record -- description and label shown, real name in the data, `named_at` -- is already the source the
Keeper's view is projected from (§103.3). It was polluted by an unverified model claim.

Secondary, not observed to cause a leak: the book's prose uses short names (the Esso scene: 「棚下拉斯、内特、史蒂夫抽烟喝啤酒」;
Russell's summary: 「当地人有时叫他“拉斯”」), which the §103.5 rename (full display names only) leaves alone, and the capsule's
`untold.name` seat hands the Keeper the full name for the moment it is said. On table 14 turn 1, with all three correctly
untold, the Keeper saw both and still wrote epithets only. Watch for it on the acceptance table (§6); do not build for it first.

## 4. What §103.5 built (in place, keep it)

Contract: `docs/kernel-rpc.md` §103.5. In short:

1. `table.untold {campaign}` (read-only) -> `{people: [{name, id, shown}]}`: every book NPC whose `untoldBlock`
   (`kernel-ts/read/capsule.ts`) is not null, campaign-wide (`untoldRoster`); `shown` = the table's epithet, else the handle.
2. `extensions/table/context-runtime.ts` reads the roster with each snapshot and passes every outgoing request through
   `renameUntold` (`extensions/kernel/untold-view.ts`): host messages (`role: custom`) and tool results, at Latin word
   boundaries, longest name first, keeping the one seat `"untold":{"name":"…"`. The hook's own capsule copy (`capsuleSent`,
   which *replaces* the persisted `coc-capsule` content on every request -- why the first attempt `86aef486a` never reached the
   Keeper) goes through `untoldView`. The clerk's note, `carried` views, `first_sight`, the prescreen packet and tool results
   all carried book names before this.
3. A say token for an untold person with no table word records `shown` beside `name` when the two differ (the token text, or
   `""` for a handle) (`kernel-ts/write/speech.ts`); the card's hover (`pipicoc/mechanics.js`) and `toldTurn` read `shown`.
4. `89244dfae`: `runtime/jev/committed-speech-spans.ts` validated speakers as exactly `{npc, name}`, so a row with `shown`
   made the delivery's spans `unavailable`; it now accepts `shown` on NPC rows.

Box on `4dd724094`: `test:ext` all pass, loop 0 failed, pytest 2072 passed with only the known `test_jev_resolve` baseline (2).
Tests: `tests/extension/untold-request.test.mjs` (real kernel in process + `installContextPolicy`, asserts the *sent*
messages), `tests/extension/untold-view.test.mjs`, `Electron/packages/ui/src/coc-speech.test.tsx`,
`tests/extension/jev-committed-speech-spans.test.mjs`; each mechanism mutation-checked.

## 5. Recommended fix (owner direction, 2026-10-03)

Owner: 「我看你提的建议还是后验，又打回，到时候又出之前出过的傻逼bug，每次咱们出文之后不是都会记录npc信息到右侧栏么，
应该有角色描述和不在ui上显示只在数据里的真实姓名，可以从那里取，如果真实姓名在剧情里被人说出来就同步，直接在生成前告诉kp，
不要后验！」

The design, which §103 already has the shape of:
- **One source: the person's journal record**, what the right sidebar shows (`npc-journal.json` via `table.view`
  `npcs.journal`): the description and label the player knows (shown), the real name (data only), `named_at`.
- **Before every generation, the Keeper is told exactly that**: an unnamed person by label and description, never the real
  name (§103.5 renames it everywhere the host writes); a named person by name. Nothing reads or judges the Keeper's finished
  draft; nothing is refused or rewritten after it is written (§166 stands, and the owner has ruled out any after-the-fact check).
- **Sync when the name is said in the story** -- and only then. This is the step that failed, so it must be grounded:

1. **`named: true` must carry its evidence.** Add `named_quote` to a journal entry: the exact words of this turn's delivery
   (its prose or one of its spoken lines) in which the player was given the name. `journal.submit` accepts `named: true` only
   with a `named_quote` that occurs in the turn record's `rendered_text` or a `speech[].text` (compare after the §139
   quotation-mark normalization the verifier lanes already use; an exact substring otherwise -- this checks that the cited
   words exist, it does not judge what they mean). Refused otherwise, with a fix that says to leave `named` out unless the words
   can be quoted. Failing closed keeps the person unnamed, which is the safe side. Turn-1 of table 14 would have been refused
   three times: there are no such words.
2. **`named: true` beside a `label` is a contradiction** (the lane's own instruction: "named: true instead of a label").
   Refuse it, with the fix "one or the other".
3. **The lane's instruction** (`instruction()` in `kernel-ts/journal/jobs.ts`): `named: true` with `named_quote` only when
   someone in this turn's delivery said or showed the name; a person who did not speak and was only described is never named.
4. **Contract**: a new subsection under §103 (next free number after 103.5; section numbers are stable, never reuse one),
   amending §103.2's writer rules.
5. **Tests**, on the real path: `journal.submit` against the in-process kernel -- table 14's turn-1 submission verbatim is
   refused for all three; a quote present in a spoken line (「叫我拉斯就行」) is accepted and sets `named_at`; a quote not in
   the record is refused; `label` + `named` is refused. Then a capsule read after a refused submission still carries `untold`
   for the person. Each new check needs a mutation that fails its test.

Optional, only if the acceptance table shows the secondary sources leaking: give the person's record the other names the book
uses for them (short names, nicknames), produced by a model (the journal lane or the module reader) -- never a hardcoded list,
regex or name-splitting rule -- and have `untoldRoster` rename those too; and drop the capsule's `untold.name` seat in favour of
a read the Keeper makes when a character is about to say the name.

Rejected: any check of the Keeper's draft before or after delivery that refuses or rewrites it (the owner, above; §166).

## 6. Acceptance (write the outcomes down before playing)

- Tests above, plus the existing `tests/extension/untold-request.test.mjs`; suites on the LAN test box (amax first, leehow-pc
  second; `~/.claude/skills/leehow-pc-tests/scripts/remote-test.sh probe`, then `run <worktree> ext|loop|py`; one suite at a
  time on one box). Known baselines: pytest's 2 `test_jev_resolve` failures; pi-backend vitest `test/pack-host.test.ts` and
  `test/session-title.test.ts` fail at HEAD.
- Live: build the packaging branch, package, and play a **new** Blood Road campaign in the installed App as a first-time player,
  one sentence a turn, Keeper `flapcode/gpt-6-luna` low (check the model chip before creating the session and the session's
  `model_change` rows after). At least six turns at the gas station: talk to each of the three men; around turn 4 or later the
  player asks one his name. Pass: after every turn, `npc-journal.json` has no `named_at` for a person whose name was not said
  or shown in a delivery, and the narration never names an untold person; after the introduction, that one person's name may
  appear. Record first-visible time per turn. Stop at the first visible failure whose cause is found, and report.

## 7. Side findings, not part of this ticket

- 「岩盐弹」: the Keeper writes what the investigator cannot see (the shotgun's rock-salt load) on first sight, every table.
- Giving out epithets costs one extra `apply` on the first meeting (table 14 turn 1: 67 s first-visible versus 48 s without).
- Right after the App restarts, the new-session page shows raw UI keys (`title.start`, `source.starter.title`) for a few seconds.
- `<agentHome>/models.json` starts with `//` comments written by `applyProviderModelCorrections` (`runtime/host.ts`). `pi-backend` reads it with `JSON.parse` in four places, sees zero configured models, and the compat-provider add throws. A separate task was filed.
- Handles in prose have not been seen yet. If they appear, a deterministic exact-match check on known handles is allowed (it is not semantic).

## 8. Rules that bind whoever picks this up

- Read `Agents.md` in full first; `kernel-ts/` is the only production kernel.
- No fake-Keeper shortcut scripts (`kp_settle_turn`, batch settles, scripted turns). Live acceptance means the installed App with its own Keeper and a player one sentence at a time. If a different test method seems better, ask the owner first.
- Never run anything on `gpt-6-astra`, and never switch models without the owner saying so in the current turn.
- Heavy suites on the LAN box, not the Mac.
- One packaging location only: `~/leehow/code/pipicoc-build/PipiCOC.app`, staging destroyed before exit.
- Contract section numbers are stable identifiers: add new ones, never renumber or reuse.
- No hardcoded lists, regexes or mappings for open semantic questions; use a model or ask.
- Talk to the owner in Chinese.
