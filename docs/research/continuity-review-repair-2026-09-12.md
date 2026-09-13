# Continuity review repair — implementation and acceptance

Date: 2026-09-12. Owned branch: codex/story-continuity. Product commits: 5817faf1, 9c124aaa, 5499b4d0, bc1d2aa1. Current Mods: narration-audit 1.2.4 and enhanced-items 1.1.9. P0-P3 implemented; P4 code, fixed-input and genuine-play gates exercised. Human UI acceptance and integration into 0.9.2a remain pending. No package, deployment or remote publication was performed.

## Result and corrected criterion

The audit now checks material conflicts with settled history, player choices, receipts and world state. A coherent new campaign detail is allowed without a literal module quotation. Faithful recap remains required; NPC assertions and player hypotheses retain attribution. The immutable module remains provenance, not an exhaustive permission list for fiction. Legacy audit.source.v1 artifacts and locked Mod versions keep their historical meaning; audit.continuity.v1 is an explicit versioned adoption.

The confirmed latency defect was repeated model work, not a 15-minute idle sleep: the old five actual turns took 932.057s, of which narrate/audit consumed 842.439s. Nine jobs started thirteen Pi attempts, with 344 reviewer responses and 399 tools. Actual tool execution was only 21.406s. The task demanded exhaustive positive source proof, gave oversized raw files, encouraged schema exploration, conflated artifact errors with story conflicts, and renewed nested retry allowances. The driver also ended one wait prematurely at 99.207s although actual completion was 361.988s. Original evidence is unchanged.

## Implemented behavior

- Focused context supplies current input, kernel clock, receipts, actors and executable equipment, attributed memory, corrections, recent player inputs and deliveries, and relevant source relations. Full pinned files remain available with explicit truncation. The private read_audit_evidence tool supports names or turn numbers without JSON-schema guessing.
- Checked submit_audit validates the complete result and ends the private agent through the supported Pi termination API. Deterministic errors return exact paths, files and excerpts together. One local artifact repair does not trigger a Keeper rewrite. One submit-only reminder remains inside the same session allowance.
- A review uses at most six provider requests; the automatic chain shares twelve requests and thirty seconds of active review allowance, one semantic rewrite and one artifact repair. Counters survive restart. Reservations are charged before launch; an interrupted review cannot refund itself. A later explicit player retry is linked to retained accounting.
- Provider-hook exceptions alone are swallowed by Pi, so the limiter also aborts the actual request context. An unavailable marker defeats a later submission. Explicit and implicit delivery share the gate and cannot publish rejected prose as an approved fallback.
- Cold recovery calls internal mods.review.status before running the Keeper. A paused or interrupted review suppresses automatic recovery work, avoiding duplicate time/threat effects. New player input can retry the retained turn. No new Keeper verb or memory database was added.
- The driver cancels a premature agent_end fallback when work resumes, prefers actual kernel delivery, and retains rejected drafts as evidence.

## Validation

All model probes and genuine Keeper/lane work used deepseek/deepseek-v4-flash with thinking off. No Astra or Grok test calls were used.

| Gate | Observed result |
| --- | --- |
| Driver event/delivery regressions | 14/14 passed |
| Kernel Mod, memory and capsule regressions | 50/50 passed |
| Final full extension suite | 850/850 passed, 46.1s, zero skips |
| TypeScript check and runtime build | Passed |
| Latest frozen semantic corpus | 18/18 matched, nine cases repeated twice |
| Retained wall-draft completion probes | 2/2 completed; these have completion-only expectations, not semantic golden labels |
| Forced one-call allowance | Unavailable at 1425ms, no checked submission; this is correct termination, not successful gameplay |

Latest fixed probes are run-RrQBhp. Across its 18 semantic and two completion-only reviews, median was 3093ms, range 1495-9432ms, maximum three provider calls. These are immutable-input probes, not a scripted player or fake Keeper. An indirect-receipt positive case explicitly neutralizes one ambiguous time phrase; the original is retained. The clock negative case rejects unqualified morning at kernel night, while an explicitly uncanny-light positive case preserves the actual night.

Earlier runs CWQCtN, vg4fWi, EgL6LP and zlc5kp retain their failures. CWQCtN matched semantics but exceeded one call allowance and is not a budget pass. Later rRRw9I matched 18/18 before the evidence helper. The first final full-suite run exposed the new TS-only RPC missing from the current-only vocabulary assertion; the assertion was updated without touching the frozen Python reference. A subsequent full run had one Git child-start timing failure under concurrent play; the isolated Git test passed, followed by the final full 850/850 run after the live driver stopped. No unrelated Git implementation or test timeout was changed.

