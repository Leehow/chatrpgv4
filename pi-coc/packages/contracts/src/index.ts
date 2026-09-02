export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type Visibility = { scope: "public" | "keeper" | "party" } | { scope: "actor"; actorId: string };
export interface FictionTime { epoch: number; instant: string; }
export interface SourceRef { documentHash: string; printedPage?: number; section?: string; spanHash?: string; }
export interface DomainEvent<TPayload extends JsonValue = JsonValue> {
  eventId: string; eventType: string; aggregateId: string; payload: TPayload; visibility: Visibility;
  fictionTime: FictionTime; causedBy: string[]; ruleRefs: string[]; sourceRefs: SourceRef[];
}
export interface RngReceipt { receiptId: string; streamId: string; drawIndex: number; sides: number; result: number; }
export interface ModelReceipt { receiptId: string; lane: "director" | "narrator" | "verifier"; provider: string; model: string; requestHash: string; responseHash: string; }
export interface BranchHead { sessionId: string; branchId: string; commitId: string | null; revision: number; }
export interface TurnCommit {
  commitId: string; sessionId: string; branchId: string; parentCommitId: string | null; interactionTurn: number;
  fictionTimeBefore: FictionTime; fictionTimeAfter: FictionTime; eventIds: string[]; stateHashAfter: string;
  contentPackHash: string; ruleSetHash: string; inputHash: string; planHash: string;
  rngReceipts: RngReceipt[]; modelReceipts: ModelReceipt[]; createdAt: string;
}
export interface PlayerInput { requestId: string; sessionId: string; branchId: string; actorId: string; expectedHeadRevision: number; text: string; }
export interface Intent { actorId: string; goal: string; method?: string; constraints: string[]; targetIds: string[]; }
export interface RuleRequest { requestId: string; ruleId: string; actorId: string; inputs: Record<string, JsonValue>; proposedDifficulty?: "regular" | "hard" | "extreme"; adjudicationReason?: string; }
export interface TimeProposal { mode: "tactical" | "scene" | "extended" | "travel" | "downtime" | "montage"; seconds: number; reason: string; }
export interface ProposedEvent { eventType: string; aggregateId: string; payload: JsonValue; visibility: Visibility; sourceRefs: SourceRef[]; }
export interface PendingDecision { decisionId: string; revision: number; headCommitId: string | null; prompt: string; choices: Array<{ id: string; label: string; consequencesVisible: boolean }>; }
export interface TurnPlan {
  planId: string; intent: Intent; ruleRequests: RuleRequest[]; proposedEvents: ProposedEvent[]; timeProposal: TimeProposal;
  revealCandidateIds: string[]; pendingDecision?: PendingDecision; rationaleRefs: string[];
}
export interface RuleResolution { requestId: string; ruleId: string; outcome: string; data: Record<string, JsonValue>; events: DomainEvent[]; rngReceipts: RngReceipt[]; }
export interface ContextCapsule {
  capsuleId: string; sessionId: string; branchHead: BranchHead; fictionTime: FictionTime; playerInput: PlayerInput;
  currentScene: JsonValue; visibleClaims: JsonValue[]; actorViews: JsonValue[]; activeClocks: JsonValue[]; dueEvents: JsonValue[];
  applicableRules: JsonValue[]; narrativeObligations: JsonValue[]; legalAffordances: JsonValue[]; styleContract: JsonValue;
  forbiddenDisclosureIds: string[]; tokenEstimate: number;
}
export interface NarrativeFrame {
  frameId: string; commitId: string; observedChanges: JsonValue[]; sensoryCues: JsonValue[]; npcActions: JsonValue[];
  mechanicalEchoes: JsonValue[]; openAffordances: JsonValue[]; forbiddenClaimIds: string[]; styleContract: JsonValue;
}
export interface NarrationDraft { draftId: string; frameId: string; text: string; }
export interface VerificationReport { accepted: boolean; violations: Array<{ code: string; message: string; claimId?: string; severity: "error" | "warning" }>; repairedText?: string; }
export type TurnStatus = "NEEDS_CLARIFICATION" | "NEEDS_PLAYER_CHOICE" | "COMMITTED_UNPUBLISHED" | "PUBLISHED" | "ABORTED";
export interface TurnResult { status: TurnStatus; commit?: TurnCommit; pendingDecision?: PendingDecision; narration?: string; verification?: VerificationReport; }
export function canonicalize(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}
export async function sha256Hex(value: JsonValue | string): Promise<string> {
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : canonicalize(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2,"0")).join("");
}
export function isVisibleTo(visibility: Visibility, actorId: string, isKeeper = false): boolean {
  if (isKeeper) return true;
  if (visibility.scope === "public" || visibility.scope === "party") return true;
  if (visibility.scope === "actor") return visibility.actorId === actorId;
  return false;
}
export interface Clock { now(): string; }
export interface IdGenerator { next(prefix: string): string; }
