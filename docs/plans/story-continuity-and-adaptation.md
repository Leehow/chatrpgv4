# Story continuity and adaptation — authoritative repair plan

_Status: P0-P3 IMPLEMENTED; P4 code, fixed-input and genuine-play gates completed. Human UI acceptance and integration remain PENDING. **P5 (midgame causal re-entry) core midgame causal-logic mainline is IMPLEMENTED and its static/code status stands, and its core genuine-play acceptance is ACCEPTED on the retained `midgame-reentry-live-20` evidence; the prior `midgame-reentry-live-18` raw evidence was lost with the closed prior worktree and is `invalid-for-acceptance` as independently inspectable raw evidence (an operator evidence-retention failure, not a product pass). Its extended `introduce_evidence` / `source_rebinding` / `bridge_offer` live gate remains PENDING, so P5 as a whole is NOT complete.** This is the single execution plan. Current retained evidence worktree: `/Users/haoli/leehow/code/chatrpgv4-wt-midgame-evidence`, current versions story-thread 1.2.6 and narration-audit 1.2.16; this worktree will be locked and retained and must not be closed or deleted. Current results: [midgame causal re-entry checkpoint](../research/midgame-causal-reentry-2026-09-13.md) and [repair report](../research/continuity-review-repair-2026-09-12.md). Wire contract: docs/kernel-rpc.md section 36.14; the midgame causal re-entry contract is section 37._

Owned checkout: codex/story-continuity, planning base b182f5ff; product repair0789496f. Primary has concurrent dirty work including its own contract and Electron/onboarding paths and is untouched. The user now explicitly authorizes implementation of P0-P4. Issue publication, packaging/deployment and new tasks remain out of scope. The concrete versioned wire contract is §36.14.

## 1. Corrected goal (authoritative)

The user's correction governs acceptance. Distinguish four regimes:

- **Recalling already-delivered history** (what was narrated, a recap, an NPC's prior
  line or an earlier receipt) must be faithful; contradiction is a failure.
- **Adding a new campaign detail** invented to make the campaign's own logic work is
  ALLOWED when it is coherent with settled state. Absence of a literal module quote is
  not, by itself, a failure.
- **An NPC assertion or a player hypothesis** keeps its attribution: a rumor, lie, or
  guess is reported as such and is not automatically world truth.
- **Kernel-authoritative action/resource state** (items, cash, dice outcomes, movement,
  refusals) is never invented or reversed.

Retractions, receipts, player choices, and world state constrain continuation. The
original module file stays immutable for engineering provenance; it is not an exhaustive
list of every permissible fictional fact. Ordinary compatible detail must NOT require a
heavy graph-adaptation job; it persists through existing delivered history/notes/memory,
while meaningful world changes use existing apply/resolve.

Out of scope for this repair: new memory DB, semantic regex/list classification,
compulsory planner/lane, comprehension score, new Keeper verb, automatic retcon, forced
clue/scene, generic graph edits, or any rewrite of the graph-adaptation subsystem. Its
capabilities and source cause/unique-identity protections are unchanged.

## 2. Superseding interpretation and retained state

Missing source provenance alone does not prove that turns17/18 were incoherent. Their old rejection records and raw evidence remain unchanged; this plan supersedes that interpretation, without declaring the turns newly passed. Turns12/13 included fabricated retrospective testimony/kinship explicitly withdrawn later, so those corrections remain authoritative. Overall story-coherence and human UI acceptance remain incomplete.

Retained campaign continuity-venue-live completed turns22-41 and is now turn42 awaiting_player. The player ended the paid inquiry after finding the cellar body and returning evidence and the original key. This is an inquiry ending, not a solved haunting. The bible refusal and prior corrections remain intact; raw evidence was retained.

## 3. Verified baseline

Evidence: `.coc/playtests/continuity-memory-resume/verification.json`, `turn-1-actual-delivery.json`, campaign turns17-21 and retained Mod job traces. Keeper and all lanes used DeepSeek Flash with thinking off; the main session was the sole live player.

- Five turns: 932.057s actual; 842.439s in narrate/audit (~90.4%), 59.958s in Keeper generation. Turn17 was361.988s, not the driver's premature99.207s.
- Nine review jobs /13 Pi attempts:344 reviewer model responses,399 tool calls,128560 output tokens. Tool execution unions total21.406s; no child timeout, reported reasoning tokens0.
- Child time819.441s splits without overlap: first-draft first attempts442.636s; first attempts after Keeper rewrites261.439s; artifact-format retries115.366s. First-write tails overlap these, not extra savings.
- A489-character no-receipt clarification received a40KB task packet plus original/effective graphs about870KB each. One auditor made54 model responses; one format repair made19. Earlier7-12s audits had different tasks/coverage and are not a controlled speedup baseline.

## 4. Implementation plan (dependencies, owned paths, completion gates)

Statuses: historical work COMPLETE; this plan COMPLETE; P0-P3 IMPLEMENTED; P4 fixed-input and genuine-play checks COMPLETED with retained intermediate failures and remaining limits documented. Human UI acceptance and integration remain pending.

**P0 — Contract/rubric and measurement repair** (blocks all product edits). Finalize a
versioned continuity-review replacement contract using a NEW capability/schema version; do
NOT silently reinterpret recorded `audit.source.v1`/`source_review` verdicts. Keep locked
old Mod versions/jobs readable and immutable; new behavior is adopted through existing Mod
configuration/versioning. Concrete P0 prerequisite: fix the literal wire names for the new
capability/schema (not invented here). Repair first during implementation:
`tests/play/driver.py` + existing `tests/play/test_driver.py`, reproducing the real event
sequence and rejected-draft precedence. Gate: driver tests reproduce the race and the fix;
per-turn time measured input-to-final-settle.

**P1 — Policy and focused input.** Change only the current audit producer/Mod policy at
`kernel-ts/mods/audit-source.ts`, `kernel-ts/mods/jobs.ts`, existing read projections as
strictly necessary, `mods/narration-audit/auditor.md`, and affected enhanced-items auditor
integration (do not break independent legacy/queued equipment checks). Reuse current
historical/semantic-reference readers; keep full fallback and freshness; criteria
distinguish faithful recap from compatible new fiction. Gate: focused seam tests plus
fixed-corpus verdicts per §§5-6.

**P2 — Deterministic error/repair isolation.** Validator errors identify exact
locations and collect all deterministically discoverable format/reference errors with
paths/files/excerpts in ONE response so a single artifact repair fixes multiple malformed
references without blind rediscovery, preserving the semantic verdict and never asking the
Keeper to rewrite fiction. Checked submission integration in `extensions/mods/index.ts`
plus a minimal private audit submission adapter, reusing `runtime/tasks.ts` and
`extensions/module/reader.ts` interfaces only as needed. No main-narration rewrite for a
malformed auditor result. Gate: malformed-artifact case repaired locally; semantic verdict
unchanged; failed artifacts retained.

**P3 — Termination/budget.** Share counters/deadline across nested retries and Keeper
repair; stop on checked submission; expose unavailable cleanly without rerolling, deleting
evidence, inventing a fallback scene, or publishing unreviewed text as approved. A fresh
read/review inside the same automatic chain consumes remaining budget; explicit
narrate/ask and implicit closure share the same review/remaining budget; only an explicit
user-directed retry starts a newly recorded bounded attempt linked to the prior attempt.
Implemented P3 paths include `extensions/kernel/index.ts`, ONLY for the
delivery/retry/steer hooks needed to surface review unavailability and prevent the parent
Keeper from automatically starting more review rounds or exposing rejected prose (implemented in this repair). Preserve cancellation/cold resume/freshness and existing
legacy no-capability behavior. Reader termination validated against its current supported
Pi API. Gate: budget/unavailable/cancellation cases accurate; unavailable/invalid audit
cannot be bypassed by implicit prose; no automatic full-budget loop.

**P4 — Controlled validation then genuine play.** One small fixed corpus using retained
snapshots and tool-enabled Pi DeepSeek Flash, identical candidate/state/model parameters
per comparison; do not rerun the costly baseline unnecessarily. Isolate changes (policy;
input organization; submission/repair) in bounded probe variants and record which variant
changes acceptance semantics, so old source-faithfulness is never the quality oracle.
Probes are NOT live gameplay and never modify the original campaign. Use existing highest
seams `tests/extension/source-audit.test.mjs`, existing Mod job bridge/runtime seam tests,
`tests/play/test_driver.py`, and `tests/play/driver.py` for actual play; no new elaborate
harness and no tests that merely copy prompt wording. No two pytest processes in parallel.
Then resume the retained real campaign with the main session as sole player, one natural
utterance at a time. The remaining extended gate may use `xai/grok-4.6` at low reasoning
effort, authorized by the user on 2026-09-13; select it before activation and keep it fixed.
Do not use Astra. Preserve refusal of the bible,
cover another reasonable detour and later causal explanation, and continue toward a
natural ending or real blockage, not until a turn quota. Never end/grade it failed merely
because a compatible detail is absent from the book. Keep actual uninformed-human UI
acceptance as a separate pending gate; no unsolicited App packaging/deploy.

