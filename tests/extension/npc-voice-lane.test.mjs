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
/** A voice answer: a mask and three exchanges. `answer(a, b, c)` uses a fixed mask; `answer({mask, exchanges})` is explicit. */
const voiceOf = (...args) => args.length === 1 && args[0] && typeof args[0] === "object" && !Array.isArray(args[0]) ? args[0] : { mask: "自称俺，句尾带「呗」。", exchanges: args };
const answer = (...args) => fauxAssistantMessage(JSON.stringify({ voice: voiceOf(...args) }));
const silence = () => fauxAssistantMessage(JSON.stringify({ voice: null, reason: "does_not_speak" }));
const verdict = (honours, why = "") => fauxAssistantMessage(JSON.stringify({ honours, why }));
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
			hides: "he knows what walks under the house",
			speaks: "English", would_lie_about: ["the cellar"], deflect_lines: ["Nothing down there."],
			knowledge: ["the cellar door sticks"],
		},
		documents: ["A rent book in his own hand."],
		investigator: { sex: "女", address: "薇姐" },
		taken_masks: ["自称鄙人，句尾带「这个嘛」。"],
		budget: { mask_chars: 200, exchanges: 3, max_chars: 200 },
		instruction: "Write how this person is heard: a mask of one line, then three exchanges.",
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
/**
 * 等第 `count` 次 `voice.job`。遥测行不是它的替身：一行是 `record()` 里 `await appendJsonl` 落盘，
 * 下一次 `voice.job` 要等那次 I/O 的完成回调回到事件循环之后才发出。整套跑起来时，轮询这一侧
 * 看得见磁盘上的行、而车道那一侧还没被调度回来——断言 `voice.job` 的次数就必须等 `voice.job`。
 */
const asked = (table, count) => waitFor(() => table.calls("voice.job").length >= count, { label: `voice.job ${count}` });

test("a committed turn drains the queue, one job per person, on a closed packet that carries no id", async (t) => {
	let seen;
	const table = await openVoice(t, {
		people: ["steven-knott", "dooley"],
		responses: [context => { seen = context; return answer(" 你是谁？ → 没什么好说的。 ", "雨大。 → 大就大呗。", "地窖呢？ → 你问这个干什么？"); }, answer("随便看看。", "跟你没关系！", "走了。")],
	});
	table.commit(1);
	await completed(table, 2);
	// Three asks: two people and the kernel's `job_id: null`, which is what ends a drain.
	await asked(table, 3);
	assert.deepEqual(table.calls("voice.job").map(row => row.params), Array(3).fill({ campaign: "camp" }));
	assert.deepEqual(table.calls("voice.submit").map(row => row.params), [
		{ campaign: "camp", job_id: "voice:camp:steven-knott", voice: { mask: "自称俺，句尾带「呗」。", exchanges: ["你是谁？ → 没什么好说的。", "雨大。 → 大就大呗。", "地窖呢？ → 你问这个干什么？"] } },
		{ campaign: "camp", job_id: "voice:camp:dooley", voice: { mask: "自称俺，句尾带「呗」。", exchanges: ["随便看看。", "跟你没关系！", "走了。"] } },
	]);
	assert.equal(table.calls("voice.fail").length, 0);
	assert.equal(seen.tools, undefined, "the voice lane is a zero-tool subsession");
	assert.match(seen.systemPrompt, /a mask of one line, then three exchanges/);
	assert.match(seen.systemPrompt, /mask is one line of 1 to 200 characters/);
	assert.match(seen.systemPrompt, /exchanges is exactly 3 strings/);
	assert.match(inputText(seen), /\[Masks other people here already wear\]\n- 自称鄙人，句尾带「这个嘛」。/);
	assert.match(inputText(seen), /\[Person\] Steven Knott/);
	assert.match(inputText(seen), /\[Hides\] he knows what walks under the house/);
	assert.match(inputText(seen), /\[Coarse language\] on/);
	assert.match(inputText(seen), /\[The investigator this person is talking to\] sex: 女 \| addressed as: 薇姐/);
	assert.ok(!inputText(seen).includes("voice:camp:"), "the model never reads the job id");
	assert.ok(!seen.systemPrompt.includes("voice:camp:"));
	assert.deepEqual(table.rows().map(row => [row.npc, row.ok, row.model]), [
		["steven-knott", true, "voice/v1"], ["dooley", true, "voice/v1"],
	]);
	assert.ok(table.rows().every(row => typeof row.ms === "number"));
	assert.deepEqual(table.rows("lane-call").filter(row => row.subsession === "voice").map(row => row.phase).slice(0, 3),
		["start", "response", "end"]);
});

test("a packet with no investigator says nothing about one", async (t) => {
	let seen;
	const table = await openVoice(t, {
		people: ["steven-knott"],
		responses: [context => { seen = context; return answer("你是谁？", "雨大。", "地窖呢？"); }],
		rpc: (method, _params, queue) => method === "voice.job" && queue.length ? { ...packet(queue.shift()), investigator: undefined } : undefined,
	});
	table.commit(1);
	await completed(table, 1);
	await asked(table, 2);
	assert.ok(!inputText(seen).includes("[The investigator"), "absent is absent: the frame fills nothing in");
});

