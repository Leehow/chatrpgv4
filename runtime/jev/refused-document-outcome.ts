/** The owner-authorized final outcome check for one verified pre-write document refusal. */
import {createHash} from 'node:crypto';
import type {DecisionBatch, Json} from './contracts.ts';
import type {DecisionPort} from './decision-port.ts';
import {TaskLease} from './task-context.ts';
import {JEV_MODEL, packDecisionBatch} from './question-packing.ts';

export const REFUSED_DOCUMENT_OUTCOME_FAMILY = 'refused-document-outcome';
export const REFUSED_DOCUMENT_OUTCOME_REASON = 'refused_document_outcome';
export const documentOutcomeDigest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface RefusedDocumentBasis {
  campaign: string; worldline: string; turn: number; playerText: string; writer: string;
  kind?: 'refused' | 'selected_no_write';
  name?: string; text?: string; cause?: string;
  carrier?: {name: string; version: string};
  catalog: Array<{name: string; version: string}>;
}
export type DocumentOutcomeVerdict = {status: 'clean' | 'steer' | 'terminal' | 'stale' | 'inactive';
  reason: string; probability?: number; basisHash?: string; draftHash?: string; attempt: number};

export class RefusedDocumentOutcome {
  basis?: RefusedDocumentBasis;
  revision = 0;
  attempts = 0;
  correctionIssued = false;
  terminal = false;
  private checked = new Map<string, DocumentOutcomeVerdict>();
  arm(basis: RefusedDocumentBasis): void {
    // Repeated failed proposals do not renew the turn's decision/correction budget.
    if (this.basis && !(this.basis.kind === 'selected_no_write' && basis.kind !== 'selected_no_write')) return;
    this.basis = structuredClone(basis); this.revision++;
  }
  settle(name: string, version: string, originalText: string, actualBoundSuffix: string, proposedName: string): void {
    const basis = this.basis;
    if (!basis || basis.kind === 'selected_no_write' || documentOutcomeDigest(basis.text) !== documentOutcomeDigest(originalText)
      || documentOutcomeDigest(basis.text) !== documentOutcomeDigest(actualBoundSuffix)) return;
    const trackedCarrier = basis.carrier?.name === name && basis.carrier.version === version;
    const sameProposal = basis.name === proposedName && basis.catalog.some(value => value.name === name && value.version === version);
    if (!trackedCarrier && !sameProposal) return;
    this.basis = undefined; this.revision++; this.terminal = false;
  }
  settleSelected(): void {
    if (this.basis?.kind !== 'selected_no_write') return;
    this.basis = undefined; this.revision++; this.terminal = false;
  }
  issuedCorrection(): void { this.correctionIssued = true; }
  async check(input: {draft: string; decision: DecisionPort; signal: AbortSignal; deadlineAt?: number;
    correctionAvailable: boolean; current: () => Promise<boolean>}): Promise<DocumentOutcomeVerdict> {
    const basis = this.basis, revision = this.revision;
    if (!basis) return {status: 'inactive', reason: 'no_refused_write', attempt: this.attempts};
    const basisHash = documentOutcomeDigest(basis), draftHash = documentOutcomeDigest(input.draft), key = basisHash + ':' + draftHash;
    const verdict = (status: DocumentOutcomeVerdict['status'], reason: string, probability?: number): DocumentOutcomeVerdict =>
      ({status, reason, attempt: this.attempts, basisHash, draftHash, ...(probability === undefined ? {} : {probability})});
    const current = async () => !input.signal.aborted && this.basis === basis && this.revision === revision
      && documentOutcomeDigest(basis) === basisHash && documentOutcomeDigest(input.draft) === draftHash && await input.current();
    if (!await current()) return verdict('stale', 'refusal_binding_changed');
    if (this.terminal) return verdict('terminal', 'outcome_unconfirmed');
    const prior = this.checked.get(key);
    if (prior) {
      if (prior.status === 'steer' && this.correctionIssued) { this.terminal = true; return verdict('terminal', 'repeated_false_completion', prior.probability); }
      return prior;
    }
    if (this.terminal || this.attempts >= 2) { this.terminal = true; return verdict('terminal', 'outcome_check_exhausted'); }
    if (!this.correctionIssued && [...this.checked.values()].some(value => value.status === 'steer'))
      return verdict('steer', 'correction_pending');
    this.attempts++;
    const deadlineAt = Math.min(Date.now() + 2_000, input.deadlineAt ?? Infinity);
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(Math.max(1, deadlineAt - Date.now()))]);
    const scope = {owner: REFUSED_DOCUMENT_OUTCOME_FAMILY, campaign: basis.campaign, worldline: basis.worldline, audience: 'keeper' as const};
    const readSet = [{kind: 'draft' as const, resource: `turn:${basis.turn}:refused-document`, revision: basisHash},
      {kind: 'draft' as const, resource: `turn:${basis.turn}:final-document-outcome`, revision: draftHash}];
    const lease = new TaskLease({owner: REFUSED_DOCUMENT_OUTCOME_FAMILY, goal: 'Check only the unconfirmed recording outcome', scope, readSet, signal, capabilities: ['decision'],
      budget: {deadlineAt, remainingActions: 1, remainingInputTokens: 32_000, remainingOutputTokens: 2_000, remainingCostUsd: .01}});
    let answer: DocumentOutcomeVerdict;
    let removeAbort: (() => void) | undefined;
    try {
      const batch: DecisionBatch = {id: `document-outcome:${basis.turn}:${draftHash.slice(0, 16)}`, family: REFUSED_DOCUMENT_OUTCOME_FAMILY,
        familyVersion: '2', model: JEV_MODEL, scope, readSet,
        state: {playerWords: basis.playerText, recording: basis.kind === 'selected_no_write'
          ? {writer:basis.writer,status:'The current player selected physical recording. The host verified no current-turn document-write receipt; no canonical refusal or attempted text is claimed.'}
          : {writer: basis.writer, proposedCarrier: basis.name, proposedText: basis.text,
            status: 'Refused before any document write; no writing receipt settled this recording.'}, draft: input.draft} as Json,
        questions: [{key: 'false_completion', type: 'noul', target: 'completion of this unconfirmed recording',
          instructions: 'Does the draft assert or presuppose that this specific selected physical recording exists or was completed? Judge only that recording outcome. Prior prose is not a writing receipt. A claimed written page or copied characters count even when the draft only verifies them or makes the assertion in dialogue. An attempt, intention, uncertainty, negation, discussion, reading another settled record or another settled action is not completion. Do not judge style, authorization, NPC purpose, plan quality or whether the proposed text is true.'}]};
      packDecisionBatch(batch);
      const cancelled = new Promise<never>((_, reject) => {
        const abort = () => reject(new Error('Outcome decision cancelled or expired'));
        signal.addEventListener('abort', abort, {once: true}); removeAbort = () => signal.removeEventListener('abort', abort);
        if (signal.aborted) abort();
      });
      const result = await Promise.race([input.decision.decide(batch, lease), cancelled]), value = result.answers.false_completion;
      if (!await current()) return verdict('stale', 'refusal_binding_changed');
      const p = result.status === 'complete' && value?.status === 'answered' && value.type === 'noul' ? value.noul : undefined;
      answer = p === undefined || !Number.isFinite(p) || p < 0 || p > 1 ? verdict('terminal', 'outcome_unavailable')
        : p <= .1 ? verdict('clean', 'no_false_completion', p)
          : p >= .9 && this.attempts === 1 && !this.correctionIssued && input.correctionAvailable ? verdict('steer', 'false_completion', p)
            : verdict('terminal', p >= .9 ? 'false_completion_without_correction' : 'outcome_uncertain', p);
    } catch {
      if (!await current()) return verdict('stale', 'refusal_binding_changed');
      answer = verdict('terminal', 'outcome_unavailable');
    } finally { removeAbort?.(); lease.close(); }
    this.checked.set(key, answer); if (answer.status === 'terminal') this.terminal = true;
    return answer;
  }
}
