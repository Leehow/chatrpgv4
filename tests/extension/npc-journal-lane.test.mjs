/** Real Pi-mounted journal/memory extensions with controlled RPC packets and faux providers, not a playtest. */
import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as settle } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { fauxAssistantMessage, fauxProvider, getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { waitFor } from "./harness.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const answer = (entries = []) => fauxAssistantMessage(JSON.stringify({ entries }));
const promptOf = context => getCurrentSystemPrompt(context.messages);
/** Drop system messages before reading conversational blocks. Their content is a string. */
const inputText = context => context.messages.filter(message => message.role !== "system").flatMap(message => message.content).map(block => block.text ?? "").join("\n");

function packet(turn, lane = "journal") {
	if (turn === undefined) return { job_id: null };
	return {
		job_id: `${lane}:camp:t${turn}`, turn, commit: "private-commit-key",
		scene: { name: "hall", display_name: "Entrance Hall" },
		present: ["Dooley"], investigators: [{ name: "Thomas" }], recordable: ["Dooley"], unnamed: ["Dooley"],
		player_text: "I ask the caretaker about the locked door.",
		keeper_text: "Dooley hands you the key.",
		prior: [{ name: "Dooley", label: "The caretaker", description: "The caretaker." }],
		budget: { max_entries: 3, max_description_chars: 40, max_exchange_chars: 40, max_label_chars: 30 },
		instruction: "Record only people who appeared; use the campaign's play language.",
	};
}

function gate(t) {
	const { promise, resolve } = Promise.withResolvers();
	t.after(resolve);
	return { promise, open: resolve };
}

async function openLanes(t, { env = {}, backfills = [], responses = [], memoryResponses = [], rpc, bridgeFirst = true, mode = "play" } = {}) {
	const workspace = mkdtempSync(join(tmpdir(), "pi-coc-journal-lane-"));
	const values = {
		PI_COC_MODE: mode, PI_COC_HOME: workspace, PI_OFFLINE: "1",
		PI_COC_NPCJOURNAL_MODEL: "journal/j1", PI_COC_MEMORY_MODEL: "memory/m1",
		PI_COC_NPCJOURNAL_BACKFILL: "0", PI_COC_MEMORY_BACKFILL: "0",
		PIPIUI_BRIDGE_PORT: "1", PIPIUI_SESSION_CAPABILITY: "lane-test-capability", ...env,
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
	const pushes = [];
	t.mock.method(globalThis, "fetch", async (_url, options) => {
		pushes.push(JSON.parse(options.body));
		return new Response("{}");
	});
	const journal = fauxProvider({ provider: "journal", models: [{ id: "j1" }] });
	const memory = fauxProvider({ provider: "memory", models: [{ id: "m1" }] });
	journal.setResponses(responses);
	memory.setResponses(memoryResponses);
	const modelRuntime = await ModelRuntime.create({
		authPath: join(workspace, "auth.json"), modelsPath: null,
		modelsStorePath: join(workspace, "models-store.json"), refreshOnCreate: false,
	});
	modelRuntime.registerNativeProvider(journal.provider);
	modelRuntime.registerNativeProvider(memory.provider);
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	let api;
	const resourceLoader = new DefaultResourceLoader({
		cwd: workspace, agentDir: join(workspace, "agent"), settingsManager,
		additionalExtensionPaths: [join(ROOT, "extensions/memory"), join(ROOT, "extensions/npc-journal")],
		extensionFactories: [{ name: "probe", factory: pi => { api = pi; } }],
	});
	await resourceLoader.reload();
	const created = await createAgentSession({
		cwd: workspace, agentDir: join(workspace, "agent"), model: journal.getModel(), modelRuntime,
		thinkingLevel: "off", noTools: "all", resourceLoader, settingsManager, sessionManager: SessionManager.inMemory(),
	});
	session = created.session;
	assert.deepEqual(created.extensionsResult.errors, []);
	const requests = [], errors = [], pending = [...backfills];
	const call = async (method, params) => {
		requests.push({ method, params });
		if (rpc) return rpc(method, params);
		if (method === "journal.job") return packet(params.turn ?? pending.shift());
		if (method === "memory.job") return packet(params.turn, "memory");
		return {};
	};
	const publish = () => api.events.emit("coc:kernel-bridge", { campaign: "camp", call });
	if (bridgeFirst) publish();
	await session.bindExtensions({ mode: "print", onError: error => errors.push(error) });
	if (!bridgeFirst) publish();
	t.after(() => assert.deepEqual(errors, [], "Pi must not swallow an extension lifecycle error"));
	return {
		journal, memory, pushes, publish,
		commit: turn => api.events.emit("coc:turn-committed", { campaign: "camp", turn }),
		hook: type => session._extensionRunner.emit({ type, reason: "quit" }),
		calls: method => requests.filter(row => row.method === method),
		entries: lane => session.sessionManager.getEntries()
			.filter(row => row.type === "custom" && row.customType === "coc-telemetry" && row.data.lane === lane)
			.map(row => row.data),
		rows: (lane = "journal") => {
			const path = join(workspace, ".coc/campaigns/camp/telemetry.jsonl");
			return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse).filter(row => row.lane === lane) : [];
		},
	};
}

async function completed(table, count = 1, lane = "journal") {
	await waitFor(() => table.rows(lane).length >= count, { label: `${lane} job telemetry ${count}` });
}

test("mounted NPC lane sends a closed player-safe prompt and payload, then refreshes the panel", async (t) => {
	let seen;
	const table = await openLanes(t, { responses: [context => {
		seen = context;
		return answer([
			{ name: " Dooley ", description: " The caretaker. ", exchange: "Hands over a key.", turn: 7, secret: "omit" },
			{ name: "Too long", description: "x".repeat(41) },
			{ name: "No prose" },
			{ name: "Dooley", exchange: "Points to the door." },
			{ name: "Dooley", label: " The man with the keys ", named: true, secret: "omit" },
			{ name: "Dooley", label: "x".repeat(31) },
			{ name: "Dooley", description: "Beyond the packet budget." },
		]);
	}] });
	table.commit(7);
	await completed(table);
	assert.deepEqual(table.calls("journal.job").map(row => row.params), [{ campaign: "camp", mode: "referenced", turn: 7 }]);
	assert.deepEqual(table.calls("journal.submit")[0].params, {
		campaign: "camp", job_id: "journal:camp:t7", entries: [
			{ name: "Dooley", description: "The caretaker.", exchange: "Hands over a key." },
			{ name: "Dooley", exchange: "Points to the door." },
			// §103: a label and a naming travel as they are; whether either is owed is the kernel's check.
			{ name: "Dooley", label: "The man with the keys", named: true },
		],
	});
	assert.deepEqual(getCurrentTools(seen.messages), []);
	assert.match(promptOf(seen), /Record only people who appeared/);
	assert.match(promptOf(seen), /at most 3 rows/);
	assert.match(promptOf(seen), /label, only for a name listed under not yet named: 1 to 30 characters/);
	assert.match(promptOf(seen), /named: true, only for a name listed under not yet named/);
	assert.match(inputText(seen), /\[Recordable names\] Dooley/);
	assert.match(inputText(seen), /\[Not yet named to the player\] Dooley/);
	assert.match(inputText(seen), /- Dooley \(label: The caretaker\): The caretaker\./);
	assert.match(inputText(seen), /Dooley hands you the key/);
	assert.ok(!inputText(seen).includes("private-commit-key"));
	assert.deepEqual(table.pushes, [{
		schemaVersion: 1, sessionCapability: "lane-test-capability", action: "ext.emit",
		extensionId: "coc-keeper", event: "sheet-changed",
	}]);
	assert.equal(table.rows()[0].entries, 3);
	assert.equal(table.rows()[0].model, "journal/j1");
	assert.deepEqual(table.rows("lane-call").filter(row => row.subsession === "journal").map(row => row.phase), ["start", "response", "end"]);
});

test("journal retries submit once without refetching the job, then emits only one refresh", async (t) => {
	let submissions = 0;
	const table = await openLanes(t, {
		responses: [answer(), answer()],
		rpc: async (method, params) => {
			if (method === "journal.job") return packet(params.turn);
			if (method === "journal.submit" && ++submissions === 1) throw { code: "invalid_params", message: "bad entry" };
			return {};
		},
	});
	table.commit(1);
	await completed(table);
	assert.equal(table.calls("journal.job").length, 1);
	assert.equal(table.calls("journal.submit").length, 2);
	assert.equal(table.calls("journal.fail").length, 0);
	assert.equal(table.pushes.length, 1);
	assert.equal(table.rows()[0].retried, true);
});

for (const reason of ["model_error", "invalid", "lane_error"]) {
	test(`journal's two failed attempts keep the existing ${reason} backlog reason`, async (t) => {
		const table = await openLanes(t, {
			responses: reason === "model_error" ? [fauxAssistantMessage("not JSON"), fauxAssistantMessage("still not JSON")] : [answer(), answer()],
			rpc: async (method, params) => {
				if (method === "journal.job") return packet(params.turn);
				if (method === "journal.submit") throw { code: reason === "invalid" ? "invalid_params" : "bridge_closed" };
				return {};
			},
		});
		table.commit(1);
		await completed(table);
		assert.equal(table.calls("journal.job").length, 1);
		assert.equal(table.calls("journal.submit").length, reason === "model_error" ? 0 : 2);
		assert.equal(table.calls("journal.fail").length, 1);
		assert.equal(table.calls("journal.fail")[0].params.reason, reason);
		assert.equal(table.rows()[0].failed, true);
		assert.equal(table.pushes.length, 0);
	});
}

test("unavailable journal model leaves the kernel job untouched; an unset override follows the session model", async (t) => {
	const table = await openLanes(t, { env: { PI_COC_NPCJOURNAL_MODEL: "journal/missing" }, responses: [answer()] });
	table.commit(1);
	await completed(table);
	assert.equal(table.rows()[0].reason, "model_unavailable");
	assert.equal(table.calls("journal.job").length, 0);
	delete process.env.PI_COC_NPCJOURNAL_MODEL;
	table.commit(2);
	await completed(table, 2);
	assert.equal(table.calls("journal.submit")[0].params.job_id, "journal:camp:t2");
	assert.equal(table.rows()[1].model, "journal/j1");
});

for (const bridgeFirst of [true, false]) {
	test(`journal backfill uses default dispatch until empty, with bridge ${bridgeFirst ? "before" : "after"} session_start`, async (t) => {
		const table = await openLanes(t, {
			bridgeFirst, env: { PI_COC_NPCJOURNAL_BACKFILL: "5" }, backfills: [4, 3], responses: [answer(), answer()],
		});
		await waitFor(() => table.calls("journal.job").length === 3, { label: "empty backfill dispatch" });
		await completed(table, 2);
		await table.hook("agent_settled");
		await settle(40);
		assert.deepEqual(table.calls("journal.job").map(row => row.params), Array(3).fill({ campaign: "camp", mode: "referenced" }));
		assert.deepEqual(table.rows().map(row => [row.turn, row.backfill]), [[4, true], [3, true]]);
		assert.equal(table.calls("journal.fail").length, 0);
	});
}

test("journal and memory are independently single-flight; committed journal turns precede remaining backfill", async (t) => {
	const held = gate(t);
	const table = await openLanes(t, {
		env: { PI_COC_NPCJOURNAL_BACKFILL: "2" }, backfills: [4, 3],
		responses: [async () => { await held.promise; return answer(); }, answer(), answer(), answer()],
		memoryResponses: [fauxAssistantMessage('{"candidates":[]}'), fauxAssistantMessage('{"candidates":[]}')],
	});
	await waitFor(() => table.calls("journal.job").length === 1, { label: "held journal backfill" });
	table.commit(1);
	table.commit(2);
	await completed(table, 2, "memory");
	assert.equal(table.calls("journal.job").length, 1, "the held job owns only the journal queue");
	held.open();
	await completed(table, 4);
	assert.deepEqual(table.calls("journal.job").map(row => row.params.turn), [undefined, 1, 2, undefined]);
	assert.deepEqual(table.rows().map(row => [row.turn, Boolean(row.backfill)]), [[4, true], [1, false], [2, false], [3, true]]);
});

test("shutdown is nonblocking, aborts both models and neither retries nor backlogs unfinished work", async (t) => {
	const held = gate(t);
	const table = await openLanes(t, {
		responses: [async () => { await held.promise; return answer(); }],
		memoryResponses: [async () => { await held.promise; return fauxAssistantMessage('{"candidates":[]}'); }],
	});
	table.commit(1);
	await waitFor(() => table.rows("lane-call").filter(row => row.phase === "start").length === 2, { label: "both models started" });
	table.commit(2);
	await table.hook("session_shutdown");
	table.commit(3);
	table.publish();
	await table.hook("agent_settled");
	held.open();
	// Shutdown clears ctx, so late rows can reach appendEntry but have no workspace to append to.
	await waitFor(() => table.entries("lane-call").filter(row => row.phase === "end").length === 2, { label: "both model calls ended" });
	await settle(40);
	for (const lane of ["journal", "memory"]) {
		assert.equal(table.calls(`${lane}.job`).length, 1);
		assert.equal(table.calls(`${lane}.submit`).length, 0);
		assert.equal(table.calls(`${lane}.fail`).length, 0);
		assert.equal(table.entries("lane-call").find(row => row.subsession === lane && row.phase === "end").ok, false);
	}
	assert.equal(table.pushes.length, 0);
});

test("setup mode registers neither background lane", async (t) => {
	const table = await openLanes(t, { mode: "setup", env: { PI_COC_NPCJOURNAL_BACKFILL: "5" } });
	table.commit(1);
	await table.hook("agent_settled");
	await settle(40);
	assert.equal(table.calls("journal.job").length, 0);
	assert.equal(table.calls("memory.job").length, 0);
	assert.deepEqual(table.rows(), []);
});

test("mounted referenced journal lane selects aliases without copying names or exposing host bindings",async(t)=>{
    let seen;
    const referencePacket={...packet(7),protocol:"journal-reference-v2",selection_binding:"private-selection-binding",
        recordable:[{alias:"person:0",name:"Dooley"}],present:["person:0"],unnamed:["person:0"],
        investigators:[{name:"Thomas"}],prior:[{person:"person:0",label:"The caretaker",description:"The caretaker."}],
        speech:[{person:"person:0",text:"The door stays locked."}]};
    const table=await openLanes(t,{rpc:async(method,params)=>method==="journal.job"?referencePacket:{},responses:[context=>{
        seen=context;return answer([{person:"person:0",label:"The caretaker",exchange:"Hands over a key."}]);
    }]});
    table.commit(7);await completed(table);
    assert.equal(table.calls("journal.job")[0].params.mode,"referenced");
    assert.deepEqual(table.calls("journal.submit")[0].params,{campaign:"camp",job_id:"journal:camp:t7",protocol:"journal-reference-v2",selection_binding:"private-selection-binding",
        entries:[{person:"person:0",label:"The caretaker",exchange:"Hands over a key."}]});
    assert.match(promptOf(seen),/person selects one issued recordable alias/);assert.ok(!promptOf(seen).includes('"name":"..."'));
    assert.match(inputText(seen),/person:0/);assert.ok(!inputText(seen).includes("private-selection-binding"));assert.ok(!inputText(seen).includes("private-commit-key"));
    assert.equal(table.calls("journal.submit").length,1);
});
