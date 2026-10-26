/**
 * §166.2's refusal-result guard for an act held by an unavailable admission review (owner decision 2026-10-11, contract §213.1).
 *
 * Writer: an `admission_unavailable` refusal this turn (`hold`). Reader: the shared final-delivery boundary, which asks one
 * bounded Jev Noul whether the draft asserts the result of what the player declared and no settled receipt carries. Actor:
 * the Keeper, corrected once through the existing turn-close steer (§200.3's table, `outcomeStatus`); every other answer
 * delivers. The host owns eligibility, binding and control flow; Jev neither writes text nor decides what happened.
 */
import type {DecisionBatch, Json} from './contracts.ts';
import type {DecisionPort} from './decision-port.ts';
import {TaskLease} from './task-context.ts';
import {JEV_MODEL, packDecisionBatch} from './question-packing.ts';
import {documentOutcomeDigest as outcomeDigest, outcomeStatus} from './refused-document-outcome.ts';

export const HELD_ACT_OUTCOME_FAMILY = 'held-act-outcome';
export const HELD_ACT_OUTCOME_REASON = 'held_act_outcome';
/** At most this many held refusals and settled receipts reach the question; each line at most `HELD_LINE_MAX` code points. */
export const HELD_ROWS_MAX = 12;
export const HELD_LINE_MAX = 300;

export interface HeldRefusal {tool: string; lines: string[]; cause: string; operationKey?: string; argumentCompletionKey?:string}
export interface HeldActBasis {campaign: string; worldline?: string; turn: number; playerText: string; held: HeldRefusal[]; complete?: boolean}
export type HeldActVerdict = {status: 'clean' | 'steer' | 'unclear' | 'claimed' | 'stale' | 'inactive';
  reason: string; probability?: number; basisHash?: string; draftHash?: string; attempt: number};

const clip = (text: string) => [...text].slice(0, HELD_LINE_MAX).join('');
/** Transport identities are not operation arguments; all other values must match exactly. */
export function heldOperationKey(tool: string, args: Record<string, unknown>): string {
  const ordered = (value: unknown): unknown => Array.isArray(value) ? value.map(ordered)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,ordered(item)])) : value;
  const {campaign: _, call_id: __, ...proposal} = args;
  return outcomeDigest({tool, proposal: ordered(proposal)});
}
/** Only canonical owed receipts can retire the same formerly refused operation without its authority annotation. */
export function heldRecoveryOperationKey(tool:string,args:Record<string,unknown>,receipts:Record<string,unknown>[]):string|undefined {
  if(tool!=='apply'||!Array.isArray(args.effects))return;
  const effects=args.effects as Record<string,unknown>[],owed=effects.filter(effect=>typeof effect.owed==='string');
  if(!owed.length||!owed.every(effect=>receipts.some(receipt=>receipt.owed===effect.owed)))return;
  return heldOperationKey(tool,{...args,effects:effects.map(({owed:_,...effect})=>effect)});
}
/**
 * A settled receipt as the question shows it: its scalar fields, clipped. A projection of the kernel's own row, not a reading
 * of it; which act it carries is Jev's to judge.
 */
export function receiptLine(receipt: Record<string, unknown>): string {
  const fields = Object.entries(receipt).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .map(([key, value]) => `${key}=${String(value)}`);
  return clip(fields.join(' '));
}

