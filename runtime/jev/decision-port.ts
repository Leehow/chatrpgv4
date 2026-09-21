/** One typed decision port for all registered task domains. Usage is charged by the adapter once. */
import type { DecisionBatch, DecisionResult } from './contracts.ts';
import type { TaskLease } from './task-context.ts';

export interface DecisionPort {
  decide(batch: DecisionBatch, lease: TaskLease): Promise<DecisionResult>;
}
