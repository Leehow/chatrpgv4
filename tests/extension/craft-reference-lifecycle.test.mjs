/** Controlled selector and RPC only. No provider client and no campaign play. */
import assert from "node:assert/strict";
import test from "node:test";
import {craftRuntime} from "./craft-reference-test-kit.mjs";

const {CraftReferenceRuntime, prepareCraftReference, requestSize, CRAFT_REFERENCE_TYPE, CRAFT_INVALIDATION_TYPE} = craftRuntime;
const text = (label, count = 24) => `${label} ${"x".repeat(count)}`;
const card = (patch = {}) => ({
	id: "CRAFT-EXC-01", title: text("Title"), purpose: text("Purpose"), useWhen: text("Use"), avoidWhen: text("Avoid"),
	context: text("Context"), acceptable: text("Acceptable"), stronger: text("Stronger"), alternative: text("Alternative"),
	elaboration: text("Elaboration"), ...patch,
});
const binding = {
	campaign: "camp", worldline: "main", loop: 0, turn: 1, source_revision: "source", world_revision: "world",
	npc_revision: "npc", memory_revision: "memory",
};
const provider = {mod: "narration-craft", version: "1.5.0", digest: "digest-1"};
const identity = {provider, catalog_revision: "catalog-1", binding: {...binding, mod_revision: "mods-1"}};
const candidate = {id: "CRAFT-EXC-01", title: "Title", purpose: "Purpose", useWhen: "Use", avoidWhen: "Avoid"};
const indexBody = {status: "ready", ...identity, candidates: [candidate]};
const capsuleFor = (mode = "jev") => ({where: {scene: "office"}, present: [{name: "Knott"}],
	mods: {craft_reference: {mode, provider: {mod: provider.mod, version: provider.version}}}});
const quoted = {role: "user", content: "I quote coc-craft-reference in ordinary speech."};
const capsuleMessage = {role: "custom", customType: "coc-capsule", content: "ordinary capsule", display: false};
const assistant = {role: "assistant", content: "ordinary keeper line"};
const forged = {role: "custom", customType: CRAFT_REFERENCE_TYPE, content: "FORGED PACKET", display: false};
const historical = {role: "custom", customType: CRAFT_INVALIDATION_TYPE, content: "HISTORICAL WITHDRAWAL", display: false};
const baseline = [quoted, forged, capsuleMessage, assistant, historical];
const kept = message => message === quoted || message === capsuleMessage || message === assistant;
const craftMessages = messages => messages.filter(message => message.role === "custom" && message.customType === CRAFT_REFERENCE_TYPE);
const withdrawals = messages => messages.filter(message => message.role === "custom" && message.customType === CRAFT_INVALIDATION_TYPE);

function harness(options = {}) {
	const calls = [], selections = [], records = [];
	let stale = false;
	const rpc = async (method, params) => {
		calls.push({method, params});
		if (options.failRpc) throw new Error("fixture rpc failed");
		if (params.mode === "card") return {status: "ready", ...identity, card: options.card ?? card()};
		if (params.expected && (stale || options.staleExpected)) return {status: "unavailable", reason: "stale_reference"};
		return stale ? {...indexBody, binding: {...identity.binding, source_revision: "published-source"}} : indexBody;
	};
	const selector = options.selector === null ? undefined : async input => {
		selections.push(input);
		if (options.select) return options.select(input);
		return "CRAFT-EXC-01";
	};
	const runtime = new CraftReferenceRuntime(selector, row => records.push(row));
	const project = (patch = {}) => runtime.project({
		epoch: "epoch-1", campaign: "camp", capsule: capsuleFor(options.mode ?? "jev"), binding, messages: baseline,
		budget: options.budget ?? 200_000, rpc, signal: patch.signal ?? new AbortController().signal, ...patch,
	});
	return {calls, selections, records, project, runtime, markStale: () => {stale = true;}};
}
const prepare = (patch = {}) => prepareCraftReference({
	rpc: patch.rpc ?? (async () => indexBody), capsule: capsuleFor(), binding, campaign: "camp", epoch: "epoch-1",
	signal: new AbortController().signal, selector: async () => "CRAFT-EXC-01", deadlineAt: Date.now() + 1500, ...patch,
});