/** Causes that leave whether a write landed unknown; every other kernel refusal committed nothing. */
const UNKNOWN_OUTCOMES=['operation_failed','commit_failed','timeout','aborted','revision_conflict','transport','partial_settlement','unknown_partial_write'];
export class HeldActOutcome {
  basis?: HeldActBasis;
  revision = 0;
  attempts = 0;
  correctionIssued = false;
  private checked = new Map<string, HeldActVerdict>();
  /** Every unavailable refusal of the turn joins one basis; the turn's decision and correction budget is not renewed. */
  hold(input: Omit<HeldActBasis, 'held'>, refusal: HeldRefusal, strict = false): void {
    const basis = this.basis;
    if (basis && (basis.turn !== input.turn || basis.playerText !== input.playerText || basis.worldline !== input.worldline)) return;
    const limit = strict ? 12_000 : HELD_LINE_MAX;
    const complete = basis?.complete !== false && refusal.lines.every(line => [...line].length <= limit);
    const row = {tool: refusal.tool, lines: refusal.lines.map(line => [...line].slice(0, limit).join('')), cause: refusal.cause,
      ...(refusal.operationKey ? {operationKey: refusal.operationKey} : {}),
      ...(refusal.cause==='invalid_params'&&refusal.argumentCompletionKey ? {argumentCompletionKey:refusal.argumentCompletionKey} : {})};
    const held = basis?.held ?? [];
    if(row.argumentCompletionKey&&held.some(value=>value.cause==='invalid_params'&&value.argumentCompletionKey===row.argumentCompletionKey))return;
    if (held.some(value => JSON.stringify(value) === JSON.stringify(row))) return;
    if (held.length >= HELD_ROWS_MAX) { this.basis = {...basis!, complete: false}; this.revision++; return; }
    this.basis = {...input, held: [...held, row], ...(strict ? {complete} : {})}; this.revision++;
  }
  /** Called only after complete canonical settlement by the operation owner, never by a model. */
  settled(input: Omit<HeldActBasis, 'held'>, operationKey: string, argumentCompletionKey?:string): number {
    const basis = this.basis;
    if (!basis || basis.complete === false || basis.campaign !== input.campaign || basis.worldline !== input.worldline
      || basis.turn !== input.turn || basis.playerText !== input.playerText) return 0;
    const held = basis.held.filter(row => row.operationKey !== operationKey
      &&!(row.cause==='invalid_params'&&row.argumentCompletionKey&&row.argumentCompletionKey===argumentCompletionKey)), removed = basis.held.length - held.length;
    if (removed) { this.basis = held.length ? {...basis, held} : undefined; this.revision++; this.checked.clear(); }
    return removed;
  }
  /** Known atomic refusals are results, never completed effects or authority to retry them. */
  uncommittedFailures():Array<{tool:string;status:'uncommitted';reason:string}>|undefined {
    if(!this.basis)return [];
    const causes=['invalid_params','action_not_authorized','action_admission_uncertain','admission_unavailable','place_barrier'];
    if(this.basis.complete!==true||this.basis.held.some(row=>!causes.includes(row.cause)
      // §252.1: an apply clue refused as not discoverable here writes nothing either (live el-v2-20261021f T19, undelivered).
      &&!(row.tool==='apply'&&['unknown_entity','not_here','preview_clock_unknown','chosen_covered_quote'].includes(row.cause))
      // §270.7: a refused resolve is one kernel transaction that never committed, whatever its refusal said; only an outcome
      // the host could not read back stays unknown (1025d Digging T12: a refused Persuade held the turn after the corrected
      // one succeeded, and nine settled receipts were never told).
      &&!(row.tool==='resolve'&&!UNKNOWN_OUTCOMES.includes(row.cause))
      // §270.13: an apply refusal is all-or-nothing too (a document out of a reader's reach, 1025h Digging T1); a barrier
      // the party could not pass keeps the turn held, since its prose must not tell the crossing.
      &&!(row.tool==='apply'&&!UNKNOWN_OUTCOMES.includes(row.cause)&&!['not_reachable','blocked'].includes(row.cause))))return;
    return this.basis.held.map(row=>({tool:row.tool,status:'uncommitted',reason:row.cause}));
  }
  issuedCorrection(): void { this.correctionIssued = true; }
  async check(input: {draft: string; receipts: string[]; decision: DecisionPort; signal: AbortSignal; deadlineAt?: number;
    correctionAvailable: boolean; current: () => boolean; strict?: boolean}): Promise<HeldActVerdict> {
    const basis = this.basis, revision = this.revision;
    if (!basis) return {status: 'inactive', reason: 'no_held_act', attempt: this.attempts};
    if (input.strict && (basis.complete === false || input.receipts.length > HELD_ROWS_MAX
      || input.receipts.some(line => [...line].length > 12_000)))
      return {status: 'unclear', reason: 'outcome_coverage_incomplete', attempt: this.attempts};
    const receipts = input.receipts.slice(0, HELD_ROWS_MAX).map(line => input.strict ? line : clip(line));
    const basisHash = outcomeDigest({basis, receipts}), draftHash = outcomeDigest(input.draft), key = basisHash + ':' + draftHash;
    const verdict = (status: HeldActVerdict['status'], reason: string, probability?: number): HeldActVerdict =>
      ({status, reason, attempt: this.attempts, basisHash, draftHash, ...(probability === undefined ? {} : {probability})});
    const current = () => !input.signal.aborted && this.basis === basis && this.revision === revision && input.current();
    if (!current()) return verdict('stale', 'held_binding_changed');
    const prior = this.checked.get(key);
    if (prior) {
      // §200.3: the draft the correction was asked for, sent again after it, is delivered; the claim is recorded.
      if (prior.status === 'steer' && this.correctionIssued) return verdict('claimed', 'repeated_false_completion', prior.probability);
      return prior;
    }
    if (this.attempts >= 2) return verdict('unclear', 'outcome_check_exhausted');
    if (!this.correctionIssued && [...this.checked.values()].some(value => value.status === 'steer'))
      return verdict('steer', 'correction_pending');
    this.attempts++;
    const deadlineAt = Math.min(Date.now() + 2_000, input.deadlineAt ?? Infinity);
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(Math.max(1, deadlineAt - Date.now()))]);
    const scope = {owner: HELD_ACT_OUTCOME_FAMILY, campaign: basis.campaign, ...(basis.worldline ? {worldline: basis.worldline} : {}), audience: 'keeper' as const};
    const readSet = [{kind: 'draft' as const, resource: `turn:${basis.turn}:held-act`, revision: basisHash},
      {kind: 'draft' as const, resource: `turn:${basis.turn}:final-held-outcome`, revision: draftHash}];
    const lease = new TaskLease({owner: HELD_ACT_OUTCOME_FAMILY, goal: 'Check only the result of the act an unavailable review held', scope, readSet, signal,
      capabilities: ['decision'], budget: {deadlineAt, remainingActions: 1, remainingInputTokens: 32_000, remainingOutputTokens: 2_000, remainingCostUsd: .01}});
    let answer: HeldActVerdict;
    let removeAbort: (() => void) | undefined;
    try {
      const batch: DecisionBatch = {id: `held-act-outcome:${basis.turn}:${draftHash.slice(0, 16)}`, family: HELD_ACT_OUTCOME_FAMILY,
        familyVersion: '1', model: JEV_MODEL, scope, readSet,
        state: {playerWords: basis.playerText,
          held: {status: 'These operations failed this turn. Only successful matching canonical receipts establish completion; an unrelated successful operation does not settle them.',
            refused: basis.held.map(row => ({tool: row.tool, lines: row.lines}))},
          settledReceipts: receipts, draft: input.draft} as Json,
        questions: [{key: 'held_result', type: 'noul', target: 'result of an act the review held',
          instructions: 'Does the draft assert or presuppose the result of an act the player declared that no settled receipt carries: an arrival, a departure, a payment, a thing changing hands, or another completed change to where the investigator is or what anyone holds? Settled receipts did happen and may be told. The investigator beginning the act (turning to it, setting out, reaching for it, hailing a cab), an intention, a refusal, speech, a gesture, looking and listening are not results. Do not judge style, authorization, plausibility or whether the act was wise.'}]};
      packDecisionBatch(batch);
      const cancelled = new Promise<never>((_, reject) => {
        const abort = () => reject(new Error('Outcome decision cancelled or expired'));
        signal.addEventListener('abort', abort, {once: true}); removeAbort = () => signal.removeEventListener('abort', abort);
        if (signal.aborted) abort();
      });
      const result = await Promise.race([input.decision.decide(batch, lease), cancelled]), value = result.answers.held_result;
      if (!current()) return verdict('stale', 'held_binding_changed');
      const p = result.status === 'complete' && result.batchId === batch.id && value?.status === 'answered' && value.type === 'noul' ? value.noul : undefined;
      const [status, reason] = outcomeStatus(p, this.attempts, this.correctionIssued, input.correctionAvailable);
      answer = verdict(status, reason, reason === 'outcome_unavailable' ? undefined : p);
    } catch {
      if (!current()) return verdict('stale', 'held_binding_changed');
      answer = verdict('unclear', 'outcome_unavailable');
    } finally { removeAbort?.(); lease.close(); }
    this.checked.set(key, answer);
    return answer;
  }
}
