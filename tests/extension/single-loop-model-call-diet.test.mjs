/**
 * SL-11 (spec pi-native-single-loop, Ruling "A turn is under 60 seconds"; contract §135.20–§135.23): the model-call diet.
 *
 * - §135.20: the read step's artifact carries the bodies of the issued candidates (clue, handout, person, exit with
 *   who is there), bounded like a capsule section, and the Keeper gets them in the run's packet.
 * - §135.21: a `how`/`why` argument is one sentence: the schema says so, and a longer one is refused before it runs
 *   with a fix that says to shorten it, on both engines. Nothing is cut.
 * - §135.23: on the single-loop engine a turn's request is append-only, so a run's second model call reads its first
 *   call's whole prompt from cache (the faux provider's own accounting: the common prefix with the previous prompt),
 *   and the next turn's first call reads the brief.
 * - §179.2: the turn's capsule follows the brief, its stable sections first, so the next turn's first call also reads the
 *   capsule's head up to the first section that changed.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { openTable, waitFor } from "./harness.mjs";
import { TaskLease } from "../../runtime/jev/task-context.ts";
import { operationCapability } from "../../extensions/kernel/canonical-operation-dispatcher.ts";
import { createHybridEngine } from "./hybrid-engine-fixture.mjs";
import { CANDIDATE_BODIES_BYTES, CANDIDATE_BODY_BYTES, fitBody, readCandidateBodies } from "../../runtime/jev/candidate-bodies.ts";
import { argumentLimitRefusal, COC_TOOLS, SENTENCE_MAX } from "../../extensions/kernel/tools.ts";
import { capsuleUpdate, stableFirst, CAPSULE_UPDATE_TYPE, CAPSULE_VOLATILE_SECTIONS } from "../../extensions/table/context-policy.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const size = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");

/** A kernel that answers the reads the body step makes, from rows a test gives it; every call is logged. */
function fakeReads(rows, calls = []) {
	return async (method, params) => {
		calls.push([method, params]);
		if (method === "table.lookup") return rows.lookup?.[params.query] ?? { entities: [] };
		if (method === "table.look" && params.focus === "npc") {
			if (rows.fail?.includes(params.name)) throw new Error("kernel down");
			return rows.npc?.[params.name] ?? { kind: "npc", name: params.name };
		}
		return {};
	};
}
const clueCandidate = (clue) => ({ key: `apply:clue:${clue}`, verb: "apply", family: "clue", label: `Reveal ${clue}`, source: "t", bound: { kind: "clue", clue }, unbound: [] });
const moveCandidate = (to) => ({ key: `apply:move:${to}`, verb: "apply", family: "move", label: `Move to ${to}`, source: "t", bound: { kind: "move", to }, unbound: [] });
const personCandidate = (who) => ({ key: `apply:person:${who}`, verb: "apply", family: "person", label: `Stage ${who}`, source: "t", bound: { kind: "person", who }, unbound: [] });
const handoutCandidate = (name) => ({ key: `apply:handout:${name}`, verb: "apply", family: "handout", label: `Show ${name}`, source: "t", bound: { kind: "handout", name }, unbound: [] });

const ROWS = {
	lookup: {
		"cellar-scratches": { entities: [{ name: "cellar-scratches", kind: "beat", summary: "a beat that shares the handle" },
			{ name: "cellar-scratches", kind: "clue", summary: "Scratches on the cellar door, from the inside.", properties: { delivery_kind: "obvious" }, visibility: "revealable" }] },
		morgue: { entities: [{ name: "morgue", kind: "scene", summary: "scene morgue", destination_identity: { canonical_name: "The Globe offices" },
			relations: [{ kind: "route-to", to: "office" }, { kind: "present-in", from: "arty" }] }] },
		"The Letter": { entities: [{ name: "letter-1", display_name: "The Letter", kind: "handout", summary: "A letter from the landlord.", properties: { when_to_deliver: "on hire" } }] },
	},
	npc: {
		arty: { kind: "npc", name: "Arty Wilmot", untold: { use: "Private until introduced" }, role: "gatekeeper", wants: "Guard the morgue." },
		"Ruth Blake": { kind: "npc", name: "Ruth Blake", role: "archivist", wants: "Be treated like a person.", hides: "She knows the 1878 cutoff.",
			combat_disposition: { options: { a: "x".repeat(900), b: "y".repeat(900) } } },
	},
};

