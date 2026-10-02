/**
 * Contract §165.3 on the product path: the Keeper's own `narrate` at a real-kernel table (the emitted kernel), the
 * kernel extension's `coc:turn-committed` with the delivery's `speech`, and the speech-edit extension taking it from the
 * bus -- with no lane model named, so it runs on the table's own model (the owner's ruling: stay on the table's model).
 * Jev answers the lane's fact questions through the real adapter; every other family is answered 503 and fails open.
 */
import {strict as assert} from "node:assert";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {join, resolve} from "node:path";
import {test} from "node:test";
import {fauxAssistantMessage, fauxToolCall} from "@earendil-works/pi-ai";
import {openTable, waitFor, waitForIdle} from "./harness.mjs";
import speechEdit from "../../extensions/speech-edit/index.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const LINE = "「钥匙在这儿，地址写在租约上。」";
const EDITED = "「行，钥匙在这儿，地址就写在租约上。」";
/** A person the table has not named: their line arrives as a label row and is edited too (§165.3, amended 2026-10-01). */
const STRANGER = "门口的男孩", STRANGER_LINE = "「先生，外面下雨了。」", STRANGER_EDITED = "「先生，外面下雨啦。」";

/** Turn 1 delivered and closed through the emitted kernel; the player speaks next at turn 2. */
function turnOneClosed(workspace) {
	const input = [["table.open", {}], ["table.player_input", {text: "我先四处看看。"}], ["table.narrate", {call_id: "t1-c1", text: "办公室里很安静。"}]]
		.map(([method, params], index) => JSON.stringify({id: String(index), method, params: {campaign: "test-camp", ...params}})).join("\n");
	const run = spawnSync(process.execPath, [join(ROOT, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(ROOT, "content")],
		{cwd: ROOT, input: `${input}\n`, encoding: "utf8"});
	for (const frame of run.stdout.split("\n").filter(line => line.trim()).map(line => JSON.parse(line)).filter(frame => !frame.progress))
		if (!frame.ok) throw new Error(`fixture step ${frame.id} failed: ${JSON.stringify(frame.error)}`);
}

test("the Keeper's narrate with an NPC line and a stranger's line reaches the lane from the bus, on the table's model, and patches its card", async t => {
	const original = globalThis.fetch, asked = [];
	globalThis.fetch = async (url, init) => {
		if (String(url) !== JEV_URL) return original(url, init);
		const body = JSON.parse(init.body);
		if (!Object.keys(body.questions).every(key => key.startsWith("fact_change_"))) return new Response("unavailable", {status: 503});
		asked.push(body);
		const answers = Object.fromEntries(Object.keys(body.questions).map(key => [key, {type: "noul", noul: 0.05}]));
		return new Response(JSON.stringify({model: "jev-1.13.0", answers, usage: {input_tokens: 300, output_tokens: 4}}), {status: 200});
	};
	t.after(() => {globalThis.fetch = original;});
	const table = await openTable({
		realKernel: true, prepareWorkspace: turnOneClosed,
		env: {EXT_JEV_APIKEY: "test-jev-key", PI_COC_TIME_READING: "0", PI_COC_PURPOSE_GATE: "0", PI_COC_SPEECH_EDIT_MODEL: undefined},
		extraExtensions: [{name: "speech-edit", factory: speechEdit}],
		responses: [
			fauxAssistantMessage([fauxToolCall("narrate", {text: `诺特把钥匙推过来，没起身。{{say:Steven Knott}}${LINE}{{/say}}`
				+ `门口有人探头。{{say:${STRANGER}}}${STRANGER_LINE}{{/say}}他又低头看账本。`})], {stopReason: "toolUse"}),
			// The next completion on the table's model is the lane's: narrate closed the Keeper's run.
			fauxAssistantMessage(JSON.stringify({lines: [EDITED, STRANGER_EDITED]})),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("钥匙和地址给我。");
	await waitForIdle(table.session);

	const [committed] = table.committed().filter(payload => payload.turn === 2);
	assert.ok(committed, "narrate committed turn 2 on the bus");
	assert.deepEqual(committed.speech.map(row => [row.who.npc ?? row.who.label, row.text]), [["steven-knott", LINE], [STRANGER, STRANGER_LINE]],
		"the payload carries the delivery's speech");
	assert.equal(asked.length, 0);
	assert.equal(table.entries("coc-card-patch").length, 0);
	const record = JSON.parse(readFileSync(join(table.workspace, ".coc/campaigns/test-camp/turns/0002.json"), "utf8"));
	assert.equal(record.speech[0].text, LINE);
	assert.equal(record.speech_edit, undefined);
});
