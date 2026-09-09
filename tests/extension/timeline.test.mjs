/**
 * The timeline panel's pack side (contract §29): both invokes bind the session's own campaign,
 * a successful branch leaves its watershed as a `coc-mechanics` entry plus a `timeline-changed`
 * push, and kernel refusals arrive as coded answers rather than thrown crashes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerTimelinePanel } from "../../pipicoc/timeline.ts";

function piSurface() {
	const entries = [];
	return {
		events: new EventEmitter(),
		on() {},
		appendEntry(customType, data) { entries.push({ customType, data }); },
		entries,
	};
}

function withRegistry(run) {
	const symbol = Symbol.for("pipiui.ext-invoke.registry");
	const prior = globalThis[symbol];
	const handlers = new Map();
	globalThis[symbol] = { version: 1, register(_id, method, handler) { handlers.set(method, handler); return () => {}; } };
	return Promise.resolve().then(() => run(handlers)).finally(() => { globalThis[symbol] = prior; });
}

async function wordsFixture() {
	const contentRoot = await mkdtemp(join(tmpdir(), "coc-timeline-words-"));
	await writeFile(join(contentRoot, "languages.json"), JSON.stringify({ default: "zz", languages: { zz: { autonym: "Zz" } } }));
	await mkdir(join(contentRoot, "ui/zz"), { recursive: true });
	await writeFile(join(contentRoot, "ui/zz/timeline.json"), JSON.stringify({ title: "zz title" }));
	return contentRoot;
}

test("an unbound session answers unbound, and never leaks a panel-supplied campaign", async () => {
	await withRegistry(async (handlers) => {
		const pi = piSurface();
		registerTimelinePanel(pi);
		// A live session without a binding: the kernel bridge exists, no campaign has been bound.
		pi.events.emit("coc:kernel-bridge", { call: async () => ({}) });
		const unbound = await handlers.get("timeline.graph")({});
		assert.equal(unbound.status, "unbound");
		assert.equal(unbound.campaign, null);
		const calls = [];
		pi.events.emit("coc:kernel-bridge", { campaign: "selected", call: async (method, params) => { calls.push({ method, params }); return { active: "main", lines: [], nodes: [] }; } });
		const graph = await handlers.get("timeline.graph")({ campaign: "forged", max_nodes: 50 });
		assert.equal(calls[0].method, "table.graph");
		assert.deepEqual(calls[0].params, { max_nodes: 50, campaign: "selected" });
		assert.equal(graph.status, "ready");
		assert.equal(graph.active, "main");
	});
});

test("a timeline answer carries the session language words", async () => {
	await withRegistry(async (handlers) => {
		const contentRoot = await wordsFixture();
		const pi = piSurface();
		registerTimelinePanel(pi);
		pi.events.emit("coc:kernel-bridge", { campaign: "selected", runtime: { contentRoot }, call: async () => ({ lines: [], nodes: [] }) });
		const answer = await handlers.get("timeline.graph")({});
		assert.equal(answer.ui.tag, "zz");
		assert.equal(answer.ui.words.timeline.title, "zz title");
	});
});

test("a successful branch appends the watershed entry and pushes timeline-changed", async () => {
	await withRegistry(async (handlers) => {
		const pi = piSurface();
		registerTimelinePanel(pi);
		pi.events.emit("coc:kernel-bridge", {
			campaign: "selected",
			call: async (method, params) => method === "table.branch"
				? { ok: true, line: { name: params.name ?? "if-3-1", kind: "if", loop: 0, forked_from: { line: "main", turn: 3, commit: "abc123" } }, active: params.name ?? "if-3-1", branched_from: { line: "main", turn: 3, commit: "abc123" } }
				: {},
		});
		pi.events.emit("coc:table-open", { campaign: "selected", open: { campaign: { play_language: "en" } } });
		const pushed = [];
		const priorPort = process.env.PIPIUI_BRIDGE_PORT;
		const priorCapability = process.env.PIPIUI_SESSION_CAPABILITY;
		const priorFetch = globalThis.fetch;
		process.env.PIPIUI_BRIDGE_PORT = "1";
		process.env.PIPIUI_SESSION_CAPABILITY = "test";
		globalThis.fetch = async (url, init) => { pushed.push(JSON.parse(init.body)); return { ok: true }; };
		try {
			const answer = await handlers.get("timeline.branch")({ commit: "abc123", name: "what-if", campaign: "forged" });
			assert.equal(answer.status, "ready");
			assert.equal(answer.ok, true);
			assert.equal(answer.line.name, "what-if");
			assert.equal(pi.entries.length, 1);
			assert.equal(pi.entries[0].customType, "coc-mechanics");
			assert.deepEqual(pi.entries[0].data, {
				turn: 3,
				mechanics: [{ kind: "worldline", operation: "fork", line: "what-if", from_line: "main", from_turn: 3 }],
				play_language: "en",
			});
			await new Promise((resolve) => setImmediate(resolve));
			assert.ok(pushed.some((body) => body.action === "ext.emit" && body.event === "timeline-changed"), "branch success pushes timeline-changed");
		} finally {
			if (priorPort === undefined) delete process.env.PIPIUI_BRIDGE_PORT; else process.env.PIPIUI_BRIDGE_PORT = priorPort;
			if (priorCapability === undefined) delete process.env.PIPIUI_SESSION_CAPABILITY; else process.env.PIPIUI_SESSION_CAPABILITY = priorCapability;
			globalThis.fetch = priorFetch;
		}
	});
});

test("kernel refusals are coded answers, and a held campaign lock reads as operation_in_progress", async () => {
	await withRegistry(async (handlers) => {
		const pi = piSurface();
		registerTimelinePanel(pi);
		pi.events.emit("coc:kernel-bridge", { campaign: "selected", call: async () => { throw Object.assign(new Error("turn 4 is acting"), { code: "operation_in_progress" }); } });
		const busy = await handlers.get("timeline.branch")({ commit: "abc123" });
		assert.equal(busy.status, "error");
		assert.equal(busy.code, "operation_in_progress");
		pi.events.emit("coc:kernel-bridge", { campaign: "selected", call: async () => { throw Object.assign(new Error("another process is holding"), { code: "internal", details: { reason: "campaign_locked" } }); } });
		const locked = await handlers.get("timeline.branch")({ commit: "abc123" });
		assert.equal(locked.code, "operation_in_progress");
		const bad = await handlers.get("timeline.branch")({});
		assert.equal(bad.code, "invalid_params");
	});
});

test("a committed turn pushes timeline-changed", async () => {
	await withRegistry(async (handlers) => {
		const pi = piSurface();
		registerTimelinePanel(pi);
		assert.ok(handlers.has("timeline.graph") && handlers.has("timeline.branch"));
		const pushed = [];
		const priorPort = process.env.PIPIUI_BRIDGE_PORT;
		const priorCapability = process.env.PIPIUI_SESSION_CAPABILITY;
		const priorFetch = globalThis.fetch;
		process.env.PIPIUI_BRIDGE_PORT = "1";
		process.env.PIPIUI_SESSION_CAPABILITY = "test";
		globalThis.fetch = async (url, init) => { pushed.push(JSON.parse(init.body)); return { ok: true }; };
		try {
			pi.events.emit("coc:turn-committed", {});
			await new Promise((resolve) => setImmediate(resolve));
			assert.ok(pushed.some((body) => body.action === "ext.emit" && body.event === "timeline-changed"));
		} finally {
			if (priorPort === undefined) delete process.env.PIPIUI_BRIDGE_PORT; else process.env.PIPIUI_BRIDGE_PORT = priorPort;
			if (priorCapability === undefined) delete process.env.PIPIUI_SESSION_CAPABILITY; else process.env.PIPIUI_SESSION_CAPABILITY = priorCapability;
			globalThis.fetch = priorFetch;
		}
	});
});