test("§135.20: the bodies of the issued clue, handout, person and exit come from the kernel reads the Keeper would make, bounded and accounted", async () => {
	const calls = [];
	const capsule = { known: { clues_here: [{ name: "cellar-scratches", summary: "Scratches on the cellar door.", gate: "obvious", discovered: false }] } };
	const candidates = [moveCandidate("morgue"), clueCandidate("cellar-scratches"), personCandidate("Ruth Blake"), handoutCandidate("The Letter"),
		{ key: "resolve:core-check:ordinary-check", verb: "resolve", family: "core-check", label: "check", source: "t", bound: {}, unbound: [] }];
	const read = await readCandidateBodies({ candidates, capsule, call: fakeReads(ROWS, calls) });
	const byFamily = Object.fromEntries(read.bodies.map((entry) => [entry.family, entry]));
	assert.deepEqual(read.bodies.map((entry) => entry.family), ["clue", "handout", "person", "move"], "the budget serves clues, handouts, people, then exits");
	// A clue: its capsule row and its graph entity (not the beat that shares its handle).
	assert.equal(byFamily.clue.body.gate, "obvious");
	assert.equal(byFamily.clue.body.properties.delivery_kind, "obvious");
	assert.deepEqual(calls.find(([method, params]) => params.query === "cellar-scratches")[1], { kind: "module", query: "cellar-scratches", expected_kind: "clue" });
	// A handout, by name.
	assert.equal(byFamily.handout.body.properties.when_to_deliver, "on hire");
	// A person: the look, cut to its budget with the dropped fields named, never silently.
	assert.equal(byFamily.person.body.wants, "Be treated like a person.");
	assert.equal(byFamily.person.truncated, true);
	assert.deepEqual(byFamily.person.omitted_fields, ["combat_disposition"]);
	assert.ok(size(byFamily.person.body) <= CANDIDATE_BODY_BYTES);
	// An exit: the destination and who the book puts there, each as the Keeper's own look answers.
	assert.deepEqual(byFamily.move.body.people_there, [{ name: "Arty Wilmot", role: "gatekeeper", untold: { use: "Private until introduced" }, wants: "Guard the morgue." }]);
	assert.equal(byFamily.move.body.relations, undefined);
	assert.ok(calls.some(([method, params]) => method === "table.look" && params.name === "arty"));
	assert.equal(read.omitted.length, 0);
	assert.ok(read.bytes <= CANDIDATE_BODIES_BYTES);

	// A read that fails, and a body that does not fit the whole budget, are listed with their reason.
	const failing = await readCandidateBodies({ candidates: [personCandidate("Ruth Blake")], capsule: {}, call: fakeReads({ ...ROWS, fail: ["Ruth Blake"] }) });
	assert.deepEqual(failing.omitted, [{ key: "apply:person:Ruth Blake", family: "person", name: "Ruth Blake", reason: "read_failed" }]);
	const many = Array.from({ length: 20 }, (_, index) => personCandidate(`P${index}`));
	const crowded = await readCandidateBodies({ candidates: many, capsule: {}, call: async () => ({ kind: "npc", name: "n", wants: "w".repeat(700) }) });
	assert.ok(crowded.bytes <= CANDIDATE_BODIES_BYTES);
	assert.ok(crowded.omitted.length > 0 && crowded.omitted.every((entry) => entry.reason === "budget"));
	assert.equal(crowded.bodies.length + crowded.omitted.length, 20);
});

