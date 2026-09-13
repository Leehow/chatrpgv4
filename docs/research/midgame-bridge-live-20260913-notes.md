# Extended live gate working notes — `introduce_evidence` / `source_rebinding` / `bridge_offer`

Date: 2026-09-13. Branch `claude/midgame-bridge-live-20260913` from `0.9.2a` (`e8984eb9`).
Handoff: `docs/handoff-midgame-causal-reentry-20260913.md` (retained evidence worktree copy).
Contract: `docs/kernel-rpc.md` §37. Plan: `docs/plans/story-continuity-and-adaptation.md` P5.

## Intent check (repository-required before Grok work)

**The user wants to achieve:** that the product, during ordinary midgame play, notices when the
player is acting on a wrong causal model or has chosen an ongoing direction detached from the
unresolved core story, and that the Keeper then makes the causal relation and the present stakes
unmistakable *inside the direction the player actually chose* — without forcing the player back to
a prescribed scene, without inventing evidence, and without settling a choice the player has not
made. The single remaining acceptance is the extended chain that the core `clarify_known` mainline
does not cover.

**Success is:** one fresh genuine-play chain, main session as sole player, one natural utterance
per turn, live Keeper `xai/grok-4.6` at low reasoning effort, in which structured evidence shows

1. a `misframed`/`detached` assessment stored in `memory/story.jsonl` with the exact frame;
2. the next turn projecting `causal_reentry` with `mode: introduce_evidence`, one source-grounded
   `bridge`, and the correct `relation`;
3. `authority.clue_here` false at the player's chosen place, a reviewed `source_rebinding` accepted,
   and the *effective graph* changed (not prose);
4. an unforced `bridge_offer` — audit basis `bridge_offer`, verdict `defer`, no acquisition receipt,
   no `bridge_delivered`, and no second demand for `source_rebinding`;
5. the player's own later choice to inspect/receive it producing the minimal clue/source-handout
   receipt and audit basis `bridge_receipt` with the exact bridge relation;
6. a later player frame showing understanding or informed refusal, with play continuing coherently
   in the chosen direction;
7. a real pending preparation surviving a later player utterance and, after a process restart
   (`session.resume` first), recovered through the unnamed adaptation `status` path.

**Empty delivery would be:** a turn count; generated scenery; an audit report or KPI table standing
in for the chain; a scripted player, batch settlement, `kp_settle_turn`-style fake Keeper, keyword
routing, or any fixture standing in for play; narration that *says* the bridge landed while no
receipt, no effective-graph change and no `reentry_review` basis back it; declaring the gate passed
from a run whose raw `.coc` evidence is not retained and independently inspectable; or repairing
the failure by adding place/action enumerations or a parallel director instead of the existing
system path.

## Workspace

- Fresh lifecycle-owned worktree `/Users/haoli/leehow/code/chatrpgv4-wt-midgame-bridge`.
- `node_modules` symlinked to `chatrpgv4-wt-story-continuity`; `npm run build:runtime` ran clean
  with Node 24.19.0 from `/Users/haoli/.local/bin/node`.
- Module package `the-haunting` copied from the retained evidence worktree's `.coc/modules/`
  (immutable installed module, digest `59fa9d87…`); it is the module library, not a save.
- Pi profile copied to the ignored `.pi/coc-agent/`; `defaultProvider: xai`,
  `defaultModel: grok-4.6`, `defaultThinkingLevel: low`; `packages` repointed at this worktree.
  Credentials are never printed or committed.
- The retained evidence worktree `/Users/haoli/leehow/code/chatrpgv4-wt-midgame-evidence` is locked
  and untouched. The shared checkout `chatrpgv4-wt-pi-coc-v2` (`codex/session-maps`) is untouched.

## Run log

(appended below as the run proceeds)

## Run 1 — campaign `midgame-bridge-live-21`, runs `…-21-run` and `…-21b-run`

