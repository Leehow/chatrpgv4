# Provider traffic: the book is read once, and the Keeper's request keeps its prefix (2026-10-04)

Status: decided 2026-10-04 (owner: 「按照你的建议来优化吧」 on the three recommendations below); contract §179.
Implementation on `claude/cache-traffic-20261004` (tickets: `cache-traffic-tickets.md`).

Owner, 2026-10-04: 「我发现现在pipicoc用的大模型流量跑的特别快，grok的缓存命中极低，你看看怎么回事」, then 「按照你的建议来优化吧」.

Related contract: §22.6 (campaign-isolated source workspaces, 2026-09-15), §151.4 (a unit read before a fork), §135.23 (a
turn's request is append-only), §19.2 (the table's own context fold), §176.8 (untold names are renamed on the way out).

## 1. Evidence

Ten hours of the installed App (2026-10-04 02:11Z to 10:02Z, five tables of the same 111-page PDF book, Keeper
`grok-build/grok-4.5` low), tokens as the provider reported them. "Uncached" is `input`; "cached" is `cacheRead`.

| lane | work | uncached input | cached | hit |
| --- | --- | --- | --- | --- |
| module reading, `read` phase children | 397 jobs, 9,603 calls | 27.4 M | 124.9 M | 82% |
| module reading, `verify` units | 1,063 children | 24.8 M | 34.5 M | 58% |
| Keeper main channel | 86 calls | 1.84 M | 1.96 M | 52% |

The reading lane is 96.6% of the uncached tokens. The Keeper is 3%. The App's usage pill reads only the Keeper
channel (`pipiui-token-ledger.jsonl`, depth 0), so what the owner sees there is the 52%; the provider's console sees
everything.

**Why the reading lane costs this much.** Each of the five campaigns forked the shared library
(`.coc/modules/book-4`, 8 material rows, last read 2026-09-28) and read the whole book again in its private workspace
(`.coc/module-campaigns/<campaign>/modules/book-4`): `backgroundSourceUnits` cuts 111 pages into 56 "Original pages"
detail units, `queueAheadReading` adds a visual-asset job per nominated page (about 53), plus the index and identity
jobs; a finished fork holds 122–125 jobs, 108 material rows, took 2.5–3.6 hours and 15–24 M uncached tokens (read plus
verify). §22.6 sends every post-fork publication to the fork and never back, so the library stays as thin as it was on
2026-09-28 and the sixth campaign reads the book a sixth time. Each `coc:turn-committed` wakes the pump, so a table reads
on as long as the player plays. Every verify unit is a new child with a new session id, hence a new `x-grok-conv-id` and
a cold prefix: 58%.

**Why the Keeper misses.** Probed directly against `api.x.ai` with the App's credential (`grok-4.5`, 18 calls):

| probe | cached | reading |
| --- | --- | --- |
| a fresh conversation id, first call | 384 | 384 is xAI's own fixed preamble; a Keeper call whose `cacheRead` is 384 shared nothing |
| same conversation, same prompt plus one message | 3,712 | blocks of 128 tokens; the prefix is matched up to the first difference |
| same, `reasoning.effort` omitted | 384 | a different reasoning effort is a different cache (`none` is refused on grok-4.5 with HTTP 400) |
| no `x-grok-conv-id`, three calls | 384, 3,712, 3,712 | the first landed elsewhere and then stuck |
| add a tool, change its description | 3,712, 3,840 | tool declarations do not sit in the cached prefix |
| one long user message, its tail changed | 2,688 of 2,752 | the match runs inside a message, to the token where it diverges |

Against the four tables' calls and the context lane's rows (`system_bytes`, `briefing_bytes`, `source_revision`):

- Every opening pays two whole prompts (about 65 K tokens each): the setup preamble switches to the Keeper's, and the
  §128.1 synthesized head differs from the system message Pi then persists (`system_bytes` 100,779 → 107,265, constant
  afterwards).
