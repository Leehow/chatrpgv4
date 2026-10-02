/**
 * A provider that says nothing at all to its first request -- never even the response headers -- and answers each
 * later request after `lateMs`, as an OpenAI chat-completions stream carrying `prose`. Patch 0005 (owner, 2026-10-02):
 * the Keeper call cap cuts only a call that has not answered, and the step's re-send is not capped, so the tests of
 * that seam need a re-send that answers.
 */
import { createServer } from "node:net";

export function silentThenLateProvider(t, { lateMs, prose, model = "stall-1" }) {
	const sockets = new Set(), timers = new Set();
	let requests = 0;
	const answer = (socket) => {
		socket.write("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nTransfer-Encoding: chunked\r\n\r\n");
		const chunk = (text) => socket.write(`${Buffer.byteLength(text).toString(16)}\r\n${text}\r\n`);
		const frame = (delta, finish) => chunk(`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model,
			choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
		frame({ role: "assistant", content: prose }, null);
		frame({}, "stop");
		chunk("data: [DONE]\n\n");
		socket.write("0\r\n\r\n");
	};
	const server = createServer((socket) => {
		sockets.add(socket);
		socket.on("error", () => {});
		socket.on("close", () => sockets.delete(socket));
		let received = "";
		socket.on("data", (data) => {
			received += data;
			if (!received.includes("\r\n\r\n")) return;
			received = "";
			if (++requests === 1) return;
			const timer = setTimeout(() => { timers.delete(timer); if (!socket.destroyed) answer(socket); }, lateMs);
			timers.add(timer);
		});
	});
	t.after(() => new Promise((done) => { for (const timer of timers) clearTimeout(timer); for (const socket of sockets) socket.destroy(); server.close(done); }));
	return new Promise((ready) => server.listen(0, "127.0.0.1", () => ready({ port: server.address().port, requests: () => requests })));
}
