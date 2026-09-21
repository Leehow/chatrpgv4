Status: accepted
Execution: complete as a standalone slice; independent of T02
Parent design: #101
Stage: S1
Model: gpt-6-astra
Helper: gpt-5.6-terra for independent resolver and legacy-view tests only

# Implement standalone SourceRef resolver and legacy views

Implement exact host-owned references as a standalone compatibility slice. It may proceed beside T02 after contracts freeze and makes no hybrid-runtime claim.

## Depends on

- T01 accepted.

## Current progress

- `runtime/jev/source-ref.ts` and `runtime/jev/source-ref-legacy.ts` are implemented by Astra and compile.
- Independent Terra resolver/legacy-view tests pass 9/9.
- Type checking passes and the Astra lead reviewed the implementation and test slice.
- T03 is accepted only as the standalone SourceRef/legacy-view slice. No consumer migration, Jev integration, or hybrid-runtime acceptance is claimed.

## Scope

- Issue owner/document-or-record/revision/type plus allowed field or half-open UTF-16 range references.
- Reject surrogate splits, first-duplicate guessing, stale active jobs, foreign owners, cross-campaign scope, and unauthorized fields.
- Convert existing code-point ranges explicitly at the host boundary.
- Preserve exact native bytes; normalization creates a derivative with a mapping.
- Provide legacy quote-shaped and record-shaped reader views without migrating every world identity.

## Proposed exclusive write set

- `runtime/jev/source-ref.ts`
- `runtime/jev/source-ref-legacy.ts`
- `tests/extension/jev-source-ref.test.mjs`

**Subassignment boundary:** Terra may own legacy fixtures and the resolver test file only. Astra owns both SourceRef production modules.

## Acceptance

- Cases cover astral UTF-16, duplicate strings, field allowlists, revisions, owner/audience/worldline boundaries, exact reconstruction, derivative mappings, legacy reads, and historical readability.
- A SourceRef proves only location and copy fidelity; tests prevent promotion to truth, currentness, public visibility, or visual proof.

## Retirement and rollback

Keep legacy readers. Disable new reference issuance on resolver failure; source originals and accepted historical artifacts remain untouched and readable.

## Not this ticket

No Jev call, source preparation, graph publication, memory migration, broad identity replacement, push/package/restart, or Python kernel.
