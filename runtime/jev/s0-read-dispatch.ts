/**
 * S0 only: call the current public Pi hooks and wrapped recall executor.
 * Nested reads are host operations, not fabricated assistant turns or Pi tool-result messages.
 * Full dispatcher/event parity is a later gate; the ordinary writer still uses narrate/ask.
 */
import { randomUUID } from 'node:crypto';
import { validateToolArguments, type AssistantMessage, type ToolCall } from '@earendil-works/pi-ai';
import type { AgentToolResult, AgentContext } from '@earendil-works/pi-agent-core';
import type { AgentSession } from '@earendil-works/pi-coding-agent';

export interface S0ReadTrace { operationId: string; phase: 'prepare' | 'execute' | 'finalize' | 'end'; isError?: boolean }
export interface S0ReadObservation { operationId: string; result: AgentToolResult<unknown>; isError: boolean }
export interface S0ReadOptions {
  current(): boolean;
  /** Allows only this host-issued child ID through the private role's recall gate. */
  enter(operationId: string): () => void;
  trace(event: S0ReadTrace): void;
}

/** The host-owned S0 proposal is narrower than Pi's permissive public argument schemas. */
function closedSchema(value: unknown): any {
  if (Array.isArray(value)) return value.map(closedSchema);
  if (!value || typeof value !== 'object') return value;
  const result = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, closedSchema(child)]));
  if (result.type === 'object' && result.properties) result.additionalProperties = false;
  return result;
}

export function createS0ReadDispatcher(session: AgentSession, options: S0ReadOptions) {
  const tool = session.agent.state.tools.find(candidate => candidate.name === 'recall');
  const before = session.agent.beforeToolCall, after = session.agent.afterToolCall;
  if (!tool || !before || !after) throw new Error('S0 requires the bound Pi recall executor and both hooks');
  const proposalTool = { ...tool, parameters: closedSchema(tool.parameters) };
  let busy = false;

  return async (args: Record<string, unknown>, parent: AssistantMessage, signal: AbortSignal): Promise<S0ReadObservation> => {
    const operationId = `jev-read-${randomUUID()}`;
    const errorResult = (message: string, terminate?: boolean): AgentToolResult<unknown> => ({
      content: [{ type: 'text', text: message }], details: {}, ...(terminate ? { terminate } : {}),
    });
    const live = () => !signal.aborted && options.current() && session.agent.beforeToolCall === before
      && session.agent.afterToolCall === after && session.agent.state.tools.includes(tool);
    if (busy) throw new Error('S0 read operations must be sequential');
    if (!live() || !session.messages.includes(parent) || parent.role !== 'assistant') throw new Error('S0 read binding is stale or cancelled');
    busy = true;
    let leave = () => {};
    let result: AgentToolResult<unknown>, isError = false;
    const call: ToolCall = { type: 'toolCall', id: operationId, name: 'recall', arguments: structuredClone(args) };
    const context = (): AgentContext => ({ systemPrompt: session.agent.state.systemPrompt,
      messages: session.messages, tools: session.agent.state.tools });
    try {
      leave = options.enter(operationId);
      options.trace({ operationId, phase: 'prepare' });
      let validated: unknown;
      try {
        const prepared = tool.prepareArguments ? { ...call, arguments: tool.prepareArguments(call.arguments) as ToolCall['arguments'] } : call;
        validated = validateToolArguments(proposalTool, prepared);
        const block = await before({ assistantMessage: parent, toolCall: call, args: validated, context: context() }, signal);
        if (!live()) return { operationId, result: errorResult('S0 read binding is stale or cancelled'), isError: true };
        if (block?.block) return { operationId, result: errorResult(block.reason || 'S0 read was blocked', block.terminate), isError: true };
      } catch (error) {
        return { operationId, result: errorResult(error instanceof Error ? error.message : 'S0 read preflight failed'), isError: true };
      }
      options.trace({ operationId, phase: 'execute' });
      try { result = await tool.execute(operationId, validated, signal); }
      catch (error) { result = errorResult(error instanceof Error ? error.message : 'S0 read execution failed'); isError = true; }
      options.trace({ operationId, phase: 'finalize' });
      // An executed failure still reaches the normal failure ledger. A preflight block does not.
      try {
        if (!live()) return { operationId, result: errorResult('S0 read binding is stale or cancelled'), isError: true };
        const override = await after({ assistantMessage: parent, toolCall: call, args: validated, result, isError, context: context() }, signal);
        if (override) {
          result = { ...result, content: override.content ?? result.content, details: override.details ?? result.details,
            usage: override.usage ?? result.usage, terminate: override.terminate ?? result.terminate };
          isError = override.isError ?? isError;
        }
      } catch (error) { result = errorResult(error instanceof Error ? error.message : 'S0 read finalization failed'); isError = true; }
      if (!live()) return { operationId, result: errorResult('S0 read binding is stale or cancelled'), isError: true };
      return { operationId, result, isError };
    } finally {
      try { options.trace({ operationId, phase: 'end' }); }
      finally { try { leave(); } finally { busy = false; } }
    }
  };
}
