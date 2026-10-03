# Untold names: the Keeper still writes names the player was never told (handoff, 2026-10-03)

Status: ready-for-agent (option 1 in §5). Option 2 needs the owner to amend §166 first.

Owner, 2026-10-03: 「你写个交接文档，看是什么问题，你推荐怎么解决，我让别的ai处理这个」.

Rulings in force:
- **§103 (2026-09-17).** A name the player was not told is not on the player's card.
- **Owner, 2026-10-03, 「都按照你推荐的做就行」.** This approved the structural fix: until a name is said, the Keeper's information carries epithets and handles, and the book's name is set aside for the moment it is said.
- **§166 (owner, 2026-10-01).** Narration is delivered in one pass. A finished draft is not reviewed, refused or rewritten. Any fix has to act before the Keeper writes, not on what it wrote.

## 1. Where the code is

| | |
|---|---|
| Work branch | `claude/first-sight-20261002`, worktree `/Users/haoli/leehow/code/chatrpgv4-wt-speech-edit`, head `89244dfae` |
| Packaging branch | `claude/first-sight-pkg-20261002`, worktree `/Users/haoli/leehow/code/chatrpgv4-wt-pkg-a0f0a720e`, head `58761eda8`. It is on the old Pi base and gets every fix by `git cherry-pick -x`. The main checkout's dependencies are not to be swapped. |
| Installed App | `8feb98795` (packaging branch). It does **not** include `89244dfae` / `58761eda8` (speech-span fix, §3.4). |
| Mainline `0.9.6a` | `dec6deae3`. It moved 4 commits past `8a6808a93` (other sessions), so the work branch needs a merge, not a fast-forward. Not merged: the owner has not said to. |

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
| 13 (campaign `game-91d04b3a-fad7-4f7b-b516-492102e8eab6`) | `4b80f2cc7` | 1 | Prose names nobody; the say token is `{{say:拉塞尔·威廉姆斯}}`. The card shows that name on hover. |
| 13 | | 2 | 「拉塞尔拿起油枪……」 The name is in the narration. |
| 14 (campaign `game-99780158-2384-41ee-bce2-1a90bba93201`) | `8feb98795` | 1 | The Keeper first applied epithets to all three men (`apply person` → 高瘦的加油站老板 / 啤酒肚的退休卡车司机 / 短灰发的退伍老兵), then wrote prose and say tokens with them only. Clean. |
| 14 | | 2 | 「拉塞尔看了你一眼……棚下的内特把啤酒瓶放到膝盖上」 |

Campaign data: `~/Library/Application Support/Pipi/pipicoc/pi-coc/.coc/campaigns/<id>/turns/000N.json` (`rendered_text`, `speech`).

Session transcripts (`coc-capsule`, `coc-clerk` and tool results as persisted):
- Table 13: `…/pi-coc/agent/ui-sessions/play/%2FUsers%2Fhaoli%2Fleehow%2Fplaytests%2Fjev-gui-20260928/2026-10-03T01-21-36-628Z_2d677b8b-5a12-4e06-b83e-4806855ce41c.jsonl`
- Table 14: `…/2026-10-03T02-41-45-574Z_199252d1-1207-4035-b522-f5ad13151e23.jsonl`

## 3. What §103.5 built, and what it achieved

Contract: `docs/kernel-rpc.md` §103.5. In short:

1. **Who is untold.** `table.untold {campaign}` (read-only) returns `{people: [{name, id, shown}]}`. It covers every book NPC whose untold block (`untoldBlock`, `kernel-ts/read/capsule.ts`) is not null, campaign-wide; `untoldRoster` builds it. `shown` is the table's epithet, else the handle.
2. **The request is the boundary.** `extensions/table/context-runtime.ts` reads the roster with each snapshot. It passes every outgoing request through `renameUntold` (`extensions/kernel/untold-view.ts`), which acts on host messages (`role: custom`) and tool results. Matching is at Latin word boundaries, longest name first, and it keeps the one seat `"untold":{"name":"…"`. The hook's own capsule copy (`capsuleSent`, which *replaces* the persisted `coc-capsule` content on every request) goes through `untoldView`.
   - This was the reason the first attempt (`86aef486a`) never reached the Keeper.
   - The clerk's note, `carried` views, `first_sight`, the prescreen packet and tool results all carried book names before this.
3. **A say token shows what it says.** For an untold person with no table word, the speech row carries `shown` beside `name` when the two differ: the token text, or `""` for a handle (`kernel-ts/write/speech.ts`). The card's hover (`pipicoc/mechanics.js`) and the told check (`toldTurn`, `kernel-ts/journal/naming.ts`) read `shown`.
   - Before this, a token by handle resolved to the book name. The hover displayed it, and the kernel counted the name as told.
4. **`89244dfae`.** `runtime/jev/committed-speech-spans.ts` validated speakers as exactly `{npc, name}`, so a row with `shown` made the whole delivery's spans `unavailable` (memory evidence, referenced memory and fulfillment options lost that turn's attribution). It now accepts `shown` on NPC rows.

Box results on `4dd724094`:
- `test:ext`: all pass.
- loop: 0 failures.
- pytest: 2072 passed. The only 2 failures are the known `test_jev_resolve` baseline (`test_options_is_read_only…`, `test_the_first_blow_row…`).

Tests for this:
- `tests/extension/untold-request.test.mjs`: real kernel in process plus `installContextPolicy`. It asserts the *sent* messages.
- `tests/extension/untold-view.test.mjs`
- `Electron/packages/ui/src/coc-speech.test.tsx` (hover)
- `tests/extension/jev-committed-speech-spans.test.mjs`