## Genuine play and timing

The sole player was the main session, one natural utterance at a time through tests/play/driver.py and the real RPC bin/pi-coc. Retained campaign continuity-venue-live continued from turn 22 through turn 41 across the implementation iterations. These inputs differ from the five-turn baseline; this is not a controlled whole-game speedup ratio.

- Completed delivery attempts: 20; total input-to-settle wait 942.375s; median 25.609s.
- Median per-turn narrate preparation/review/commit interval: 6.6225s; maximum aggregate interval 24.483s. This includes more than private model inference.
- Ordinary subgroup: 16 turns, median 24.132s. Excluded turns 23 and 27 had long dynamic adaptation, turn 30 had long object materialization, and turn 36 was an explicit recovery.
- Long turns 23 and 27 still took 223.371s and 185.814s; their graph/NPC work included 120.813s, 64.974s and 118.189s lookups. That subsystem is outside this audit repair.
- One undelivered attempt at turn 36 paused after 19.2s; it is listed separately and is not a completion/performance pass. Its later explicit retry completed the already-settled result in 30.223s without another resolve or apply.

Player choices remained consequential: the player declined the hospital bible, corrected a supposed paper handover, borrowed and returned a different key, abandoned part of the upstairs route, read diary passages without reciting rituals, followed the cellar connection, and found a physical body behind the wall. The player then declined confrontation, reported uncertainty to Knott, returned the diaries and original key, received the paid inquiry fee through a cash receipt, and left. This is a natural end to the inquiry; it does not prove the haunting was solved or a final battle played.

The live review exposed two gaps that were fixed during the run: kernel time was absent from the focused packet, and an auditor exhausted its allowance guessing raw object shapes. A cold recovery then revealed an unwanted extra time/threat application before the paused-review check. Those historical effects remain retained, not rolled back. After the startup fix, world and turn hashes were unchanged and no startup tool calls were captured; explicit retry added no resolve/apply. The initial RPC capture did not show a service-status entry, so this proves state preservation, not GUI status visibility.

Final state is turn 42 awaiting_player, with turn 41 committed and the driver stopped after agent_settled. Narration-audit 1.2.4 and enhanced-items 1.1.9 are active. All three earlier false childhood/kinship memory entries remain superseded by their recorded corrections. Diary transfer, key return, Luck spending and payment retain kernel receipts; cash moved from 5.90 to 45.90 at the final payment.

## Limits and evidence

This does not establish universal hallucination elimination, Greek transplantation, a complete mystery resolution, or uninformed-human UI acceptance. Some main-Keeper calls still misuse schemas before correction. One committed turn 30 narration contained DeepSeek DSML closing tokens; kernel-rendered text confirms this is a separate provider-formatting issue, not a driver fallback fabrication. No parser overhaul or graph-adaptation rewrite was folded into this repair.

The canonical evidence remains in the owned checkout:

- .coc/campaigns/continuity-venue-live/ — turns, telemetry, memory, world and receipts.
- .coc/playtests/continuity-review-live/, continuity-review-clock-resume/, continuity-review-recovery/, continuity-review-retry/ — all attempts, including the zero-input faulty recovery and the later successful recovery.
- .coc/playtests/continuity-review-probes/ — immutable-input cases, rejected artifacts and private Pi traces.
- .coc/playtests/continuity-review-acceptance/metrics.json and final-state.json — derived assessments; validation/ preserves the passing and intermediate failed test logs.
- /tmp/pipicoc-continuity-impl.yh2FpS/ — retained diagnostic and tool-enabled Pi execution traces. No original campaign or rejected artifact was deleted.

The run with a 180-second transport timeout also has turn-2-actual-delivery.json; its original timeout summary remains unchanged. Metrics use actual event completion and filter each attempt by timestamp so turn 36 is not double-counted after explicit retry. The full lifetime of turn 36, including failure, offline work and restart, is not presented as its 30.223s completion latency.

Contract: ../kernel-rpc.md sections 35.13-35.14. Execution plan: ../plans/story-continuity-and-adaptation.md. The plan records the primary-source comparison that preceded substantial implementation.
