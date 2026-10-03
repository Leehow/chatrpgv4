# Chinese NPC expression-card selection (selector v7)

## Authority and flow
Jev selects advisory references before Keeper drafting, never finished prose. Producer supplies locked voice/personality, mood, relationship, player act, listener, risk, bounded recent exchange, source/current facts, language, revision, and enabled package. One batch asks independently per person: participation, card activation (Noul), and separate register-conflict (Noul). Host accepts none or at most one habit and one interaction. Tool-Pi authors cards; Host exact-materializes selected cards into the existing single provider request. Existing masks, personality, lore, voice authoring, and NPC card state are unchanged.

Cards are conditional patterns, not canon, quotations, state, occupation, or class templates. The host and source/current facts are authoritative. The Keeper drafts once, may ignore stale/contradictory/unsafe advice, and may use natural initiative, responsive emotion, formal or long speech when context warrants it.

## Package and budgets
The package is version 1 with six habits and thirteen interactions (19 cards); each card has name, kind, applies, pattern, and grounded examples. Preserve the card material and do not import example facts. Package/schema and UTF-8 budgets are checked structurally. The selector limits 24 cards, 8 people, 14,000-byte context, and 2,200-byte final advice.

## Runtime
`selectExpressionReferences` is family version 7. It makes one typed decision seam in one batch, with nullable answers, no retry or duplicate batch. Binding covers campaign/worldline/loop/audience, catalog/context/family/model revisions, turn input, and active revision. Current policy defaults are minFit .65, minParticipant .7, maxConflict .35; these are provisional calibration gates, separately calibrated and not validated literary improvement.

Preparation permits at most two distinct snapshots per turn, same-key memoization, and a 1,200 ms asynchronous allowance overlapping existing preparation. The user authorized a first-request wait on 2026-10-02: the first eligible NPC request may await the already running selection only until 800 ms after the attempt for its exact writing snapshot started. Existing preparation for that same snapshot spends the window; obsolete provisional snapshots do not. Later requests and changed snapshots cannot renew it. Completion, cancellation, none, error, or expiry releases the request immediately; no second prose generation is added. Cold completion can still miss; stale or absent advice falls back to normal Keeper writing. Before `provider_request`, verify actual serialized selected-reference inclusion; a projected but absent packet is withdrawn.

Exact history is already materialized by existing context policy; no invented inference. No second prose model, reviewer, rewrite, keyword/name classifier, semantic heuristic, or voice-state mutation is introduced.

## Evidence and status
Implementation/testing is authorized with Flapcode GPT Luna and the 800 ms first-request policy. Current package is 1.3.6 / family 7 (full 2122 bytes, brief 1090 bytes, cap 1200). The narrower design is implemented as pre-draft selection: the root is the sole one-utterance player, and selected cards must be verified in the serialized provider request before drafting. Existing voice ownership, state, and cards remain unchanged. Focused checks establish wiring, schema, budgets, inclusion, cancellation, fallback, and ownership only; they do not prove literary quality.

Historical evidence remains: the earlier 4361/4361 extension suite was at a prior content snapshot; the final same-code/current-content suite was still running at the evidence snapshot; old red suites, the failed static screen (`invalid-for-selector-intent`), v5/v6 inconclusive blind trials, and all undelivered records are not erased. Live observations are limited and do not establish quality advantage, causal A/B speed, release, deployment, or App acceptance. No extra prose model, judge, or rewrite is introduced.