Keeper `xai/grok-4.6`, `reasoning_effort: low` (confirmed in `daemon.json.model_confirmed` and in every
`provider-request` telemetry row). Sole player: this main session, one natural utterance per turn.
Module `the-haunting`, digest `59fa9d87…`, `play_language: zh-Hans`, investigator `thomas-hayes`.

### What the product got right (structural evidence, not narration)

- Turn 2, an explicit non-supernatural causal frame plus a direction away from the house, was stored in
  `memory/story.jsonl` as
  `{"turn": 2, "commit": "92f56e0", "status": "detached", "thread": "house-haunted-by-corbitt", "frame": "世上没有会记仇的房子。…所以我不进宅子。", "bridge_delivered": false}`.
- The next turn's audit context (`.coc/mods/jobs/<job>/context.json`, four jobs, identical) carried
  `causal_reentry` with `mode: "introduce_evidence"`, `status: "detached"`, `known: []`,
  `authority: {"current_scene": "commission-briefing", "clue_here": false}` and one deterministic
  source-grounded bridge: `{"clue": "globe-unpublished-story", "relation": "supports", "source_handouts": ["globe-unpublished-1918"], "source_scenes": ["newspaper-morgue"]}`.
- The pre-delivery audit refused every non-realizing draft with the contract's own finding and fix
  (`.coc/mods/jobs/042d1d19…/result.json`): `reentry_review {verdict: revise, basis: none, quote: null, clue: null, relation: null}`.

So items 1–2 of the extended gate — detection, mode selection, deterministic bridge, authority projection,
pre-delivery enforcement — behaved exactly as §37 specifies, on Grok 4.6 low.

### Blocking defect found: a turn can reach a state with no lawful Keeper draft, and the player can never speak again

Chain of events, all in retained evidence:

1. The Keeper read the row correctly and prepared the required `source_rebinding`
   (`.coc/adaptation-jobs/midgame-bridge-live-21/f98b530d…/job.json`, purpose `source_rebinding`,
   one `clue_at` change for `clue-globe-unpublished-story` at `scene-commission-briefing`).
2. The independent adaptation review **refused** it — legitimately:
   `{"verdict": "contradicted", "issues": ["clue_at of globe-unpublished-story at commission-briefing contradicts canonical discoverable-at newspaper-morgue … inventing that the unpublished copy is within reach at his office."]}`
   (`…/attempt-1/review/result.json`). Job `status: "failed"`.
3. With that refusal there is **no lawful `reentry_review` basis left at all**:
   `bridge_receipt`/`bridge_offer` require `authority.clue_here: true`;
   `acquired_clarification`/`player_discharge` require nonempty `known`;
   `preparation_wait` requires a live pending/reviewing job — the job is terminal `failed`;
   `none` is by definition `revise`.
4. `AuditBudget` then blocks the review for the input (`max_rewrites: 1` →
   `"The bounded Keeper repair did not resolve the review"`), and every further `narrate` returns
   `needs / continuity_review_unavailable`.
5. `extensions/kernel/index.ts` REFUSAL_BUDGET deliberately exempts `narrate`/`ask` and tells the Keeper to
   "close the turn with narrate" — but narrate is precisely what the paused review has closed. The escape
   hatch the refusal budget points at is the one that is shut.
6. `table.player_input` requires `awaiting_player`/`asked` (`kernel-ts/write/index.ts:588`); the turn is
   `acting`, so every further player utterance is refused `turn_state`. Telemetry shows three such refusals
   at 10:51:11Z, 10:56:32Z and 10:59:05Z.
7. **A cold process restart does not recover it.** Run `midgame-bridge-live-21b-run` was a fresh
   `bin/pi-coc --mode rpc` process; `turn.json` still reads `{"turn": 3, "state": "acting"}`,
   `table.player_input` was refused again, and the agent settled `empty` after four `stop_reason: error`
   provider calls. The campaign is unplayable and cannot be handed back to the player.

Contributing capacity fact: `AUDIT_LIMITS.time_ms` is 30000 for the whole review allowance of one player
input (`kernel-ts/mods/audit-result.ts:3`). Single continuity reviews under grok-4.6 low measured 21.1 s,
21.9 s and 30.0 s, so one review can consume the entire per-input allowance and the second attempt is
refused as `"The shared review allowance is exhausted"` before it starts.