- A turn's first call reads 25,728 tokens (the system prompt and tool declarations) on most turns and 40,064 (plus the
  brief) on some. §135.23 made the brief the source's own, but the brief carries `module`, and these tables published
  new material almost every turn (`source_revision` changed on turns 3, 4, 6 and 7 of one table), so the brief changed
  with the book. After the brief, `coc-history` is rebuilt every turn and the capsule is a new message, so nothing
  further is shared. Later calls of the same turn read 78–98%.
- The occasional 384 at a turn start (54–370 s after a hit, no change in system, brief or unknown bytes) has no cause in
  the payload the telemetry can see; xAI says entries are evicted under server load.
- `thinking-schedule` is a no-op on grok-4.5: the catalog exposes no `off`, so Pi clamps the request back to `low`. On a
  model with an `off` level the same schedule would pay the whole prompt again on every turn's second call.

## 2. What changes (contract §179)

### 2.1 The library follows the leading fork (§179.1)

A fork's accepted reading is source material, not campaign canon. When a fork publishes (a `module.read.finish` that
wrote a graph, a scene row, visual scan or identity state, or a reference materialization) and the library's current
generation is the one this fork forked from or last published, the kernel publishes the fork's reading state to the
library as a new library generation: the graph (with the campaign's opening choice removed: `entry_scene_ids` and the
scenes' `is_start` keep the library's own values), the material rows, scene index, visual scans and candidates,
identity state, retranscriptions, resolved needs and dispositions, viewed pages, the index file, guidance files and
the packet files they name. `opening_choice`, `campaign_scope`, `reading.completed` and `reading.answers` stay private.
A fork whose base the library has moved past publishes nothing to it (`library_advanced`); the next campaign forks the
deeper library and its read-ahead finds the units read (§151.4's `unitRows`). The library's own reads and `module.register`
are unchanged.

Expected effect: the second and later tables of a book read nothing the first table read. On today's numbers that is
four of the five books' worth, about 75 M of the 77 M uncached reading tokens.

Not done, and why: throttling the read-ahead to pages near the player was recommended and is withdrawn after reading the
design record (`coc-module-parsing-redesign`, 2026-08-03): 9 of 11 surveyed modules keep NPC stat blocks in sections no
location edge reaches, which is why the whole book is read. With the library deepening, the whole-book read is paid once
per book, not once per table.

### 2.2 The Keeper's request keeps its prefix across turns (§179.2)

On the single-loop engine the outgoing order after the brief becomes: the turn's capsule, then `coc-history`, then the
player's words and the rest of the opening, then the optional packets, then the turn's traffic. The capsule is rendered
with its sections in a fixed order, stable ones first (`head`, `historical_setting`, `worldlines`, `mods`, the state
lists, `known`, `voices`, `style`) and the ones that change every turn last (`where`, `present`, `director`, `memory`,
`recent`, `turn`). xAI matches the token prefix inside a message, so the next turn's first call shares the system prompt,
the brief and the capsule's stable head. Nothing is removed from the request; the legacy engine is unchanged.

### 2.3 The context lane can attribute a miss (§179.3)

The context lane's `request` row gains `at` and `segments`: one `{kind, bytes, digest}` per outgoing message in order,
plus `system_digest`. A cache miss in the token ledger can then be joined by time and attributed to the first segment
whose digest changed. Today the row has sizes but no fingerprints and no timestamp.

## 3. Acceptance

- CT-01: `tests/extension/campaign-module-isolation.test.mjs` (amended: the library equals the leading fork's reading
  and the other fork's publications leave it alone), `fork-read-ahead.test.mjs`, a new case in which a second campaign
  forked after the sync queues no unit the first read; kernel suites green on the box.
- CT-02: `tests/extension/single-loop-model-call-diet.test.mjs` extended: the next turn's first call shares the brief
  and the capsule's stable head with the previous request; `context-policy.test.mjs` for the section order and the
  legacy engine.
- CT-03: `context-policy.test.mjs` / `long-campaign-context.test.mjs`: every `request` row carries `at`, `segments`,
  `system_digest`.
- Live: after packaging, two consecutive tables of the same PDF book; the second table's `reading-telemetry.jsonl`
  shows no `detail` read of a unit the first table read, and the Keeper's turn-start `cacheRead` is at or above the
  system prompt plus brief plus capsule head.
