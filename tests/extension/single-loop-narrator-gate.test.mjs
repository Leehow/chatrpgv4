/**
 * §151.5 on the extension seam (needs the emitted build: `tests/extension/pi.mjs` loads the vendored Pi from `build/`): a
 * real Pi session on the hybrid engine with the narrator-only setting on, the kernel extension's own tool gate, the fake
 * kernel and the faux provider. The engine announces a model call outside its step's catalog (`coc:model-step`'s
 * `refuse`), and the kernel extension refuses it before admission or a kernel write, with the engine's sentence; `propose`
 * is on the Keeper's surface; the next compose's narrate delivers. With the setting off the same `apply` is not blocked.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { customMessages, openTable, waitFor } from "./harness.mjs";
import { createHybridEngine } from "../../runtime/jev/hybrid-engine.ts";

/** A Jev answer in the adapter's result shape: every question answered, `exit` set to `exit`. */
function answered(batch, exit) {
	const answers = {};
	for (const question of batch.questions) {
		const choice = question.key === "exit" ? exit : "later";
		answers[question.key] = { status: "answered", type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 0.9 } };
	}
	return { batchId: batch.id, status: "complete", answers, coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] }, issues: [] };
}
const APPLY = fauxToolCall("apply", { effects: [{ kind: "time", minutes: 10, why: "the search takes ten minutes" }] });
const NARRATE = fauxToolCall("narrate", { text: "地窖门吱呀一声开了，霉味扑面而来，台阶向下没入黑暗。" });

async function narratorTable(t, env) {
	const engine = createHybridEngine({ env, decision: { decide: async (batch) => answered(batch, "finish") } });
	const table = await openTable({
		env: { PI_COC_LOOP_ENGINE: "hybrid-v1", FAKE_KERNEL_WORKSPACE: "1" },
		runDriver: engine.runDriver,
		extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses: [fauxAssistantMessage([APPLY], { stopReason: "toolUse" }), fauxAssistantMessage([NARRATE], { stopReason: "toolUse" })],
	});
	t.after(() => table.dispose());
	return table;
}
const textOf = (message) => (message.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join("");
const methods = (table) => table.kernelRequests().map((request) => request.method);

test("§151.5 kernel gate: on a narrowed compose the Keeper's apply is refused with the engine's sentence before the kernel hears of it; the next compose's narrate delivers", async (t) => {
	const table = await narratorTable(t, { COC_NARRATOR_ONLY: "on" });
	assert.ok(table.activeTools().includes("propose"), "propose is on the Keeper's surface with the setting on");
	await table.session.prompt("我推开地窖门");
	const results = table.session.messages.filter((message) => message.role === "toolResult");
	assert.deepEqual(results.map((result) => [result.toolName, result.isError]), [["apply", true], ["narrate", false]]);
	assert.match(textOf(results[0]), /apply is not in this narrator-only compose step's catalog \(narrate, ask, propose\)/);
	assert.ok(!methods(table).includes("table.apply"), "the refused apply never reached the kernel");
	assert.ok(methods(table).includes("table.narrate"), "the compose after the refusal delivered");
	assert.ok(table.telemetry().some((row) => row.tool === "apply" && row.code === "blocked" && row.reason === "narrator_catalog"));
	assert.equal(table.session.lastDrivenRun.status, "delivered");
});

test("§151.5 kernel gate: with the setting off the same compose's apply is not blocked by the catalog, and propose is not on the surface", async (t) => {
	const table = await narratorTable(t, {});
	assert.ok(!table.activeTools().includes("propose"));
	await table.session.prompt("我推开地窖门");
	assert.ok(!table.telemetry().some((row) => row.reason === "narrator_catalog"));
	assert.ok(methods(table).includes("table.apply"), "the Keeper's apply reached the kernel as before");
});

test('§159: no Jev port never restores model resolve; the host displays an unresolved notice independently of prose', async t => {
	const engine = createHybridEngine({env: {}, decision: null});
	let table;
	table = await openTable({env: {PI_COC_LOOP_ENGINE: 'hybrid-v1', FAKE_KERNEL_WORKSPACE: '1'}, runDriver: engine.runDriver,
		extraExtensions: [{name: 'coc-hybrid-engine', factory: engine.extension}], responses: [
			() => {
				const notice = {campaign: 'test-camp', turn: 1, run: 'unavailable-check', needs: [{candidate: 'Listen', needs: ['jev_unavailable']}]};
				table.emit('coc:check-selection-unresolved', notice);
				table.emit('coc:check-selection-unresolved', notice);
				return fauxAssistantMessage([fauxToolCall('resolve', {action: {intent: 'investigate', goal: 'listen', method: 'listen', skill: 'Listen'}})], {stopReason: 'toolUse'});
			},
			fauxAssistantMessage([NARRATE], {stopReason: 'toolUse'}),
		]});
	t.after(() => table.dispose());
	assert.ok(!table.activeTools().includes('resolve'));
	await table.session.prompt('I listen at the door.');
	assert.ok(!methods(table).includes('table.resolve'));
	await waitFor(() => customMessages(table.session, 'coc-delivery').some(message => message.details?.check_selection_unresolved), {label: 'unresolved check notice'});
	const notices = customMessages(table.session, 'coc-delivery').filter(message => message.details?.check_selection_unresolved);
	assert.equal(notices.length, 1, 'one host notice per run, even if the event repeats');
	assert.equal(notices[0].display, true);
	assert.ok(String(notices[0].content).length > 10);
});
