/**
 * Contract §11.5.6 (SL-62). A person named in a write or check that the graph and the turn's carried text both
 * miss is resolved against the scene's known people (present, §135.31's own reduction) before `unknown_entity`
 * stands: one fan-out question, one row per known person, each judged on the SL-52 within-row margin
 * (`rowClears`, `runtime/jev/route-compile.ts`). A clear row rewrites the call's own name to that person's handle
 * and the write lands; a name that clears no row still refuses `unknown_entity`, unchanged; the fan-out is
 * memoised per player turn by the name asked.
 *
 * Evidence (long gate #10 t4, `longgate10-haunting-1345`): at the Hall of Records the Keeper wrote
 * `look npc 档案处的办事员` and three `resolve` on that name, all refused `unknown_entity` -- the starter's NPC is
 * "the Hall of Records clerk", registered under the play-language name the lane rendered, and the Keeper's own
 * rendering did not match -- though the same turn's compile had already listed "the Hall of Records clerk" as an
 * addressee candidate: the person was known.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitForIdle } from "./harness.mjs";

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const CLERK = "the Hall of Records clerk";
const VARIANT = "档案处的办事员";

function distribution(keys, chosen, confidence) {
	const rest = keys.length > 1 ? (1 - confidence) / (keys.length - 1) : 0;
	return Object.fromEntries(keys.map((key) => (key === chosen ? [key, confidence] : [key, rest])));
}

/** A controlled typed endpoint for the `person-name-resolution` family only; any other family gets its first option. */
function installJev(t, answer) {
	const original = globalThis.fetch;
	const seen = [];
	globalThis.fetch = async (url, init) => {
		if (String(url) !== JEV_URL) return original(url, init);
		const body = JSON.parse(init.body);
		// The wire body carries no family (`PackedRequest` is `{model, state, questions}`); the person-name-resolution
		// state shape (`{name, candidates}`) is what tells this family's request apart from any other's.
		const mine = !!body.state && typeof body.state.name === "string" && Array.isArray(body.state.candidates);
		if (mine) seen.push(body);
		const answers = Object.fromEntries(Object.entries(body.questions).map(([key, question]) => {
			const keys = Object.keys(question.criteria);
			const index = Number(key.slice("person_".length)) - 1;
			const { choice, confidence } = mine ? answer(body.state.candidates[index], body.state) : { choice: keys[0], confidence: 0.99 };
			return [key, { type: "choice", choice, confidence, probabilities: distribution(keys, choice, confidence) }];
		}));
		return new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 100, output_tokens: 10 } }), { status: 200 });
	};
	t.after(() => { globalThis.fetch = original; });
	return seen;
}

const ENV = { EXT_JEV_APIKEY: "test-jev-key", FAKE_KERNEL_PRESENT: JSON.stringify([{ name: CLERK }]) };
const place = (name) => fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "npc", name, to: "here", why: "他站在窗口后" }] })], { stopReason: "toolUse" });
const narrate = (text) => fauxAssistantMessage([fauxToolCall("narrate", { text })], { stopReason: "toolUse" });
const writes = (table) => table.telemetry().filter((row) => row.tool === "apply" && !row.event);
const resolutions = (table) => table.telemetry().filter((row) => row.event === "name_resolution");

test("§11.5.6: a variant name of a present person clears its row and the write lands with the resolved handle", async (t) => {
	const requests = installJev(t, () => ({ choice: "yes", confidence: 0.8 }));
	const table = await openTable({ env: { ...ENV, FAKE_KERNEL_UNKNOWN_ENTITY: JSON.stringify({ name: VARIANT }) },
		responses: [place(VARIANT), narrate("他从窗口后抬起头。")] });
	t.after(() => table.dispose());
	await table.session.prompt("我走到窗口前");
	await waitForIdle(table.session);

	assert.equal(requests.length, 1, "one fan-out question, one row for the one known person");
	assert.deepEqual(requests[0].state.candidates.map((row) => row.alias), ["person_1"]);
	assert.deepEqual(requests[0].state.name, VARIANT);

	assert.deepEqual(writes(table).map((row) => row.ok), [true], `the write lands after resolution: ${JSON.stringify(writes(table))}`);
	assert.deepEqual(resolutions(table).map((row) => [row.name, row.status, row.resolved_to]), [[VARIANT, "resolved", CLERK]]);
});

test("§11.5.6: a name that clears no row is still refused unknown_entity, and the fan-out asks only once", async (t) => {
	const requests = installJev(t, () => ({ choice: "no", confidence: 0.9 }));
	const table = await openTable({ env: { ...ENV, FAKE_KERNEL_UNKNOWN_ENTITY: JSON.stringify({ name: "一个陌生人" }) },
		responses: [place("一个陌生人"), place("一个陌生人"), narrate("没有人回应。")] });
	t.after(() => table.dispose());
	await table.session.prompt("我叫住那个陌生人");
	await waitForIdle(table.session);

	// The fixture refuses this exact name every time it is spelled the same way, like a real name the graph does
	// not know; memoisation (this section) is what keeps the fan-out from being asked again for the same name,
	// so both writes are refused and only one question is ever sent.
	assert.equal(requests.length, 1, "the fan-out was asked once for this name, never again this turn");
	const [first, second] = writes(table);
	assert.deepEqual([first.ok, first.code], [false, "unknown_entity"], `the original refusal stands: ${JSON.stringify(first)}`);
	assert.equal(second.ok, false, "the second write for the same unresolved name is refused too");
	assert.deepEqual(resolutions(table).map((row) => [row.name, row.status]), [["一个陌生人", "unresolved"]]);
	// A name that clears no row is never retried against the kernel a second time for the same write: one
	// `table.apply` request per Keeper write, not two, or an unresolved name would cost a wasted round trip.
	const applyCalls = table.kernelRequests().filter((row) => row.method === "table.apply");
	assert.equal(applyCalls.length, 2, `one kernel call per write, no retry when nothing resolves: ${JSON.stringify(applyCalls.map((row) => row.params?.effects))}`);
});

