/**
 * Contract §154 (prototype, 2026-09-29): lean `apply` arguments behind `PI_COC_LEAN_APPLY=1`.
 *
 * Three seams. The tool surface: off is the ordinary `COC_TOOLS` object itself; on, only descriptions differ and the
 * schema's shape (what Pi validates) is the ordinary one. The host: on, every `table.apply` it sends carries `_lean`;
 * off, none does. The kernel: what a lean call leaves out is either derived where it is read (`definition ?? name`, and
 * under `_lean` the origin line of a person established without a `why`) or read by nobody; without `_lean` the kernel
 * is byte-for-byte what it was, including the "None" an absent origin line renders as today.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Check } from "typebox/value";
import { COC_TOOLS } from "../../extensions/kernel/tools.ts";
import { LEAN_APPLY_ENV, LEAN_FIELD_DESCRIPTIONS, LEAN_APPLY_NOTE, leanApplyEnabled, leanTools, offeredTools } from "../../extensions/kernel/lean-apply.ts";
import { openTable, waitForIdle } from "./harness.mjs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import modsExtension from "../../extensions/mods/index.ts";
import { KernelError } from "../../extensions/kernel/client.ts";
import { table as kernelTable } from "./object-usages-fixture.mjs";
import { waitFor } from "./wait.mjs";

const applyOf = (tools) => tools.find((tool) => tool.name === "apply");
const variant = (tools, kind) => applyOf(tools).parameters.properties.effects.items.anyOf
	.find((candidate) => candidate.properties.kind.const === kind || candidate.properties.kind.enum?.[0] === kind);
/** The schema as JSON with every description removed: what is left is the shape Pi validates. */
const shape = (schema) => JSON.parse(JSON.stringify(schema, (key, value) => (key === "description" ? undefined : value)));
/** Every own `~optional`/`~kind` marker on the way down, by path: the non-enumerable half of a TypeBox schema. */
function markers(value, path = "", out = {}) {
	if (!value || typeof value !== "object") return out;
	for (const key of ["~optional", "~kind"]) if (Object.hasOwn(value, key)) out[`${path}/${key}`] = value[key];
	for (const [key, child] of Object.entries(value)) markers(child, `${path}/${key}`, out);
	return out;
}

test("on by default; off (only an explicit 0) is the ordinary tool list itself", () => {
	// On by default (2026-09-29): only an explicit 0 turns it off.
	for (const env of [{ [LEAN_APPLY_ENV]: "0" }, { [LEAN_APPLY_ENV]: " 0 " }]) {
		assert.equal(leanApplyEnabled(env), false, JSON.stringify(env));
		assert.equal(offeredTools(COC_TOOLS, env), COC_TOOLS, "off registers the very same specs, not a copy");
	}
	for (const env of [{}, { [LEAN_APPLY_ENV]: "" }, { [LEAN_APPLY_ENV]: "true" }, { [LEAN_APPLY_ENV]: "1" }])
		assert.equal(leanApplyEnabled(env), true, JSON.stringify(env));
	assert.equal(leanApplyEnabled({ [LEAN_APPLY_ENV]: "1" }), true);
	assert.notEqual(offeredTools(COC_TOOLS, { [LEAN_APPLY_ENV]: "1" }), COC_TOOLS);
});

test("on, the apply schema keeps its shape and its validation markers; only descriptions change", () => {
	const before = JSON.stringify(COC_TOOLS.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })));
	const lean = leanTools(COC_TOOLS);
	assert.equal(JSON.stringify(COC_TOOLS.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }))), before,
		"the ordinary list is not mutated by building the lean one");
	for (const [index, tool] of COC_TOOLS.entries()) {
		if (tool.name !== "apply") assert.equal(lean[index], tool, `${tool.name} is untouched`);
	}
	assert.deepEqual(shape(applyOf(lean).parameters), shape(applyOf(COC_TOOLS).parameters), "types, required fields and bounds are the ordinary ones");
	assert.deepEqual(markers(applyOf(lean).parameters), markers(applyOf(COC_TOOLS).parameters), "every ~optional and ~kind survives the copy");
	assert.equal(applyOf(lean).description, applyOf(COC_TOOLS).description + LEAN_APPLY_NOTE);

	// Pi validates against the copy: a required field is still required, an omitted optional one still fine.
	const leanParams = applyOf(lean).parameters;
	assert.equal(Check(leanParams, { effects: [{ kind: "time", minutes: 10 }] }), true, "time without why");
	assert.equal(Check(leanParams, { effects: [{ kind: "object", name: "Flashlight", adopt: "flashlight", to: "Thomas Hayes" }] }), true,
		"an adoption without definition or why");
	assert.equal(Check(leanParams, { effects: [{ kind: "object", name: "Flashlight", adopt: "flashlight" }] }), false, "object.to is still required");
	assert.equal(Check(leanParams, { effects: [{ kind: "time", minutes: 10, why: "x".repeat(201) }] }), false, "the one-sentence bound still holds");
});

