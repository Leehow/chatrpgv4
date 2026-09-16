/**
 * The turn-illustration lane (contract §35): the invoke answers early and pushes late, one job
 * runs per message row, the portrait rides as the reference only within its byte limit, the
 * prompt comes from the tool-enabled lane, and a failure leaves the row bare.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerIllustrationPanel } from "../../pipicoc/illustration.ts";
import { waitFor } from "./wait.mjs";

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

/** The lane never reads words; a fake content root only has to exist for the instruction path. */
async function homeFixture() {
	const home = await mkdtemp(join(tmpdir(), "coc-illustration-home-"));
	const contentRoot = await mkdtemp(join(tmpdir(), "coc-illustration-content-"));
	return { home, contentRoot };
}

function okRunner(calls) {
	return async (request) => {
		calls.push(request);
		await writeFile(join(request.cwd, "prompt.json"), JSON.stringify({ prompt: "cinematic fake prompt" }));
		return { ok: true, code: 0, timedOut: false, ms: 1, stderr: "", command: [] };
	};
}

function fakeImage(ops) {
	return async (_context, op) => {
		ops.push(op);
		return { bytes: Buffer.from("fakepng"), mime: "image/png" };
	};
}

function openTable(pi, { home, contentRoot, campaign = "c1" }) {
	pi.events.emit("coc:kernel-bridge", {
		campaign,
		runtime: { home, contentRoot, signal: new AbortController().signal },
		call: async () => ({}),
	});
	pi.events.emit("coc:table-open", { campaign, open: { campaign: { play_language: "zz" } } });
}

async function illustrationFiles(home, campaign = "c1") {
	const dir = join(home, ".coc", "campaigns", campaign, "illustrations");
	const files = await readdir(dir).catch(() => []);
	return { dir, files };
}

test("an unbound session refuses generate and answers an empty list", async () => {
	await withRegistry(async (handlers) => {
		const pi = piSurface();
		registerIllustrationPanel(pi);
		// No kernel bridge at all: the table is not open.
		const closed = await handlers.get("illustration.generate")({ messageId: "m1", text: "The door creaks open." });
		assert.equal(closed.ok, false);
		assert.equal(closed.error.code, "table_not_open");
		// A live bridge without a binding: no campaign is open.
		pi.events.emit("coc:kernel-bridge", { call: async () => ({}) });
		const unbound = await handlers.get("illustration.generate")({ messageId: "m1", text: "The door creaks open." });
		assert.equal(unbound.ok, false);
		assert.equal(unbound.error.code, "table_not_open");
		const { home, contentRoot } = await homeFixture();
		pi.events.emit("coc:kernel-bridge", {
			runtime: { home, contentRoot, signal: new AbortController().signal },
			call: async () => ({}),
		});
		const noCampaign = await handlers.get("illustration.generate")({ messageId: "m1", text: "The door creaks open." });
		assert.equal(noCampaign.ok, false);
		assert.equal(noCampaign.error.code, "campaign_not_open");
		assert.deepEqual(await handlers.get("illustration.list")({}), { images: [] });
	});
});

