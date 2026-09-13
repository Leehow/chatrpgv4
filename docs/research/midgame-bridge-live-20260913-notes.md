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