test("on, every listed field carries its lean description, and the whys a reader needs are still asked for", () => {
	const lean = leanTools(COC_TOOLS);
	for (const [kind, fields] of Object.entries(LEAN_FIELD_DESCRIPTIONS)) {
		for (const [field, text] of Object.entries(fields)) {
			const got = variant(lean, kind).properties[field].description, was = variant(COC_TOOLS, kind).properties[field].description ?? "";
			assert.equal(got, typeof text === "string" ? text : was + text.append, `${kind}.${field}`);
			assert.notEqual(got, was, `${kind}.${field} changed`);
		}
	}
	// The consumers the map found: the kernel refuses these without a why, or a projection/lane reads it back.
	assert.match(variant(lean, "npc").properties.why.description, /required with defense, action or disposition; keep it with stance/);
	assert.match(variant(lean, "object").properties.why.description, /required for a condition change or a document write/);
	assert.match(variant(lean, "flag").properties.why.description, /waiving it: why is what makes it a waiver/);
	// Read elsewhere, so untouched.
	for (const kind of ["item", "cash", "damage", "map"])
		assert.equal(variant(lean, kind).properties.why.description, variant(COC_TOOLS, kind).properties.why.description, `${kind}.why is kept as it was`);
	assert.equal(variant(lean, "clue").properties.how.description, variant(COC_TOOLS, "clue").properties.how.description, "clue.how is the player's clue card");
});

test("a field the lean table names that the schema lost is an error, not a silent old instruction", () => {
	const renamed = COC_TOOLS.map((tool) => tool.name !== "apply" ? tool : { ...tool, parameters: { ...tool.parameters, properties: { ...tool.parameters.properties,
		effects: { ...tool.parameters.properties.effects, items: { anyOf: tool.parameters.properties.effects.items.anyOf.filter((v) => v.properties.kind.enum?.[0] !== "person") } } } } });
	assert.throws(() => leanTools(renamed), /no person effect/);
});

// ---- the host seam: the tools Pi registers and what reaches the kernel ----

async function hostTable(t, env) {
	let pi;
	const table = await openTable({ env, extraExtensions: [{ name: "lean-probe", factory: (api) => { pi = api; } }], responses: [
		fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "time", minutes: 10 }] })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: "Ten minutes pass in the quiet office while you think it over." })], { stopReason: "toolUse" }),
		fauxAssistantMessage("Ten minutes pass in the quiet office while you think it over."),
	] });
	t.after(() => table.dispose());
	await table.session.prompt("I wait for ten minutes.");
	await waitForIdle(table.session);
	return { table, apply: pi.getAllTools().find((tool) => tool.name === "apply") };
}

test("host, flag on: Pi offers the lean apply and every table.apply carries _lean", async (t) => {
	const { table, apply } = await hostTable(t, { [LEAN_APPLY_ENV]: "1" });
	assert.equal(apply.description, applyOf(COC_TOOLS).description + LEAN_APPLY_NOTE);
	assert.equal(variant([apply], "time").properties.why.description, LEAN_FIELD_DESCRIPTIONS.time.why);
	const applies = table.kernelRequests().filter((request) => request.method === "table.apply");
	assert.equal(applies.length, 1);
	assert.equal(applies[0].params._lean, true);
	assert.ok(table.kernelRequests().filter((request) => request.method !== "table.apply").every((request) => !("_lean" in (request.params ?? {}))),
		"only apply says it");
});

test("host, flag off: Pi offers today's apply and no request carries _lean", async (t) => {
	const { table, apply } = await hostTable(t, { [LEAN_APPLY_ENV]: "0" });
	assert.equal(apply.description, applyOf(COC_TOOLS).description);
	assert.equal(variant([apply], "time").properties.why.description, variant(COC_TOOLS, "time").properties.why.description);
	const applies = table.kernelRequests().filter((request) => request.method === "table.apply");
	assert.equal(applies.length, 1);
	assert.ok(!("_lean" in applies[0].params), "off sends exactly what it sent before");
});

test("host: a model-sent _lean never reaches the kernel", async (t) => {
	const table = await openTable({ env: { [LEAN_APPLY_ENV]: "0" }, responses: [
		fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "time", minutes: 5 }], _lean: true })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text: "Five minutes go by while you watch the street below." })], { stopReason: "toolUse" }),
		fauxAssistantMessage("Five minutes go by while you watch the street below."),
	] });
	t.after(() => table.dispose());
	await table.session.prompt("I watch the street.");
	await waitForIdle(table.session);
	const [apply] = table.kernelRequests().filter((request) => request.method === "table.apply");
	assert.ok(apply && !("_lean" in apply.params));
});

