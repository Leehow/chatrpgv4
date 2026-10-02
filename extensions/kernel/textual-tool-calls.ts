/**
 * A model's tool call written as text is restored as the tool call it is, before the turn reads the message.
 *
 * Installed App, 2026-10-02 (flapcode/gpt-6-luna, character setup): the same model that had just called `setup`
 * natively wrote its next three calls into the text channel -- ` to=functions.setup  code:\n{"step":"note",...}` --
 * between its thinking blocks, and ended with `stop`. Nothing ran, the three lines were shown to the player as the
 * wizard's reply, and the model then told the player the card had not been made. The header is the OpenAI chat
 * format's recipient line (`to=functions.<name>`) leaking through a relay.
 *
 * Pi's `message_end` lets an extension replace the finalized message in place before the loop reads its tool calls
 * (`AgentSession._replaceMessageInPlace`; `agent-loop.ts` takes `message.content` after `message_end` is awaited), so
 * a call restored here runs like any native call. Only a header naming a tool active in this session, followed by
 * one JSON object that parses, is restored; any other text is left as it was. Structural parsing of a machine
 * format, never a reading of what the prose means.
 */
import { randomUUID } from "node:crypto";

const HEADER = /to=functions\.([A-Za-z_][\w-]*)/g;

/** The end of the JSON object that starts at `start` (a `{`), honouring strings and escapes; -1 when unbalanced. */
function objectEnd(text: string, start: number): number {
	let depth = 0, inString = false, escaped = false;
	for (let index = start; index < text.length; index++) {
		const char = text[index];
		if (inString) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === "\"") inString = false;
			continue;
		}
		if (char === "\"") inString = true;
		else if (char === "{") depth++;
		else if (char === "}" && --depth === 0) return index;
	}
	return -1;
}

export interface TextualCall { name: string; arguments: Record<string, unknown> }

/**
 * The calls written in `text`, and the text left once they are taken out. A header must be followed, after at most a
 * channel word and a colon on its own line, by the object itself; anything else is not a call.
 */
export function takeTextualCalls(text: string, isTool: (name: string) => boolean): { calls: TextualCall[]; rest: string } {
	const calls: TextualCall[] = [];
	let rest = "", cursor = 0;
	for (const match of text.matchAll(HEADER)) {
		const at = match.index ?? 0;
		if (at < cursor) continue;
		const after = text.slice(at + match[0].length);
		const lead = /^[ \t]*(?:[A-Za-z_]+[ \t]*)?:?[ \t]*\r?\n?[ \t]*/.exec(after)?.[0] ?? "";
		const start = at + match[0].length + lead.length;
		if (text[start] !== "{" || !isTool(match[1])) continue;
		const end = objectEnd(text, start);
		if (end < 0) continue;
		let parsed: unknown;
		try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { continue; }
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
		calls.push({ name: match[1], arguments: parsed as Record<string, unknown> });
		rest += text.slice(cursor, at);
		cursor = end + 1;
	}
	return { calls, rest: rest + text.slice(cursor) };
}

type Block = { type: string; text?: string; [key: string]: unknown };

/**
 * The message with every text-written call restored as a `toolCall` block where it stood, or `undefined` when there
 * was none. A text block left empty is dropped; a `stop` becomes `toolUse` once the message carries a call.
 */
export function restoreTextualToolCalls<T extends { role?: string; content?: unknown; stopReason?: string }>(message: T,
	isTool: (name: string) => boolean): { message: T; restored: string[] } | undefined {
	if (message?.role !== "assistant" || !Array.isArray(message.content)) return undefined;
	const content: Block[] = [], restored: string[] = [];
	for (const block of message.content as Block[]) {
		if (block?.type !== "text" || typeof block.text !== "string" || !block.text.includes("to=functions.")) { content.push(block); continue; }
		const { calls, rest } = takeTextualCalls(block.text, isTool);
		if (!calls.length) { content.push(block); continue; }
		if (rest.trim()) content.push({ ...block, text: rest.trim() });
		for (const call of calls) {
			content.push({ type: "toolCall", id: `textcall_${randomUUID().replace(/-/g, "").slice(0, 24)}`, name: call.name, arguments: call.arguments });
			restored.push(call.name);
		}
	}
	if (!restored.length) return undefined;
	return { message: { ...message, content, ...(message.stopReason === "stop" ? { stopReason: "toolUse" } : {}) }, restored };
}