## 5. Acceptance matrix

| Case | Expected result | Layer |
| --- | --- | --- |
| Plausible old ledger cutoff resolving an otherwise compatible ownership timeline | Allowed new detail; stable when asked again/restarted; no claim the player knew it earlier | Policy + memory persistence |
| Previously corrected father/childhood/ownership attribution repeated as fact | Rejected or corrected via the recorded correction; old memory stays retired | Policy + memory |
| Player asks what an NPC previously said | No fabricated prior quotation/encounter; NPC rumor stays attributed, not world truth | Policy |
| Reasonable new clue presentation consistent with situation and established facts | Allowed under existing disclosure/state paths; no forced reading of the declined bible | Policy + admission (unchanged) |
| Unperformed item/cash movement, reversed refusal, changed dice outcome | Existing authority preserved; no silent pass | Kernel authority (unchanged) |
| Oblique but adequate narration of a receipt and ordinary atmosphere | No prose expansion demanded merely for wording | Policy |
| Multiple malformed evidence references or format/reference errors in one artifact | All deterministically discoverable errors returned with exact paths/files/excerpts in ONE response; one local repair fixes them; semantic verdict unchanged; no Keeper rewrite or whole-history rediscovery | Error isolation |
| Missing/stale/tampered evidence, budget exhaustion, cancellation | Not a pass; terminal/status and retry accounting accurate; receipts retained; no automatic full-budget loop; fresh read inside the automatic chain consumes the same budget | Termination/budget |
| Unavailable/invalid audit via explicit narrate/ask AND via implicit prose closure | Both share the same review/remaining budget; unavailable/invalid audit cannot be bypassed by implicit prose; rejected prose never exposed | Termination/budget + delivery hooks |
| `agent_end` followed by immediate resumed work | Driver waits for real settle; selects delivered text; preserves all prior drafts | Driver |
| Cold restart / worldline or evidence change | Corrections and compatible established details survive; stale review never reused | Freshness/resume |

Scope note: this repair does not redesign graph adaptation or action admission.

## 6. Quality and performance gates (targets, not results)

Proposed initial policy, calibrated before adoption: normal review <=6 private model responses; the whole automatic chain <=12 responses and30s active review time, with at most one semantic Keeper rewrite and one targeted artifact repair. Counts exclude human thinking/background work and survive automatic retries/restart in existing retained records. A later explicit user-directed retry is a separately recorded bounded attempt linked to prior accounting. Exact unchanged-candidate reuse still requires valid source/state/package bindings; missing evidence is never approved by cache.

Every clear positive/negative case in the fixed corpus must have the expected verdict;
ambiguous cases are LABELED for review rather than washed into a success percentage.
Normal-case audit median <=10s across repeated fixed cases; no ordinary automatic chain
over its proposed 30s/12-response budget. Count unavailable outcomes explicitly so fast
failures cannot game success. Report count/range/median with sample size, not a
misleading p95 from a tiny sample. In genuine ordinary investigation turns aim median
end-to-end <=30s, reporting dynamic graph-adaptation/long-reading requests separately; no
speed claim before measured same-input and real-flow evidence. Step limits are safety
boundaries, not proof of usefulness; a correct case that times out is a failed completion
gate, not a performance pass; performance acceptance requires correct cases to complete,
not simply to time out faster. If baseline/model limits make targets infeasible, retain
findings and choose the smallest evidence-supported adjustment.

## 7. Sources (brief)

Prior art is precedent for the design, not grounds to adopt dependencies or replace Pi.

- [User-provided Keeper Rulebook](</Users/haoli/Documents/TRPG/coc英文/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen).pdf>),
  printed 199-202, 221 (physical PDF 211-214, 233), verified earlier: spontaneous
  plausible family-tree clues, multiple routes, scenario essentials vs movable
  presentation, Idea roll for stalled investigation. Do NOT add Idea-roll engine features.
