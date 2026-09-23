import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { projectSkillCards } from "../../extensions/kernel/index.ts";
import { COC_TOOLS } from "../../extensions/kernel/tools.ts";
import { customMessages, openTable, waitFor } from "./harness.mjs";

const cards = JSON.parse(readFileSync(new URL("../../content/skills/draft.json", import.meta.url), "utf8"));
const names = ["ordinary-check-with-consequence", "direct-authorized-change", "repair-named-gap"];
const call = (name, args) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
const finish = () => [call("narrate", { text: "The room is still." }), fauxAssistantMessage("")];
const rows = (table) => table.entries("coc-telemetry").filter((row) => row.lane === "skills");
// Independent context/memory extensions own their rows; they are not joined by campaign/turn.
const kernelEvidence = (table, turn) => table.entries("coc-telemetry").filter((entry) => entry.turn === turn
	&& (entry.tool || ["admission", "mods", "provider-request", "provider-response", "provider-call", "skills"].includes(entry.lane)
		|| (entry.lane === "lane-call" && entry.subsession === "admission")));
function capsule(table) {
	const message = customMessages(table.session, "coc-capsule").at(-1);
	assert.equal(message.display, false);
	return JSON.parse(typeof message.content === "string" ? message.content : message.content.map((block) => block.text).join(""));
}

test("draft projection validates shape, preserves exactly three semantic cards, and bounds UTF-8 bytes", () => {
	assert.deepEqual(cards.map((card) => card.name), names);
	const projected = projectSkillCards(cards);
	assert.deepEqual(projected.cards, cards);
	assert.equal(projected.optional, true);
	assert.equal(projected.experiment, "procedural-skill-e0");
	assert.ok(Buffer.byteLength(JSON.stringify(projected)) <= 1024);
	assert.equal(projected.truncated, undefined);
	assert.throws(() => projectSkillCards([{ name: "bad" }]));
	assert.throws(() => projectSkillCards([cards[0], cards[0]]));
	assert.throws(() => projectSkillCards([{ ...cards[0], extra: true }]));
	const excess = projectSkillCards([...cards, { ...cards[0], name: "extra" }]);
	assert.equal(excess.cards.length, 3);
	assert.equal(excess.truncated, true);
	const large = projectSkillCards([cards[0], { ...cards[1], procedure: "é".repeat(1024) }, cards[2]]);
	assert.deepEqual(large.cards, [cards[0]]);
	assert.equal(large.truncated, true);
	assert.ok(Buffer.byteLength(JSON.stringify(large)) <= 1024);
	assert.equal(cards.length, 3);
	for (const spec of COC_TOOLS) {
		assert.equal(spec.parameters.properties.using_skill.type, "string");
		assert.ok(!spec.parameters.required?.includes("using_skill"));
		assert.equal(spec.parameters.properties.run_id, undefined);
	}
	const prompt = readFileSync(new URL("../../prompts/keeper.md", import.meta.url), "utf8");
	assert.match(prompt, /nine kernel sections/);
	assert.match(prompt, /ignoring them creates no debt/);
	assert.match(prompt, /Never mention skills in player text/);
});

for (const enabled of [undefined, "0", "true", "1"]) {
	test(`projection flag ${enabled ?? "unset"}: raw kernel sections and bus/message stay consistent`, async (t) => {
		const seen = [];
		const table = await openTable({ env: { PI_COC_SKILLS: enabled }, responses: finish(),
			extraExtensions: [(pi) => pi.events.on("coc:capsule", (data) => seen.push(data))] });
		t.after(() => table.dispose());
		await table.session.prompt("I watch the room.");
		const projected = capsule(table);
		const raw = JSON.parse(table.kernelRequests().find((row) => row.method === "table.player_input").capsule_json);
		const { skills, ...kernelSections } = projected;
		assert.deepEqual(kernelSections, raw);
		assert.deepEqual(seen[0].capsule, projected);
		assert.equal("skills" in raw, false);
		assert.equal("skills" in projected, enabled === "1");
		if (skills) assert.deepEqual(skills, projectSkillCards(cards));
		assert.equal(rows(table).length, 1);
		assert.equal(rows(table)[0].enabled, enabled === "1");
		assert.deepEqual(rows(table)[0].offered, enabled === "1" ? names : []);
		assert.equal(rows(table)[0].selected, null);
		assert.equal(rows(table)[0].delivered, true);
		assert.equal(rows(table)[0].fallback, false);
		assert.equal(table.telemetry().filter((row) => row.lane === "skills").length, 1);
		assert.deepEqual(table.extensionErrors, []);
	});
}