Each mechanism was mutation-checked: removing it fails its test.

Achieved: table 14 turn 1 behaved exactly as intended. The Keeper sees handles, gives epithets, and uses them in prose and say tokens. Not achieved: turn 2.

## 4. Why it still leaks

The rename covers the book's **full display name** only.

1. **The book's prose uses short names and nicknames everywhere**, and those reach the Keeper unrenamed. Verbatim from table 14's persisted messages:
   - The Esso station scene description: 「……棚下拉斯、内特、史蒂夫抽烟喝啤酒并注视外来者。」 (in the capsule's `where`, the clerk's move row and carried scene view).
   - Russell's summary: 「阿巴托尔镇口埃索加油站的老板，当地人有时叫他“拉斯”。」
   - Nate's summary: 「……住在山脊路史蒂夫·布朗隔壁，大部分时间待在加油站假装帮拉斯修车。」
   - Russell's `would_lie_about`: 「……拉斯谎称订零件修车……」

   Turn 2's 「内特」 comes from these.
2. **The capsule's `untold.name` seat hands the Keeper the full name on purpose** ("used only once someone in the scene says it"). Turn 2's 「拉塞尔」 is its first half. The Keeper (luna, low thinking) does not hold to the instruction attached to it.

Deciding which strings are "a short name or nickname of this person" is an open semantic question. Owner rule: never answer it with a hardcoded list, regex or name-splitting heuristic. It goes to a model, or to the owner.

## 5. Recommendation

### Option 1 (recommended; compatible with §166): the Keeper never holds a name it may not write yet

**1a. Release a name only when someone is about to say it.**
- Take `untold.name` out of the Keeper's copy of the capsule (`untoldView`).
- Give the Keeper one explicit way to get it for the turn a character introduces themselves or is introduced. For example, `look focus=npc name=<handle or epithet>` with a flag such as `reveal_name: true`, answering `untold: {name: <book name>}`. `renameUntold` already keeps that seat.
- The tool text says when to use it: the person, or someone in the scene, says the name in this turn's dialogue.
- Nothing else changes about telling. `toldTurn` and the journal lane still decide from the delivered text and speech rows.
- Contract: a new subsection under §103 (next free number after 103.5; numbers are stable, never reuse one).

**1b. Make the book's other names for a person data, produced by a model.**
- Add per-person name variants (short given names, nicknames, the forms the book itself uses for them) to the person's graph record. Two producers:
  - (i) The module reader, when it builds person records, for books read from now on.
  - (ii) A one-off backfill lane over the person records and their passages, for books already read, so Blood Road does not need a full re-read.
- The variants must be personal names only, never a role or common noun (老板, 店员, 警长). Put that in the lane's instruction. If a check is needed, it is a model or Jev question. Do not add a stop-word list, a minimum length or a splitting rule (owner rule).
- `untoldRoster` then returns one row per variant with the same `shown`. `renameUntold` already handles many rows (longest first, Latin boundaries).
- The told check can read the same variants (`nameWords` in `kernel-ts/journal/naming.ts`), so a character saying 「叫我拉斯」 tells it.

1a closes the seat (turn 2's 「拉塞尔」); 1b closes the book prose (turn 2's 「内特」). Neither touches a finished draft, so §166 holds.

### Option 2 (only if the owner amends §166): check the draft before delivery

- One Jev batch per delivery: a Noul per present untold person. Ask whether the narrator's own voice (not a character's spoken line) calls this person by a personal name rather than a description or the table's epithet. On "yes", refuse once with a fix naming the epithet to use, then deliver.
- The pattern exists, retired, in `extensions/kernel/index.ts` (the forced-player-choice cue gate around line 2600; `runtime/jev/forced-resolution.ts`). Cost: about 0.3 s a delivery, plus one rewrite only when it fires.
- §166.1 forbids exactly this ("No automatic … verifier … is started for a delivery"), so it cannot be built without the owner's amendment.

### Option 3: stop here

§103.5 stays. Turn 1 behaviour is good; leaks continue whenever the book's prose uses a short name.

## 6. Acceptance (write the outcomes down before playing)

- **Tests.** Extend `tests/extension/untold-request.test.mjs` (real kernel and installed hooks, assert the sent messages):
  - a person with name variants: every variant renamed in host messages and tool results;
  - the capsule has no `untold.name`;
  - the reveal read returns it and the rename keeps it;
  - a delivery whose dialogue says a variant tells the person.

  Each new mechanism needs a mutation that fails its test.
- **Suites** on the LAN test box (amax first, leehow-pc second; `~/.claude/skills/leehow-pc-tests/scripts/remote-test.sh probe`, then `run <worktree> ext|loop|py`; one suite at a time on one box). Known baselines:
  - pytest: the 2 `test_jev_resolve` failures above.
  - pi-backend vitest: `test/pack-host.test.ts` and `test/session-title.test.ts` fail at HEAD.
- **Live table.**
  - Build the packaging branch, package, and play a new Blood Road campaign in the installed App as a first-time player, one sentence a turn.
  - Keeper `flapcode/gpt-6-luna` low. Check the model chip before creating the session and the session's `model_change` rows after.
  - At least six turns at the gas station: talk to each of the three men; around turn 4 or later have the player ask one his name.
  - Pass: no untold person is named in narration on any turn before a character says the name in dialogue; say-token hovers show epithets; after the introduction the name may appear.
  - Record first-visible time per turn.
  - Stop at the first visible failure whose cause is found, and report.

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