- [Anthropic, "Building effective agents"](https://www.anthropic.com/engineering/building-effective-agents)
  (evaluator/optimizer needs clear criteria and measurable improvement; termination
  boundaries).
- [Anthropic, "Effective context engineering for AI agents"](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
  (focused high-signal initial context plus just-in-time lookup; autonomous search costs
  latency; not all file-backed agents are bad).
- [AJV error objects](https://ajv.js.org/api.html#error-objects)
  (instancePath/structured local error info) — precedent only, no new dependency.
- [LangGraph Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api)
  (explicit termination with step limit as safety net, not sole success criterion) — no
  LangGraph adoption.

## 8. Historical record (preserved, concise)

- Source audit checkpoint `ca127652` and memory repair `0789496f` remain prior history on
  owned `codex/story-continuity`; this planning turn is documentation only.
- Memory repair implemented: timestamp-shape fix, kernel-bound semantic corrections,
  supersession/late backfill, current-worldline reconciliation, correction priority and
  inherited relevance, memory status/provenance, readable superseding content,
  `record_integrity_only` transcript label.
- Memory validation (historical): extension suite 838 passed; dedicated memory suite 5/5;
  kernel memory module 14; adjacent memory/recall/worldline/transaction/capsule suite 85
  (one transcript-schema assertion initially missing `verification_scope`, then
  corrected); typecheck and runtime build passed. Live startup/backfill reconciled three
  legacy corrections (4.601s total).
- Resume playtest turns 17-21 committed (`c303d09`, `b674f0a`, `d0e599c`, `dbe8fb9`,
  `0942e16`); turn 22 open. Three bounded findings documented, superseded in
  interpretation by §2: cost/instability of audit-imposed rewrites; driver race;
  old-rubric source-proof failures.
- Turns 12/13 of `continuity-venue-live` included fabricated retrospective
  testimony/kinship that was explicitly withdrawn; the corrections stay authoritative and
  the rejected draft files are retained as historical rejection evidence assessed under
  the appropriate rubric. No universal hallucination elimination, Greek transplantation,
  human UI acceptance, or story ending is claimed.

## Current implementation checkpoint

Commits5817faf1,9c124aaa,5499b4d0 andbc1d2aa1 implement the new continuity capability, focused context including kernel clock and executable equipment, private evidence lookup and checked submission, aggregate artifact errors, bounded shared review accounting, explicit/implicit paused delivery, driver completion repair, and a read-only cold-recovery status check. Current versions are narration-audit1.2.4 and enhanced-items1.1.9; retained legacy1.1.2 remains tested.

Validation: driver14/14; kernel Mod/memory/capsule50/50; final extension850/850; typecheck and runtime build passed. Latest frozen probes matched18/18 semantic expectations plus2/2 separately labeled completion-only checks, median3093ms, range1495-9432ms, at most3calls. The real one-call exhaustion probe correctly paused and is not a gameplay pass.

Genuine play completed20delivery attempts through turn41, ending the paid inquiry after a cellar discovery; median25.609s end-to-end and6.6225s in the narrate preparation/review/commit interval. One19.2s undelivered review attempt is retained separately; later explicit recovery completed without repeating resolve/apply. Dynamic graph work still caused two long turns. The natural ending preserves the unresolved haunting and does not claim combat acceptance. Full evidence, intermediate failures, current state and limitations are in [the repair report](../research/continuity-review-repair-2026-09-12.md). Human UI acceptance, integration and packaging remain outside this completed code-validation slice.

## Current checkpoint (2026-09-12): adaptation routing, scene commitment and pending preparation

The checkpoint above is historical. It recorded narration-audit 1.2.4, the continuity-review repair and
the first genuine-play ending; its evidence is retained unchanged and is not rewritten here. This
checkpoint supersedes it as the current state of the branch.

Current audit version is **narration-audit 1.2.16** (with enhanced-items 1.1.9; 1.2.9–1.2.15 were installed and exercised in retained live evidence and retain their historical meanings, and 1.2.11's checked `reentry_review` sub-review remains current with the 1.2.12 bridge-authority requirement, the 1.2.13 `bridge_offer` basis, the 1.2.14 separation of the placement/offer stage from the acquisition/delivery stage, the 1.2.15 reentry modes, and the 1.2.16 evidence `relation`). The version moves because the two-stage `bridge_offer` basis was added under `causal_reentry` on the contract section 37 slice, at 1.2.14 because retained live evidence (`midgame-reentry-live-15h-run`) showed the reviewer still applying the old receipt-first rule to an authority-true compliant offer, and at 1.2.15 because retained live evidence (`midgame-reentry-live-17b-run`, turn 6) showed the Keeper opening adaptation on a thread that already carried acquired evidence instead of clarifying it, so the `mode` (`clarify_known | introduce_evidence`) now closes which bases may pass, and at 1.2.16 because retained live evidence (`midgame-reentry-live-20-run`, turn 5) showed a `supports` row quoted to argue against the selected thread while the audit still passed `acquired_clarification`, so the checked sub-review now carries the evidence's `relation` and requires the quote to use that evidence in that row's own direction; the causal-reentry pre-delivery deferral rule (1.2.10), the scene-commitment heading 1.2.8 (carried from 1.2.7) and the pending-preparation turn rule remain valid as historical descriptions. Current `story-thread` version is **1.2.6**; 1.2.3 remains its historical predecessor and its action-instruction meanings are preserved unchanged, 1.2.4 adds the creation-time no-clue clarification, 1.2.5 adds the deterministic reentry mode, and 1.2.6 adds the evidence `relation` direction rule: `clarify_known` uses one already acquired `known` row and continues the chosen action with no adaptation and no new clue, stating that row's relation in that row's own direction, while `introduce_evidence` keeps the existing concrete bridge/authority/`source_rebinding`/`bridge_offer`/`bridge_receipt` flow; a `new_destination` scene's initial no-clue description is not a permanent prohibition, a later reviewed `source_rebinding` is the authorized way to add an existing clue's delivery relation there, no flag/ruling/note/adaptation may forbid the bridge or freeze the scene clue-free, and player agency is preserved after rebinding (`bridge_offer` when the player has not chosen acquisition, or the minimal receipt path when they have).

The persistent-locus promotion rule: `active_scene` is a persistent gameplay locus, not physical
coordinates. A distinct place is promoted to a registered scene only when it becomes the ongoing context
for subsequent player action or durable location-bound state (its own affordances, discoverable clues,
NPC/object presence, or intended return); otherwise it is same-locus detail or transition and needs no
scene. This is one semantic test, not an enumeration of doors, balconies, cabinets, vehicles or other
nouns, and the noun or its size never decides.

Adaptation-purpose routing: `lookup kind adaptation action prepare` carries a closed `purpose`
(`new_destination | persistent_npc | source_rebinding | handout | rebase`) that the kernel structurally
validates against the closed change set before acceptance. Ordinary fiction and physical objects no
longer advertise adaptation; only an explicit `expected_kind: scene` miss returns a new-destination
preparation. Creator and reviewer decide the open semantics in a focused, tool-enabled pair — one
creator and one reviewer, bounded per-run provider requests and wall time — with the focus packet inlined
or bounded rather than letting the child explore raw schemas.

Destination identity admission: existing target handle, display and summary are projected into admission
so a label cannot substitute the persistent locus the player actually chose.

Pending-preparation turn state: when `prepare` returns pending with retained background work, that work
owns the rest of the turn. Only a short `narrate` that honestly says preparation is pending may close
it; all other Keeper tools are blocked, and the ordinary `agent_end` floor must not restart ordinary
work. The pending status itself authorizes no arrival or change.

Adaptation job freshness (retained fix): a pending job binds the material world, party, active worldline,
source generation and existing adaptation, not narration-only HEAD, turn number or player text. An honest
wait-only `narrate` therefore does not stale the job; `status` and `cancel` remain callable while it waits,
and a terminal status clears the wait. Host-owned `preparation_wait` is retained across subsequent explicit
player inputs while the same job remains pending or reviewing in the same live process: a new player input
clears review/admission attempt state (new context, `current_input`) but must not clear a real preparation
wait, and only an explicit `ready`/`failed`/`cancelled` status (or an explicit `cancel`/nonpending adaptation
result) clears it. Any material world/party/worldline/source change still invalidates it, and final `apply`
admission still protects withdrawal, so a wait turn cannot smuggle an unchosen change.

Full implementation seams and evidence are in
[the adaptation-routing report](../research/adaptation-routing-scene-commitment-2026-09-12.md). It records
the old live waits, the final frozen adaptation probes, the paired semantic cabinet/station probes, the
genuine Athens play, the failed `adaptation-pending-live` evidence, and current validation. Human UI and packaging remain pending; integration is complete — merge `5a193568` integrated `codex/story-continuity` with `3ee1e4b0`, preserved mainline turn illustrations as contract section 35 and renumbered this work to section 36, and post-merge validation passed `npm run build:runtime`, `npm run check:kernel`, complete `npm run test:ext` 869/869, and the bounded Python selection `tests/kernel/test_apply_item_cash.py tests/kernel/test_memory.py tests/kernel/test_recall.py tests/play/test_driver.py` 40/40 in 117.74 s. The earlier full Python-suite note (1244 passed, 1 skipped, 2 out-of-slice failures) remains historical and no clean full Python suite is claimed.

Primary-source analogues were used proportionally and did not override project constraints:
[Anthropic, "Building effective agents"](https://www.anthropic.com/engineering/building-effective-agents)
for routing distinct work types into a simple composable pattern, and the Microsoft Azure architecture
pattern for
[asynchronous request-reply](https://learn.microsoft.com/en-us/azure/architecture/patterns/async-request-reply)
for returning a pending/status result instead of holding a foreground request. Both informed the shape of
the routing and the pending-preparation state; the repository's own contract and acceptance rules remain
authoritative.

## P5 (core midgame mainline ACCEPTED on retained live20 evidence; extended `introduce_evidence` / `source_rebinding` / `bridge_offer` live gate ACCEPTED on retained `midgame-bridge-live-22`)

**Extended gate closed (2026-09-13, later the same day).** The extended `introduce_evidence` → reviewed `source_rebinding` → authority true → unforced `bridge_offer` → player acquisition → `bridge_receipt` → coherent continuation chain is **ACCEPTED** on retained campaign `midgame-bridge-live-22` in worktree `/Users/haoli/leehow/code/chatrpgv4-wt-midgame-bridge`, played with `xai/grok-4.6` at low reasoning effort, this main session as sole player, one natural utterance per turn. Evidence and job ids are in contract §37.8 and [the extended gate working notes](../research/midgame-bridge-live-20260913-notes.md). Two contract-first repairs were required first, both found by that play and both retained as failed evidence on campaign `midgame-bridge-live-21`: **§38**, because a paused continuity review left a turn in `acting` with no lawful draft and `table.player_input` then refused every further utterance, bricking the campaign across restarts; and **§37.6**, because a placement the independent source review contradicted had no lawful next move and reported only a generic failure sentence, so the Keeper prepared the same refused placement again. Versions are now story-thread 1.2.7 and narration-audit 1.2.17. Validation: `npm run check:kernel` passed and `npm run test:ext` 890/890 exit 0 with Node 24.19.0. Human UI acceptance, integration and packaging remain pending/out of scope. Everything below stays valid and historical.

**Prior checkpoint (2026-09-13; acceptance status corrected after evidence loss, then core mainline accepted on retained live20 evidence).** The core midgame causal-logic mainline is **IMPLEMENTED**, its static/code status stands, and its core genuine-play acceptance is **ACCEPTED on the retained `midgame-reentry-live-20` evidence**; the extended live gate is **PENDING**, so P5 as a whole is not complete. The prior primary-acceptance campaign `midgame-reentry-live-18` (runs `midgame-reentry-live-18b-run`, `midgame-reentry-live-18c-run`) had its raw campaign/playtest evidence accidentally deleted by a worktree closeout and is now `invalid-for-acceptance` as independently inspectable raw evidence — an operator evidence-retention failure, not a product pass — and its missing paths are not cited as current evidence. The core acceptance rests on the retained `midgame-reentry-live-20` campaign and runs: turn 2 acquired `globe-unpublished-story` through Ruth Blake's 1918 withheld Globe file after ordinary play; turn 3 stored `misframed` for `house-haunted-by-corbitt` with the exact player frame saying the unrelated tenants were a frightening story and not evidence of Corbitt's will; turn 4 under 1.2.15 exposed the wrong-direction flaw (mode `clarify_known` with known row `globe-unpublished-story`, relation `supports`, quoted to argue the opposite manufactured-scare direction while the audit wrongly passed `acquired_clarification`), kept as failed evidence, not a pass; 1.2.16 adds `relation` to `reentry_review` and exact structural matching to the `known`/bridge relation; turn 5 after upgrade rejected the first wrong-direction candidate (audit job `ea5624057011efd004552bf69e67bf87b1f7633963c66cb8254ae57dad0aeb0`, `reentry_review` none/`relation` null, with a precise fix) and passed the corrected candidate (audit job `8a186efaaa015298f4da7e7a5182e3eda6a346d44ddff53ca6918ec211ef3396`, `acquired_clarification`, clue `globe-unpublished-story`, relation `supports`, no adaptation/new clue); turn 6 passed `player_discharge` (audit job `80d5601af739a1ebbc513820561c88561b8b460f75995d043755d55b755c8ecc`) and stored `aligned` for `house-haunted-by-corbitt` (`memory/story.jsonl`, commit `c3a0d29`) without forcing the player into the house. The live20b final aligned retry was delivered in 16.1 s with only `narrate`, and the whole live20b run was 81.7 s across four driver attempts and seven tool calls. The retained `midgame-reentry-live-19` run is a **semantic-model failure, not acceptance**: DeepSeek classified an active but repeatedly failed investigation as `introduce_evidence` too early. The driver `final_text` on the live20 turn-5 run carries a DeepSeek XML wrapper around the narration, listed as a player-surface/model-output limitation while the kernel turn and audit evidence remain retained. The extended `introduce_evidence` → `source_rebinding` → `bridge_offer` chain has not yet completed in live play, so items 11, 14 and 15 below remain unaccepted and the gate stays separate from the core mainline. Current versions are story-thread 1.2.6 and narration-audit 1.2.16; the current retained evidence worktree is `/Users/haoli/leehow/code/chatrpgv4-wt-midgame-evidence`, which will be locked and retained and must not be closed or deleted. Current 1.2.16 validation passed with Node 24.19.0: `npm run check:kernel`; targeted continuity/adaptation/audit/turn 59/59; targeted relation validation 11/11; full `npm run test:ext` 883/883 exit 0. Earlier adjacent validation passed targeted Python `tests/kernel/test_memory.py` + `tests/play/test_driver.py` 29/29 and the runtime build before the relation-only change; those two gates were not rerun at closeout. Retained evidence is recorded in the [midgame causal re-entry checkpoint](../research/midgame-causal-reentry-2026-09-13.md). Human UI acceptance, integration and packaging remain pending/out of scope. Everything recorded below remains valid and historical and is not rewritten.

**Why reopened.** The earlier COMPLETE label applied only to the prior continuity/adaptation slice — the
shared continuity builder, adaptation routing, scene commitment, pending-preparation ownership and the
continuity-review repair. It was **too broad for the user's actual mainline objective.** The mainline
objective is not "the infrastructure exists"; it is that a midgame player who keeps acting while explicitly
misunderstanding the causal story, or who chooses an ongoing direction detached from every unresolved
critical/core conclusion, is reliably re-entered into the causal thread without being forced back to a
prescribed scene and without losing agency. That loop does not exist yet. Everything above (the
continuity/adaptation checkpoint, the adaptation-routing checkpoint, and their evidence) stays valid and
historical; those checkpoints are not rewritten or deleted. P5 is the new, currently-open work.

**Objective.** A player may keep acting while explicitly misunderstanding the causal story, or may choose an
ongoing direction detached from every unresolved core conclusion. This must be detected semantically
without keyword lists, counters, a new Keeper verb, a new foreground model call, or forcing the player back to
a prescribed scene. The selection is causal, not procedural: the lane receives only unresolved `critical`/
`core` conclusions when any exist, and otherwise only the highest authored importance tier present, so a
lower-importance procedure, hook, route, or presentation conclusion cannot displace a core causal thread.
Informed refusal must be of the core thread — demonstrating understanding of the selected core causal claim
and its present stakes, then knowingly declining — not merely a refusal of a commission, clue, route,
destination, NPC request, or authored hook. `detached` is the state where the player chose an ongoing
direction with no visible path to the selected core thread and has not demonstrated that core understanding;
its response respects the refused hook and brings one source-grounded causal carrier into the chosen
direction, never retrying the refused offer or forcing the authored route. The full versioned wire shape is
contract section 37; it is recorded there before any code change, per the contract-first rule.

**Editable scope (only these).**

- `docs/kernel-rpc.md` section 37 (this slice's contract), this plan, and
  `docs/specs/story-continuity-and-adaptation.md`.
- The existing post-commit memory extraction lane (`memory.job` / `memory.submit`) and kernel memory storage,
  including the new bounded keeper-only `story_context` in the task packet and `memory/story.jsonl`.
- The `story-thread` projection and its Mod text/version, plus the reentry row it emits.
- Capsule and telemetry only where the new assessment/reentry fields require it.
- Focused extension, kernel, and play tests for the new behavior.

**Non-goals.**

- No new top-level Keeper verb; the seven verbs do not change.
- No hardcoded semantic words, keyword tables, regex classification, or comprehension score.
- No mandatory per-turn foreground model call; the detection rides the existing post-commit lane only.
- No rewriting module truth, no silent retcon, no source mutation.
- No forcing player choices, no forced return to a prescribed scene, no chosen response for the investigator.
- No UI, packaging or deployment work until code and true play pass.

**Steps.**

1. Contract first: land section 37 (done at authorization; implementation follows it exactly).
2. Extend `memory.job` with the bounded keeper-only `story_context`; extend `memory.submit` to accept the
   closed `story` object and append `memory/story.jsonl` transactionally. Validate closed shape, exact
   `frame`/`delivery_quote` excerpts, and turn/commit/worldline binding; reject the whole submission on a
   malformed story result; keep replay idempotent; keep correction-only jobs out of story assessment.
3. Project the latest current-worldline `misframed`/`detached` assessment into at most one `story-thread`
   `reentry` row, with the same-row evidence, routes and one English action instruction.
4. Add telemetry/acceptance accounting for assessment status, reentry projected, and `bridge_delivered`,
   without turning offer feedback into an obligation.
5. Focused tests at the existing seams, then true play.
6. Enforce the discharge/realization decision **before delivery** in the enabled continuity audit
   (narration-audit 1.2.10): when `causal_reentry` is projected, an explicit current-input connection to the
   selected core claim and present stakes, or informed refusal at that level, discharges it; otherwise the
   candidate must realize the supplied `bridge` using that exact clue/fact or a source-grounded equivalent
   already authorized by current receipts, and must state how it supports or contradicts the thread claim and
   why it matters now. An analogous invented incident, vague warning, atmosphere, detached recap, route name,
   menu, or a bare claim that preparation is happening is not realization. `bridge_delivered` requires at
   least one acquired supporting/contradicting evidence row on the selected thread: new information must
   first land through its existing clue or handout receipt, and vague warning or atmosphere cannot count.
   Changed placement needs settled reviewed `source_rebinding`; the audit creates neither clue nor receipt.
   When the bridge is unmet it adds one finding naming `causal_reentry.bridge.clue` and sets
   `continuity_review` to `revise`, with no required duplicate conflict.
8. Make the decision a checked sub-review (narration-audit 1.2.11): whenever `context.causal_reentry` exists
   and the overall verdict is not `unavailable`, submit `continuity_review.reentry_review` as
   `{verdict: pass|revise|defer, basis: bridge_receipt|acquired_clarification|player_discharge|preparation_wait|none,
   quote: string|null, clue: string|null}`. `bridge_receipt` passes when current receipts contain the supplied
   bridge clue or one of its source handouts and the candidate realizes it, `clue` exactly copies
   `causal_reentry.bridge.clue`, and `quote` is an exact candidate excerpt explicitly stating the relation and
   current stakes. `acquired_clarification` passes when `causal_reentry.known` is nonempty, `clue` names one
   known row, and `quote` is an exact candidate excerpt explicitly connecting that evidence and the stakes.
   `player_discharge` passes when `causal_reentry.known` is nonempty, `clue` names one known row, and `quote`
   is an exact `current_input` excerpt demonstrating the selected core connection and informed refusal or
   action. `preparation_wait` defers only when `context.preparation_wait` exists, with `clue` null and `quote`
   exactly copying the candidate's honest wait-only notice. `none` revises with `quote` and `clue` null and
   exactly one finding telling the Keeper to settle the supplied bridge authority if needed and then
   explicitly state the relation plus the stakes (superseded by step 12's 1.2.14 stage separation: the `none`
   fix and the blanket receipt rule now name the lawful stage and never demand a receipt or `source_rebinding`
   once authority is true). Overall pass needs a passing `reentry_review` or a
   structural defer; a structured revise overrides a contradictory aggregate pass and is not duplicated as a
   conflict. The shape applies only when `causal_reentry` exists; an ordinary candidate keeps the base output.
7. Deferral is structural, not inferred: a reentry may be deferred for an honest background wait only when
   `context.preparation_wait` exists with `kind` `source` or `adaptation`, which the host passes only from its
   actual retained background state. No receipts, no new mail, an empty/quiet turn, generic waiting, or a
   candidate that merely says preparation is happening can establish pending preparation. When the field
   exists, the candidate must only tell the player that the exact retained preparation is pending and must
   claim no result, movement, new evidence, elapsed fictional time or unrelated event. Without it, a projected
   reentry must be discharged by `current_input` at the selected core causal level or realized from the
   supplied bridge before delivery. `locus_review` schema is unchanged.
9. Project bridge authority from the effective graph (narration-audit 1.2.12): `causal_reentry` carries the current scene plus a boolean establishing whether the effective graph currently makes the supplied bridge clue discoverable there, computed after accepted adaptations and never from model prose or the stale `source_scenes` list. `bridge_receipt` requires both the exact clue/handout receipt and that authority at the current scene; when it is false, `reentry_review` must revise and direct the Keeper to prepare and accept `source_rebinding` first. `acquired_clarification` and `player_discharge` use already acquired evidence and do not require the clue to remain at the current scene; `preparation_wait` and `none` keep their existing meanings. No physical-location enumeration, automatic adaptation or new semantic model call is added; the existing `source_rebinding` rule is closed structurally.
10. Add the two-stage `bridge_offer` basis (narration-audit 1.2.13): once the effective graph says the supplied bridge clue is discoverable at the current scene (`causal_reentry.authority.clue_here` is `true`) and there is no current bridge clue/source-handout receipt, the Keeper may put the exact carrier within reach, state how it bears on the selected causal claim and why the choice matters now, and stop with the choice still with the player. The `bridge_offer` basis uses verdict `defer`, `clue` exactly equal to `causal_reentry.bridge.clue`, and `quote` an exact candidate excerpt expressing the carrier, causal bearing, current stakes and open player choice; it must claim no taking, reading, accepting, spending time on, believing or acting on the evidence, mints no clue/handout receipt and never counts as `bridge_delivered`. Overall pass may carry this structural defer. The post-commit assessment remains `bridge_delivered` false, so the next turn retains the reentry until the player acts or a later valid discharge occurs. `bridge_receipt` still requires a receipt and authority; `acquired_clarification`/`player_discharge`/`preparation_wait`/`none` keep their meanings. No new Keeper verb, lane, forced clue, automatic adaptation, physical-place list or opaque id is added.
11. Make `story-thread` 1.2.4 (carried unchanged by 1.2.5) the Keeper/action consumer of the 1.2.13 `bridge_offer` basis: its Mod text reads `causal_reentry.authority.clue_here` and the current `current_input` and tells the Keeper to (a) prepare/accept `source_rebinding` before asserting the carrier arrived when authority is false; (b) once it is true and the player explicitly chose to receive/read/examine the bridge, settle only the exact clue and/or source handout receipt that chosen action needs and then state the causal relation and current stakes, without bundling extra item transfer, elapsed reading time, movement or another unchosen commitment; (c) otherwise, when the player did not choose it, force no receipt and narrate an unforced `bridge_offer` — exact carrier within reach, its bearing on the selected causal claim, why the choice matters now — and stop with the choice open, claiming no taking/reading/accepting/spending/believing/acting and minting no receipt; and (d) after action admission refuses a bundled/unchosen acquisition, honor the refusal and use the `bridge_offer` path when authority is true, without resending the batch or replacing it with unrelated ordinary pacing. The three ends are tied explicitly: the effective graph/adaptation layer writes authority, the audit reads/verifies `bridge_offer`, and `story-thread` tells the Keeper what action to take.
15. Clarify in the Mod text (story-thread 1.2.4; carried unchanged by 1.2.5) that a `new_destination` scene's initial description saying it has no scenario clue records only its creation-time graph state and is not a permanent prohibition, so a later reviewed `source_rebinding` is precisely the authorized way to add an existing clue's delivery relation there. When `authority.clue_here` is `false`, the Keeper follows the projected bridge and prepares `source_rebinding`, and never creates a flag, ruling, note or new adaptation whose purpose is to forbid the bridge, freeze the scene as clue-free, or override the reentry, because none of these can supersede source graph/adaptation authority. Player agency is preserved after rebinding: use `bridge_offer` when the player has not chosen acquisition, or the minimal receipt path when they have. Retained live evidence is `midgame-reentry-live-16c-run` around open campaign turn 2, where after the Athens destination acceptance and move the Keeper read the scene's initial no-clue description as permanent, attempted rejected flag/ruling writes forbidding source clues, and omitted the required `source_rebinding`; item 15 stays unaccepted until a retest records the bridge reached through a reviewed `source_rebinding` at that scene.
12. Separate the two stages without ambiguity and version the clarification (narration-audit 1.2.14), because retained `midgame-reentry-live-15h-run` showed the reviewer still applying the old receipt-first rule to an authority-true offer. **Placement/offer stage:** when `causal_reentry.authority.clue_here` is `true` and there is no current bridge clue or source-handout receipt, the effective graph already authorizes the exact carrier to appear at this scene; a compliant candidate may show the carrier's visible identity/provenance and explain how examining it could bear on the selected causal claim and the current stakes while leaving taking/opening/reading/accepting/spending/believing/acting to the player, and it MUST be reviewed as `bridge_offer` `defer`. It needs no clue/handout receipt, never counts as `bridge_delivered`, and must not be told to `source_rebind` again. **Acquisition/delivery stage:** quoting or realizing the evidence contents as learned, or claiming acquisition, requires its clue/source-handout receipt and then uses `bridge_receipt` pass; `bridge_delivered` continues to require acquired evidence. The old blanket sentence that new evidence always needs a receipt now refers specifically to acquired/read contents and is explicitly subordinate to the `bridge_offer` exception. When `authority.clue_here` is `false`, `source_rebinding` is required; when it is `true`, it is never required again and a compliant offer is never revised for a missing receipt. Examples and the `none`/overall-pass findings guidance are updated so an authority-true compliant offer cannot be revised merely for missing a receipt. No schema, basis or field changes; the three docs, this plan and the Mod text carry the clarification, and item 11 stays unaccepted until a retest records an offer the player takes up.
13. Retain host-owned `preparation_wait` across subsequent explicit player inputs (P5, retained live evidence `midgame-reentry-live-16-run`, around campaign turn 2). While the same background source/adaptation job remains pending or reviewing in the same live process, `preparation_wait` survives later player inputs; a new input clears only review/admission attempt state (new context, `current_input`) and must not clear a real preparation wait. Only an explicit `ready`/`failed`/`cancelled` status, or an explicit `cancel`/nonpending adaptation result, clears it; until then only adaptation `status`/`cancel` controls and an honest wait-only `narrate` are allowed, and the audit receives the same `preparation_wait`. This adds no second task registry and never infers waiting from prose; it preserves the existing host-owned state until the job reports a terminal/nonpending status, and item 13 stays unaccepted until a retest shows a later input keeping the wait and an honest wait accepted with it.
14. Cold-resume recovery routing over the existing adaptation surface (P5, retained live evidence `midgame-reentry-live-16b-run`, around campaign turn 2). Reuse `lookup kind adaptation action status` with an **optional** `name`: with a name it keeps current behavior; without one it returns the most recent retained current proposal for the bound campaign whose status is `pending`, `reviewing`, `ready`, `failed` or `stale` under its semantic name, or status `none` when none is retained. `accepted`/`cancelled` proposals are settled, not recovery work. The no-name form never returns hashes, digests, task keys or retained task/work paths. On each explicit player input with no in-memory `preparation_wait`, the host asks this no-name status once: a retained `pending`/`reviewing` proposal restores `preparation_wait`; a retained `ready`/`failed`/`stale` proposal restores a short host-owned adaptation control state that blocks ordinary Keeper tools until the Keeper calls `status` with the supplied semantic name, whose explicit result clears the control and allows accept/continue or a same-name retry. The host calls no model to discover this, infers nothing from prose, and when several proposals are retained chooses the newest deterministically by creation time then semantic name. This is recovery routing only — it never accepts or retries a proposal on its own — and adds no new Keeper verb, second registry, opaque identifier or automatic adaptation. Item 14 stays unaccepted until a retest recovers a retained proposal after restart without the Keeper knowing its name in advance.
16. Add the deterministic reentry mode to the same row (story-thread 1.2.5; narration-audit 1.2.15): `mode: clarify_known | introduce_evidence`, selected by the kernel from the acquired evidence on the chosen thread plus the prior same-worldline/loop/thread assessments. `clarify_known` when the chosen thread has acquired known evidence and no earlier assessment on that line/loop/thread before the current one recorded `bridge_delivered: true`: the row needs no new bridge, and the Keeper must use one known evidence row, explicitly state how it supports or contradicts the selected core claim **in that row's own `relation` direction** and why it matters now, then continue the player's chosen action — opening no adaptation and inventing or delivering no new clue. `introduce_evidence` when `known` is empty, or when an earlier assessment on that line/loop/thread already recorded `bridge_delivered: true` and a later player frame is still `misframed`/`detached`: keep the existing concrete bridge, authority, `source_rebinding`, `bridge_offer` and `bridge_receipt` flow, in the bridge's own relation direction. Physical location never decides the mode; `bridge_delivered` remains the post-commit feedback. narration-audit 1.2.15 accepts only `acquired_clarification` or `player_discharge` under `clarify_known` (neither may revise; no bridge receipt/offer or source rebinding may be demanded) and keeps `bridge_receipt`/`bridge_offer` for `introduce_evidence`. Tied together: the kernel writes the mode from acquired evidence plus prior story assessments, `story-thread` acts on it, and narration-audit 1.2.15 validates the permitted basis. No new lane, Keeper verb, semantic regex/list, counter, physical-place list or automatic adaptation. Retained live evidence `midgame-reentry-live-17b-run` turn 6 (player held `globe-unpublished-story`, explicitly `misframed` about `house-haunted-by-corbitt`; the Keeper opened `source_rebinding` for `dooley-macario-madness` instead of clarifying the existing article, 46.5 s undelivered) motivates this; item 16 stays unaccepted until a retest records a first misunderstanding with known evidence completing without adaptation and, after a successful clarification, a later renewed misframe introducing exactly one new source-grounded bridge.
17. Carry the selected evidence's `relation` in the checked `reentry_review` (story-thread 1.2.6; narration-audit 1.2.16), without a new lane, verb or semantic logic. `acquired_clarification` and `player_discharge` set `clue` to one row in `causal_reentry.known` and `relation` exactly to that row's relation, and the quote must use that evidence in that row's own direction: a `supports` row may not be quoted to argue against the selected thread and a `contradicts` row may not be quoted to argue for it. `bridge_receipt` and `bridge_offer` set `relation` exactly to `causal_reentry.bridge.relation`. `preparation_wait` and `none` set `relation` to `null`. The Mod text tells the Keeper to state a `clarify_known` row's relation in that row's own direction and to realize an `introduce_evidence` bridge in its own relation direction. Retained live evidence `midgame-reentry-live-20-run` turn 5 (mode `clarify_known`, known row `globe-unpublished-story` with `relation: supports`, candidate quoted it to argue a manufactured-scare/no-Corbitt reading, audit wrongly passed `acquired_clarification`) motivates this; that failure is preserved, and item 17 is now satisfied by the retained live20 retest after the 1.2.16 upgrade, where turn 5 rejected the first wrong-direction candidate (audit job `ea5624057011efd004552bf69e67bf87b1f7633963c66cb8254ae57dad0aeb0`) and passed the corrected clarification argued in the selected row's own direction (audit job `8a186efaaa015298f4da7e7a5182e3eda6a346d44ddff53ca6918ec211ef3396`, `acquired_clarification`, clue `globe-unpublished-story`, relation `supports`) and turn 6 passed `player_discharge`.

**Retained live finding that motivated the 1.2.4 creation-time no-clue rule (`midgame-reentry-live-16c-run`, around open campaign turn 2; not yet fixed or accepted).** After the Athens destination acceptance and move, the Keeper read the `new_destination` scene's initial no-clue description as a permanent prohibition, attempted rejected flag/ruling writes forbidding source clues there, and omitted the required `source_rebinding`, so the projected bridge never reached the scene. This is retained as failed evidence, not a pass: such a description records only the scene's creation-time graph state, and a later reviewed `source_rebinding` is precisely the authorized way to add an existing clue's delivery relation there. When `authority.clue_here` is `false` the Keeper follows the projected bridge and prepares `source_rebinding`, and never creates a flag, ruling, note or new adaptation whose purpose is to forbid the bridge, freeze the scene as clue-free, or override the reentry, since none of these can supersede source graph/adaptation authority. Player agency is preserved after rebinding: use `bridge_offer` when the player has not chosen acquisition, or the minimal receipt path when they have. `story-thread` **1.2.5** carries the rule; item 15 stays unaccepted until a retest records the bridge reached through a reviewed `source_rebinding` at that scene.

**Retained live finding that motivated the deterministic reentry mode (`midgame-reentry-live-17b-run`, turn 6; not yet fixed or accepted).** The player already held `globe-unpublished-story` as acquired evidence (`acquired: true`, delivery turn 4) and was explicitly `misframed` about `house-haunted-by-corbitt`. The Keeper did not clarify the article the player already held; it tried to open `source_rebinding` for `dooley-macario-madness` at the newspaper morgue, which `causal_reentry.authority.clue_here` did not yet authorize there, so the reviewer revised `reentry_review` `{verdict: revise, basis: none}` and the turn was not delivered, costing 46.5 s (`wall_seconds` 46.499, `settle_class` `undelivered_with_tools`). This is retained as failed evidence, not a pass: the first misunderstanding on a thread the player already holds evidence for needs no adapted bridge, so `mode: clarify_known` now tells the Keeper to connect one known row and continue the chosen action without opening adaptation. `mode: introduce_evidence` is confined to a thread with no acquired evidence or to a renewed misframe/detachment after a prior assessment recorded `bridge_delivered: true`, so it never repeats the same clarification after renewed deviation while avoiding graph work on the first misunderstanding. Item 16 stays unaccepted until a retest records a first misunderstanding with known evidence completing without adaptation and, after a successful clarification, a later renewed misframe introducing exactly one new source-grounded bridge.

**Retained live finding that motivated cold-resume recovery routing (`midgame-reentry-live-16b-run`, around campaign turn 2; not yet fixed or accepted).** After the process restarted, the prior adaptation was no longer in host memory and the Keeper did not know its semantic name. The player asked to inspect that preparation, but the Keeper ignored the request and repeatedly narrated an unverifiable wait. This is retained as failed evidence, not a pass: recovery must not depend on the Keeper remembering a name from the previous process, so `status` takes an optional name and the no-name form returns the most recent retained current proposal under its semantic name, with the host asking it once per explicit input and restoring either `preparation_wait` or the short host-owned control state. Item 14 stays unaccepted until retest.

**Retained live finding that motivated structural deferral (`midgame-reentry-live-15`, turn 5; not yet fixed
or accepted).** `causal_reentry` was present in the audit context (assessment of turn 4, `detached`), but the
auditor passed a quiet no-new-mail scene by incorrectly treating the absence of receipts as a
pending-preparation deferral. No `context.preparation_wait` existed, no clue or handout receipt had landed,
and the next assessment had not yet established success. This motivates the structural
`context.preparation_wait` field; it is retained as a failure, not a pass, and the slice remains **not**
accepted with retest pending.

**Retained live finding that motivated the checked sub-review (`midgame-reentry-live-15`, turn 6; not yet
fixed or accepted).** `causal_reentry` was present in the audit context, no `context.preparation_wait`
existed, and neither a clue or handout receipt nor any acquired known evidence had landed, yet the reviewer
claimed a generic Chandler Street item discharged the bridge and passed. No supplied bridge clue was carried
and no acquired evidence was connected, so this was not a discharge. This proves that prose-only audit
guidance was insufficient and motivates the checked `reentry_review` sub-review (narration-audit 1.2.11); it
is failed evidence, not a pass, and the slice remains **not** accepted with retest pending.

**Retained live finding that motivated pre-delivery enforcement (`midgame-reentry-live-15`, turn 4; not yet
fixed or accepted).** The projection correctly supplied a concrete `bridge` on `globe-unpublished-story`
(the unpublished 1918 Globe feature on prior tenants ruined by accidents, illness and suicide, carried by
handout `globe-unpublished-1918` in the `newspaper-morgue`). The turn-4 candidate instead delivered an
invented Chandler Street newspaper analogy with no clue receipt and did not connect it to Corbitt or to the
bridge. The post-commit assessment correctly kept `story_status: detached` and `bridge_delivered: false`.
Recording this as the reason to enforce the decision before delivery; it is **not** claimed fixed or accepted
until a retest runs.

**Retained live finding that exposed the `story_context` acquired-evidence seam (`midgame-reentry-live-15`, turn 7; not yet fixed or accepted).** Turn 7 delivered the exact selected bridge through a handout receipt: `the-haunting-handout-9-chapel-symbol`, a `player-safe` drawing whose graph relation `supports` the clue `clue-chapel-eye-symbol`, was shown and settled as `handout:the-haunting-handout-9-chapel-symbol-t7`, and the pre-delivery `reentry_review` correctly passed. The post-commit `story_context` reconstructed only `discovered_clues` and omitted `handouts_shown`, so it exposed zero acquired evidence and the stored assessment returned `unclear` with `bridge_delivered: false` even though the bridge had landed. This is the retained failed acceptance evidence for the acquired-evidence predicate below; it is not claimed fixed or accepted, and P5 stays in progress with retest pending.

**Retained live finding that motivated kernel-projected bridge authority (`midgame-reentry-live-15`, turn 7; not yet fixed or accepted).** The same turn showed the Keeper could hand out the selected source handout at Athens without first accepting `source_rebinding`, even though the bridge clue was source-located at the Chapel ruins; the handout receipt made the checked audit pass, so prose guidance alone did not enforce the existing placement rule. narration-audit 1.2.12 therefore projects bridge authority under `causal_reentry`: the current scene plus a boolean establishing whether the effective graph currently makes the bridge clue discoverable there, computed from the effective graph after accepted adaptations, never from model prose or the stale `source_scenes` list, so the source-authored location ranking cannot override an accepted rebinding and narration cannot override the graph. `bridge_receipt` now requires both the exact clue/handout receipt and bridge authority at the current scene; when authority is false it must revise and direct the Keeper to prepare and accept `source_rebinding` first, while `acquired_clarification` and `player_discharge` use already acquired evidence and do not require the clue to remain at the current scene, and `preparation_wait` and `none` keep their existing meanings. This adds no physical-location enumeration, automatic adaptation or new semantic model call; it closes the existing `source_rebinding` rule structurally. The turn is retained as failed evidence and P5 stays in progress until retest.

**Retained live finding that motivated retaining host-owned `preparation_wait` across player inputs (`midgame-reentry-live-16-run`, around campaign turn 2; not yet fixed or accepted).** The run showed `athens-hayes-1920` still running, yet `before_agent_start` cleared `preparationWait` when the next explicit player input arrived. An honest wait-only `narrate` then lacked `context.preparation_wait` and was rejected, and a second `source_rebinding` could not start because the first job still owned preparation. Host-owned `preparation_wait` is retained across subsequent explicit player inputs while the same background source/adaptation job remains pending or reviewing in the same live process: a new player input clears review/admission attempt state (new context, `current_input`) but not a real preparation wait. Only an explicit `ready`/`failed`/`cancelled` status (or an explicit `cancel`/nonpending adaptation result) clears it; until then only adaptation `status`/`cancel` controls and an honest wait-only `narrate` are allowed, and the audit receives the same `preparation_wait`. This adds no second task registry and never infers waiting from prose; it is retained as failed evidence, not a pass, and P5 stays in progress until retest.

**Retained live false-revision finding that motivated the 1.2.14 stage separation (`midgame-reentry-live-15h-run`, driver attempts around campaign turn 9; not yet fixed or accepted).** This run (`2026-09-13T06:30:55Z`, four undelivered turns, all `agent_settled`) reached the offer stage repeatedly. `causal_reentry.authority.clue_here` was already `true` after the accepted `source_rebinding`, and the candidates put the exact Globe carrier within reach and explained its bearing: the landlady's forwarded stack with the difference in paper and heading, then the statement that the hard loose sheets are a set-and-corrected but never-printed editorial proof on the same Chandler Street address, followed by how that class of evidence would bear on the selected causal claim and why the choice matters now — while explicitly leaving the reading to the player. The reviewer nevertheless returned `reentry_review` `{verdict: revise, basis: none, quote: null, clue: null}` on every attempt, invoked the old receipt-first rule ("new information lands through prose alone rather than through its existing clue/handout"), and in one attempt demanded `source_rebinding` again although authority was true. Action admission also refused two of the attempts and one review paused after the first refusal, so none of them was delivered. This is retained as failed evidence, not a pass: an authority-true compliant offer is the placement/offer stage, is reviewed as `bridge_offer` `defer`, needs no receipt, and must not be told to `source_rebind` again. narration-audit 1.2.14 therefore states the two stages without ambiguity, scopes the receipt rule to acquired/read contents, and makes it explicitly subordinate to the `bridge_offer` exception. P5 stays in progress until retest.

**Retained live finding that motivated two-stage `bridge_offer` (`midgame-reentry-live-15f-run`, driver attempts 2-4 around campaign turn 9; not yet fixed or accepted).** The run accepted `source_rebinding` for `globe-unpublished-story` into the Athens pension (adaptation receipt `7f1866baa199b5ae`), so `causal_reentry.authority.clue_here` became `true`. The Keeper then bundled clue, handout, item transfer and 25 minutes of reading into one batch, which action admission correctly refused because the player had chosen only to mail the travel pages and had not chosen to receive or read the clipping. The continuity audit then rejected a narration that merely offered the newly available clipping, so the Keeper had no lawful way to put the missing choice into the fiction and the turn stayed undelivered. This is retained as failed evidence, not a pass: the rules forbade settling a choice the player had not made while also forbidding offering it. Narration-audit 1.2.13 adds the `bridge_offer` basis to close this seam, and P5 stays in progress until retest. The same run then omitted the carrier entirely after admission refused the forced batch, which is the retained follow-on finding that motivated making `story-thread` **1.2.4** (carried unchanged by 1.2.5) the Keeper/action consumer of the 1.2.13 basis; the audit basis is inert without that explicit action instruction. The three ends of the loop are recorded together: the effective graph/adaptation layer writes authority (settled `source_rebinding` sets `causal_reentry.authority.clue_here`), the audit reads/verifies `bridge_offer`, and `story-thread` 1.2.5 tells the Keeper what action to take for the current authority and `current_input`.

**Acquired-evidence predicate (contract section 37.2/37.3).** `story_context`, the continuity/story projections and every later consumer reconstruct acquisition from receipts through the assessed turn: a clue is acquired when the clue itself was discovered **or** a shown handout connected to it by the closed `supports`/`depicts` graph roles was delivered, and `delivery_turn` may come from either the clue receipt or the carrier handout receipt. A shown handout is a carrier of that clue for causal understanding only — it does not silently add a clue receipt, rewrite `discovered_clues`, or collapse the two identities — and `handouts_shown` alone is not acquired evidence. The same predicate is used for thread ranking, known evidence (`known`), missing-bridge selection, post-commit validation and next-turn reentry so audit and feedback agree; it introduces no new entity, lane, verb or general transitive inference. The already-recorded GUMSHOE precedent for movable clue presentation supports a carrier-based reading, without adding a dependency or any automatic-clue rule.

**Retained live evidence that exposed the `story_assessment_context` budget seam (`midgame-reentry-live-18`, turn 3; not yet fixed or accepted).** In turn 3 the pre-delivery audit correctly saw `globe-unpublished-story` as acquired and passed `acquired_clarification`, but the memory job's full continuity connection for that thread exceeded its 7KB per-context budget and was dropped whole instead of being trimmed to its compact row, so all `story_context` supporting rows were empty and the DeepSeek lane failed the shape check instead of recording `bridge_delivered`. This is retained failed evidence, not a pass: the packet's thread rows must be the existing compact continuity evidence projection (evidence name, `supports`/`contradicts` relation, `acquired` flag, latest `delivery_turn`), with full source refs, claims, prose and NPC dossiers left out of the lane packet, and the per-context byte budget must trim optional rows and must never erase all acquired evidence from a selected thread merely because one full connection exceeds the budget. This is input compaction, not new semantic inference, memory storage or a model call. P5 stays in progress until a backfill/retest successfully records the assessment from the trimmed packet.

**Live finding that reopened the wording (2026-09).** In a live midgame turn the player explicitly refused
Knott's commission. The lane classified that refusal as aligned to the minor commission-and-research-frame
thread: the hook refusal was respected but the core haunting story disappeared. Implementation action was to
supply only unresolved critical/core threads when any exist and otherwise only the highest authored tier. This
is recorded as the reason for the refinement; it is **not** claimed fixed or accepted until a retest runs.
Recorded shape: `story_context.threads` entries are `{thread, claim, importance, supporting:[{evidence,
delivery_turn}], contradicting:[…]}`, with `last_assessment` and optional `truncated`; importance is authored;
the stored assessment binds worldline and loop. The current extension requires `story` when `story_context`
has threads; kernel validation stays backward compatible with an already-open job from an older bundled host
that omits `story` — omission writes no assessment and never invents alignment.

**Acceptance.** Same as contract section 37.5: active wrong theory with nonzero receipts and stall counters
zero produces `misframed` then a grounded reentry within the next turn; facts-without-connection reentry
explains the relation and stakes rather than repeating clues; informed refusal of the selected core thread
produces `aligned`/no compulsory beat (a shallow refusal of a hook, commission, clue, route or NPC request is
not such a refusal); quiet play/short answer/one-turn side action produces `unclear`/no compulsory beat;
persistent departure (such as another city) produces `detached` plus a source-grounded rebind into that chosen
direction, no forced return, no retry of the refused offer, no arbitrary copy of the whole module; after
bridge delivery no repeat until later input is assessed, and renewed misunderstanding can produce a new
reentry; restart/worldline keeps only the matching latest assessment and replay does not duplicate; lane
failure/malformed output leaves gameplay available and backlog evidence retained without inventing alignment;
a bridge delivered through a shown carrier handout connected to its clue by the closed `supports`/`depicts`
roles is read back as acquired evidence by thread ranking, `known`, bridge selection, post-commit validation
and next-turn reentry, so audit and feedback agree and a delivered bridge is not reported as zero acquired
because the packet's per-context byte budget dropped a whole connection instead of trimming optional rows —
the lane packet uses the compact continuity evidence projection (evidence name, supports/contradicts,
acquired, latest delivery turn) and never keeps full source refs, claims, prose or NPC dossiers; a bridge handout at a scene the effective graph does not make discoverable is refused by the
kernel-projected bridge-authority boolean unless reviewed `source_rebinding` was accepted first, so handing out
a source-located carrier without settling its placement cannot pass; once bridge authority is true and no
bridge clue/source-handout receipt exists, a candidate that puts the exact carrier within reach, states its
causal bearing and the current stakes and leaves the choice open is a structural `bridge_offer` defer rather
than a revise, claims no taking/reading/accepting/spending/believing/acting on the evidence, mints no receipt
and never counts as `bridge_delivered`, so the next turn retains the reentry until the player acts and the
acquisition/delivery stage — quoting or realizing the contents as learned — alone requires the clue/source-handout
receipt and `bridge_receipt`, while the placement/offer stage needs no receipt and no further
`source_rebinding` because the accepted rebinding already authorizes placement;
true play uses `tests/play/driver.py`, this main session as sole player, one natural utterance per turn; the
remaining extended gate may use `xai/grok-4.6` at low reasoning effort, selected before activation and fixed
for the run, covering active wrong theory with nonzero receipts, informed refusal of the core thread, a
detached ongoing direction, a delivered causal bridge, renewed deviation, and eventual coherent continuation
— no fake Keeper/scripted player and no Astra.

Implementation is in place; acceptance is **not** claimed yet. The retained turn-7 zero-evidence failure is the
current failed acceptance evidence for the shared acquired-evidence predicate, and the same turn's handout at
Athens without accepted `source_rebinding` is the failed evidence for kernel-projected bridge authority; the
retained `midgame-reentry-live-15f-run` attempts 2-4 around campaign turn 9 are the failed evidence for
two-stage `bridge_offer`, because the Keeper could neither settle the unchosen reading nor lawfully offer it in
fiction, and the same run's subsequent omission of the carrier is the pair of failed evidence that motivated
making `story-thread` 1.2.4 the Keeper/action consumer of the 1.2.13 basis; the retained
`midgame-reentry-live-15h-run` attempts around campaign turn 9 are the failed evidence for the 1.2.14 stage
separation, because the candidates did reach a compliant authority-true offer and the reviewer still revised
them for a missing receipt and once demanded `source_rebinding` again. The retained `midgame-reentry-live-16-run`
around campaign turn 2 is the failed evidence for retaining host-owned `preparation_wait` across player inputs:
the job was still running when a later input cleared `preparationWait`, so an honest wait lacked
`context.preparation_wait` and was rejected and a second `source_rebinding` could not start while the first job
owned preparation. The retained `midgame-reentry-live-16b-run` around campaign turn 2 is the failed evidence
for cold-resume recovery routing: after the process restarted the prior adaptation was no longer in host
memory, the Keeper did not know its semantic name, ignored the player's request to inspect it, and repeatedly
narrated an unverifiable wait. The retained `midgame-reentry-live-16c-run` around open campaign turn 2 is the failed evidence for the story-thread 1.2.4 creation-time no-clue rule: after the Athens destination acceptance and move the Keeper read the scene's initial no-clue description as permanent, attempted rejected flag/ruling writes forbidding source clues, and omitted the required `source_rebinding`. The retained `midgame-reentry-live-17b-run` turn 6 is the failed evidence for the deterministic reentry mode: the player had acquired `globe-unpublished-story` and was explicitly `misframed` about `house-haunted-by-corbitt`, but the Keeper opened `source_rebinding` for `dooley-macario-madness` instead of clarifying the existing article, and the turn stayed undelivered (`wall_seconds` 46.499). The retained `midgame-reentry-live-18` turn 3 is the failed evidence for the `story_assessment_context` input-compaction seam: the pre-delivery audit correctly saw `globe-unpublished-story` as acquired and passed `acquired_clarification`, but the memory job's full continuity connection exceeded its 7KB budget and was dropped whole, so all `story_context` supporting rows were empty and the lane failed shape instead of recording `bridge_delivered`. P5 remains open until a retest receives a later input keeping the retained `preparation_wait`,
an honest
wait accepted with it, and it cleared only by an explicit `ready`/`failed`/`cancelled` status (or an explicit
`cancel`/nonpending adaptation result), and until a retest recovers a retained proposal after restart with the
no-name `status` when the Keeper does not know its name, and until a retest
delivers a `bridge_offer` whose choice the player's next chosen action
takes up, until a retest records the bridge reached through a reviewed `source_rebinding` at that
`new_destination` scene, and until a retest records a first misunderstanding with known evidence completing
without adaptation followed by a later renewed misframe introducing exactly one new source-grounded bridge,
and until a backfill/retest records the story assessment from the trimmed compact packet for
`midgame-reentry-live-18` turn 3.
The §36 infrastructure checkpoints above remain historical.

**Current checkpoint (2026-09-13; acceptance status corrected after evidence loss, then core mainline accepted on retained live20 evidence), appended without rewriting the paragraphs above.** The core midgame causal-logic mainline is IMPLEMENTED, its static/code status stands, and its core genuine-play acceptance is **ACCEPTED on the retained `midgame-reentry-live-20` evidence**; the extended live gate is PENDING, so P5 as a whole is not complete. The prior primary-acceptance campaign `midgame-reentry-live-18` (runs `midgame-reentry-live-18b-run`, `midgame-reentry-live-18c-run`) had its raw campaign/playtest evidence accidentally deleted by a worktree closeout, so its reported turn-2 `misframed` frame, turn-3 `clarify_known` delivery in 15.948 s passing `acquired_clarification`, and turn-4 `player_discharge`/`aligned` results are now `invalid-for-acceptance` as independently inspectable raw evidence and retained only as historical claims — an operator evidence-retention failure, not a product pass; their missing paths are not cited as current evidence. The accepted result rests on the retained `midgame-reentry-live-20` campaign and runs: turn 2 acquired `globe-unpublished-story` through Ruth Blake's 1918 withheld Globe file after ordinary play; turn 3 stored `misframed` for `house-haunted-by-corbitt`; turn 4 under 1.2.15 exposed the wrong-direction flaw (wrong-direction `supports` clarification passed as `acquired_clarification`), kept as failed evidence, not a pass; 1.2.16 adds `relation` to `reentry_review` and exact structural matching; turn 5 after upgrade rejected the first wrong-direction candidate (audit job `ea5624057011efd004552bf69e67bf87b1f7633963c66cb8254ae57dad0aeb0`) and passed the corrected candidate (audit job `8a186efaaa015298f4da7e7a5182e3eda6a346d44ddff53ca6918ec211ef3396`, `acquired_clarification`, clue `globe-unpublished-story`, relation `supports`); turn 6 passed `player_discharge` (audit job `80d5601af739a1ebbc513820561c88561b8b460f75995d043755d55b755c8ecc`) and stored `aligned` (`memory/story.jsonl`, commit `c3a0d29`) without forcing the player into the house. The live20b final aligned retry was delivered in 16.1 s with only `narrate`; the whole live20b run was 81.7 s across four driver attempts and seven tool calls. The retained `midgame-reentry-live-19` run is a semantic-model failure (DeepSeek classified an active but repeatedly failed investigation as `introduce_evidence` too early), not acceptance. The driver `final_text` on the live20 turn-5 run carries a DeepSeek XML wrapper around the narration, a player-surface/model-output limitation while the kernel turn and audit evidence remain retained. The retained `midgame-reentry-live-19` and `midgame-reentry-live-20` campaigns and playtest runs remain preserved in this evidence worktree, and no evidence in it was deleted. Current versions are story-thread 1.2.6 and narration-audit 1.2.16. The current retained evidence worktree is `/Users/haoli/leehow/code/chatrpgv4-wt-midgame-evidence`; it will be locked and retained and must not be closed or deleted. The extended `introduce_evidence` / `source_rebinding` / `bridge_offer` chain has not completed in live play, so items 11, 14 and 15 remain unaccepted and that gate stays pending and separate from the core mainline. Current 1.2.16 validation passed with Node 24.19.0: `npm run check:kernel`; targeted continuity/adaptation/audit/turn 59/59; targeted relation validation 11/11; full `npm run test:ext` 883/883 exit 0. Earlier adjacent validation passed targeted Python `tests/kernel/test_memory.py` + `tests/play/test_driver.py` 29/29 and the runtime build before the relation-only change; those two gates were not rerun at closeout. No Astra or Grok run was started. Human UI acceptance, integration and packaging remain pending/out of scope. Retained evidence: [midgame causal re-entry checkpoint](../research/midgame-causal-reentry-2026-09-13.md).