test("§135.20: fitBody drops trailing fields first, then clips strings, and always marks what it cut", () => {
	assert.deepEqual(fitBody({ a: 1 }, 100), { body: { a: 1 } });
	const cut = fitBody({ name: "n", role: "r", wants: "w".repeat(2000) }, 200);
	assert.ok(size(cut.body) <= 200 && cut.truncated === true && cut.body.wants.endsWith("…"));
});

test("§135.20: the read step's artifact carries the issued bodies, and the Keeper gets them in the run's packet", async () => {
	const handlers = new Map(), emitted = [];
	const bus = { on: (name, handler) => handlers.set(name, handler), emit: (name, value) => { emitted.push([name, value]); handlers.get(name)?.(value); } };
	const engine = createHybridEngine({ env: {}, decision: null, record: () => {} });
	engine.extension({ events: bus, on: () => {}, getActiveTools: () => [], setActiveTools: () => {} });
	const source = "a".repeat(64);
	const kernel = fakeReads(ROWS);
	bus.emit("coc:kernel-bridge", { campaign: "c", call: async (method, params) => {
		if (method === "table.capsule") return { where: { scene: "office", assets: [{ name: "The Letter", kind: "handout" }] }, present: [],
			known: { clues_here: [{ name: "cellar-scratches", summary: "Scratches.", gate: "obvious", discovered: false }] },
			_context: { version: 1, campaign: "c", worldline: "main", loop: 0, turn: 3, source_revision: source } };
		if (method === "table.status") return { turn: 3, state: "open", receipts: [] };
		if (method === "table.apply.options") return { candidates: [{ effect: { kind: "clue", clue: "cellar-scratches" }, description: { summary: "Scratches." } },
			{ effect: { kind: "move", to: "morgue" }, description: { display_name: "The Globe offices", unlock_when: { met: true } } }] };
		return kernel(method, params);
	} });
	const plan = await engine.runDriver.prepare({ runId: "run-1", inputRevision: "rev", rawInput: "I go to the Globe", session: {} });
	const read = await plan.ports.read.read({ origin: "policy", operation: "read", readOnly: true },
		{ runId: "run-1", stepId: "s1", operationId: "s1/op1", origin: "policy", inputRevision: "rev", scopeId: "root", signal: new AbortController().signal });
	const bodies = read.artifact.read.bodies;
	assert.deepEqual(bodies.map((entry) => entry.key), ["apply:clue:cellar-scratches", "apply:handout:The Letter", "apply:move:morgue"]);
	assert.equal(bodies.find((entry) => entry.family === "move").body.people_there[0].name, "Arty Wilmot");
	assert.ok(bodies.every((entry) => entry.read.length > 0), "each body names the kernel reads it came from");
	// The Keeper-facing half: the run's packet carries the same bodies, without the host's keys.
	const [, packet] = emitted.find(([name]) => name === "coc:run-prescreen");
	const content = JSON.parse(packet.message.content);
	assert.deepEqual(content.issued.bodies.map((entry) => `${entry.family}:${entry.name}`), ["clue:cellar-scratches", "handout:The Letter", "move:morgue"]);
	assert.ok(!packet.message.content.includes("apply:clue:"), "host keys stay on the artifact");
	assert.match(content.issued.head, /do not look or lookup them again/);
});

