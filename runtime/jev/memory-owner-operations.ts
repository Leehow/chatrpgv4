/** Private memory owner bindings. The kernel owns source validation, cursor and publication. */
import type { OwnedOperation } from '../../extensions/kernel/canonical-operation-dispatcher.ts';
import { ContractError, isPlainRecord, type IntentBinding, type Json, type ObservationPacket, type ReadSet, type TaskContext } from './contracts.ts';

export interface MemoryBinding { packet: Record<string, any>; intent: IntentBinding }
export function memoryReadSet(packet: Record<string, any>): ReadSet {
  return [{kind: 'source', resource: `memory-turn:${packet.turn}`, revision: packet.origin.revision},
    {kind: 'family', resource: 'memory-write', revision: '3'}];
}
export function registerMemoryOperations(options: {
  registerOwned(name: string, operation: OwnedOperation): () => void;
  binding(task: TaskContext): MemoryBinding;
  call(method: string, params: Record<string, unknown>): Promise<Record<string, any>>;
}): () => void {
  const releases: Array<() => void> = [];
  for (const operation of ['memory.job', 'memory.submit']) releases.push(options.registerOwned(operation, {
    capability: 'memory.write', kind: 'publication',
    validate(args) {
      if (!isPlainRecord(args) || (operation === 'memory.job' ? Object.keys(args).length !== 0
        : Object.keys(args).join(',') !== 'referenced' || !isPlainRecord(args.referenced))) throw new ContractError('invalid_memory_operation');
      return args;
    },
    async execute(proposal, context) {
      const bound = options.binding(context.task.context), campaign = context.task.context.scope.campaign;
      let result: Record<string, any>;
      try {
        result = await options.call(operation, operation === 'memory.job'
          ? {campaign, mode: 'referenced', turn: bound.packet.turn}
          : {campaign, job_id: bound.packet.job_id, referenced: proposal.args.referenced});
      } catch (error) {
        if (!['invalid_params', 'idempotency_conflict', 'campaign_not_ready'].includes(String((error as any)?.code))) throw error;
        return {operationId: proposal.id, status: 'refused', result: {code: (error as any).code}, refs: [], receipts: [],
          readSet: proposal.readSet, coverage: {used: [], omitted: [], unknown: ['Memory publication was refused by its kernel owner.']}};
      }
      const packet = operation === 'memory.job' ? result : result.next;
      if (!packet || packet.protocol !== 'memory-reference-v1' || packet.job_id !== bound.packet.job_id
        || packet.origin?.revision !== bound.packet.origin.revision) throw new ContractError('memory_origin_changed');
      bound.packet = structuredClone(packet);
      const decisions: Record<string, Json>[] = operation === 'memory.submit' && isPlainRecord(proposal.args.referenced) && Array.isArray(proposal.args.referenced.decisions)
        ? proposal.args.referenced.decisions.filter((value): value is Record<string, Json> => isPlainRecord(value)) : [];
      const refs = decisions.filter(value => value.outcome === 'retain').flatMap(value =>
        (packet.story_sources as Array<Record<string, any>>).filter(segment => segment.alias === value.source).map(segment => segment.ref));
      return {operationId: proposal.id, status: 'succeeded', result: JSON.parse(JSON.stringify(result)) as Json,
        refs, receipts: [], readSet: proposal.readSet, coverage: {
          used: decisions.filter(value => value.outcome === 'retain').map(value => String(value.source)),
          omitted: decisions.filter(value => value.outcome === 'skip').map(value => String(value.source)),
          unknown: decisions.filter(value => value.outcome === 'defer').map(value => String(value.source)),
        }} satisfies ObservationPacket;
    },
  }));
  return () => { for (const release of releases) release(); };
}