test("§11.5.6: a name no scene person is present for spends no Jev call", async (t) => {
	const requests = installJev(t, () => ({ choice: "yes", confidence: 0.9 }));
	const table = await openTable({ env: { EXT_JEV_APIKEY: "test-jev-key", FAKE_KERNEL_PRESENT: JSON.stringify([]),
		FAKE_KERNEL_UNKNOWN_ENTITY: JSON.stringify({ name: "一个陌生人" }) }, responses: [place("一个陌生人"), narrate("没有人回应。")] });
	t.after(() => table.dispose());
	await table.session.prompt("我叫住那个陌生人");
	await waitForIdle(table.session);

	assert.equal(requests.length, 0, "no known people, no candidates, no question -- the candidates are the scene's own rows");
	assert.deepEqual(writes(table).map((row) => [row.ok, row.code]), [[false, "unknown_entity"]]);
});

// §11.5.8 (SL-67; amends §11.5.6). Evidence: SL-29A batch-10 t14 -- 拉斯/内特/史蒂夫, shortened from three persons
// (拉斯·威廉姆斯/内特·帕特森/史蒂夫·布朗) this campaign established at t1 via `from_passage`, refused `unknown_entity`
// when the party had moved on and none of the three were in `present` any more. The candidate rows now also come
// from the campaign's own roster (`table.look`'s `roster`, unconditioned by scene or presence), asked with the
// same per-row question: presence decides what the check can target, not whether the name resolves.
const ESTABLISHED = "拉斯·威廉姆斯", SHORTENED = "拉斯";

test("§11.5.8: a shortened name of a person this campaign established elsewhere resolves via the roster, party absent", async (t) => {
	const requests = installJev(t, () => ({ choice: "yes", confidence: 0.85 }));
	const table = await openTable({ env: { EXT_JEV_APIKEY: "test-jev-key",
		FAKE_KERNEL_PRESENT: JSON.stringify([]), // the party is elsewhere: nobody from the roster is present this scene
		FAKE_KERNEL_ROSTER: JSON.stringify([{ name: ESTABLISHED, display_name: ESTABLISHED }]),
		FAKE_KERNEL_UNKNOWN_ENTITY: JSON.stringify({ name: SHORTENED }) },
		responses: [place(SHORTENED), narrate("拉斯点了点头。")] });
	t.after(() => table.dispose());
	await table.session.prompt("我向拉斯问起这件事");
	await waitForIdle(table.session);

	assert.equal(requests.length, 1, "one fan-out question, one row for the roster's one established person");
	assert.deepEqual(requests[0].state.candidates.map((row) => row.alias), ["person_1"]);
	assert.deepEqual(writes(table).map((row) => row.ok), [true], `the write lands after resolving against the roster: ${JSON.stringify(writes(table))}`);
	assert.deepEqual(resolutions(table).map((row) => [row.name, row.status, row.resolved_to]), [[SHORTENED, "resolved", ESTABLISHED]]);
});

test("§11.5.8: an unrelated name still refuses unknown_entity even with an established roster to ask", async (t) => {
	const requests = installJev(t, () => ({ choice: "no", confidence: 0.9 }));
	const table = await openTable({ env: { EXT_JEV_APIKEY: "test-jev-key", FAKE_KERNEL_PRESENT: JSON.stringify([]),
		FAKE_KERNEL_ROSTER: JSON.stringify([{ name: ESTABLISHED, display_name: ESTABLISHED }]),
		FAKE_KERNEL_UNKNOWN_ENTITY: JSON.stringify({ name: "一个陌生人" }) },
		responses: [place("一个陌生人"), narrate("没有人回应。")] });
	t.after(() => table.dispose());
	await table.session.prompt("我叫住那个陌生人");
	await waitForIdle(table.session);

	assert.equal(requests.length, 1, "the roster is asked, but a genuinely unrelated name clears no row");
	assert.deepEqual(writes(table).map((row) => [row.ok, row.code]), [[false, "unknown_entity"]]);
	assert.deepEqual(resolutions(table).map((row) => [row.name, row.status]), [["一个陌生人", "unresolved"]]);
});

test("§11.5.8: a person in both present and the roster is one candidate row, not two", async (t) => {
	const requests = installJev(t, () => ({ choice: "yes", confidence: 0.8 }));
	const table = await openTable({ env: { EXT_JEV_APIKEY: "test-jev-key",
		FAKE_KERNEL_PRESENT: JSON.stringify([{ name: CLERK }]),
		FAKE_KERNEL_ROSTER: JSON.stringify([{ name: CLERK, display_name: CLERK }]),
		FAKE_KERNEL_UNKNOWN_ENTITY: JSON.stringify({ name: VARIANT }) },
		responses: [place(VARIANT), narrate("他从窗口后抬起头。")] });
	t.after(() => table.dispose());
	await table.session.prompt("我走到窗口前");
	await waitForIdle(table.session);

	assert.equal(requests.length, 1);
	assert.deepEqual(requests[0].state.candidates.map((row) => row.alias), ["person_1"],
		"present and the roster agree on the same handle: it is asked about once, not twice");
});