test("§135.21: a how or why longer than one sentence is refused with a fix that says to shorten it; at the ceiling it passes", () => {
	const long = "x".repeat(SENTENCE_MAX + 1), exact = "y".repeat(SENTENCE_MAX);
	const refusal = argumentLimitRefusal("apply", { effects: [{ kind: "clue", clue: "c", how: exact }, { kind: "npc", name: "A", to: "here", why: long }] });
	assert.equal(refusal.code, "invalid_params");
	assert.equal(refusal.code_detail, "argument_too_long");
	assert.equal(refusal.next, "change_input");
	assert.deepEqual(refusal.details.fields, [{ field: "effects[1].why", length: SENTENCE_MAX + 1, max: SENTENCE_MAX }]);
	assert.match(refusal.fix, /^Shorten effects\[1\]\.why to one sentence of at most 200 characters/);
	assert.equal(argumentLimitRefusal("apply", { effects: [{ kind: "clue", clue: "c", how: exact }] }), undefined);
	// Code points, as JSON Schema counts them: a 200-character sentence in any script passes.
	assert.equal(argumentLimitRefusal("apply", { effects: [{ kind: "time", minutes: 5, why: "字".repeat(SENTENCE_MAX) }] }), undefined);
	// The schema itself declares the ceiling on every how and why of every effect.
	const bounded = [];
	const walk = (schema, path) => {
		if (!schema || typeof schema !== "object") return;
		for (const [key, value] of Object.entries(schema.properties ?? {})) {
			if (key === "how" || key === "why") bounded.push([`${path}.${key}`, value.maxLength]);
			walk(value, `${path}.${key}`);
		}
		for (const branch of schema.anyOf ?? []) walk(branch, path);
		if (schema.items) walk(schema.items, `${path}[]`);
	};
	walk(COC_TOOLS.find((tool) => tool.name === "apply").parameters, "apply");
	assert.ok(bounded.length >= 12);
	assert.deepEqual(bounded.filter(([, max]) => max !== SENTENCE_MAX), [], "every how/why declares the ceiling");
});

for (const engine of ["legacy", "hybrid-v1"]) {
	test(`§135.21 on the ${engine} engine: the Keeper's over-long why is refused before the kernel, with the fix; the shortened call lands`, async (t) => {
		const hybrid = engine === "hybrid-v1" ? createHybridEngine({ env: process.env, decision: null }) : undefined;
		const why = "because ".repeat(40);
		const table = await openTable({
			...(hybrid ? { runDriver: hybrid.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: hybrid.extension }], env: { PI_COC_LOOP_ENGINE: "hybrid-v1" } } : {}),
			responses: [
				fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "time", minutes: 10, why }] })], { stopReason: "toolUse" }),
				fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "time", minutes: 10, why: "They waited." }] })], { stopReason: "toolUse" }),
				fauxAssistantMessage([fauxToolCall("narrate", { text: "时间过去了。" })], { stopReason: "toolUse" }),
				fauxAssistantMessage("时间过去了。"),
			],
		});
		t.after(() => table.dispose());
		await table.session.prompt("我等着");
		const results = table.session.messages.filter((message) => message.role === "toolResult" && message.toolName === "apply");
		assert.equal(results[0].isError, true);
		const text = results[0].content.map((block) => block.text ?? "").join("");
		assert.match(text, /^invalid_params: apply: effects\[0\]\.why \(320 characters\) is longer than one sentence/);
		assert.match(text, /fix: Shorten effects\[0\]\.why to one sentence of at most 200 characters and send the same call again/);
		const applies = table.kernelRequests().filter((request) => request.method === "table.apply");
		assert.equal(applies.length, 1, "only the shortened call reached the kernel");
		assert.equal(applies[0].params.effects[0].why, "They waited.");
		assert.equal(results[1].isError, false);
	});
}

