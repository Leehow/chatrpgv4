/** Proposed integration contracts, not names from the user's current Pi source tree.
 * Python reference.py is the runnable request compiler in this package.
 * Preserve unicode_code_point offsets or explicitly map them to JS UTF-16 units.
 */
export type Decision = 'VIOLATION' | 'CLEAN' | 'NOT_APPLICABLE' | 'INSUFFICIENT_CONTEXT';
export type Channel = 'player_narration' | 'audit_note';
export interface Fact {
  id: string;
  text: string;
  sourceRef: string;
}
export interface FactCapsule {
  turnRef: string;
  revision: number;
  recipient: string;
  branchRef: string;
  epoch: number;
  publicFacts: readonly Fact[];
  requiredFactIds: readonly string[];
  epistemicLimits: readonly string[];
  playerAuthorizations: readonly string[];
  ruleEffectRefs: readonly string[];
  surfacePermissions: readonly string[];
  publicHistoryRefs: readonly string[];
  scopeComplete: boolean;
}
export interface ExpressionPlan {
  version: '1.0.0';
  cardPackageDigest: string;
  capsuleRevision: number;
  recipient: string;
  baseVoiceRef: string;
  primaryCardId: string | null;
  supportingCardIds: readonly string[];
  exampleIds: readonly string[];
  lengthTarget: 'brief' | 'balanced' | 'expansive';
  /** Soft target only. Mandatory information takes precedence. */
  preserveFactIds: readonly string[];
}
export interface QuotedSpan {
  kind: 'quoted_span';
  draftDigest: string;
  turnRef: string;
  id: string;
  start: number;
  end: number;
  offsetUnit: 'unicode_code_point';
  quote: string;
}
export type Evidence = QuotedSpan | {
  kind: 'omission' | 'whole_text' | 'multiple_unresolved' | 'unlocalized';
  draftDigest: string;
  requiredFactIds?: readonly string[];
};
export interface Diagnostic {
  cardId: string;
  decision: Decision;
  rawProbabilities: Readonly<Record<Decision, number>>;
  providerConfidence: number;
  calibrationProfileRef: string | null;
  evidence: readonly Evidence[];
  positiveExampleIds: readonly string[];
  repairOwner: string;
}
export interface DeliveryBinding {
  turnRef: string;
  expectedStateRevision: number;
  narrationRevision: number;
  draftDigest: string;
  recipient: string;
  mode: 'full_buffer' | 'segment_buffer' | 'direct_stream';
  status: 'unpublished' | 'partly_published' | 'published' | 'cancelled';
}
export interface ExpressionRuntime {
  prepareExpression(capsule: FactCapsule, signal: AbortSignal): Promise<ExpressionPlan>;
  diagnoseDraft(text: string, capsule: FactCapsule, signal: AbortSignal): Promise<readonly Diagnostic[]>;
  /** This interface does not grant rules/state write authority. */
  publishNarration(text: string, binding: DeliveryBinding, signal: AbortSignal): Promise<void>;
}