test("first offered selection wins; every annotation is stripped before admission, Mod and RPC", async (t) => {
	const prepared = [];
	const table = await openTable({ env: { PI_COC_SKILLS: "1" }, responses: [
		call("look", { focus: "time", using_skill: "not-offered" }),
		call("apply", { effects: [{ kind: "time", minutes: 1, why: "Watch the room" }], using_skill: names[1] }),
		call("look", { focus: "time", using_skill: names[0] }),
		call("narrate", { text: "The room is still.", using_skill: "also-not-offered" }), fauxAssistantMessage(""),
	] });
	t.after(() => table.dispose());
	table.emit("coc:mods-bridge", { prepare: async (tool, input) => {
		prepared.push({ tool, input: structuredClone(input) });
		table.runtimeBridges().at(-1).record({ lane: "mods", event: "test-review", tool });
	} });
	await table.session.prompt("I watch the room for a minute.");
	assert.equal(rows(table).length, 1);
	const row = rows(table)[0];
	assert.equal(row.selected, names[1]);
	assert.equal(row.invalid_selection, "not-offered");
	assert.deepEqual(row.tool_names, ["look", "apply", "look", "narrate"]);
	assert.equal(row.delivered, true);
	assert.equal(row.fallback, false);
	assert.deepEqual(row.refusal_classes, []);
	assert.equal(row.provider_rounds, table.entries("coc-telemetry").filter((entry) => entry.lane === "provider-call").length);
	assert.equal(typeof row.provider, "string");
	assert.equal(typeof row.model, "string");
	assert.equal(row.campaign, "test-camp");
	assert.equal(row.turn, 1);
	assert.match(row.run_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
	const evidence = kernelEvidence(table, row.turn);
	for (const lane of ["admission", "mods", "provider-call", "provider-response", "skills"]) {
		assert.ok(evidence.some((entry) => entry.lane === lane), `missing ${lane}`);
	}
	assert.ok(evidence.some((entry) => entry.tool === "table.player_input"));
	assert.ok(evidence.some((entry) => entry.tool === "apply" && entry.call_id));
	assert.ok(evidence.every((entry) => entry.run_id === row.run_id), JSON.stringify(evidence.filter((entry) => entry.run_id !== row.run_id)));
	assert.deepEqual(row.provider_models, [{ provider: row.provider, model: row.model, rounds: row.provider_rounds }]);
	assert.equal(row.mixed_provider_model, false);
	assert.ok(table.lanes.admission.requests().length > 0);
	assert.ok(table.lanes.admission.requests().every((request) => !request.includes("using_skill")));
	assert.ok(prepared.length > 0);
	assert.ok(prepared.every(({ input }) => !("using_skill" in input)));
	for (const payload of [capsule(table), prepared, table.kernelRequests(), table.lanes.admission.requests(), table.session.messages]) {
		assert.ok(!JSON.stringify(payload).includes(row.run_id), "run identity never reaches model, admission, Mod input or RPC");
	}
	for (const request of table.kernelRequests()) assert.equal("using_skill" in (request.params ?? {}), false);
	assert.deepEqual(table.kernelRequests().find((request) => request.method === "table.apply").params.effects,
		[{ kind: "time", minutes: 1, why: "Watch the room" }]);
	assert.deepEqual(table.extensionErrors, []);
});

test("disabled annotations remain nonblocking, invalid, stripped, and never selected", async (t) => {
	const table = await openTable({ env: { PI_COC_SKILLS: "0" }, responses: [
		call("look", { using_skill: names[0] }), ...finish(),
	] });
	t.after(() => table.dispose());
	await table.session.prompt("I wait.");
	const [row] = rows(table);
	assert.equal(row.enabled, false);
	assert.deepEqual(row.offered, []);
	assert.equal(row.selected, null);
	assert.equal(row.invalid_selection, names[0]);
	assert.equal(row.delivered, true);
	assert.equal(row.fallback, false);
	assert.ok(table.kernelRequests().some((request) => request.method === "table.look"));
	assert.ok(table.kernelRequests().every((request) => !("using_skill" in (request.params ?? {}))));
});

test("refused then repaired delivery records fallback and resets across player runs", async (t) => {
	const table = await openTable({ env: { PI_COC_SKILLS: "1",
		FAKE_KERNEL_ERRORS: JSON.stringify({ "table.look": { code: "needs", message: "Name the entity", fix: "Set name" } }),
		FAKE_KERNEL_ERRORS_ONCE: "1" }, responses: [
		call("look", { using_skill: names[2] }), call("look", { focus: "time" }), ...finish(),
	] });
	t.after(() => table.dispose());
	await table.session.prompt("I watch the room.");
	assert.equal(rows(table).length, 1);
	assert.equal(rows(table)[0].selected, names[2]);
	assert.equal(rows(table)[0].fallback, true);
	assert.equal(rows(table)[0].delivered, true);
	assert.ok(rows(table)[0].refusal_classes.includes("needs"));
	table.faux.setResponses(finish());
	await table.session.prompt("I keep watching.");
	assert.equal(rows(table).length, 2);
	assert.notEqual(rows(table)[0].run_id, rows(table)[1].run_id);
	assert.equal(rows(table)[1].selected, null);
	assert.deepEqual(rows(table)[1].refusal_classes, []);
	assert.deepEqual(rows(table)[1].tool_names, ["narrate"]);
	assert.equal(rows(table)[1].fallback, false);
	assert.equal(capsule(table).skills.selected, undefined);
	assert.deepEqual(table.extensionErrors, []);
});

test("provider retry attempts share one settled ledger", async (t) => {
	let starts = 0, settled = 0;
	const table = await openTable({ env: { PI_COC_SKILLS: "1" },
		settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } },
		extraExtensions: [(pi) => {
			pi.on("agent_start", () => { starts += 1; });
			pi.on("agent_settled", () => { settled += 1; });
		}], responses: [
		call("look", { using_skill: names[0] }),
		fauxAssistantMessage([], { stopReason: "error", errorMessage: "503 Service unavailable" }),
		...finish(),
	] });
	t.after(() => table.dispose());
	await table.session.prompt("I inspect the room.");
	assert.ok(starts >= 2, "a retry or queued continuation really ran");
	assert.equal(settled, 1);
	assert.equal(rows(table).length, 1);
	assert.equal(rows(table)[0].selected, names[0]);
	assert.equal(rows(table)[0].delivered, true);
	assert.deepEqual(rows(table)[0].tool_names, ["look", "narrate"]);
	assert.equal(rows(table)[0].provider_rounds, table.entries("coc-telemetry").filter((entry) => entry.lane === "provider-call").length);
	assert.deepEqual(table.extensionErrors, []);
});

