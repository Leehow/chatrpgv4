/**
 * Contract §138.6 (BR-02): the host pins a tier or a profile on the kernel's own `needs` refusal.
 *
 * The real extension over the fake kernel, with a controlled typed endpoint behind the real decision adapter
 * (`fetch` answers the pinned Jev model). Asserted: what the kernel was sent, in what order and under which call
 * ids; what the Keeper was told; and the bind rows. Below the gate, on an `unknown`, on a second refusal for the same
 * person in a turn, and without a key, the refusal reaches the Keeper exactly as the kernel wrote it.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, toolResultTexts, waitForIdle } from "./harness.mjs";

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const KNOTT = "Steven Knott";
const PRESENT = JSON.stringify([
	{ name: KNOTT, kind: "npc", role: "landlord", wants: "the house let again", fears: "a scandal in the papers", summary: "A nervous property man who has never raised a hand to anyone." },
	{ name: "看门人", kind: "npc" },
]);
const PROFILES = JSON.stringify([
	{ id: "knife_medium", name: "Knife, Medium", skill: "Fighting (Brawl)", damage: "1D4+2" },
	{ id: "club_large", name: "Club, Large", skill: "Fighting (Brawl)", damage: "1D8" },
	{ id: "revolver_38", name: ".38 Revolver", skill: "Firearms (Handgun)", damage: "1D10", range: 15 },
]);
const ENV = { EXT_JEV_APIKEY: "test-jev-key", FAKE_KERNEL_PRESENT: PRESENT, FAKE_KERNEL_UNPINNED: JSON.stringify([KNOTT]), FAKE_KERNEL_WEAPON_PROFILES: PROFILES };
const ATTACK = { intent: "combat", goal: "knock the landlord down", method: "a straight punch", target: KNOTT, weapon: "unarmed" };

function distribution(keys, chosen, confidence) {
	const rest = keys.length > 1 ? (1 - confidence) / (keys.length - 1) : 0;
	return Object.fromEntries(keys.map((key) => [key, key === chosen ? (keys.length > 1 ? confidence : 1) : rest]));
}

/** A controlled typed endpoint: `answer(key, question, body)` names the choice and its confidence for every question. */
function installJev(t, answer) {
	const original = globalThis.fetch;
	const requests = [];
	globalThis.fetch = async (url, init) => {
		if (String(url) !== JEV_URL) return original(url, init);
		const body = JSON.parse(init.body);
		requests.push(body);
		const answers = Object.fromEntries(Object.entries(body.questions).map(([key, question]) => {
			const keys = Object.keys(question.criteria);
			const { choice, confidence } = answer(key, question, body);
			return [key, { type: "choice", choice, confidence, probabilities: distribution(keys, choice, confidence) }];
		}));
		return new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 500, output_tokens: 20 } }), { status: 200 });
	};
	t.after(() => { globalThis.fetch = original; });
	return requests;
}

// The Keeper's and the host's writes; the standing defence the host settles after a landed attack (§11.5) is its own call.
const writes = (table) => table.kernelRequests().filter((entry) => ["table.resolve", "table.apply"].includes(entry.method) && !entry.params?.action?.defense);
const bindRows = (table) => table.telemetry().filter((row) => row.lane === "run" && row.event === "bind" && row.clerk === "band_recovery");
const recoveryRows = (table) => table.telemetry().filter((row) => row.lane === "band-recovery");

async function play(t, { responses, env = ENV, answer }) {
	const requests = installJev(t, answer);
	const table = await openTable({ responses: [...responses, fauxAssistantMessage([fauxToolCall("narrate", { text: "拳头落下。" })], { stopReason: "toolUse" }), fauxAssistantMessage("done")], env });
	t.after(() => table.dispose());
	await waitForIdle(table.session);
	await table.session.prompt("我一拳打向诺特。");
	return { table, requests };
}

