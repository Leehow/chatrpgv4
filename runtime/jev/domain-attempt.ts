/** Attempt-local decisions, with settled effects retained across a same-input replan. */
import {isPlainRecord} from './contracts.ts';
import type {TaskDomain, TaskStep, TaskView} from './task-runtime.ts';

export function attemptKey(view: Pick<TaskView, 'replans'>, key: string): string {
  return view.replans ? `${key}:attempt:${view.replans}` : key;
}

export function withAttemptKeys(domain: TaskDomain): TaskDomain {
  return {...domain, next(view) {
    const suffix = `:attempt:${view.replans}`;
    const key = (value: string): string | undefined => view.replans
      ? value.endsWith(suffix) ? value.slice(0, -suffix.length) : undefined
      : /:attempt:\d+$/.test(value) ? undefined : value;
    const local: TaskView = {...view,
      decisions: view.decisions.flatMap(row => {const local = key(row.key); return local === undefined ? [] : [{...row, key: local}];}),
      observations: view.observations.flatMap(row => {
        const local = key(row.key);
        if (local !== undefined) return [{...row, key: local}];
        // Prior checked source/history observations and actual settled effects remain evidence.
        return row.packet.status === 'succeeded' && (row.packet.receipts.length > 0
          || !['resolve.options','apply.options','apply.fulfillment.options','apply.fulfillment.prepare'].includes(row.proposal.operation)
            && !['resolve','apply'].includes(row.proposal.operation)) ? [row] : [];
      })};
    const step = domain.next(local);
    if (step.kind === 'decision' || step.kind === 'operation') return {...step, key: attemptKey(view, step.key)};
    if (step.kind === 'decisions') return {...step, batches: step.batches.map(row => ({...row, key: attemptKey(view, row.key)}))};
    return step;
  }};
}

export function mutationOutcome(view: TaskView, operation: 'resolve' | 'apply'): TaskStep | undefined {
  const rows = view.observations.filter(row => row.proposal.operation === operation);
  if (rows.some(row => row.packet.status === 'succeeded' && row.packet.receipts.length))
    return {kind: 'finish', status: 'complete', remainingNeeds: []};
  const row = rows.at(-1);
  if (!row) return undefined;
  const packet = row.packet, body = isPlainRecord(packet.result) ? packet.result : {};
  const error = isPlainRecord(body.coc_error) ? body.coc_error : {};
  const details = isPlainRecord(error.details) ? error.details : {};
  if (details.reason === 'action_not_authorized')
    return {kind: 'finish', status: 'needs_player', remainingNeeds: ['The actual admission owner requires the missing player choice. Do not resend this action in other words.']};
  if (packet.status === 'refused' && !packet.receipts.length && !packet.diagnostics?.some(value => value.code === 'settlement_unknown')
    && error.code === 'invalid_params' && error.next === 'change_input')
    return {kind: 'replan', remainingNeeds: ['Correct the non-settled operation using current options and the actual parameter refusal. Preserve every settled receipt.']};
  return {kind: 'finish', status: 'partial', remainingNeeds: [`The canonical ${operation} owner did not settle this action; preserve its actual refusal or pending outcome.`]};
}
