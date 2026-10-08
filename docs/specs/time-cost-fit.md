# A time cost fits the act

Status: ready-for-human (implemented on `claude/time-cost-20261008`; contract `docs/kernel-rpc.md` §202. Open: a live Jev
probe of the new question over run 3's lines, see "Not verified here", and the owner's merge.)

Finding R10 of TR-F2 real table run 3 (2026-10-08, App `4ce2e4cab`, The Haunting, Thomas Hayes, campaign
`game-af36b938-4ca6-421e-bdec-759080123f69`, Keeper `openai-codex/gpt-6-luna` low): turn 16 charged 245 minutes for walking
down a hallway to a door.

## Evidence

Read from the campaign's `turns/*.json` receipts and the `lane: "run", event: "bind"` rows of its `telemetry.jsonl`.

Every time receipt of the campaign was written by the clerk (`clerk: declared_time`, §138.10): the route fact said the
declaration `costs` table time, Jev answered the band question in three views (§163.10), the pooled leader bound at any
confidence, and the kernel rolled a whole minute uniformly inside the row (`basis: banded`, `band_roll`). None was the
Keeper's own number and none was the compile's. "Conf" is the pooled leader's derived confidence; after it the runner-up.
The judgement is a reading of the player's line against the row's act.

| T | player's line | band (conf; runner-up) | range | min | judgement |
| --- | --- | --- | --- | --- | --- |
| 1 | 我先去波士顿环球报的档案室，查这栋房子以前的旧报道。 | library_research (.99) | 60-480 | 93 | fits the declared act; the move was refused and the fiction stayed at Knott's office (residual) |
| 2 | 对，我现在就动身去环球报社，到那里的剪报档案室翻旧报道。 | library_research (.82; single_room .11) | 60-480 | 369 | the row fits the declared research, but the fiction stopped at the doorman: 6 h charged for an act not reached (residual) |
| 3 | 我递上名片：…我想查查跟那栋房子有关的旧报道。 | speak_briefly (.74) | 0-3 | 2 | fits |
| 4 | 我压低声音对门卫说：…半小时就走。 | speak_briefly (.71) | 0-3 | 3 | fits (the quoted half hour is a promise, not time chosen now) |
| 5 | 我…走到那位整理文件的女职员桌边，客气地问：… | speak_briefly (.85) | 0-3 | 3 | fits |
| 6 | 我离开报社，去波士顿中央图书馆，在那里的旧报纸缩微档里查科比特家老房子的报道。 | library_research (.94) | 60-480 | 416 | right row; long (7 h) but inside "several hours" |
| 7 | 我接着往后翻，找后来住进这栋房子的人家有没有出过事的报道… | library_research (.99) | 60-480 | 68 | fits |
| 8 | 我把马卡里奥一家和罗克斯伯里记在本子上。然后去市政档案馆，查这栋房子的产权记录… | library_research (.67; single_room .11) | 60-480 | 222 | **out of proportion** (the closest call of the five): one house's property record by its address; the road's time rides on the move |
| 9 | 我请档案职员帮我调出科比特家那栋房子的产权登记… | library_research (.86) | 60-480 | 401 | **out of proportion**: a clerk fetches one register |
| 10 | "我就是请您帮我调卷。"…麻烦把…产权登记和…遗嘱记录拿给我看。 | library_research (.61; speak_briefly .20) | 60-480 | 205 | **out of proportion**: two known records brought to hand |
| 11 | 谢过职员，我去那座已经关闭的沉思礼拜堂看看，找找迈克尔·托马斯牧师留下的东西。 | single_room_search (.46; careful_house .29) | 10-45 | 10 | fits (the road's 30 minutes rode on the move) |
| 12 | 我忍着额头的刺痛，在废墟里仔细翻找，看有没有通往地下室的入口，或者牧师留下的文件、书信。 | careful_house_search (.45; single_room .48 against .49) | 60-360 | 234 | borderline: a careful search of a burned chapel is the row's act |
| 13 | 那我就去翻那个柜子和周围的残物，里面有什么书和纸都拿出来看。 | single_room_search (.84) | 10-45 | 23 | fits |
| 14 | 我把日记和那本拉丁文书包好带走，直接去科比特家的老房子，先在外面绕一圈看看情况。 | unsettled (`unknown` led; single_room .24, quick_obs .19) | — | — | no time beyond the road's; a walk around a house had no row of its size |
| 15 | 我掏出诺特先生给的钥匙，打开前门进屋，打着手电先在一楼看一圈。 | careful_house_search (.34; quick_obs .28, single_room .27) | 60-360 | 269 | **out of proportion**: a look around one floor |
| 16 | 我先不管楼上的动静，顺着走廊找通往地下室的门。找到了就用手电照着往下看，先不急着下去。 | careful_house_search (.41; single_room .29, quick_obs .12, unknown .12) | 60-360 | 245 | **out of proportion**: a walk down a corridor to a door and a look down a stairwell |
| 17 | 我侧耳听了听楼下有没有动静，然后握紧手电，一级一级慢慢走下台阶。 | quick_observation (.55) | 0-5 | 4 | fits |
| 18 | 日记说科比特葬在地下室。我用手电仔细照墙面和地面… | none (no bind ran; implicit narrate) | — | — | no time charged; under, not over (residual) |

Five of sixteen receipts are out of proportion to the declared act; the clock ran 2,713 minutes (45 h) over turns 1-16, of
which 1,342 minutes are those five.

**Who chose and why.** The clerk, through Jev. The bind question's criteria were the rows' names and ranges only
("careful house search: 60 to 360 minutes"); the views split across rows an order of magnitude apart (turn 16: .44 /
.29 / .12 / .12; turn 15: .38 / .28 / .27) and §163.10 binds the pooled leader at any confidence, so the house-sized row
won on "a house and something looked for", and the kernel rolled inside its 60-360.

**The admission review** (§32) judged the turn-16 time line `entailed`: typed Jev .76, below its settle gate .87, so the
lane reviewer decided, with the grounds "the player chose to search the hallway for the basement door … the time is a
routine cost of that search". That is admission's question, did the player choose the act this effect settles; it is
not a second band question, and it reads the band by name. It is left as it is (see Decisions).

**Across the retained tables** of this machine (the App's and the main source worktree's campaigns: 38 campaigns, 516
declared-time bind rows, 512 landed with a roll: speak_briefly 280, quick_observation 138, library_research 31,
sleep_night 21, investigation_recovery 17, short_rest 11, single_room_search 6, careful_house_search 4, first_aid 4) the
same shape repeats:

- three of the four `careful_house_search` binds were looks around a floor, a motel room and along a corridor to a door
  (245-269 minutes), the fourth the chapel search above (234);
- about half of the 31 `library_research` binds were one request at a counter, a card drawer opened or a first look at a
  reading room (up to 456 minutes: 「麻烦你打开吧，我看看那栋房子建宅和转过几次手的卡片」);
- `short_rest` charged 77-216 minutes for resting "a few minutes" or "a while" over a drink (the rests that named ten,
  fifteen or thirty minutes are from 10-03/04, before the literal intervals of 2026-10-06 took them over);
- `speak_briefly`, `quick_observation` and `sleep_night` look right.

## Root cause

1. **Jev chose among names.** `timeQuestion` (§138.8, reused by the clerk, §138.10) wrote each criterion as
   `careful house search: 60 to 360 minutes`. The time-costs rows held nothing else (band-then-roll D1 says the criterion is
   "the row's own description from the table"; the time rows had none), and the instruction asked "which kind of activity
   is it". So the kind of place and act decided (a house and something looked for; an archive and a record), and the
   extent did not.
2. **Two extents had no row.** A few minutes of moving and looking inside one place sits between `quick_observation` (0-5)
   and `single_room_search` (10-45); one known record brought to hand sits between `speak_briefly` (0-3) and
   `library_research` (60-480). With no row of the right size, the views split across rows an order of magnitude apart, and
   §163.10's pooled leader binds at any confidence.
3. **Not the ranges.** `careful_house_search` and `library_research` reach hours because their acts take hours (CoC 7e,
   Library Use: one use "marks several hours of continuous search"). Narrowing them would not have changed which row was
   named for a corridor, and would shorten real searches. The uniform roll is unchanged.

## The change (contract §202)

1. **Every row says what act it covers.** `time-costs.categories.<row>.covers`, one English sentence: the act and its
   extent, with a contrast where a neighbour is the same kind at another size. Data in the rules table, written and
   reviewed like the ranges, read by Jev; nothing in code classifies a declaration. `bandRows` requires it (a row without
   it is `campaign_not_ready`, like a row without a range) and lists it; `rules.bands`, `band_unknown`'s options and the
   host's `readBandRows` carry it.
2. **The question asks the extent.** Each criterion is `<name>, <min> to <max> minutes: <covers>`; the instruction says to
   judge the extent as well as the kind, and that a row of the same kind but a larger or a smaller extent does not fit. The
   clerk's bind and the shadow lane read the same question (shadow family version 2).
3. **Two rows fill the ladder**, appended after `momentary` (the seventeen before keep handles, values and positions):
   `brief_activity` {2, 5, 10} and `record_lookup` {10, 20, 45}. A misread between neighbours now costs minutes, not hours:
   the rows a corridor can be confused with are 0-5, 2-10 and 10-45.
4. `rule-index.json` reports 19 categories.

Not changed: who names the band, the gate, §163.10's pooled binding and its unsettled path, the route fact, literal
intervals, the roll, road rows and their fill, stated time costs, "time is charged once a turn", the admission review.

## Decisions

- **Contract §202, a new section amending §138.2, §138.8, §138.10 and §138.10.1** (amendment notes left in each), not an
  edit inside the band section: the band section's evidence and tests stay as they were measured.
- **Band choice was already a closed Jev question over the player's words** (§138.10 with §163.10); it stays one. The fix
  is its candidates: rows with a stated extent, and the two missing rungs.
- **Ranges and the roll are kept.** A long act still takes hours: `careful_house_search` 60-360 and `library_research`
  60-480 are unchanged, and their `covers` say what earns them (a whole building room by room; hours in the holdings for
  information not yet located).
- **No gate change.** §163.10 is an owner ruling (the pooled leader binds below the former gate); with rows of the right
  size its errors fall between neighbours.
- **The admission review is not made a second band question.** Refusing the clerk's time there would leave the turn's time
  unsettled instead of choosing the row that fits.
- **The owed review's `time_bands`** (§158.2, an LLM reviewer naming a band by handle) has the same name-only shape; giving
  it `covers` changes a Mod job's input contract and is left as a follow-up, not opened here.

## Not fixed here (residuals, for the coordinator)

- **Time charged for an act the fiction did not reach** (turns 1, 2): the clerk charges the declared act before the
  Keeper narrates whether it happened. A different order or an outcome-tied charge, not a row choice.
- **The owed review** (§158.2) offers `time_bands` by handle only; it should read `covers` too.
- **Out-of-character requests charged time**: on the retained tables, history checks that opened with 「暂不推进剧情」 were
  routed `costs` and charged `library_research` (67-462 minutes). That is the route fact's question, not a row's.
- **Turn 18**: the route selected the time candidate but no bind ran and no time landed (the run ended at `ask_llm` and an
  implicit narrate).

## Not verified here

The tests answer Jev deterministically: they prove the rows, the question and the path from `rules.bands` through the host's
read, the clerk's band question and the kernel's roll to the receipt, not that the real Jev now names `brief_activity` for
turn 16. A live probe (paid Jev calls on the Mac; no Keeper, no world writes) should ask the new question over the run's
sixteen declarations and the survey's `careful_house_search`, `library_research` and `short_rest` lines, with the outcomes
written down first:

- turns 14, 15 and 16 → `brief_activity` (or `quick_observation` / `single_room_search`), never an hour-scale row;
- turns 9 and 10 → `record_lookup`; turn 8 → `record_lookup` or `library_research`;
- turns 1, 6 and 7 → `library_research`; turns 3-5 → `speak_briefly`; turn 13 → `single_room_search`; turn 17 →
  `quick_observation`;
- a "search the whole house room by room" line → `careful_house_search`; "an afternoon with the microfilm" →
  `library_research`; "rest a few minutes / a while over a drink" → `investigation_recovery`.

## Tests

`tests/extension/time-cost-fit.test.mjs` (contract §202 "Tests"): on the emitted kernel, every row's `covers`, the two rows'
ranges and positions, a blank `covers` refused naming the row, the new rows rolling minutes and the long rows hours across
seeds; the question over the kernel's own rows; through the hybrid engine over the haunting (real kernel, faux Keeper,
deterministic Jev) run 3's turn-16 line lands at most ten minutes, turn 9's request at most 45, and a whole-house search and
a library afternoon still at least an hour. Updated: `band-shadow.test.mjs`, `jev-band-shadow-domain.test.mjs` (the host keeps
`covers`), `time-band-momentary.test.mjs`, `ts-kernel-rules.test.mjs`, `tests/kernel/test_rules_bands.py`, the fake kernel.

Mutations (copied aside, restored by copy, each run against the affected files):

| mutation | red |
| --- | --- |
| the host drops `covers` when it reads `rules.bands` (the state this slice was found in) | time-cost-fit 3/7 (turn 16, turn 9, the question), jev-band-shadow-domain 1 |
| the question writes names and ranges only | time-cost-fit 3/7, band-shadow 2/7 |
| `brief_activity` removed | time-cost-fit 4/7 |
| `brief_activity` max 360 | time-cost-fit 3/7 |
| `careful_house_search` min 2 | time-cost-fit 3/7 |
| `record_lookup` max 480 | time-cost-fit 3/7 |
| the instruction stops asking the extent | time-cost-fit 1/7 |
| the kernel stops requiring `covers` (built on the box, `build-fetch`, then rebuilt clean) | time-cost-fit 1/7 (the blank-`covers` refusal) |

## Comments

(none yet)