test("queued host continuations keep selection and settle exactly once", async (t) => {
	let starts = 0;
	const table = await openTable({ env: { PI_COC_SKILLS: "1" },
		extraExtensions: [(pi) => pi.on("agent_start", () => { starts += 1; })], responses: [
		call("look", { using_skill: names[0] }), fauxAssistantMessage(""), ...finish(),
	] });
	t.after(() => table.dispose());
	await table.session.prompt("I inspect the room.");
	assert.equal(starts, 2);
	assert.equal(rows(table).length, 1);
	assert.equal(rows(table)[0].selected, names[0]);
	assert.equal(rows(table)[0].delivered, true);
	assert.deepEqual(rows(table)[0].tool_names, ["look", "narrate"]);
	assert.deepEqual(table.extensionErrors, []);
});

// §13.11: fallback includes "进入未计划选择/材料/活跃会话路径" even when the run delivers. The combat
// defence is no longer the Keeper's `ask` (§11.5.1 "The combat choice buttons are retired for new
// player defenses"; the host settles it once under the standing preference), so each divergence is
// driven by the path that still produces it: the attack's active session, and a still-open closed
// option (push) handed back with ask.
test("an active session is divergence even when delivery succeeds", async (t) => {
	const table = await openTable({ env: { PI_COC_SKILLS: "1" }, responses: [
		call("resolve", { action: { actor: "Thomas Hayes", goal: "Attack", method: "Punch", intent: "combat", target: "Corbitt", weapon: "unarmed" }, using_skill: names[0] }),
		call("narrate", { text: "Corbitt reels back." }), fauxAssistantMessage(""),
	] });
	t.after(() => table.dispose());
	await table.session.prompt("I attack Corbitt with my bare hands.");
	assert.equal(table.kernelRequests().filter((entry) => entry.method === "table.resolve" && entry.params._standing_defense).length, 1,
		"the attack opened a live combat session whose investigator defence the host settled");
	assert.equal(rows(table).length, 1);
	assert.equal(rows(table)[0].selected, names[0]);
	assert.equal(rows(table)[0].delivered, true);
	assert.equal(rows(table)[0].fallback, true);
	assert.deepEqual(rows(table)[0].refusal_classes, []);
	assert.deepEqual(rows(table)[0].tool_names, ["resolve", "narrate"]);
	assert.deepEqual(table.extensionErrors, []);
});

