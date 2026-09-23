/**
 * The Keeper's system prompt on a host-triggered run (contract §128.1, docs/pi-host-contract.md).
 *
 * Pi 0.87 keeps the system prompt in the transcript: a system message carries named `sections`, and
 * a request replays every system message into the prompt the model reads. A user prompt re-diffs the
 * sections against the session's current prompt before its first request (`prompt()` ->
 * `_preparePromptAndToolLoadout`); a later request inside the same run is re-diffed by the next-turn
 * refresh. A run started by `pi.sendMessage(..., {triggerTurn: true})` does neither before its first
 * request, so that request reads whatever prompt the transcript last recorded.
 *
 * In PipiCOC the setup guide and the table share one session file: the setup process records
 * `prompts/setup.md` as the preamble, exits, and the play process opens the same file with
 * `prompts/keeper.md` and starts the opening with a host message. On 2026-09-22 (`game-21ac44b7`,
 * installed App) the opening's first request therefore ran on the setup guide's preamble -- no four
 * laws, no `{{say:Name}}` rule -- the Keeper introduced Steven Knott and wrote his lines unwrapped,
 * and only the second request of the run (after `look`/`resolve`) carried the Keeper prompt.
 *
 * The public `context_with_system` hook owns the system messages of one request, and the event
 * context's `getSystemPrompt()` is the prompt this session is running on now. When the prompt the
 * transcript replays is not that one, the request gets the shape Pi itself sends for a forced prompt
 * (`_installAgentForcedPromptProjection`): one leading system message holding the current prompt and
 * the replayed tool declarations, the later system messages folded into it. Nothing is persisted:
 * Pi's own next-turn refresh writes the durable section patch, after which the two agree again.
 */
import { getCurrentSystemMessage, getSystemMessageText } from "@earendil-works/pi-ai";

type Message = { role?: unknown; [key: string]: unknown };

/** The request's messages with the session's current prompt at their head, or undefined when the transcript already carries it. */
export function currentPromptHead(messages: readonly Message[], prompt: unknown): Message[] | undefined {
	if (typeof prompt !== "string" || !prompt) return undefined;
	const current = getCurrentSystemMessage(messages as never) as (Message & { toolsAdded?: unknown[]; timestamp?: number }) | undefined;
	if (!current || getSystemMessageText(current as never) === prompt) return undefined;
	const head: Message = { role: "system", content: prompt, ...(current.toolsAdded ? { toolsAdded: current.toolsAdded } : {}), timestamp: current.timestamp ?? 0 };
	return [head, ...messages.filter((message) => message.role !== "system")];
}
