/** Domains map internal outcomes explicitly; this layer has no universal failure policy. */
import { ContractError, TASK_OUTCOMES, type TaskResult } from './contracts.ts';

export type OutcomeHandlers<T> = { [K in TaskResult['status']]: (result: TaskResult & { status: K }) => T };
export function mapTaskOutcome<T>(result: TaskResult, handlers: OutcomeHandlers<T>): T {
  if (TASK_OUTCOMES.some(status => !Object.hasOwn(handlers, status) || typeof handlers[status] !== 'function')
    || !TASK_OUTCOMES.includes(result.status)) throw new ContractError('incomplete_outcome_mapping');
  return (handlers[result.status] as (result: TaskResult) => T)(structuredClone(result));
}

/** Losing an awaiter never cancels the separately owned operation. */
export function awaitOrYield<T>(operation: Promise<T>, waiter: AbortSignal): Promise<{ status: 'ready'; value: T } | { status: 'yielded' }> {
  return new Promise((resolve, reject) => {
    const yieldWait = () => { waiter.removeEventListener('abort', yieldWait); resolve({ status: 'yielded' }); };
    operation.then(value => { waiter.removeEventListener('abort', yieldWait); resolve({ status: 'ready', value }); },
      error => { waiter.removeEventListener('abort', yieldWait); reject(error); });
    if (waiter.aborted) yieldWait();
    else waiter.addEventListener('abort', yieldWait, { once: true });
  });
}
