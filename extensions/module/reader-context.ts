/** Keep page-image history bounded without changing the recorded reader transcript. */
import { appendFileSync } from "node:fs";

export function boundImages(messages: any[], previouslyIncluded = new Set<string>(), byteBudget = 32 * 1024 * 1024, countBudget = 24) {
	const copy = messages.map(message => ({ ...message, ...(Array.isArray(message.content) ? { content: [...message.content] } : {}) }));
	let bytes = 0, count = 0;
	const included: string[] = [];
	for (let i = copy.length - 1; i >= 0; i--) {
		const message = copy[i];
		if (!Array.isArray(message.content)) continue;
		for (let j = message.content.length - 1; j >= 0; j--) {
			const block = message.content[j];
			if (block.type !== "image") continue;
			const size = typeof block.data === "string" ? Buffer.byteLength(block.data, "base64") : 0;
			const key = message.toolCallId ?? `message-${i}`;
			if (!previouslyIncluded.has(key) || count === 0 || (count < countBudget && bytes + size <= byteBudget)) {
				bytes += size; count++;
				included.push(key);
				continue;
			}
			message.content[j] = { type: "text", text: previouslyIncluded.has(key)
				? "[Earlier page image omitted from this request to bound its size. Reopen the cached image with read if you need its details again.]"
				: "[This image has not been included in the model context. Read fewer images at once and reopen this cached image before using its contents.]" };
		}
	}
	return { messages: copy, included, bytes, count };
}

export default function readerContext(pi: any) {
	const sent = new Set<string>();
	pi.on("before_provider_request", (event: any, ctx: any) => {
		const log = process.env.PI_COC_READER_REQUESTS_LOG;
		if (log) appendFileSync(log, JSON.stringify({at: new Date().toISOString(), provider: ctx.model?.provider,
			model: event.payload?.model, reasoning_effort: event.payload?.reasoning?.effort ?? event.payload?.reasoning_effort ?? null}) + "\n");
	});
	pi.on("context", (event: any) => {
		const result = boundImages(event.messages, sent);
		for (const id of result.included) sent.add(id);
		const log = process.env.PI_COC_READER_IMAGES_LOG;
		if (log) appendFileSync(log, JSON.stringify({ included: result.included, bytes: result.bytes, count: result.count }) + "\n");
		return { messages: result.messages };
	});
}
