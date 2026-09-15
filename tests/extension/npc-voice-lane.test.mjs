/** The real Pi-mounted npc-voice lane against a stubbed kernel and a faux provider, not a playtest. */
import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as settle } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { waitFor } from "./harness.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const answer = (...lines) => fauxAssistantMessage(JSON.stringify({ sample_lines: lines }));
const inputText = context => context.messages.flatMap(message => message.content).map(block => block.text ?? "").join("\n");

/** The §40.5 packet: exactly the closed fields, and a job id the model must never see. */
function packet(handle) {
	if (!handle) return { job_id: null };
	return {
		job_id: `voice:camp:${handle}`,
		play_language: "zh-Hans",
		module: { title: "The Haunting", era: "Boston, 1920s" },
		coarse_language: true,
		npc: {
			handle, name: handle === "steven-knott" ? "Steven Knott" : "Dooley",
			role: "caretaker", wants: "to be left alone", fears: "the cellar stairs",
			hides: "he knows what walks under the house", voice: "clipped, defensive",
			speaks: "English", would_lie_about: ["the cellar"], deflect_lines: ["Nothing down there."],
			knowledge: ["the cellar door sticks"],
		},
		documents: ["A rent book in his own hand."],
		budget: { lines: 2, max_chars: 120 },
		instruction: "Write two lines this person would say, one at ease and one under strain.",
	};
}

async function openVoice(t, { env = {}, people = [], responses = [], rpc, mode = "play" } = {}) {
	const workspace = mkdtempSync(join(tmpdir(), "pi-coc-voice-lane-"));
	const values = {
		PI_COC_MODE: mode, PI_COC_HOME: workspace, PI_OFFLINE: "1",
		PI_COC_VOICE_MODEL: "voice/v1", ...env,
	};
	const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	let session;
	t.after(async () => {
		if (session) {
			await session._extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			session.dispose();
		}
		for (const [key, value] of previous) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
	});
	const voice = fauxProvider({ provider: "voice", models: [{ id: "v1" }] });
	voice.setResponses(responses);
	const modelRuntime = await ModelRuntime.create({
		authPath: join(workspace, "auth.json"), modelsPath: null,
		modelsStorePath: join(workspace, "models-store.json"), refreshOnCreate: false,
	});
	modelRuntime.registerNativeProvider(voice.provider);
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	let api;
	const resourceLoader = new DefaultResourceLoader({
		cwd: workspace, agentDir: join(workspace, "agent"), settingsManager,
		additionalExtensionPaths: [join(ROOT, "extensions/npc-voice")],
		extensionFactories: [{ name: "probe", factory: pi => { api = pi; } }],
	});
	await resourceLoader.reload();
	const created = await createAgentSession({
		cwd: workspace, agentDir: join(workspace, "agent"), model: voice.getModel(), modelRuntime,
		thinkingLevel: "off", noTools: "all", resourceLoader, settingsManager, sessionManager: SessionManager.inMemory(),
	});
	session = created.session;
	assert.deepEqual(created.extensionsResult.errors, []);
	const requests = [], errors = [], queue = [...people];
	const call = async (method, params) => {
		requests.push({ method, params });
		if (rpc) {
			const answered = await rpc(method, params, queue);
			if (answered !== undefined) return answered;
		}
		if (method === "voice.job") return packet(queue.shift());
		return {};
	};
	api.events.emit("coc:kernel-bridge", { campaign: "camp", call });
	await session.bindExtensions({ mode: "print", onError: error => errors.push(error) });
	t.after(() => assert.deepEqual(errors, [], "Pi must not swallow an extension lifecycle error"));
	return {
		voice, queue,
		commit: turn => api.events.emit("coc:turn-committed", { campaign: "camp", turn }),
		hook: type => session._extensionRunner.emit({ type, reason: "quit" }),
		calls: method => requests.filter(row => row.method === method),
		rows: (lane = "voice") => {
			const path = join(workspace, ".coc/campaigns/camp/telemetry.jsonl");
			return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse).filter(row => row.lane === lane) : [];
		},
	};
}