test("§135.21 for a policy-origin call: the canonical dispatcher refuses the over-long why with the same fix, before the kernel", async (t) => {
	let gateway, observation;
	const why = "x".repeat(SENTENCE_MAX + 5);
	const probe = { name: "dispatch-probe", factory(pi) {
		pi.events.on("coc:operation-dispatcher", (value) => { gateway = value; });
		pi.registerTool({ name: "host_dispatch_test", label: "dispatch", description: "test-only gateway caller", parameters: Type.Object({}), executionMode: "sequential",
			async execute() {
				const scope = { owner: "sl11-test", campaign: "test-camp", worldline: "main", loop: 0, audience: "keeper" };
				const owner = new TaskLease({ owner: "sl11-test", goal: "one clerk write", scope, capabilities: ["apply"],
					budget: { deadlineAt: Date.now() + 60_000, remainingInputTokens: 100_000, remainingOutputTokens: 16_384, remainingCostUsd: 1, remainingActions: 20 },
					readSet: [{ kind: "world", resource: "test-camp", revision: "w1" }] });
				const args = { effects: [{ kind: "time", minutes: 5, why }] };
				observation = await gateway.dispatch({ id: "clerk:op1", taskId: owner.context.id, operation: "apply", args, capability: operationCapability("apply", args),
					scope: owner.context.scope, readSet: owner.context.readSet, basis: [] },
					{ session: table.session, task: owner, journal: { load: async () => undefined, save: async () => {} }, validateCurrent: async () => {},
						recover: async () => ({ status: "absent", activeTurn: 1 }), trace: () => {} });
				return { content: [{ type: "text", text: "{}" }], details: {} };
			} });
		pi.on("session_start", () => pi.setActiveTools([...pi.getActiveTools(), "host_dispatch_test"]));
	} };
	const table = await openTable({ extraExtensions: [probe], responses: [fauxAssistantMessage([fauxToolCall("host_dispatch_test", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: "好。" })], { stopReason: "toolUse" }), fauxAssistantMessage("好。")] });
	t.after(() => table.dispose());
	await table.session.prompt("好");
	assert.equal(observation.status, "refused");
	assert.equal(observation.result.coc_error.code_detail, "argument_too_long");
	assert.match(observation.result.coc_error.fix, /^Shorten effects\[0\]\.why/);
	assert.ok(!table.kernelRequests().some((request) => request.method === "table.apply"), "the kernel received no write");
});

