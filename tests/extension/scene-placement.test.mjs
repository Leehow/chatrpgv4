/**
 * Contract §187.2.3: the host places a place the Keeper is about to mint, before the kernel sees it.
 *
 * The real apply tool over the emitted kernel (the-haunting, turn 1 closed at the commission briefing), a controlled typed
 * endpoint behind the real decision adapter. Asserted per outcome, through what the kernel actually received and what it
 * wrote: `same` moves to the book place and mints nothing; `inside` mints with `within` and the capsule shows the book
 * place; a below-bar answer mints as written; `shadow` (an env override since 2026-10-07; `on` ships) writes the row and changes nothing. What Jev was
 * shown is the effect's description, the active scene and the book places -- by alias, never by handle.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitFor, waitForIdle } from "./harness.mjs";

const root = resolve(import.meta.dirname, "../..");
const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const STAIR = "The Globe's back stair";
const MORGUE = "newspaper-morgue";

function turnOneClosed(workspace) {
	const input = [["table.open", {}], ["table.player_input", { text: "I listen to Knott." }],
		["table.narrate", { call_id: "t1-c1", text: "Knott finishes his account and hands over the keys to the house." }]]
		.map(([method, params], index) => JSON.stringify({ id: String(index), method, params: { campaign: "test-camp", ...params } })).join("\n");
	const run = spawnSync(process.execPath, [join(root, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(root, "content")],
		{ cwd: root, input: `${input}\n`, encoding: "utf8" });
	for (const frame of run.stdout.split("\n").filter(line => line.trim()).map(line => JSON.parse(line)).filter(frame => !frame.progress))
		if (!frame.ok) throw new Error(`fixture step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
}

/** The placement batch answers `place` with the alias of `target` (by the state's book place names) and the two Nouls
 * for it; any other family's question gets a neutral answer. */
function installJev(t, { target, same, inside, confidence = 0.9 }) {
	const original = globalThis.fetch, batches = [];
	globalThis.fetch = async (url, init) => {
		if (String(url) !== JEV_URL) return original(url, init);
		const body = JSON.parse(init.body), placement = Object.hasOwn(body.questions, "place");
		if (placement) batches.push(body);
		const state = typeof body.state === "string" ? JSON.parse(body.state) : body.state;
		const places = placement ? state.book_places : {};
		const chosen = Object.keys(places).find(key => places[key].name === target) ?? "none";
		const answers = Object.fromEntries(Object.entries(body.questions).map(([key, question]) => {
			if (question.type === "noul") {
				const alias = key.slice(key.indexOf("_") + 1);
				return [key, { type: "noul", noul: placement && alias === chosen ? (key.startsWith("same_") ? same : inside) : 0.05 }];
			}
			if (question.type === "choice") {
				const keys = Object.keys(question.criteria), pick = placement ? chosen : keys[0];
				const rest = (1 - confidence) / Math.max(1, keys.length - 1);
				return [key, { type: "choice", choice: pick, confidence, probabilities: Object.fromEntries(keys.map(k => [k, k === pick ? confidence : rest])) }];
			}
			const levels = question.criteria.map((_, index) => String(index));
			return [key, { type: "score", score: 0, confidence: 0.9, legend: Object.fromEntries(levels.map((level, index) => [level, question.criteria[index]])),
				probabilities: Object.fromEntries(levels.map(level => [level, level === "0" ? 1 : 0])) }];
		}));
		return new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 400, output_tokens: 10 } }), { status: 200 });
	};
	t.after(() => { globalThis.fetch = original; });
	return batches;
}

const MOVE = { kind: "move", to: STAIR, via: "Round the back of the newspaper building", establish: { summary: "A narrow service stair behind the Boston Globe offices." } };
const placementRows = table => table.telemetry().filter(row => row.lane === "scene-placement");
const world = workspace => JSON.parse(readFileSync(join(workspace, ".coc/campaigns/test-camp/world.json"), "utf8"));