// ---- the kernel seam: a lean call lands what a full one lands ----

const WITHOUT_TIME = (receipts) => receipts.map(({ at, ...rest }) => rest);

async function adopt(t, object) {
	const game = await kernelTable(t);
	const job = await game.call("mods.job", { role: "create", input: { name: "Hand torch", category: "item", description: "A battery flashlight." } });
	await writeFile(join(job.cwd, "result.json"), JSON.stringify({ name: "Hand torch", category: "item", description: "A battery flashlight.",
		basis: "Listed on the investigator sheet.", parameters: { charges: null, effects: [] }, player_view: { description: "A battery flashlight.", fields: [] } }));
	const accepted = await game.call("mods.accept", { job: job.job });
	const result = await game.apply([{ kind: "define", name: "Hand torch", category: "item", _definition: accepted.definition, _provenance: accepted.provenance },
		{ kind: "object", adopt: "flashlight", to: game.sheet.name, ...object }]);
	const world = await game.world(), turn = JSON.parse(await readFile(join(game.directory, "turn.json"), "utf8"));
	return { result, world, receipts: turn.receipts };
}

test("kernel: an adoption that leaves out definition equal to its name lands the same receipts and world", async (t) => {
	const full = await adopt(t, { name: "Hand torch", definition: "Hand torch", why: "registering the sheet's equipment" });
	const lean = await adopt(t, { name: "Hand torch" });
	assert.deepEqual(WITHOUT_TIME(lean.receipts), WITHOUT_TIME(full.receipts), "the adoption receipt never carried why, and definition is read from name");
	assert.deepEqual(lean.world.objects, full.world.objects);
	assert.ok(lean.receipts.some((receipt) => receipt.kind === "definition" && receipt.adopted === "flashlight"), "the adoption landed");
	const instance = Object.values(lean.world.objects.instances).find((item) => item.name === "Hand torch");
	assert.equal(lean.world.objects.definitions[instance.definition].name, "Hand torch", "the instance stands on the named definition");
});

/**
 * The live path of the starting-equipment batch (§129.4): the Mod host defers the define beside the turn, the kernel
 * queues the adoption with the effect as the Keeper sent it, and the next turn's resume replays that stored effect.
 * A lean adoption (no definition, no why, no category) must come out of the replay as the full one does.
 */
const TORCH = { name: "Hand torch", category: "item", description: "A battery flashlight.", basis: "Listed on the investigator sheet.",
	parameters: { charges: null, effects: [] }, player_view: { description: "A battery flashlight with a dented barrel.", fields: [] } };

function modsHost(game) {
	const entries = [];
	const pi = { events: new EventEmitter(), on: () => undefined,
		appendEntry: (customType, data) => entries.push({ type: "custom", id: `entry-${entries.length}`, customType, data }) };
	let bridge, minted = 50;
	const self = { turn: 1 };
	pi.events.on("coc:mods-bridge", (value) => { bridge = value; });
	modsExtension(pi);
	const call = async (method, params) => {
		try { return await game.call(method, JSON.parse(JSON.stringify(params))); }
		catch (error) {
			if (typeof error?.code !== "string") throw error;
			throw new KernelError({ code: error.code, message: error.message, fix: error.fix, details: error.details });
		}
	};
	pi.events.emit("coc:kernel-bridge", { call, mintCallId: () => `t${self.turn}-c${++minted}`,
		runtime: {
			async runTask(task) {
				await writeFile(join(task.request.cwd, "result.json"), JSON.stringify(TORCH));
				return { ok: true, code: 0, timedOut: false, ms: 1, stderr: "", command: [] };
			},
			async check() { return { ok: true }; },
		} });
	return Object.assign(self, { bridge, entries });
}