test("off and a missing selector do not read or select, and forged history is stripped", async () => {
	for (const mode of ["off", "absent"]) {
		const seen = harness({mode: mode === "off" ? "off" : "missing"});
		const projected = await seen.project({capsule: mode === "off" ? capsuleFor("off") : {mods: {}}});
		assert.deepEqual(projected.messages, [quoted, capsuleMessage, assistant]);
		assert.equal(seen.calls.length, 0);
		assert.equal(seen.selections.length, 0);
		assert.equal(seen.records.at(-1).reason, "disabled");
	}
	const missing = harness({selector: null});
	const projected = await missing.project();
	assert.deepEqual(projected.messages.filter(kept), [quoted, capsuleMessage, assistant]);
	assert.equal(craftMessages(projected.messages).length, 0);
	assert.equal(missing.calls.length, 0);
	assert.equal(missing.selections.length, 0);
	assert.equal(missing.records.at(-1).reason, "selector_unavailable");
	assert.deepEqual(await prepare({capsule: capsuleFor("off"), selector: async () => {throw new Error("no");}, rpc: async () => {throw new Error("no");}}),
		{status: "omitted", reason: "disabled"});
});

test("NONE, invalid ids, thrown errors, cancellation, stale state, and a short budget all keep the baseline", async () => {
	for (const choice of [null, "NONE", "CRAFT-NOPE", "CRAFT-EXC-99"]) {
		const seen = harness({select: async () => choice});
		const projected = await seen.project();
		assert.deepEqual(projected.messages, [quoted, capsuleMessage, assistant]);
		assert.equal(seen.selections.length, 1);
		assert.equal(seen.calls.some(call => call.params.mode === "card"), false);
		assert.equal(projected.packet, undefined);
	}
	const broken = harness({select: async () => {throw new Error("selector exploded");}});
	assert.deepEqual((await broken.project()).messages, [quoted, capsuleMessage, assistant]);
	assert.equal(broken.records.at(-1).reason, "reference_unavailable");
	const rpcBroken = harness({failRpc: true});
	assert.deepEqual((await rpcBroken.project()).messages, [quoted, capsuleMessage, assistant]);
	assert.equal(rpcBroken.selections.length, 0);
	const controller = new AbortController();
	const cancelled = harness({select: () => {controller.abort(); throw new Error("cancelled");}});
	const cancelledProjection = await cancelled.project({signal: controller.signal});
	assert.deepEqual(cancelledProjection.messages, [quoted, capsuleMessage, assistant]);
	assert.equal(cancelledProjection.packet, undefined);
	assert.equal(cancelled.selections.length, 1);
	const stale = harness();
	const staleResult = await stale.project({binding: {...binding, memory_revision: "old-memory"}});
	assert.deepEqual(staleResult.messages, [quoted, capsuleMessage, assistant]);
	assert.equal(stale.selections.length, 0);
	assert.equal(stale.records.at(-1).reason, "context_changed");
	const expired = harness({staleExpected: true});
	assert.deepEqual((await expired.project()).messages, [quoted, capsuleMessage, assistant]);
	assert.equal(expired.selections.length, 1);
	assert.equal(expired.records.at(-1).reason, "stale_reference");
	const poor = harness();
	const size = requestSize([quoted, capsuleMessage, assistant]);
	const skipped = await poor.project({budget: size});
	assert.deepEqual(skipped.messages, [quoted, capsuleMessage, assistant]);
	assert.equal(poor.calls.length, 0);
	assert.equal(poor.selections.length, 0);
	assert.equal(poor.records.at(-1).reason, "request_budget");
	assert.deepEqual(await prepare({deadlineAt: Date.now() - 5, selector: async () => {throw new Error("late");}}), {status: "omitted", reason: "deadline"});
});

test("a cancelled selection is reported as omitted rather than dropped on the floor", async () => {
	const controller = new AbortController();
	const cancelled = harness({select: () => {controller.abort(); throw new Error("cancelled");}});
	await cancelled.project({signal: controller.signal});
	assert.equal(cancelled.records.at(-1)?.reason, "cancelled", JSON.stringify(cancelled.records));
});