test("a required choice is divergence even when delivery succeeds", async (t) => {
	const table = await openTable({ env: { PI_COC_SKILLS: "1" }, responses: [
		call("resolve", { action: { goal: "Search the desk", method: "Spot Hidden", intent: "investigate" }, using_skill: names[0] }),
		call("ask", { kind: "mechanics", text: "The drawer seems empty.", options: ["push", "accept"] }), fauxAssistantMessage(""),
	] });
	t.after(() => table.dispose());
	await table.session.prompt("I search the desk.");
	assert.equal(rows(table).length, 1);
	assert.equal(rows(table)[0].selected, names[0]);
	assert.equal(rows(table)[0].delivered, true);
	assert.equal(rows(table)[0].fallback, true);
	assert.deepEqual(rows(table)[0].refusal_classes, []);
	assert.deepEqual(rows(table)[0].tool_names, ["resolve", "ask"]);
	assert.deepEqual(table.extensionErrors, []);
});

test("a material refusal stays fallback after the original action eventually lands", async (t) => {
	const effect = { kind: "time", minutes: 1, why: "Watch the room" };
	const table = await openTable({ env: { PI_COC_SKILLS: "1", FAKE_KERNEL_MATERIAL_PENDING: "1" }, responses: [
		call("apply", { effects: [effect], using_skill: names[1] }),
		call("apply", { effects: [effect] }), ...finish(),
	] });
	t.after(() => table.dispose());
	await table.session.prompt("I watch the room for a minute.");
	assert.equal(rows(table).length, 1);
	assert.equal(rows(table)[0].selected, names[1]);
	assert.equal(rows(table)[0].delivered, true);
	assert.equal(rows(table)[0].fallback, true);
	assert.ok(rows(table)[0].refusal_classes.includes("material_pending"));
	assert.deepEqual(table.extensionErrors, []);
});

test("session rebinding discards the prior run and its selection", async (t) => {
	const table = await openTable({ env: { PI_COC_SKILLS: "1" }, responses: [call("look", { using_skill: names[0] }), ...finish()] });
	t.after(() => table.dispose());
	await table.session.prompt("I inspect the room.");
	await table.session._extensionRunner.emit({ type: "session_start" });
	table.faux.setResponses(finish());
	await table.session.prompt("I wait here.");
	assert.equal(rows(table).length, 2);
	assert.notEqual(rows(table)[0].run_id, rows(table)[1].run_id);
	assert.equal(rows(table)[1].selected, null);
	assert.equal(rows(table)[1].invalid_selection, null);
	assert.deepEqual(rows(table)[1].tool_names, ["narrate"]);
	assert.deepEqual(table.extensionErrors, []);
});

