import type { BranchHead, DomainEvent, FictionTime, ModelReceipt, RngReceipt, TurnCommit } from "../../contracts/src/index.js";

export class BranchHeadConflictError extends Error {
  constructor(public readonly expected: number, public readonly actual: number) {
    super(`Branch head revision mismatch: expected ${expected}, actual ${actual}`);
  }
}
export interface CommitDraft {
  requestId: string; requestHash: string; sessionId: string; branchId: string; expectedHeadRevision: number;
  commitId: string; interactionTurn: number; fictionTimeBefore: FictionTime; fictionTimeAfter: FictionTime;
  events: DomainEvent[]; stateHashAfter: string; contentPackHash: string; ruleSetHash: string; inputHash: string;
  planHash: string; rngReceipts: RngReceipt[]; modelReceipts: ModelReceipt[]; createdAt: string;
}
export interface EventLedger {
  createSession(sessionId: string, branchId?: string): BranchHead;
  getBranchHead(sessionId: string, branchId: string): BranchHead;
  appendCommit(draft: CommitDraft): TurnCommit;
  forkBranch(sessionId: string, sourceCommitId: string | null, newBranchId: string): BranchHead;
  getCommit(commitId: string): TurnCommit;
  getEvents(commitId: string): DomainEvent[];
  replayTo(commitId: string | null): DomainEvent[];
}
export class InMemoryEventLedger implements EventLedger {
  private heads = new Map<string, BranchHead>(); private commits = new Map<string, TurnCommit>();
  private eventsByCommit = new Map<string, DomainEvent[]>(); private idempotency = new Map<string,{requestHash:string;commitId:string}>();
  createSession(sessionId: string, branchId = "main"): BranchHead {
    const key = `${sessionId}:${branchId}`; if (this.heads.has(key)) throw new Error(`Branch exists: ${key}`);
    const head = { sessionId, branchId, commitId: null, revision: 0 }; this.heads.set(key, head); return { ...head };
  }
  getBranchHead(sessionId: string, branchId: string): BranchHead {
    const head = this.heads.get(`${sessionId}:${branchId}`); if (!head) throw new Error("Unknown branch"); return { ...head };
  }
  appendCommit(draft: CommitDraft): TurnCommit {
    const idemKey = `${draft.sessionId}:${draft.branchId}:${draft.requestId}`; const prior = this.idempotency.get(idemKey);
    if (prior) { if (prior.requestHash !== draft.requestHash) throw new Error("Idempotency conflict"); return this.getCommit(prior.commitId); }
    const key = `${draft.sessionId}:${draft.branchId}`; const head = this.heads.get(key); if (!head) throw new Error("Unknown branch");
    if (head.revision !== draft.expectedHeadRevision) throw new BranchHeadConflictError(draft.expectedHeadRevision, head.revision);
    const commit: TurnCommit = {
      commitId:draft.commitId, sessionId:draft.sessionId, branchId:draft.branchId, parentCommitId:head.commitId,
      interactionTurn:draft.interactionTurn, fictionTimeBefore:draft.fictionTimeBefore, fictionTimeAfter:draft.fictionTimeAfter,
      eventIds:draft.events.map((e)=>e.eventId), stateHashAfter:draft.stateHashAfter, contentPackHash:draft.contentPackHash,
      ruleSetHash:draft.ruleSetHash, inputHash:draft.inputHash, planHash:draft.planHash, rngReceipts:[...draft.rngReceipts],
      modelReceipts:[...draft.modelReceipts], createdAt:draft.createdAt,
    };
    this.commits.set(commit.commitId,commit); this.eventsByCommit.set(commit.commitId,[...draft.events]);
    this.heads.set(key,{sessionId:head.sessionId,branchId:head.branchId,commitId:commit.commitId,revision:head.revision+1});
    this.idempotency.set(idemKey,{requestHash:draft.requestHash,commitId:commit.commitId}); return structuredClone(commit);
  }
  forkBranch(sessionId: string, sourceCommitId: string | null, newBranchId: string): BranchHead {
    if (sourceCommitId) { const source=this.getCommit(sourceCommitId); if(source.sessionId!==sessionId) throw new Error("Cross-session fork"); }
    const key=`${sessionId}:${newBranchId}`; if(this.heads.has(key)) throw new Error("Branch exists");
    const head={sessionId,branchId:newBranchId,commitId:sourceCommitId,revision:0}; this.heads.set(key,head); return {...head};
  }
  getCommit(commitId:string):TurnCommit { const c=this.commits.get(commitId); if(!c) throw new Error("Unknown commit"); return structuredClone(c); }
  getEvents(commitId:string):DomainEvent[] { const e=this.eventsByCommit.get(commitId); if(!e) throw new Error("Unknown commit"); return structuredClone(e); }
  replayTo(commitId:string|null):DomainEvent[] { if(!commitId)return[]; const chain:TurnCommit[]=[]; let cursor:string|null=commitId;
    while(cursor){const c=this.getCommit(cursor);chain.push(c);cursor=c.parentCommitId;} chain.reverse(); return chain.flatMap((c)=>this.getEvents(c.commitId)); }
}
