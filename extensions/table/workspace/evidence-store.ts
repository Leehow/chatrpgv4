/** Host-side entrypoint for the rebuildable KIC evidence store. */
export {
  EVIDENCE_STORE_VERSION,
  EVIDENCE_AUTHORITIES,
  EvidenceStore,
  createEvidenceStore,
  evidenceStoreRoot,
  evidenceId,
  type EvidenceAuthority,
  type EvidenceBinding,
  type EvidenceCoverage,
  type EvidenceInput,
  type EvidenceRead,
  type EvidenceReference,
  type EvidenceScope,
  type EvidenceStoreLimits,
} from "../../../kernel-ts/read/workspace-store.ts";