test("implicit delivery and request-hook rounds retain one private run identity without double counting", async (t) => {
	let table;
	table = await openTable({ env: { PI_COC_SKILLS: "1", PI_COC_SPEECH_STEER: "0" }, extraExtensions: [(pi) => {
		pi.on("turn_start", async () => table.session._extensionRunner.emit({
			type: "before_provider_request", payload: { model: "transport-model" },
		}));
	}], responses: [call("look", { using_skill: names[0] }), fauxAssistantMessage("The room is still.")] });
	t.after(() => table.dispose());
	await table.session.prompt("I inspect the room.");
	const [row] = rows(table);
	const evidence = kernelEvidence(table, row.turn);
	assert.equal(row.provider_rounds, 2);
	assert.equal(row.provider_models.length, 1);
	assert.equal(row.provider_models[0].model, "transport-model");
	assert.equal(row.provider_models[0].rounds, 2);
	assert.equal(row.mixed_provider_model, false);
	assert.ok(evidence.some((entry) => entry.lane === "provider-request"));
	assert.ok(evidence.some((entry) => entry.tool === "narrate" && entry.implicit));
	assert.ok(evidence.every((entry) => entry.run_id === row.run_id));
	assert.deepEqual(table.extensionErrors, []);
});

test("a mid-run provider change preserves both exact identities rather than choosing the last", async (t) => {
	let changed = false;
	const table = await openTable({ env: { PI_COC_SKILLS: "1" }, extraExtensions: [(pi) => {
		pi.on("turn_end", async (_event, ctx) => {
			if (changed) return;
			changed = true;
			const second = ctx.modelRegistry.getAll().find((model) => model.provider === "verifier" && model.id === "v1");
			assert.ok(second);
			assert.equal(await pi.setModel(second), true);
		});
	}], responses: [call("look", { using_skill: names[0] })] });
	t.after(() => table.dispose());
	table.lanes.verifier.setResponses([...finish(), fauxAssistantMessage("")]);
	await table.session.prompt("I inspect the room.");
	const [row] = rows(table);
	assert.equal(row.mixed_provider_model, true);
	assert.equal(row.provider, null);
	assert.equal(row.model, null);
	assert.equal(row.provider_models.length, 2);
	assert.equal(row.provider_models[0].rounds, 1);
	assert.equal(row.provider_models[1].provider, "verifier");
	assert.equal(row.provider_models[1].model, "v1");
	assert.ok(row.provider_models[1].rounds >= 1);
	assert.equal(row.provider_models.reduce((sum, identity) => sum + identity.rounds, 0), row.provider_rounds);
	assert.equal(row.provider_rounds, table.entries("coc-telemetry").filter((entry) => entry.lane === "provider-call").length);
	assert.equal(row.delivered, true);
	assert.deepEqual(table.extensionErrors, []);
});

for (const status of ["pending", "reviewing", "ready"]) {
	test(`adaptation status ${status} uses the structured wait for fallback accounting`, async (t) => {
		const table = await openTable({ env: { PI_COC_SKILLS: "1", PI_COC_ADAPTATION_WAIT_MS: "0",
			FAKE_KERNEL_RETAINED_ADAPTATION_STATUS: status }, responses: [
			call("lookup", { kind: "adaptation", action: "status", using_skill: names[1] }), ...finish(),
		] });
		t.after(() => table.dispose());
		await table.session.prompt("Check the preparation and tell me its status.");
		const [row] = rows(table);
		assert.equal(row.selected, names[1]);
		assert.equal(row.delivered, true);
		assert.deepEqual(row.refusal_classes, []);
		assert.equal(row.fallback, status !== "ready");
		if (status !== "ready") assert.equal(table.entries("coc-adaptation-status").at(-1).status, status);
		assert.deepEqual(table.extensionErrors, []);
	});
}

test("a selected skill with an aborted provider has no delivery and falls back", async (t) => {
	const table = await openTable({ env: { PI_COC_SKILLS: "1" }, responses: [
		call("look", { using_skill: names[0] }), fauxAssistantMessage([], { stopReason: "aborted", errorMessage: "Stopped" }),
	] });
	t.after(() => table.dispose());
	await table.session.prompt("I look around.");
	assert.equal(rows(table).length, 1);
	assert.equal(rows(table)[0].delivered, false);
	assert.equal(rows(table)[0].fallback, true);
	assert.deepEqual(rows(table)[0].tool_names, ["look"]);
	// The host publishes the unfinished-turn notice asynchronously after settlement.
	// Observe delivery before disposing the SDK session, rather than racing its stale-ctx guard.
	await waitFor(() => customMessages(table.session, "coc-delivery").some(message => message.details?.turn_unfinished),
		{ label: "aborted turn notice" });
	assert.deepEqual(table.extensionErrors, []);
});
