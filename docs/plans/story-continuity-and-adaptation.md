# Story continuity and adaptation — authoritative repair plan

_Status: P0-P3 IMPLEMENTED; P4 code, fixed-input and genuine-play gates completed. Human UI acceptance and integration remain PENDING. This is the single execution plan. Current results: [repair report](../research/continuity-review-repair-2026-09-12.md). Wire contract: docs/kernel-rpc.md section 36.14._

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
utterance at a time, DeepSeek Flash only (no Astra/Grok). Preserve refusal of the bible,
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

Current audit version is **narration-audit 1.2.8** (with enhanced-items 1.1.9). The version moves because
two rules landed on the same contract section: the scene-commitment heading is now 1.2.8 (carried from
1.2.7), and the pending-preparation turn rule is new. Older headings and their evidence remain valid as
historical descriptions.

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