const completed = (table, count = 1) => waitFor(() => table.rows().length >= count, { label: `voice telemetry ${count}` });

test("a committed turn drains the queue, one job per person, on a closed packet that carries no id", async (t) => {
	let seen;
	const table = await openVoice(t, {
		people: ["steven-knott", "dooley"],
		responses: [context => { seen = context; return answer(" 没什么好说的。 ", "你问这个干什么？"); }, answer("随便看看。", "跟你没关系！")],
	});
	table.commit(1);
	await completed(table, 2);
	// Three asks: two people and the kernel's `job_id: null`, which is what ends a drain.
	assert.deepEqual(table.calls("voice.job").map(row => row.params), Array(3).fill({ campaign: "camp" }));
	assert.deepEqual(table.calls("voice.submit").map(row => row.params), [
		{ campaign: "camp", job_id: "voice:camp:steven-knott", sample_lines: ["没什么好说的。", "你问这个干什么？"] },
		{ campaign: "camp", job_id: "voice:camp:dooley", sample_lines: ["随便看看。", "跟你没关系！"] },
	]);
	assert.equal(table.calls("voice.fail").length, 0);
	assert.equal(seen.tools, undefined, "the voice lane is a zero-tool subsession");
	assert.match(seen.systemPrompt, /one at ease and one under strain/);
	assert.match(seen.systemPrompt, /each line is 1 to 120 characters/);
	assert.match(inputText(seen), /\[Person\] Steven Knott/);
	assert.match(inputText(seen), /\[Hides\] he knows what walks under the house/);
	assert.match(inputText(seen), /\[Coarse language\] on/);
	assert.ok(!inputText(seen).includes("voice:camp:"), "the model never reads the job id");
	assert.ok(!seen.systemPrompt.includes("voice:camp:"));
	assert.deepEqual(table.rows().map(row => [row.npc, row.ok, row.model]), [
		["steven-knott", true, "voice/v1"], ["dooley", true, "voice/v1"],
	]);
	assert.ok(table.rows().every(row => typeof row.ms === "number"));
	assert.deepEqual(table.rows("lane-call").filter(row => row.subsession === "voice").map(row => row.phase).slice(0, 3),
		["start", "response", "end"]);
});

test("one commit cannot become an unbounded run of model calls", async (t) => {
	const table = await openVoice(t, {
		people: ["a", "b", "c", "d", "e", "f", "g", "h"],
		responses: Array(8).fill(null).map((_, index) => answer(`at ease ${index}`, `under strain ${index}`)),
	});
	table.commit(1);
	await completed(table, 6);
	await settle(40);
	assert.equal(table.calls("voice.job").length, 6, "the ceiling holds even while people are still waiting");
	assert.equal(table.calls("voice.submit").length, 6);
	// The two left over are still the kernel's to offer: nothing here marks them done or failed.
	assert.deepEqual(table.queue, ["g", "h"]);
});

for (const [name, lines] of [
	["three lines", ["a", "b", "c"]],
	["one line", ["a"]],
	["two of the same line", ["same", "same"]],
	["a line past the budget", ["fine", "x".repeat(121)]],
	["an empty line", ["fine", "   "]],
	["a machine token", ["fine", "{{say:Knott}}"]],
	["a line break", ["fine", "two\nlines"]],
]) {
	test(`${name} is refused on shape and never submitted`, async (t) => {
		const table = await openVoice(t, { people: ["steven-knott"], responses: [answer(...lines), answer(...lines)] });
		table.commit(1);
		await completed(table);
		assert.equal(table.calls("voice.submit").length, 0);
		assert.deepEqual(table.calls("voice.fail")[0].params.reason, "model_error");
		assert.equal(table.rows()[0].failed, true);
		assert.equal(table.rows()[0].npc, "steven-knott");
	});
}