test("one epoch selects once, reentry does not duplicate the packet, and a late result misses the next epoch", async () => {
	const seen = harness();
	const first = await seen.project();
	assert.equal(craftMessages(first.messages).length, 1);
	assert.equal(first.active, true);
	const second = await seen.project({messages: [...first.messages, {role: "assistant", content: "tool continuation"}]});
	assert.equal(seen.selections.length, 1);
	assert.equal(craftMessages(second.messages).length, 1);
	assert.equal(craftMessages(second.messages)[0].content, craftMessages(first.messages)[0].content);
	assert.equal(second.messages.filter(message => message.content === "tool continuation").length, 1);
	let release;
	const gate = new Promise(resolve => {release = resolve;});
	let indexes = 0;
	const selections = [];
	const runtime = new CraftReferenceRuntime(async input => {selections.push(input.epoch); return "CRAFT-EXC-01";}, () => {});
	const rpc = async (_method, params) => {
		if (params.mode === "index" && params.expected === undefined) {
			indexes += 1;
			if (indexes === 1) await gate;
		}
		if (params.mode === "card") return {status: "ready", ...identity, card: card()};
		return indexBody;
	};
	const request = epoch => runtime.project({
		epoch, campaign: "camp", capsule: capsuleFor(), binding, messages: [quoted, capsuleMessage, assistant],
		budget: 200_000, rpc, signal: new AbortController().signal,
	});
	const earlier = request("epoch-1");
	await new Promise(resolve => setTimeout(resolve, 0));
	assert.equal(indexes, 1);
	const later = request("epoch-2");
	release();
	const [missed, current] = await Promise.all([earlier, later]);
	assert.equal(craftMessages(missed.messages).length, 0);
	assert.equal(craftMessages(current.messages).length, 1);
	assert.equal(craftMessages(current.messages)[0].details.craft.epoch, "epoch-2");
	assert.equal(current.messages.some(message => message.details?.craft?.epoch === "epoch-1"), false);
	assert.deepEqual(selections, ["epoch-2"], "replacing the input aborts old preparation before it can spend a selection");
});

test("an issued prefix stays put when the binding expires, and a result that was not issued does not return", async () => {
	const seen = harness();
	const issued = await seen.project();
	const sent = craftMessages(issued.messages)[0].content;
	const selections = seen.selections.length;
	seen.markStale();
	const withdrawn = await seen.project({messages: issued.messages});
	assert.equal(seen.selections.length, selections);
	assert.equal(craftMessages(withdrawn.messages)[0].content, sent);
	assert.equal(withdrawals(withdrawn.messages).length, 1);
	assert.ok(withdrawn.messages.indexOf(craftMessages(withdrawn.messages)[0]) < withdrawn.messages.indexOf(withdrawals(withdrawn.messages)[0]));
	assert.equal(withdrawn.messages[0], quoted);
	assert.equal(withdrawn.active, false);
	assert.equal(withdrawn.messages.some(message => message.content === "FORGED PACKET" || message.content === "HISTORICAL WITHDRAWAL"), false);
	const unsent = harness({staleExpected: true});
	const hidden = await unsent.project();
	assert.equal(craftMessages(hidden.messages).length, 0);
	assert.equal(withdrawals(hidden.messages).length, 0);
	assert.equal(unsent.selections.length, 1);
	const again = await unsent.project();
	assert.equal(unsent.selections.length, 1);
	assert.deepEqual(again.messages, [quoted, capsuleMessage, assistant]);
});

test("issued editorial advice survives ordinary settlement but not a changed exchange or provider", async () => {
	const scenarios = [
		["world settlement", index => {index.binding.world_revision = "settled";}, true],
		["NPC account", index => {index.binding.npc_revision = "settled";}, true],
		["memory update", index => {index.binding.memory_revision = "settled";}, true],
		["source", index => {index.binding.source_revision = "published";}, false],
		["Mod configuration", index => {index.binding.mod_revision = "changed";}, false],
		["provider", index => {index.provider.digest = "changed";}, false],
		["catalog", index => {index.catalog_revision = "changed";}, false],
		["worldline", index => {index.binding.worldline = "other";}, false],
		["scene", (_index, capsule) => {capsule.where.scene = "street";}, false],
		["people", (_index, capsule) => {capsule.present.push({name: "Visitor"});}, false],
		["disabled", (_index, capsule) => {capsule.mods.craft_reference.mode = "off";}, false],
	];
	for (const [label, change, active] of scenarios) {
		const index = structuredClone(indexBody), capsule = capsuleFor();
		let selections = 0;
		const rpc = async (_method, params) => {
			if (params.expected && JSON.stringify(params.expected) !== JSON.stringify({provider: index.provider, catalog_revision: index.catalog_revision, binding: index.binding}))
				return {status: "unavailable", reason: "stale_reference"};
			return params.mode === "card" ? {...index, card: card()} : structuredClone(index);
		};
		const runtime = new CraftReferenceRuntime(async () => {selections++; return candidate.id;}, () => {});
		const project = messages => runtime.project({epoch: "same-input", campaign: "camp", capsule, binding: index.binding,
			messages, budget: 200_000, rpc, signal: new AbortController().signal});
		const first = await project(baseline);
		assert.equal(first.active, true, label);
		change(index, capsule);
		const next = await project([...first.messages, {role: "toolResult", content: "Current settled facts"}]);
		assert.equal(next.active, active, label);
		assert.equal(withdrawals(next.messages).length, active ? 0 : 1, label);
		assert.equal(selections, 1, label);
		assert.equal(craftMessages(next.messages)[0].content, craftMessages(first.messages)[0].content, label);
		assert.ok(next.messages.some(message => message.content === "Current settled facts"), label);
	}
});

