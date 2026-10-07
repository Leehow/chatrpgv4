/**
 * A local OpenAI Responses endpoint shaped like flapcode `gpt-6-luna` (contract §190.3): the model takes no output-limit
 * field (`supportsMaxOutputTokens: false`), so every lane call reserves its whole `maxTokens`, 128,000 -- the shape that made
 * RD-08 turn 8's resend fail `task_budget_exhausted` on the run's clerk lease. Request n answers `script[n]` (the last step
 * repeats): `{status, body}` an HTTP error, any other object that JSON streamed back as the answer, with usage.
 */
import { createServer } from "node:http";

export const LUNA = { id: "luna", name: "luna-shaped", api: "openai-responses", reasoning: false, input: ["text"], maxTokens: 128_000, contextWindow: 400_000,
	cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }, compat: { supportsMaxOutputTokens: false } };
/** What each verdict reports: 900 input and 40 output tokens. */
export const LUNA_USAGE = { input_tokens: 900, output_tokens: 40, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } };
export const RATE_LIMITED = { status: 429, body: { detail: "Rate limit exceeded" } };

export function lunaEndpoint(t, script) {
	const hits = [], sockets = new Set();
	const server = createServer((request, response) => {
		request.on("data", () => {});
		request.on("end", () => {
			hits.push(Date.now());
			const step = script[Math.min(hits.length - 1, script.length - 1)];
			if (step.status) { response.writeHead(step.status, { "content-type": "application/json" }); response.end(JSON.stringify(step.body)); return; }
			const text = JSON.stringify(step), item = { id: "m", type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] };
			const events = [
				{ type: "response.created", response: { id: "r", model: "luna", status: "in_progress", output: [] } },
				{ type: "response.output_item.added", output_index: 0, item: { ...item, content: [] } },
				{ type: "response.content_part.added", output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } },
				{ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: text },
				{ type: "response.output_item.done", output_index: 0, item },
				{ type: "response.completed", response: { id: "r", model: "luna", status: "completed", output: [item], usage: LUNA_USAGE } },
			];
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.end(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
		});
	});
	server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
	t.after(() => new Promise((done) => { for (const socket of sockets) socket.destroy(); server.close(done); }));
	return new Promise((ready) => server.listen(0, "127.0.0.1", () => ready({ port: server.address().port, hits })));
}

/** Registers the endpoint as provider `luna`, model `luna/luna`. */
export const registerLuna = (registry, port) =>
	registry.registerProvider("luna", { baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-responses", apiKey: "unused", models: [LUNA] });
