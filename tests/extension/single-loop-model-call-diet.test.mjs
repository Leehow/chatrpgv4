// Controller-only cases retired with single-keeper-streaming-turns; retained cases exercise current shared utilities.
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
 * - §184.2: the turn's capsule follows the brief, its stable sections first, so the next turn's first call also reads the
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
		fauxAssistantMessage([fauxToolCall("output", { text: "好。" })], { stopReason: "toolUse" }), fauxAssistantMessage("好。")] });
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

for (const engine of ["hybrid-v1", "legacy"]) {
}

test("§135.23: the capsule update names only the sections that changed, and nothing when none did", () => {
	assert.equal(capsuleUpdate({ turn: { state: "open" }, where: { scene: "a" } }, { turn: { state: "open" }, where: { scene: "a" } }), undefined);
	const update = capsuleUpdate({ turn: { state: "open" }, where: { scene: "a" }, gone: 1 }, { turn: { state: "acting" }, where: { scene: "a" }, present: [] });
	assert.deepEqual(update.sections, { turn: { state: "acting" }, present: [] });
	assert.deepEqual(update.removed, ["gone"]);
	assert.equal(update.kind, "capsule_update");
	assert.equal(CAPSULE_UPDATE_TYPE, "coc-capsule-update");
});