async function adoptBesideTheTurn(t, define, object) {
	const game = await kernelTable(t);
	const h = modsHost(game);
	const payload = { campaign: "c1", effects: [{ kind: "define", name: TORCH.name, description: TORCH.description, ...define },
		{ kind: "object", adopt: "flashlight", to: game.sheet.name, name: TORCH.name, ...object }] };
	await h.bridge.prepare("apply", payload);
	assert.equal(typeof payload.effects[0]._queued, "string", "the define is generated beside the turn");
	const applied = await game.apply(payload.effects);
	const queuedReceipts = JSON.parse(await readFile(join(game.directory, "turn.json"), "utf8")).receipts;
	await game.call("table.narrate", { call_id: game.next(), text: "You check your pockets: notebook, lockpicks, the flashlight." });
	await waitFor(() => h.entries.some((entry) => entry.customType === "coc-object-details"), { label: "the definition landed beside the turn" });
	await game.call("table.player_input", { text: "I test the flashlight." });
	h.turn = 2;
	await h.bridge.after("player_input", { campaign: "c1" });
	const world = await game.world(), sheet = JSON.parse(await readFile(game.sheetPath, "utf8"));
	const instance = Object.values(world.objects.instances).find((item) => item.name === TORCH.name);
	return { applied, queuedReceipts: WITHOUT_TIME(queuedReceipts), instance, definition: instance && world.objects.definitions[instance.definition],
		equipment: sheet.equipment, queued: Object.values(world.mods.state).flatMap((state) => Object.values(state.queued ?? {})) };
}

test("kernel + Mod host: a lean starting-equipment adoption queued beside the turn resumes into the same instance as a full one", async (t) => {
	const full = await adoptBesideTheTurn(t, { category: "item" }, { definition: TORCH.name, why: "registering the sheet's equipment" });
	const lean = await adoptBesideTheTurn(t, {}, {});
	assert.deepEqual(lean.queuedReceipts, full.queuedReceipts, "the queued adoption's receipt never carried why or definition");
	assert.ok(full.instance, "the full adoption resumed into an instance");
	assert.deepEqual(lean.instance, full.instance, "same id, owner, quantity and state");
	assert.equal(lean.definition.name, TORCH.name);
	assert.equal(lean.definition.placeholder, undefined, "the generated definition replaced the placeholder");
	assert.deepEqual(lean.definition, full.definition);
	assert.deepEqual(lean.equipment, full.equipment, "the sheet mirrors the same adopted row");
	assert.deepEqual(lean.queued, [], "nothing left queued");
});

async function lookOrigin(game, name) {
	const view = await game.call("table.look", { focus: "npc", name });
	return view.origin;
}

test("kernel: a walk-on without why under _lean gets the origin line the kernel knows; without _lean it stays as today", async (t) => {
	const DOORMAN = "the boiler-room porter";
	const lean = await kernelTable(t);
	await lean.call("table.apply", { call_id: lean.next(), _lean: true, effects: [{ kind: "npc", name: DOORMAN, to: "here", walk_on: true }] });
	assert.equal((await lookOrigin(lean, DOORMAN)).reason, "walked on at this table");
	assert.equal((await lean.world()).table_people.find((person) => person.name === DOORMAN).why, "walked on at this table");

	const today = await kernelTable(t);
	await today.call("table.apply", { call_id: today.next(), effects: [{ kind: "npc", name: DOORMAN, to: "here", walk_on: true }] });
	assert.equal((await lookOrigin(today, DOORMAN)).reason, "None", "the absent origin line renders as it always has");
	assert.equal((await today.world()).table_people.find((person) => person.name === DOORMAN).why, null);
});

test("kernel: the Keeper's own why is never replaced, lean or not", async (t) => {
	const DOORMAN = "the boiler-room porter";
	const game = await kernelTable(t);
	await game.call("table.apply", { call_id: game.next(), _lean: true,
		effects: [{ kind: "npc", name: DOORMAN, to: "here", walk_on: true, why: "he came up from the cellar stair" }] });
	assert.equal((await lookOrigin(game, DOORMAN)).reason, "he came up from the cellar stair");
});

test("kernel: a person a carried passage names, recorded without why under _lean, gets the passage origin line", async (t) => {
	const CLERK = "Mr. Pruitt";
	const passage = { sentence: `The day clerk, ${CLERK}, keeps the ledger.`, scene: null, page: 3 };
	const lean = await kernelTable(t);
	await lean.call("table.apply", { call_id: lean.next(), _lean: true, effects: [{ kind: "person", who: CLERK, name: CLERK, _passage: passage }] });
	assert.equal((await lean.world()).table_people.find((person) => person.name === CLERK).why, "a passage of the source text named them");

	const today = await kernelTable(t);
	await today.call("table.apply", { call_id: today.next(), effects: [{ kind: "person", who: CLERK, name: CLERK, _passage: passage }] });
	assert.equal((await today.world()).table_people.find((person) => person.name === CLERK).why, null);
});

test("kernel: _lean must be a boolean", async (t) => {
	const game = await kernelTable(t);
	await assert.rejects(game.call("table.apply", { call_id: game.next(), _lean: "yes", effects: [{ kind: "time", minutes: 1 }] }),
		(error) => error.code === "invalid_params" && /_lean must be boolean/.test(error.message));
});