/** One kernel request list on the workspace, through the emitted kernel's own RPC (puts the table in a state). */
function kernelSteps(workspace, campaign, requests) {
	const input = requests.map((request, index) => JSON.stringify({ id: String(index), method: request[0], params: { campaign, ...request[1] } })).join("\n");
	const run = spawnSync(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")],
		{ cwd: REPO, input: `${input}\n`, encoding: "utf8" });
	for (const frame of run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress))
		if (!frame.ok) throw new Error(`fixture step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
}
const messageText = (message) => typeof message.content === "string" ? message.content
	: (message.content ?? []).map((block) => block.text ?? (block.type === "toolCall" ? `${block.name}:${JSON.stringify(block.arguments)}` : "")).join("\n");
/** The faux provider's prompt text, `role:text` per message; without the system message's tool lines, so a lower bound. */
const promptText = (messages) => messages.map((message) => `${message.role}:${messageText(message)}`).join("\n\n");
const CAPSULE_HEAD = /^\{"head":"Everything at the start of this turn/;
/** How many leading characters two strings share. */
const sharedPrefix = (a, b) => { let at = 0; while (at < a.length && at < b.length && a[at] === b[at]) at++; return at; };
/** Where a top-level section's key starts in a capsule serialized in its own key order. */
const sectionOffset = (capsule, key) => {
	const keys = Object.keys(capsule), before = keys.slice(0, keys.indexOf(key));
	return before.length ? JSON.stringify(Object.fromEntries(before.map((name) => [name, capsule[name]]))).length : 1;
};

test("§135.23: on the single-loop engine a run's second call reads the first call's whole prompt from cache, and the next turn's first call reads the brief", async (t) => {
	const campaign = "test-camp", requests = [];
	const prepareWorkspace = (workspace) => kernelSteps(workspace, campaign, [["table.open", {}], ["table.player_input", { text: "我坐下" }],
		["table.narrate", { call_id: "t1-c1", text: "诺特把帽子搁在椅背上。" }]]);
	const hybrid = createHybridEngine({ env: process.env, decision: null });
	const reply = (message) => (context) => { requests.push(context); return message; };
	const table = await openTable({
		// A table with Jev's preselection on, as the App runs it: the hook re-reads the capsule after every write.
		realKernel: true, prepareWorkspace, runDriver: hybrid.runDriver, env: { PI_COC_LOOP_ENGINE: "hybrid-v1", PI_COC_JEV_PRESELECT: "1", EXT_JEV_APIKEY: "test-key" },
		extraExtensions: [{ name: "coc-hybrid-engine", factory: hybrid.extension }],
		responses: [
			// Turn 2: a write, then the delivery; turn 3: the delivery.
			reply(fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "clue", clue: "knott-research-leads", how: "He says where to dig." }] })], { stopReason: "toolUse" })),
			reply(fauxAssistantMessage([fauxToolCall("narrate", { text: "他说先去报馆。" })], { stopReason: "toolUse" })),
			reply(fauxAssistantMessage([fauxToolCall("narrate", { text: "你点头。" })], { stopReason: "toolUse" })),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("该去哪儿查？");
	await table.session.prompt("我点头。");
	const assistants = table.session.messages.filter((message) => message.role === "assistant" && message.usage);
	assert.equal(assistants.length, 3);
	const promptTokens = (context) => Math.ceil(context.messages.map((message) => `${message.role}:${messageText(message)}`).join("\n\n").length / 4);
	// The faux provider's accounting: cacheRead is the prefix this prompt shares with the one before it.
	const [first, second, nextTurn] = assistants.map((message) => message.usage);
	assert.ok(second.cacheRead >= promptTokens(requests[0]),
		`the second call reads the first call's whole prompt from cache (${second.cacheRead} of ${promptTokens(requests[0])})`);
	assert.equal(first.cacheRead, 0);
	// The write changed the table: the capsule stayed as the turn began and the change rode at the end of the request.
	const tail = messageText(requests[1].messages.at(-1));
	assert.match(tail, /"kind":"capsule_update"/);
	const capsuleOf = (context) => context.messages.map(messageText).find((text) => text.includes('"head":"Everything at the start of this turn'));
	assert.equal(capsuleOf(requests[1]), capsuleOf(requests[0]), "the turn's capsule is not rewritten in place");
	// The next turn's first call: the brief (the source's own, not a residue of this turn's capsule) is still the prefix.
	const briefAt = (context) => context.messages.findIndex((message) => messageText(message).includes('"kind":"context_brief"'));
	const index = briefAt(requests[2]);
	assert.ok(index > 0 && index === briefAt(requests[1]));
	assert.deepEqual(requests[2].messages.slice(0, index + 1).map(messageText), requests[1].messages.slice(0, index + 1).map(messageText));
	assert.ok(nextTurn.cacheRead >= Math.ceil(requests[2].messages.slice(0, index + 1).map((message) => `${message.role}:${messageText(message)}`).join("\n\n").length / 4));
	// §179.2: right after the brief comes the turn's capsule, then the history, on the turn's calls and on the next turn's first.
	for (const context of requests) {
		assert.match(messageText(context.messages[index + 1]), CAPSULE_HEAD, "the capsule follows the brief");
		assert.match(messageText(context.messages[index + 2]), /"kind":"historical_quotations"/, "the history follows the capsule");
	}
	const previous = messageText(requests[1].messages[index + 1]), next = messageText(requests[2].messages[index + 1]);
	const before = JSON.parse(previous), after = JSON.parse(next);
	assert.deepEqual(Object.keys(after), Object.keys(stableFirst(after)), "its sections are in the stable-first order");
	// This turn's write (a clue) changed sections; the two capsules share every section ahead of the first one it changed.
	const changed = Object.keys(after).find((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
	const shared = sharedPrefix(previous, next);
	assert.ok(changed && Object.keys(after).indexOf(changed) > 0, `a section after the head changed: ${changed}`);
	assert.ok(shared >= sectionOffset(after, changed), `the capsules share ${shared} characters, through every section before ${changed}`);
	assert.ok(nextTurn.cacheRead >= Math.ceil(`${promptText(requests[2].messages.slice(0, index + 1))}\n\nuser:${next.slice(0, shared)}`.length / 4),
		`the next turn's first call reads the brief and the capsule's shared head from cache (${nextTurn.cacheRead})`);
});

test("§179.2: when a turn wrote nothing to a stable section, the next turn's first call shares the capsule past style, and every request row is fingerprinted (§179.3)", async (t) => {
	const campaign = "test-camp", requests = [];
	const prepareWorkspace = (workspace) => kernelSteps(workspace, campaign, [["table.open", {}], ["table.player_input", { text: "我坐下" }],
		["table.narrate", { call_id: "t1-c1", text: "诺特把帽子搁在椅背上。" }]]);
	const hybrid = createHybridEngine({ env: process.env, decision: null });
	const reply = (message) => (context) => { requests.push(context); return message; };
	const table = await openTable({
		realKernel: true, prepareWorkspace, runDriver: hybrid.runDriver, env: { PI_COC_LOOP_ENGINE: "hybrid-v1", PI_COC_JEV_PRESELECT: "1", EXT_JEV_APIKEY: "test-key" },
		extraExtensions: [{ name: "coc-hybrid-engine", factory: hybrid.extension }],
		// Two turns that only deliver: nothing but the turn's own record changes between them.
		responses: [reply(fauxAssistantMessage([fauxToolCall("narrate", { text: "他说先去报馆。" })], { stopReason: "toolUse" })),
			reply(fauxAssistantMessage([fauxToolCall("narrate", { text: "你点头。" })], { stopReason: "toolUse" }))],
	});
	t.after(() => table.dispose());
	await table.session.prompt("该去哪儿查？");
	await table.session.prompt("我点头。");
	assert.equal(requests.length, 2);
	const [, nextTurn] = table.session.messages.filter((message) => message.role === "assistant" && message.usage).map((message) => message.usage);
	const briefAt = (context) => context.messages.findIndex((message) => messageText(message).includes('"kind":"context_brief"'));
	const index = briefAt(requests[1]);
	assert.ok(index > 0 && index === briefAt(requests[0]));
	for (const [context, player] of [[requests[0], "该去哪儿查？"], [requests[1], "我点头。"]]) {
		assert.match(messageText(context.messages[index + 1]), CAPSULE_HEAD, "the capsule follows the brief");
		assert.match(messageText(context.messages[index + 2]), /"kind":"historical_quotations"/, "then the history");
		assert.equal(messageText(context.messages[index + 3]), player, "then the player's words");
	}
	const previous = messageText(requests[0].messages[index + 1]), next = messageText(requests[1].messages[index + 1]);
	const after = JSON.parse(next), shared = sharedPrefix(previous, next);
	const volatile = Object.keys(after).find((key) => CAPSULE_VOLATILE_SECTIONS.includes(key));
	assert.ok(sectionOffset(after, volatile) > sectionOffset(after, "style"), "style sits ahead of the volatile sections");
	assert.ok(shared >= sectionOffset(after, volatile),
		`the capsules share ${shared} characters, past style and up to the first volatile section (${volatile} at ${sectionOffset(after, volatile)})`);
	const cached = `${promptText(requests[1].messages.slice(0, index + 1))}\n\nuser:${next.slice(0, shared)}`;
	assert.ok(nextTurn.cacheRead >= Math.ceil(cached.length / 4),
		`the next turn's first call reads the system prompt, the brief and the capsule's head from cache (${nextTurn.cacheRead} >= ${Math.ceil(cached.length / 4)})`);
	t.diagnostic(`capsule ${next.length} chars; shared with the previous turn's ${shared} chars (~${Math.ceil(shared / 4)} tokens); cacheRead ${nextTurn.cacheRead}`);

	// §179.3: the context lane's request rows carry the time and the request's fingerprints.
	await waitFor(() => table.telemetry().filter((row) => row.lane === "context" && row.event === "request").length >= 2, { label: "two request rows" });
	const rows = table.telemetry().filter((row) => row.lane === "context" && row.event === "request");
	for (const row of rows) {
		assert.equal(row.at, new Date(row.at).toISOString());
		assert.match(row.system_digest, /^[a-f0-9]{12}$/);
		assert.deepEqual(row.segments.slice(0, 4).map((segment) => segment.kind), ["coc-context-brief", "coc-capsule", "coc-history", "user"]);
		assert.ok(row.segments.every((segment) => Number.isSafeInteger(segment.bytes) && segment.bytes > 0 && /^[a-f0-9]{12}$/.test(segment.digest)));
		const total = row.segments.reduce((sum, segment) => sum + segment.bytes, 0) + row.system_bytes;
		assert.equal(total - row.request_bytes, row.segments.length - 1, "the segments and the system message make up the request");
	}
	const [one, two] = rows.slice(-2);
	assert.equal(two.system_digest, one.system_digest, "the system prompt did not change");
	assert.equal(two.segments[0].digest, one.segments[0].digest, "nor did the brief");
	assert.notEqual(two.segments[1].digest, one.segments[1].digest, "the capsule did: the first segment that differs");
	assert.ok(Date.parse(two.at) >= Date.parse(one.at));
});

for (const engine of ["hybrid-v1", "legacy"]) {
	test(`§135.23 on the ${engine} engine: ${engine === "legacy" ? "the brief is still the residue of the request's capsule (legacy unchanged)" : "the brief is the source's own, the same message across turns"}`, async (t) => {
		// A later turn's capsule holds less style than the rehydrated one (§13.6): the brief kept from the last turn
		// meets this turn's smaller capsule on the new turn's first request.
		const hybrid = engine === "hybrid-v1" ? createHybridEngine({ env: process.env, decision: null }) : undefined, requests = [];
		const reply = (message) => (context) => { requests.push(context); return message; };
		const tail = hybrid ? [] : [fauxAssistantMessage("你还在等。")];
		const table = await openTable({
			env: { FAKE_KERNEL_WORKSPACE: "1", FAKE_KERNEL_STYLE_BUDGET: "1", FAKE_KERNEL_PRESENT: "[]", PI_COC_JEV_PRESELECT: "1", EXT_JEV_APIKEY: "test-key",
				...(hybrid ? { PI_COC_LOOP_ENGINE: "hybrid-v1" } : {}) },
			...(hybrid ? { runDriver: hybrid.runDriver, extraExtensions: [{ name: "coc-hybrid-engine", factory: hybrid.extension }] } : {}),
			// Turn 1 closes on the Keeper's prose (the host's implicit narrate, as on the gate table), so no write result
			// resets the brief before turn 2.
			responses: [reply(fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "time", minutes: 10, why: "They waited." }] })], { stopReason: "toolUse" })),
				reply(fauxAssistantMessage("时间过去了。")),
				reply(fauxAssistantMessage([fauxToolCall("narrate", { text: "你还在等。" })], { stopReason: "toolUse" })), ...tail],
		});
		t.after(() => table.dispose());
		await table.session.prompt("我等着");
		await table.session.prompt("我继续等");
		assert.equal(requests.length, 3);
		const brief = (context) => context.messages.map(messageText).find((text) => text.includes('"kind":"context_brief"'));
		assert.ok(brief(requests[1]) && brief(requests[2]));
		// Legacy is unchanged: its brief carries only the style the request's capsule lacks (here the capsule has it all).
		if (engine === "legacy") assert.doesNotMatch(brief(requests[2]), /observable-first/, "legacy still sends the residue");
		else {
			assert.equal(brief(requests[2]), brief(requests[1]), "the next turn's first request shares the brief");
			assert.match(brief(requests[2]), /observable-first/, "the brief carries the source's whole style");
		}
	});
}

test("§135.23: the capsule update names only the sections that changed, and nothing when none did", () => {
	assert.equal(capsuleUpdate({ turn: { state: "open" }, where: { scene: "a" } }, { turn: { state: "open" }, where: { scene: "a" } }), undefined);
	const update = capsuleUpdate({ turn: { state: "open" }, where: { scene: "a" }, gone: 1 }, { turn: { state: "acting" }, where: { scene: "a" }, present: [] });
	assert.deepEqual(update.sections, { turn: { state: "acting" }, present: [] });
	assert.deepEqual(update.removed, ["gone"]);
	assert.equal(update.kind, "capsule_update");
	assert.equal(CAPSULE_UPDATE_TYPE, "coc-capsule-update");
});