test("one commit cannot become an unbounded run of model calls", async (t) => {
	const table = await openVoice(t, {
		people: ["a", "b", "c", "d", "e", "f", "g", "h"],
		responses: Array(8).fill(null).map((_, index) => answer(`at ease ${index}`, `ordinary ${index}`, `under strain ${index}`)),
	});
	table.commit(1);
	await completed(table, 6);
	await settle(40);
	assert.equal(table.calls("voice.job").length, 6, "the ceiling holds even while people are still waiting");
	assert.equal(table.calls("voice.submit").length, 6);
	// The two left over are still the kernel's to offer: nothing here marks them done or failed.
	assert.deepEqual(table.queue, ["g", "h"]);
});

for (const [name, voice] of [
	["two exchanges", { mask: "m", exchanges: ["a", "b"] }],
	["four exchanges", { mask: "m", exchanges: ["a", "b", "c", "d"] }],
	["two of the same exchange", { mask: "m", exchanges: ["same", "same", "c"] }],
	["an exchange past the budget", { mask: "m", exchanges: ["fine", "x".repeat(201), "c"] }],
	["an empty exchange", { mask: "m", exchanges: ["fine", "   ", "c"] }],
	["a machine token", { mask: "m", exchanges: ["fine", "{{say:Knott}}", "c"] }],
	["a line break", { mask: "m", exchanges: ["fine", "two\nlines", "c"] }],
	["no mask", { exchanges: ["a", "b", "c"] }],
	["a mask past the budget", { mask: "x".repeat(201), exchanges: ["a", "b", "c"] }],
	["a list where the voice should be", ["a", "b", "c"]],
]) {
	test(`${name} is refused on shape and never submitted`, async (t) => {
		const table = await openVoice(t, { people: ["steven-knott"], responses: [answer(voice), answer(voice)] });
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
			people: ["steven-knott"], responses: [answer("a", "b", "c"), answer("a", "b", "c")],
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
		responses: [fauxAssistantMessage("not JSON"), fauxAssistantMessage("still not JSON"), answer("a", "b", "c")],
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
			env: budget === "unset" ? {} : { PI_COC_NPCVOICE_BACKFILL: budget }, people: ["steven-knott"], responses: [answer("a", "b", "c")],
		});
		if (budget !== "5") {
			await settle(60);
			assert.equal(table.calls("voice.job").length, 0);
			assert.deepEqual(table.rows(), []);
			return;
		}
		await completed(table);
		await table.hook("agent_settled");
		// Wait for the ask that ends the drain, then hold still: the settle is what gives a
		// spurious third ask its chance, so the count below stays an upper bound too.
		await asked(table, 2);
		await settle(60);
		// One drain: the person, then the kernel's `job_id: null`, and the budget is not spent again.
		assert.deepEqual(table.calls("voice.job").map(row => row.params), Array(2).fill({ campaign: "camp", backfill: true }));
		assert.equal(table.rows()[0].backfill, true);
		assert.equal(table.rows()[0].npc, "steven-knott");
	});
}

test("an unresolvable lane model leaves every kernel job untouched", async (t) => {
	const table = await openVoice(t, { env: { PI_COC_VOICE_MODEL: "voice/missing" }, people: ["steven-knott"], responses: [answer("a", "b", "c")] });
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


/** A packet carrying the book's `voice`, which is what wakes the guard; the default packet carries none so the other tests stay one call per person. */
const voiced = (method, params, queue) => method === "voice.job" ? (() => { const p = packet(queue.shift()); return p.npc ? { ...p, npc: { ...p.npc, voice: "clipped, defensive" } } : p; })() : undefined;

test("a person the book says does not speak is filed as silent, with no lines and no judge", async (t) => {
	const table = await openVoice(t, { people: ["steven-knott"], responses: [silence()] });
	table.commit(1);
	await completed(table);
	assert.deepEqual(table.calls("voice.submit").map(row => row.params), [
		{ campaign: "camp", job_id: "voice:camp:steven-knott", voice: null, reason: "does_not_speak" },
	]);
	assert.equal(table.calls("voice.fail").length, 0);
	assert.equal(table.rows()[0].ok, true);
});

test("the voice guard reads the lines against the book's voice and bounces them once", async (t) => {
	let judge;
	const table = await openVoice(t, {
		people: ["steven-knott"], rpc: voiced,
		responses: [answer("没什么好说的。", "雨呗。", "滚！！"), context => { judge = context; return verdict(false, "a clipped man does not scream"); }, answer("没什么好说的。", "雨呗。", "……你问这个做什么。")],
	});
	table.commit(1);
	await completed(table);
	assert.match(judge.systemPrompt, /register only/);
	assert.match(judge.systemPrompt, /wear the mask/);
	assert.match(inputText(judge), /\[Voice the book gives them\] clipped, defensive/);
	assert.match(inputText(judge), /\[Mask\] 自称俺，句尾带「呗」。/);
	assert.match(inputText(judge), /3\. 滚！！/);
	assert.deepEqual(table.calls("voice.submit").map(row => row.params.voice.exchanges), [["没什么好说的。", "雨呗。", "……你问这个做什么。"]]);
	assert.equal(table.rows().find(row => row.npc)?.voice_check, "rewritten");
});

test("the voice guard lets honoured lines through unchanged", async (t) => {
	const table = await openVoice(t, { people: ["dooley"], rpc: voiced, responses: [answer("先买份报。", "下雨了。", "跟你没关系。"), verdict(true)] });
	table.commit(1);
	await completed(table);
	assert.deepEqual(table.calls("voice.submit").map(row => row.params.voice.exchanges), [["先买份报。", "下雨了。", "跟你没关系。"]]);
	assert.equal(table.rows().find(row => row.npc)?.voice_check, "passed");
});
