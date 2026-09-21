import { strict as assert } from "node:assert";
import { once } from "node:events";
import { existsSync, realpathSync } from "node:fs";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const ROOT = process.cwd();
const FIXTURE = join(ROOT, "tests/extension/fixtures/jev-s0-rpc-tools.mjs");

function createJsonlClient(child, stderr) {
	let buffer = "";
	const lines = [];
	child.stdout.setEncoding("utf8");
	child.stdout.on("data", data => {
		buffer += data;
		for (;;) {
			const end = buffer.indexOf("\n");
			if (end < 0) break;
			const line = buffer.slice(0, end);
			buffer = buffer.slice(end + 1);
			if (line.trim()) lines.push(JSON.parse(line));
		}
	});
	return async function command(type, data = {}) {
		const id = "rpc-" + Math.random().toString(36).slice(2);
		child.stdin.write(JSON.stringify({ id, type, ...data }) + "\n");
		const deadline = Date.now() + 5_000;
		while (Date.now() < deadline) {
			const found = lines.findIndex(line => line.type === "response" && line.id === id);
			if (found >= 0) {
				const [reply] = lines.splice(found, 1);
				assert.equal(reply.success, true, JSON.stringify(reply));
				return reply.data;
			}
			await new Promise(resolve => setTimeout(resolve, 5));
		}
		throw new Error("timed out waiting for " + type + ": " + stderr());
	};
}

test("source-only startS0Rpc uses public JSONL/RPC runtime replacement with fresh S0 session traces", async t => {
	const cwd = await realpath(await mkdtemp(join(tmpdir(), "jev-s0-rpc-")));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	const agentDir = join(cwd, "agent");
	await mkdir(agentDir, { recursive: true });
	await writeFile(join(agentDir, "settings.json"), JSON.stringify({
		defaultProvider: "s0-rpc-fixture",
		defaultModel: "keeper",
		sessionDir: join(agentDir, "sessions"),
		compaction: { enabled: false },
		retry: { enabled: false },
	}));
	const prompt = join(cwd, "keeper.md");
	await writeFile(prompt, "Fixture keeper prompt.");
	const seed = SessionManager.create(cwd, join(agentDir, "sessions"), { id: "persistent-s0-id" });
	seed.appendMessage({
		role: "user",
		content: "seed transcript entry",
		timestamp: Date.now(),
	});
	seed.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "seed acknowledgement" }],
		api: "fixture",
		provider: "fixture",
		model: "fixture",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "stop",
		timestamp: Date.now(),
	});
	const seedPath = seed.getSessionFile();
	assert.ok(seedPath);
	assert.equal(SessionManager.open(seedPath).getCwd(), cwd);
	const runner = join(cwd, "start-s0-rpc.mjs");
	await writeFile(runner, [
		"import { startS0Rpc } from " + JSON.stringify(pathToFileURL(join(ROOT, "runtime/jev/s0-rpc.ts")).href) + ";",
		"await startS0Rpc(JSON.parse(process.env.JEV_S0_LAUNCH));",
	].join("\n"));
	const launch = {
		cwd,
		args: ["pi", "--system-prompt", prompt, "--extension", FIXTURE, "--session-id", "persistent-s0-id", "--mode", "rpc"],
		env: {
			PI_COC_LAYOUT: "source",
			PI_COC_MODE: "play",
			PI_CODING_AGENT_DIR: agentDir,
			PI_COC_HOME: cwd,
			TYPESAFE_API_KEY: "fixture-only-not-used",
		},
	};
	const child = spawn(process.execPath, [runner], {
		cwd: ROOT,
		env: { ...process.env, JEV_S0_LAUNCH: JSON.stringify(launch) },
		stdio: ["pipe", "pipe", "pipe"],
	});
	let stderr = "";
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", data => { stderr += data; });
	t.after(async () => {
		if (!child.killed) child.kill("SIGTERM");
		await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 1_000))]);
	});
	const command = createJsonlClient(child, () => stderr);
	const state = await command("get_state");
	assert.deepEqual({ provider: state.model.provider, id: state.model.id }, {
		provider: "s0-rpc-fixture",
		id: "keeper",
	});
	assert.equal(state.isStreaming, false);
	assert.equal(state.sessionId, "persistent-s0-id");

	async function assertFreshTrace() {
		const data = await command("get_entries");
		const trace = data.entries.filter(entry => entry.type === "custom" && entry.customType === "coc-jev-s0")
			.map(entry => entry.data)
			.find(entry => entry.kind === "session-bound");
		assert.ok(trace, JSON.stringify(data.entries));
		assert.deepEqual(trace.model, { provider: "s0-rpc-fixture", id: "keeper" });
	}
	await assertFreshTrace();
	const stats = await command("get_session_stats");
	assert.equal(stats.tokens.total, 0);
	assert.equal(stats.cost, 0);

	const entries = await command("get_entries");
	const seededUser = entries.entries.find(entry => entry.type === "message" && entry.message.role === "user");
	assert.ok(seededUser, JSON.stringify(entries.entries));
	await command("fork", { entryId: seededUser.id });
	await assertFreshTrace();

	await command("new_session");
	let newState = await command("get_state");
	assert.deepEqual({ provider: newState.model.provider, id: newState.model.id }, {
		provider: "s0-rpc-fixture",
		id: "keeper",
	});
	assert.ok(newState.sessionFile);
	await command("prompt", { message: "persist this lifecycle session" });
	for (let attempts = 0; attempts < 100; attempts++) {
		newState = await command("get_state");
		if (!newState.isStreaming) break;
		await new Promise(resolve => setTimeout(resolve, 10));
	}
	assert.equal(newState.isStreaming, false);
	assert.equal(existsSync(newState.sessionFile), true, "switch only opens a JSONL that Pi actually persisted");
	assert.equal(realpathSync(SessionManager.open(newState.sessionFile).getCwd()), cwd);
	await assertFreshTrace();

	await command("switch_session", { sessionPath: newState.sessionFile });
	await assertFreshTrace();
	assert.equal(stderr.includes("TYPESAFE_API_KEY"), false);
});