test("the happy path stores the image, rides the portrait as reference, and serves get and list", async () => {
	await withRegistry(async (handlers) => {
		const { home, contentRoot } = await homeFixture();
		const folder = join(home, ".coc", "campaigns", "c1");
		await mkdir(folder, { recursive: true });
		const portraitBytes = Buffer.alloc(1024, 7);
		await writeFile(join(folder, "portrait.png"), portraitBytes);
		const ops = [];
		const runnerCalls = [];
		const pi = piSurface();
		const panel = registerIllustrationPanel(pi, { generateImage: fakeImage(ops), runner: okRunner(runnerCalls) });
		openTable(pi, { home, contentRoot });
		const answer = await handlers.get("illustration.generate")({ messageId: "m1", text: "The door creaks open." });
		assert.deepEqual(answer, { status: "generating" });
		await panel.settled();

		// The prompt lane read the scene; the table-view bridge answers {}, so the card's own
		// description is simply absent and the job still succeeds.
		assert.equal(runnerCalls.length, 1);
		const scene = JSON.parse(await readFile(join(runnerCalls[0].cwd, "scene.json"), "utf8"));
		assert.equal(scene.play_language, "zz");
		assert.equal(scene.scene, "The door creaks open.");
		assert.equal(scene.protagonist.description, undefined);
		assert.equal(scene.protagonist.reference_photo, true);

		assert.equal(ops.length, 1);
		assert.equal(ops[0].kind, "edit");
		assert.equal(ops[0].aspectRatio, "3:4");
		assert.equal(ops[0].prompt, "cinematic fake prompt");
		assert.deepEqual(ops[0].refs, [`data:image/png;base64,${portraitBytes.toString("base64")}`]);

		const { dir, files } = await illustrationFiles(home);
		const stored = files.filter((name) => name.startsWith("ill-"));
		assert.equal(stored.length, 1);
		assert.ok(stored[0].endsWith(".png"));
		const index = JSON.parse(await readFile(join(dir, "index.json"), "utf8"));
		assert.equal(index.m1, stored[0]);

		const got = await handlers.get("illustration.get")({ messageId: "m1" });
		assert.equal(got.messageId, "m1");
		assert.equal(got.image, `data:image/png;base64,${Buffer.from("fakepng").toString("base64")}`);
		const listed = await handlers.get("illustration.list")({});
		assert.deepEqual(listed, { images: [{ messageId: "m1", image: got.image }] });
	});
});

test("without a portrait the call is a plain generation", async () => {
	await withRegistry(async (handlers) => {
		const { home, contentRoot } = await homeFixture();
		const ops = [];
		const runnerCalls = [];
		const pi = piSurface();
		const panel = registerIllustrationPanel(pi, { generateImage: fakeImage(ops), runner: okRunner(runnerCalls) });
		openTable(pi, { home, contentRoot });
		assert.deepEqual(await handlers.get("illustration.generate")({ messageId: "m1", text: "Rain on the windows." }), { status: "generating" });
		await panel.settled();
		assert.equal(ops.length, 1);
		assert.equal(ops[0].kind, "gen");
		assert.equal(ops[0].refs, undefined);
		const scene = JSON.parse(await readFile(join(runnerCalls[0].cwd, "scene.json"), "utf8"));
		assert.equal(scene.protagonist.reference_photo, false);
	});
});

test("an oversize portrait drops the reference and the push reports it", async () => {
	await withRegistry(async (handlers) => {
		const { home, contentRoot } = await homeFixture();
		const folder = join(home, ".coc", "campaigns", "c1");
		await mkdir(folder, { recursive: true });
		await writeFile(join(folder, "portrait.png"), Buffer.alloc(401 * 1024, 9));
		const ops = [];
		const pi = piSurface();
		const panel = registerIllustrationPanel(pi, { generateImage: fakeImage(ops), runner: okRunner([]) });
		openTable(pi, { home, contentRoot });
		const pushed = [];
		const priorPort = process.env.PIPIUI_BRIDGE_PORT;
		const priorCapability = process.env.PIPIUI_SESSION_CAPABILITY;
		const priorFetch = globalThis.fetch;
		process.env.PIPIUI_BRIDGE_PORT = "1";
		process.env.PIPIUI_SESSION_CAPABILITY = "test";
		globalThis.fetch = async (_url, init) => { pushed.push(JSON.parse(init.body)); return { ok: true }; };
		try {
			assert.deepEqual(await handlers.get("illustration.generate")({ messageId: "m1", text: "A long corridor." }), { status: "generating" });
			await panel.settled();
			assert.equal(ops.length, 1);
			assert.equal(ops[0].kind, "gen");
			assert.equal(ops[0].refs, undefined);
			const change = pushed.find((body) => body.action === "ext.emit" && body.event === "illustration-changed");
			assert.ok(change, "the job end is pushed, not answered");
			assert.equal(change.payload.messageId, "m1");
			assert.equal(change.payload.status, "ready");
			assert.equal(change.payload.reference, "dropped-oversize");
		} finally {
			if (priorPort === undefined) delete process.env.PIPIUI_BRIDGE_PORT; else process.env.PIPIUI_BRIDGE_PORT = priorPort;
			if (priorCapability === undefined) delete process.env.PIPIUI_SESSION_CAPABILITY; else process.env.PIPIUI_SESSION_CAPABILITY = priorCapability;
			globalThis.fetch = priorFetch;
		}
	});
});