test("above the gate the host pins the tier under its own call id and the refused resolve is retried once", async (t) => {
	const { table, requests } = await play(t, {
		responses: [fauxAssistantMessage([fauxToolCall("resolve", { action: ATTACK })], { stopReason: "toolUse" })],
		answer: (key) => ({ choice: key === "tier" ? "capable_adult" : "unknown", confidence: 0.81 }),
	});
	const sent = writes(table);
	assert.deepEqual(sent.map((entry) => entry.method), ["table.resolve", "table.apply", "table.resolve"]);
	assert.equal(sent[0].params.call_id, "t1-c1");
	assert.equal(sent[1].params.call_id, "t1-c2");
	assert.deepEqual(sent[1].params.effects.map(({ why, ...effect }) => effect), [{ kind: "npc", name: KNOTT, archetype: "capable_adult" }]);
	assert.match(sent[1].params.effects[0].why, /capable_adult/);
	assert.match(sent[1].params.effects[0].why, /player: "我一拳打向诺特。"/);
	assert.equal(sent[2].params.call_id, "t1-c1");
	assert.deepEqual(sent[2].params.action, sent[0].params.action);
	// The Keeper reads the retried result and the note, never the refusal.
	const texts = toolResultTexts(table.session).join("\n");
	assert.match(texts, /pinned Steven Knott's stat block as capable_adult/);
	assert.match(texts, /apply npc under call t1-c2/);
	assert.match(texts, /Fighting \(Brawl\)/);
	assert.doesNotMatch(texts, /has no stat block/);
	// One question, over the kernel's own rows, with the person and the declaration as its state.
	assert.equal(requests.length, 1);
	const question = requests[0].questions.tier;
	assert.deepEqual(Object.keys(question.criteria), ["ordinary_adult", "capable_adult", "dangerous_actor", "unknown"]);
	assert.equal(requests[0].state.person.role, "landlord");
	assert.equal(requests[0].state.declaration, "我一拳打向诺特。");
	assert.equal(requests[0].family ?? requests[0].state.family, undefined);
	// The bind row says how the parameter got its value.
	const [row] = bindRows(table);
	assert.equal(row.status, "succeeded");
	assert.equal(row.call_id, "t1-c2");
	assert.equal(row.refused_call_id, "t1-c1");
	assert.deepEqual(row.bindings.map(({ distribution: _d, ...binding }) => binding), [{ name: "archetype", path: "banded", value: "capable_adult", table: "npc-stat-archetypes", confidence: 0.81 }]);
	assert.ok(recoveryRows(table).some((r) => r.ok === true && r.band === "capable_adult"));
});

test("below the gate the refusal reaches the Keeper unchanged and nothing is written", async (t) => {
	const { table, requests } = await play(t, {
		responses: [fauxAssistantMessage([fauxToolCall("resolve", { action: ATTACK })], { stopReason: "toolUse" })],
		answer: () => ({ choice: "capable_adult", confidence: 0.31 }),
	});
	assert.deepEqual(writes(table).map((entry) => entry.method), ["table.resolve"]);
	assert.equal(requests.length, 1);
	const texts = toolResultTexts(table.session).join("\n");
	assert.match(texts, /has no stat block in the module/);
	assert.match(texts, /pin a stat block first/);
	assert.doesNotMatch(texts, /pinned Steven Knott/);
	const [row] = bindRows(table);
	assert.equal(row.outcome, "keeper");
	assert.equal(row.cause, "low_confidence");
	assert.equal(row.bindings[0].value, null);
	assert.equal(row.bindings[0].band, "capable_adult");
});

test("an unknown answer is the Keeper's, and the same person is not asked twice in a turn", async (t) => {
	const { table, requests } = await play(t, {
		responses: [
			fauxAssistantMessage([fauxToolCall("resolve", { action: ATTACK })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("resolve", { action: { ...ATTACK, method: "a kick" } })], { stopReason: "toolUse" }),
		],
		answer: () => ({ choice: "unknown", confidence: 0.9 }),
	});
	assert.deepEqual(writes(table).map((entry) => entry.method), ["table.resolve", "table.resolve"]);
	assert.equal(requests.length, 1, "the second refusal for the same person spends no question");
	const causes = bindRows(table).map((row) => row.cause);
	assert.deepEqual(causes, ["unknown"]);
	assert.deepEqual(recoveryRows(table).map((row) => row.reason), ["unknown", "already_asked"]);
	// Each refused resolve reaches the Keeper as its own tool result carrying the kernel's refusal.
	assert.equal(toolResultTexts(table.session).filter((text) => /has no stat block in the module/.test(text)).length, 2);
});

test("without a Jev key no question is asked and the refusal stands", async (t) => {
	const { EXT_JEV_APIKEY: _key, ...env } = ENV;
	const { table, requests } = await play(t, {
		responses: [fauxAssistantMessage([fauxToolCall("resolve", { action: ATTACK })], { stopReason: "toolUse" })],
		env, answer: () => ({ choice: "capable_adult", confidence: 0.99 }),
	});
	assert.equal(requests.length, 0);
	assert.deepEqual(writes(table).map((entry) => entry.method), ["table.resolve"]);
	assert.deepEqual(recoveryRows(table).map((row) => row.reason), ["unconfigured"]);
	assert.equal(bindRows(table).length, 0);
	assert.match(toolResultTexts(table.session).join("\n"), /has no stat block in the module/);
});

test("a retry refused for another reason still tells the Keeper the pin landed", async (t) => {
	const { weapon: _weapon, ...unarmed } = ATTACK;
	const { table } = await play(t, {
		responses: [fauxAssistantMessage([fauxToolCall("resolve", { action: unarmed })], { stopReason: "toolUse" })],
		answer: () => ({ choice: "capable_adult", confidence: 0.9 }),
	});
	assert.deepEqual(writes(table).map((entry) => entry.method), ["table.resolve", "table.apply", "table.resolve"]);
	const refusal = toolResultTexts(table.session).find((text) => /这次攻击没说用什么打/.test(text));
	assert.ok(refusal, "the retry's own refusal reaches the Keeper");
	assert.match(refusal, /pinned Steven Knott's stat block as capable_adult/);
	assert.match(refusal, /"band_recovery":\{"field":"archetype"/);
	assert.equal(bindRows(table)[0].status, "succeeded");
});

test("a pin the kernel refuses leaves the original refusal with the Keeper and says why on the row", async (t) => {
	const { table, requests } = await play(t, {
		responses: [fauxAssistantMessage([fauxToolCall("resolve", { action: ATTACK })], { stopReason: "toolUse" })],
		env: { ...ENV, FAKE_KERNEL_REFUSE_PIN: "1" },
		answer: () => ({ choice: "capable_adult", confidence: 0.9 }),
	});
	assert.deepEqual(writes(table).map((entry) => entry.method), ["table.resolve", "table.apply"]);
	assert.equal(requests.length, 1);
	assert.match(toolResultTexts(table.session).join("\n"), /has no stat block in the module/);
	assert.doesNotMatch(toolResultTexts(table.session).join("\n"), /pinned Steven Knott/);
	const [row] = bindRows(table);
	assert.equal(row.outcome, "keeper");
	assert.equal(row.cause, "pin_refused:invalid_params");
	assert.equal(row.call_id, "t1-c2");
	assert.deepEqual(recoveryRows(table).map((r) => r.reason), ["pin_refused:invalid_params"]);
});

test("a wrong weapon profile is read in two levels and the Keeper's own item lands with it under the same call id", async (t) => {
	const item = { kind: "item", name: "a brass-knuckled knife", weapon: "brass knife", why: "taken from the cellar tools" };
	const { table, requests } = await play(t, {
		responses: [fauxAssistantMessage([fauxToolCall("apply", { effects: [item] })], { stopReason: "toolUse" })],
		answer: (key, question) => {
			if (key === "family") return { choice: "Fighting (Brawl)", confidence: 0.9 };
			const keys = Object.keys(question.criteria);
			return keys.includes("knife_medium") ? { choice: "knife_medium", confidence: 0.84 } : { choice: "none", confidence: 0.7 };
		},
	});
	const sent = writes(table);
	assert.deepEqual(sent.map((entry) => entry.method), ["table.apply", "table.apply"]);
	assert.equal(sent[0].params.effects[0].weapon, "brass knife");
	assert.equal(sent[1].params.call_id, sent[0].params.call_id);
	assert.deepEqual(sent[1].params.effects, [{ ...item, weapon: "knife_medium" }]);
	// Two requests: the skill family, then the profiles of the families kept.
	assert.equal(requests.length, 2);
	assert.deepEqual(Object.keys(requests[0].questions), ["family"]);
	assert.deepEqual(Object.keys(requests[0].questions.family.criteria), ["Fighting (Brawl)", "Firearms (Handgun)", "none"]);
	assert.ok(Object.keys(requests[1].questions).every((key) => key.startsWith("profile_")));
	assert.equal(requests[1].state.thing.name, item.name);
	const texts = toolResultTexts(table.session).join("\n");
	assert.match(texts, /read a brass-knuckled knife as the rulebook profile knife_medium/);
	const [row] = bindRows(table);
	assert.equal(row.status, "succeeded");
	assert.equal(row.call_id, undefined);
	assert.equal(row.bindings[0].value, "knife_medium");
	assert.equal(row.bindings[0].table, "weapons");
	assert.equal(row.bindings[0].family.choice, "Fighting (Brawl)");
	// The weakest of the two judgments is the confidence, never their product.
	assert.equal(row.bindings[0].confidence, 0.84);
});

test("a thing that is no weapon leaves the Keeper's refusal as the kernel wrote it", async (t) => {
	const item = { kind: "item", name: "a dented bucket", weapon: "bucket" };
	const { table, requests } = await play(t, {
		responses: [fauxAssistantMessage([fauxToolCall("apply", { effects: [item] })], { stopReason: "toolUse" })],
		answer: () => ({ choice: "none", confidence: 0.95 }),
	});
	assert.deepEqual(writes(table).map((entry) => entry.method), ["table.apply"]);
	assert.equal(requests.length, 1);
	assert.match(toolResultTexts(table.session).join("\n"), /is not a weapon profile in the rules tables/);
	assert.deepEqual(bindRows(table).map((row) => row.cause), ["none"]);
});
