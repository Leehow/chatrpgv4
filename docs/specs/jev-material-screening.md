# Request-local Mod and NPC material screening

Status: owner-approved implementation and genuine-table comparison, 2026-10-15.
Predecessor: jev-context-screen-prototype.md. Scope excludes tool selection.

## Contract

Keep all canonical tool definitions byte-identical. The single Keeper remains
the author and causal judge. Add one request-context transform after the existing
context policy; never rewrite saved messages, source text or campaign state.

Producer: the existing locked Mod instruction projection adds host-only offsets
for authored resident/situational sections, bound to the exact instruction digest.
The existing NPC view supplies current actor state and historical records.
Reader: the table's material-screen transform reads these records and the actual
current player contribution. Actor: the same Keeper receives unchanged selected
source slices, preserved core context and explicit omission/read routes.

Always retain Mod preambles, authored resident sections, unsectioned/unknown
packages, invalid indexes, and details already explicitly requested by tools.
Keep NPC identity, personality, availability, current cognition, relationships,
recent speech, active intentions and unresolved commitments. Only terminal
intentions and explicitly fulfilled historical commitments are optional.
Ledger reference indexes may be elided with count and ordinary recall routes;
this structural saving is reported separately from semantic selection.

Use pinned jev-1.14.0 and independent per-candidate Noul questions for relevance
and contrary/qualifying context. Omit only when both answers are below 0.25;
unknown, missing, stale, oversized and failed decisions retain the full candidate.
Preserve source/actor identities; selection never grants knowledge or disclosure.
Shared state contains the current player contribution, present state and recent
public exchange. Complete candidate text lives in its own question. Ordinary
packing is preferred; a larger batch may explicitly use the existing long-context
header. No new model author, semantic publication gate or retry owner.

Cache only identical input/scope/current-context/candidate bytes. Reset on a new
player input, session replacement or shutdown. A changed state basis is not a
cache hit. One accumulated 4-second screening-work allowance per input excludes
Keeper inference time. Unchanged model rounds reuse results; changed state may
spend only the remaining allowance. Late or failed work falls back to the full view.
An explicitly requested lookup result is never screened. No new tool is needed:
lookup and recall retain original authoritative material.

Default on when the existing Jev credential/configuration is available;
PI_COC_MATERIAL_SCREEN=0 is the controlled baseline. Missing configuration is
an unchanged full projection. Record candidate counts, structural and semantic
bytes, actual model/tokens/time, unknown/fallback and output digest, never secrets.

## Verification and measurement

Focused tests cover unchanged tools/core/current promises, resident sections,
qualifiers, cross-actor isolation, exact source slices, failed/partial answers,
stale cancellation, changed context, and one-wait caching. Read-only replay
checks provider-bound projection without writing historical evidence.

Genuine play uses tests/play/driver.ts, the main session as the only unscripted
player, one contribution at a time. The owner's current request specifies Grok
consumption, so both comparison arms use grok-build/grok-4.5/low, including lanes.
Fresh isolated campaign homes avoid disturbing concurrent tables. Preserve actual
model attribution, provider input/cache/output, tools, TTFT, whole-turn elapsed
time and screening overhead. Two natural trajectories are not identical seeded
counterfactuals: report context-matched request metrics and gameplay coherence
separately, with sample counts and observed limitations.

External precedent: https://docs.typesafe.ai/models#long-context and
https://docs.typesafe.ai/cookbooks/classifying_rag_passages support typed relevance
plus contrary-evidence questions; neither proves full semantic recall. The local
prototype found missed capabilities, which is why all tool schemas stay intact.

## Trial outcome (2026-10-15)

Source integration is implemented; full product acceptance remains open. Retained
real-driver evidence and failure records are in
`.coc/playtests/material-screen-integration-20261015/report.md` and its linked runs.
A three-turn intermediate revision reduced complete request projection bytes by
2.30%; main input including cache reads fell with fewer requests, while uncached
input increased and whole-turn elapsed time did not improve. The final revision
adds recent public exchange and candidate-byte cache binding; its first genuine
turn completed, followed by two connection/time-out interruptions. Do not infer
bill savings, full semantic recall or net acceleration from this sample. All
recorded tool schemas equal the complete canonical schema. Critical active
context remains resident; unavailable selection retains the full candidate.
The final focused guard passes 18 tests. Broader shared-checkout and LAN failures
remain documented separately. No App packaging or full-scenario acceptance is
claimed.