async function play(t, { mode, target = "Boston Globe offices", same = 0.05, inside = 0.05 }) {
	const batches = installJev(t, { target, same, inside });
	const table = await openTable({ realKernel: true, prepareWorkspace: turnOneClosed,
		env: { EXT_JEV_APIKEY: "test-jev-key", PI_COC_SCENE_PLACEMENT: mode },
		responses: [fauxAssistantMessage([fauxToolCall("apply", { effects: [MOVE] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "You go round to the back of the building, where a narrow stair climbs into the dark behind the offices." })], { stopReason: "toolUse" })] });
	t.after(() => table.dispose());
	await table.session.prompt("I go round to the back stair of the Globe building.");
	await waitForIdle(table.session);
	const rows = await waitFor(() => placementRows(table).length >= 1 && placementRows(table), { label: "the scene-placement row" });
	return { table, batches, row: rows[0] };
}

test("same: the move goes to the book place and nothing is minted", async t => {
	const { table, batches, row } = await play(t, { mode: "on", same: 0.95 });
	assert.equal(world(table.workspace).active_scene, MORGUE);
	assert.deepEqual(world(table.workspace).scene_trail, ["commission-briefing"]);
	assert.ok(!world(table.workspace).table_entities?.length, "no place was minted");
	assert.equal(row.outcome, "same"); assert.equal(row.decision, "same"); assert.equal(row.handle, MORGUE); assert.equal(row.ok, true);
	assert.ok(row.distribution[MORGUE] > 0.8 && row.confidence === 0.9);
	// One request, fanned out: the Choice with a none exit and two Nouls per candidate.
	assert.equal(batches.length, 1);
	const questions = batches[0].questions, aliases = Object.keys(questions.place.criteria);
	assert.equal(aliases.at(-1), "none");
	assert.equal(Object.keys(questions).length, 1 + 2 * (aliases.length - 1));
	const state = typeof batches[0].state === "string" ? JSON.parse(batches[0].state) : batches[0].state;
	assert.deepEqual(state.destination, { name: STAIR, route: MOVE.via, description: MOVE.establish.summary });
	assert.ok(!JSON.stringify(state).includes(MORGUE), "the book places go by alias and name, never by handle");
});

test("inside: the mint carries within and sits in the book place", async t => {
	const { table, row } = await play(t, { mode: "on", inside: 0.92 });
	assert.equal(world(table.workspace).active_scene, STAIR);
	const record = world(table.workspace).table_entities[0];
	assert.equal(record.within, MORGUE); assert.equal(record.from, "commission-briefing");
	assert.equal(row.outcome, "inside"); assert.equal(row.handle, MORGUE);
});

test("below the bars the move is minted as written", async t => {
	const { table, row } = await play(t, { mode: "on", same: 0.4, inside: 0.4 });
	assert.equal(world(table.workspace).table_entities[0].name, STAIR);
	assert.ok(!("within" in world(table.workspace).table_entities[0]));
	assert.equal(row.outcome, "mint"); assert.equal(row.why, "below_bar");
});

test("shadow (the env override): the row says what it would do, the effect is unchanged", async t => {
	const { table, row } = await play(t, { mode: "shadow", same: 0.95 });
	assert.equal(world(table.workspace).table_entities[0].name, STAIR);
	assert.ok(!("within" in world(table.workspace).table_entities[0]), "shadow changes nothing");
	assert.equal(row.outcome, "shadow"); assert.equal(row.decision, "same"); assert.equal(row.handle, MORGUE);
	// Owner ruling 2026-10-07 after RD-08: the shipped mode is `on`; `shadow` stays reachable through PI_COC_SCENE_PLACEMENT.
	assert.equal(JSON.parse(readFileSync(join(root, "content/rulesets/coc7/host-budgets.json"), "utf8")).scene_placement.mode, "on");
});