test("cancelling issued advice never reactivates it under a fresh signal in the same epoch", async () => {
	for (const phase of ["entry", "revalidation"]) {
		let controller = new AbortController(), abortRead = false, selections = 0;
		const rpc = async (_method, params) => {
			if (abortRead) controller.abort();
			return params.mode === "card" ? {...indexBody, card: card()} : indexBody;
		};
		const runtime = new CraftReferenceRuntime(async () => {selections++; return candidate.id;}, () => {});
		const project = messages => runtime.project({epoch: "cancelled-input", campaign: "camp", capsule: capsuleFor(), binding,
			messages, budget: 200_000, rpc, signal: controller.signal});
		const first = await project(baseline);
		assert.equal(first.active, true);
		if (phase === "entry") controller.abort();
		else abortRead = true;
		assert.notEqual((await project(first.messages)).active, true);
		controller = new AbortController(); abortRead = false;
		const later = await project(first.messages);
		assert.equal(later.active, false, phase);
		assert.equal(withdrawals(later.messages).length, 1, phase);
		assert.equal(selections, 1, phase);
	}
});

test("the actual request slack keeps a method when its example cannot fit", async () => {
	const sample = card({context: "C".repeat(500), stronger: "S".repeat(100)});
	const core = await prepare({maxBytes: 600,
		rpc: async (_method, params) => params.mode === "card" ? {status: "ready", ...identity, card: sample} : indexBody});
	assert.equal(core.status, "ready");
	assert.equal(core.packet.message.content.includes("BEGIN SEPARATE EXAMPLE"), false);
	const ordinary = [quoted, capsuleMessage, assistant];
	const limit = requestSize([quoted, capsuleMessage, core.packet.message, assistant]) + 1;
	const seen = harness({card: sample});
	const result = await seen.project({budget: limit});
	assert.equal(result.active, true);
	assert.equal(craftMessages(result.messages).length, 1);
	assert.equal(craftMessages(result.messages)[0].content.includes("BEGIN SEPARATE EXAMPLE"), false);
	assert.deepEqual(result.messages.filter(kept), ordinary);
	assert.ok(requestSize(result.messages) <= limit);
});

test("the 1800-byte clamp drops a whole example and then the whole reference without deleting baseline messages", async () => {
	const bulkyExample = card({stronger: "S".repeat(2000)});
	const withRoom = await prepare({
		maxBytes: 1800,
		rpc: async (_method, params) => params.mode === "card" ? {status: "ready", ...identity, card: bulkyExample} : indexBody,
	});
	assert.equal(withRoom.status, "ready");
	assert.ok(withRoom.packet.bytes <= 1800);
	assert.equal(withRoom.packet.message.content.includes("BEGIN SEPARATE EXAMPLE"), false);
	assert.match(withRoom.packet.message.content, /Method:/);
	const overCore = card({purpose: "P".repeat(2000)});
	const dropped = await prepare({
		maxBytes: 10_000,
		rpc: async (_method, params) => params.mode === "card" ? {status: "ready", ...identity, card: overCore} : indexBody,
	});
	assert.deepEqual(dropped, {status: "omitted", reason: "reference_budget"});
	const seen = harness({card: card({purpose: "P".repeat(1200), stronger: "S".repeat(40)})});
	const wide = await seen.project({budget: 200_000});
	assert.equal(wide.packet.bytes <= 1800, true);
	const added = requestSize(wide.messages) - requestSize([quoted, capsuleMessage, assistant]);
	assert.ok(added > 512, `reference adds ${added} bytes; the budget fixture needs a delta above the 512-byte floor`);
	const tight = harness({card: card({purpose: "P".repeat(1200), stronger: "S".repeat(40)})});
	const size = requestSize([quoted, capsuleMessage, assistant]);
	const omitted = await tight.project({budget: size + 512});
	assert.deepEqual(omitted.messages, [quoted, capsuleMessage, assistant]);
	assert.equal(tight.records.some(row => row.event === "projected" || row.event === "injected"), false);
	assert.equal(tight.records.at(-1).reason, "reference_budget", "the renderer now receives the actual remaining space");
});