test("source-only S0 rejects an initial JSONL session owned by another workspace", async t => {
	const cwd = await realpath(await mkdtemp(join(tmpdir(), "jev-s0-rpc-outside-")));
	const foreign = await realpath(await mkdtemp(join(tmpdir(), "jev-s0-rpc-foreign-")));
	t.after(() => Promise.all([rm(cwd, { recursive: true, force: true }), rm(foreign, { recursive: true, force: true })]));
	const agentDir = join(cwd, "agent");
	await mkdir(agentDir, { recursive: true });
	await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "s0-rpc-fixture", defaultModel: "keeper" }));
	const prompt = join(cwd, "keeper.md");
	await writeFile(prompt, "Fixture keeper prompt.");
	const foreignManager = SessionManager.create(foreign, join(foreign, "sessions"));
	foreignManager.appendMessage({
		role: "assistant", content: [{ type: "text", text: "foreign" }], api: "fixture", provider: "fixture", model: "fixture",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "stop", timestamp: Date.now(),
	});
	const runner = join(cwd, "start-s0-rpc.mjs");
	await writeFile(runner, [
		"import { startS0Rpc } from " + JSON.stringify(pathToFileURL(join(ROOT, "runtime/jev/s0-rpc.ts")).href) + ";",
		"await startS0Rpc(JSON.parse(process.env.JEV_S0_LAUNCH));",
	].join("\n"));
	const child = spawn(process.execPath, [runner], {
		cwd: ROOT,
		env: { ...process.env, JEV_S0_LAUNCH: JSON.stringify({
			cwd, args: ["pi", "--system-prompt", prompt, "--extension", FIXTURE, "--session", foreignManager.getSessionFile(), "--mode", "rpc"],
			env: { PI_COC_LAYOUT: "source", PI_COC_MODE: "play", PI_CODING_AGENT_DIR: agentDir, TYPESAFE_API_KEY: "fixture-only-not-used" },
		}) },
		stdio: ["ignore", "ignore", "pipe"],
	});
	let stderr = "";
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", data => { stderr += data; });
	const [code] = await once(child, "exit");
	assert.notEqual(code, 0);
	assert.match(stderr, /S0 cannot open a session outside its captured source workspace/);
});