test("one job per row: a click while it runs starts nothing, a click after it lands regenerates", async () => {
	await withRegistry(async (handlers) => {
		const { home, contentRoot } = await homeFixture();
		const ops = [];
		const runnerCalls = [];
		let release;
		const gate = new Promise((resolve) => { release = resolve; });
		const runner = async (request) => {
			runnerCalls.push(request);
			await gate;
			await writeFile(join(request.cwd, "prompt.json"), JSON.stringify({ prompt: "cinematic fake prompt" }));
			return { ok: true, code: 0, timedOut: false, ms: 1, stderr: "", command: [] };
		};
		const pi = piSurface();
		const panel = registerIllustrationPanel(pi, { generateImage: fakeImage(ops), runner });
		openTable(pi, { home, contentRoot });
		assert.deepEqual(await handlers.get("illustration.generate")({ messageId: "m1", text: "First." }), { status: "generating" });
		// Wait until the first job reaches the runner; it then parks on the gate. The job reads the
		// card, the portrait and writes scene.json first, so this is real I/O: a wall-clock deadline,
		// never a count of event-loop turns — under whole-suite load the turns run out first.
		await waitFor(() => runnerCalls.length === 1, { label: "the first job reaching the runner" });
		// The second click is already answered and starts nothing.
		assert.deepEqual(await handlers.get("illustration.generate")({ messageId: "m1", text: "First." }), { status: "generating" });
		assert.equal(runnerCalls.length, 1);
		release();
		await panel.settled();
		assert.equal(ops.length, 1);
		// After the job landed, the same row illustrates again and overwrites.
		assert.deepEqual(await handlers.get("illustration.generate")({ messageId: "m1", text: "First." }), { status: "generating" });
		await panel.settled();
		assert.equal(runnerCalls.length, 2);
		assert.equal(ops.length, 2);
		const { files } = await illustrationFiles(home);
		assert.equal(files.filter((name) => name.startsWith("ill-")).length, 1);
	});
});

test("a failed prompt lane leaves the row bare, and bad params are refused", async () => {
	await withRegistry(async (handlers) => {
		const { home, contentRoot } = await homeFixture();
		const ops = [];
		const runnerCalls = [];
		const runner = async (request) => {
			runnerCalls.push(request);
			return { ok: false, code: 1, timedOut: false, ms: 1, stderr: "child died", command: [] };
		};
		const pi = piSurface();
		const panel = registerIllustrationPanel(pi, { generateImage: fakeImage(ops), runner });
		openTable(pi, { home, contentRoot });
		assert.deepEqual(await handlers.get("illustration.generate")({ messageId: "m1", text: "It watches from the stairs." }), { status: "generating" });
		await panel.settled();
		// Two rounds, then the failure: no image call, nothing stored, nothing to get.
		assert.equal(runnerCalls.length, 2);
		assert.equal(ops.length, 0);
		const missing = await handlers.get("illustration.get")({ messageId: "m1" });
		assert.equal(missing.ok, false);
		assert.equal(missing.error.code, "illustration_not_found");
		assert.deepEqual(await handlers.get("illustration.list")({}), { images: [] });

		for (const params of [{ messageId: "", text: "x" }, { messageId: "m2", text: "  " }, { messageId: "m2" }, null]) {
			const bad = await handlers.get("illustration.generate")(params);
			assert.equal(bad.ok, false);
			assert.equal(bad.error.code, "invalid_params");
		}
		const badGet = await handlers.get("illustration.get")({});
		assert.equal(badGet.ok, false);
		assert.equal(badGet.error.code, "invalid_params");
	});
});