`midgame-bridge-live-21` is retained as **failed evidence**, not a pass. Its `.coc` state is preserved.

### Classification

This is not the semantic-model failure the handoff anticipated (Grok read the row correctly and took the
contract's own prescribed action). It is a **system gap in §37**: the contract has a writer and a reader for
"placement authority must be obtained first", but no state and no lawful basis for *"the required placement
was reviewed and refused"*. Deferral is structural by design (§37, "Deferral is structural, not inferred"),
and there is no structural state for a terminal-unsuccessful adaptation — only for a live pending one.

## Repairs made before the retest

Two commits on `claude/midgame-bridge-live-20260913`, both contract-first:

- `4ca4ff86` — **contract §38, the stranded-turn release.** `table.player_input` takes an optional
  `release: "stranded"`, accepted only on an `open`/`acting` turn; the kernel records that turn as
  `closed_by: "stranded"` with its receipts, appends `turn-stranded`, and opens the next turn. Nothing is
  narrated or committed and no verdict becomes a pass; every delivery consumer already filters on
  `closed_by === "narrate"`. The host declares stranding only from its own run state — at `agent_settled`
  when a run left the turn undelivered **under a paused review**, and at a `table.open` that finds a
  `pending_turn` whose retained review is paused. An undelivered turn whose review still works keeps the
  §4 recovery path unchanged.
- `7458ede3` — **contract §37.6, a refused placement gets a lawful next move.** A `failed` adaptation now
  reports its `purpose` and a bounded `refused` (the independent reviewer's own `summary`, `issues` and
  per-change `contradicted` reasons) plus one instruction not to prepare the same placement again. The host
  records `rebinding_refused` from that kernel result and carries it on the `narrate` payload beside
  `preparation_wait`; narration-audit **1.2.17** accepts a candidate that continues the player's chosen
  action, claiming no evidence and no placement, as basis `authority_unavailable` with verdict `defer`;
  `story-thread` **1.2.7** tells the Keeper to propose a materially different placement or play on.
- `30976010` — projection fix found by the live path: `string()` returns the Python-compatible `"None"`
  for null, so an absent refusal reached the auditor as `{name: "None", summary: "None"}`.

Validation with Node 24.19.0 from `/Users/haoli/.local/bin/node`: `npm run check:kernel` passed;
`npm run test:ext` 890/890, exit 0. Two flaky timing failures were seen once each in full-suite runs
(`ts-kernel-git.test.mjs` process-teardown timing, `lanes.test.mjs` `#67` header-wait timing) and both pass
in isolation and in the clean full run; neither touches this change.

## Run 2 — campaign `midgame-bridge-live-22`: the extended gate chain, PASSED

Keeper `xai/grok-4.6`, `reasoning_effort: low` in every `provider-request` row; sole player this main
session, one natural utterance per turn. Mods `story-thread 1.2.7`, `narration-audit 1.2.17` (pinned in
`world.json`). Runs `…-22-run`, `…-22b-run`, `…-22c-run`.

| campaign turn | what the structured evidence shows |
| --- | --- |
| 2 | `memory/story.jsonl`: `detached` on `house-haunted-by-corbitt`, frame `所以我不进宅子。我先去查钱是怎么流的…`, `bridge_delivered: false` |
| 3 | ordinary play into `hall-of-records`; the core thread's `known` stays empty |
| 4 | undelivered under a paused review, then **released**: record `closed_by: "stranded"`, `commit: null`, its `roll` receipt preserved, `turn-stranded` event, turn 5 opened (§38) |
| 4–5 | reviewed `source_rebinding` `globe-story-at-records` (`clue_at`), independently reviewed to `ready`, accepted as receipt `adaptation:33a2e3859a70d929` — the **effective graph** changed, so `authority.clue_here` became `true` at `hall-of-records` |
| 5 | unforced **`bridge_offer`**: audit job `3da4cb0a0e24c0970d9e9085852615b6676b617cf7ffd39d50036193bfd2e84a`, `reentry_review {verdict: defer, basis: bridge_offer, clue: globe-unpublished-story, relation: supports}`, overall `pass`; receipts are only `adaptation` and `time` — **no clue and no handout receipt**; the post-commit assessment keeps `detached` with `bridge_delivered: false` |
| 6 | the player chose to take it (`「那张夹纸抽出来。」`): minimal `clue` + `handout` receipts only, audit job `89df3850730c25b507ac06d4c2fc0576fa36f57f505f2fe7a45c8059e6150059`, `reentry_review {verdict: pass, basis: bridge_receipt, clue: globe-unpublished-story, relation: supports}` |
| 7 | the player's own frame reconnects (`那就不是有人做空这栋房子，是这栋房子对住进去的人下手`): `memory/story.jsonl` stores **`aligned`** for `house-haunted-by-corbitt` with `bridge_delivered: true` and an exact delivery quote; the same turn passed audit job `9e90d272e3f637dc987e3049ad4cc521be8f5e92eafcc7fe0feb96d1eeff5401` as `acquired_clarification` (`supports`, in the row's own direction) |
| 8–12 | play continued coherently **in the direction the player chose** — probate register, the executor Michael Thomas, the chapel closed in 1912 — with no forced return to the house |