test("source-only no-session preserves an explicit SDK session id without a persisted JSONL", async t => {
	const cwd = await realpath(await mkdtemp(join(tmpdir(), "jev-s0-rpc-memory-")));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	const agentDir = join(cwd, "agent");
	await mkdir(agentDir, { recursive: true });
	await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "s0-rpc-fixture", defaultModel: "keeper" }));
	const prompt = join(cwd, "keeper.md");
	await writeFile(prompt, "Fixture keeper prompt.");
	const runner = join(cwd, "start-s0-rpc.mjs");
	await writeFile(runner, [
		"import { startS0Rpc } from " + JSON.stringify(pathToFileURL(join(ROOT, "runtime/jev/s0-rpc.ts")).href) + ";",
		"await startS0Rpc(JSON.parse(process.env.JEV_S0_LAUNCH));",
	].join("\n"));
	const child = spawn(process.execPath, [runner], {
		cwd: ROOT,
		env: { ...process.env, JEV_S0_LAUNCH: JSON.stringify({
			cwd, args: ["pi", "--system-prompt", prompt, "--extension", FIXTURE, "--no-session", "--session-id", "memory-s0-id", "--mode", "rpc"],
			env: { PI_COC_LAYOUT: "source", PI_COC_MODE: "play", PI_CODING_AGENT_DIR: agentDir, TYPESAFE_API_KEY: "fixture-only-not-used" },
		}) },
		stdio: ["pipe", "pipe", "pipe"],
	});
	t.after(async () => {
		if (!child.killed) child.kill("SIGTERM");
		await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 1_000))]);
	});
	const command = createJsonlClient(child, () => "");
	const state = await command("get_state");
	assert.equal(state.sessionId, "memory-s0-id");
	assert.equal(state.sessionFile, undefined);
	assert.equal((await command("get_session_stats")).tokens.total, 0);
});

test("source-only exact session id reopens the public SDK default session directory", async t => {
	const cwd = await realpath(await mkdtemp(join(tmpdir(), "jev-s0-rpc-default-")));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	const agentDir = join(cwd, "agent");
	await mkdir(agentDir, { recursive: true });
	await writeFile(join(agentDir, "settings.json"), JSON.stringify({
		defaultProvider: "s0-rpc-fixture",
		defaultModel: "keeper",
		compaction: { enabled: false },
		retry: { enabled: false },
	}));
	const prompt = join(cwd, "keeper.md");
	await writeFile(prompt, "Fixture keeper prompt.");
	const runner = join(cwd, "start-s0-rpc.mjs");
	await writeFile(runner, [
		"import { startS0Rpc } from " + JSON.stringify(pathToFileURL(join(ROOT, "runtime/jev/s0-rpc.ts")).href) + ";",
		"await startS0Rpc(JSON.parse(process.env.JEV_S0_LAUNCH));",
	].join("\n"));
	const launch = {
		cwd,
		args: ["pi", "--system-prompt", prompt, "--extension", FIXTURE, "--session-id", "default-s0-id", "--mode", "rpc"],
		env: { PI_COC_LAYOUT: "source", PI_COC_MODE: "play", PI_CODING_AGENT_DIR: agentDir, TYPESAFE_API_KEY: "fixture-only-not-used" },
	};
	const start = () => {
		const child = spawn(process.execPath, [runner], {
			cwd: ROOT,
			env: { ...process.env, JEV_S0_LAUNCH: JSON.stringify(launch) },
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stderr = "";
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", data => { stderr += data; });
		return { child, command: createJsonlClient(child, () => stderr) };
	};
	const first = start();
	const stop = async child => {
		if (!child.killed) child.kill("SIGTERM");
		await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 1_000))]);
	};
	try {
		let state = await first.command("get_state");
		assert.equal(state.sessionId, "default-s0-id");
		await first.command("prompt", { message: "persist public default directory" });
		for (let attempts = 0; attempts < 100; attempts++) {
			state = await first.command("get_state");
			if (!state.isStreaming) break;
			await new Promise(resolve => setTimeout(resolve, 10));
		}
		assert.equal(state.isStreaming, false);
		assert.equal(existsSync(state.sessionFile), true);
		const persistedPath = state.sessionFile;
		await stop(first.child);

		const second = start();
		try {
			const reopened = await second.command("get_state");
			assert.equal(reopened.sessionId, "default-s0-id");
			assert.equal(reopened.sessionFile, persistedPath);
			assert.equal((await second.command("get_session_stats")).tokens.total > 0, true);
		} finally {
			await stop(second.child);
		}
	} finally {
		await stop(first.child);
	}
});