for (const [thrown, reason] of [[{ code: "invalid_params", message: "the source authored this key" }, "invalid"], [{ code: "bridge_closed" }, "lane_error"]]) {
	test(`a submit refused with ${thrown.code} fails the job as ${reason}`, async (t) => {
		const table = await openVoice(t, {
			people: ["steven-knott"], responses: [answer("a", "b"), answer("a", "b")],
			rpc: async (method) => { if (method === "voice.submit") throw thrown; },
		});
		table.commit(1);
		await completed(table);
		assert.equal(table.calls("voice.submit").length, 2, "one retry, and only one");
		assert.equal(table.calls("voice.fail").length, 1);
		assert.equal(table.calls("voice.fail")[0].params.reason, reason);
		assert.equal(table.calls("voice.fail")[0].params.job_id, "voice:camp:steven-knott");
	});
}

test("a person is tried at most twice in a session, and the re-offered job ends the drain instead of spinning", async (t) => {
	const table = await openVoice(t, {
		people: ["steven-knott"],
		responses: [fauxAssistantMessage("not JSON"), fauxAssistantMessage("still not JSON"), answer("a", "b")],
		// The kernel offers a failed job again (§40.5): the same person comes back on every later ask.
		rpc: async (method) => (method === "voice.job" ? packet("steven-knott") : undefined),
	});
	table.commit(1);
	await completed(table);
	assert.equal(table.calls("voice.fail").length, 1);
	const modelCalls = table.rows("lane-call").filter(row => row.phase === "start").length;
	assert.equal(modelCalls, 2, "two attempts is one retry");
	table.commit(2);
	await completed(table, 2);
	await settle(40);
	assert.equal(table.rows("lane-call").filter(row => row.phase === "start").length, 2, "the retired person costs no further model call");
	assert.equal(table.calls("voice.submit").length, 0);
	assert.equal(table.calls("voice.fail").length, 1, "a person already failed is not failed twice");
	assert.deepEqual(table.rows()[1].skipped, "retry_budget");
	table.commit(3);
	await settle(40);
	assert.equal(table.rows().length, 2, "and it is noted once, not once per commit");
});

for (const budget of ["unset", "0", "5"]) {
	test(`backfill is asked ${budget === "5" ? "once" : "never"} when PI_COC_NPCVOICE_BACKFILL is ${budget}`, async (t) => {
		// Off unless asked (§40.5, user ruling 2026-09-15): unset is the product default and means never.
		const table = await openVoice(t, {
			env: budget === "unset" ? {} : { PI_COC_NPCVOICE_BACKFILL: budget }, people: ["steven-knott"], responses: [answer("a", "b")],
		});
		if (budget !== "5") {
			await settle(60);
			assert.equal(table.calls("voice.job").length, 0);
			assert.deepEqual(table.rows(), []);
			return;
		}
		await completed(table);
		await table.hook("agent_settled");
		await settle(60);
		// One drain: the person, then the kernel's `job_id: null`, and the budget is not spent again.
		assert.deepEqual(table.calls("voice.job").map(row => row.params), Array(2).fill({ campaign: "camp", backfill: true }));
		assert.equal(table.rows()[0].backfill, true);
		assert.equal(table.rows()[0].npc, "steven-knott");
	});
}

test("an unresolvable lane model leaves every kernel job untouched", async (t) => {
	const table = await openVoice(t, { env: { PI_COC_VOICE_MODEL: "voice/missing" }, people: ["steven-knott"], responses: [answer("a", "b")] });
	table.commit(1);
	await completed(table);
	assert.equal(table.rows()[0].reason, "model_unavailable");
	assert.equal(table.calls("voice.job").length, 0);
});

test("setup mode registers no voice lane at all", async (t) => {
	const table = await openVoice(t, { mode: "setup", env: { PI_COC_NPCVOICE_BACKFILL: "5" }, people: ["steven-knott"] });
	table.commit(1);
	await table.hook("agent_settled");
	await settle(60);
	assert.equal(table.calls("voice.job").length, 0);
	assert.deepEqual(table.rows(), []);
});