`mode` was `introduce_evidence` throughout the bridge stages (`known: []`) and flipped to `clarify_known`
only at turn 7, once the player actually held the evidence. Physical location never selected it.

### Preparation wait and cold restart

Turn 11 asked for a destination the module does not have; the Keeper prepared `new_destination`
`教区总档案处` and delivered an honest wait-only narration under `context.preparation_wait`. The process
was then stopped and a **fresh** `bin/pi-coc --mode rpc --no-session` started (`…-22c-run`). On the first
player input the capsule carried its `resume` section (checkpoint at turn 11, commit `c6f1933`), the
Keeper's **first** tool call was `lookup kind=adaptation action=status name=教区总档案处` — a name no
surviving session could have held — and it then accepted the proposal (`adaptation:dd23f0023d16e116`) and
delivered. Honest caveat: both the host's unnamed `adaptation.status` scan and the capsule's
`resume`/`recent` projection carried that name in this run, so this evidence shows the restart recovered
the retained proposal without the Keeper remembering it, but it does not isolate the unnamed-status path
from the resume projection.

### Two observations, researched to a decision (contract §37.9)

**The turn-6 `bridge_delivered: false` is correct, not a lane under-read.** I first read it as a
disagreement with the audit's passing `bridge_receipt`. Reading both bars against the turn text says
otherwise: `bridge_receipt` asks whether the candidate realized the carrier and stated *that evidence's*
relation and stakes, which turn 6 did; `bridge_delivered` asks whether the Keeper's text made the causal
relation **to the selected core claim** land, and turn 6 stopped at "it is the people who move in, not the
money" without reaching Corbitt's lingering will. Turn 7 reached it and was recorded `true`. Deriving one
from the other would report a bridge as landed the moment its carrier was realized — the exact confusion
between holding evidence and understanding it that §37 exists to prevent. **No code change**; the contract
now says why, so it is not re-litigated as a bug later.

**The review allowance was reshaped.** `AUDIT_LIMITS` had one shared `time_ms: 30000` per player input and
`AuditBudget.start()` reserved *all* remaining time for the first review, so on a lane whose single review
costs 21–30 s the repair that `max_rewrites: 1` permits got the leftovers — usually none. That is an
accidental limit overriding the intended one. Now `per_review_ms: 40000`, `time_ms: 80000`, and each review
reserves `min(per_review_ms, remaining)`. Caps, not targets: fast lane models are unaffected. Worst-case
audit cost per turn rises 30 s → 80 s, and only on a turn needing revise **and** repair — a turn that
before §38 could not be delivered at all. Covered by two tests; the old formula is killed by both.
