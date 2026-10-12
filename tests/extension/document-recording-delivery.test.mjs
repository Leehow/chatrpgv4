/**
 * Contract §200 (docs/specs/document-recording-delivery.md): a recording the host could not bind never blocks the turn's
 * delivery; §200.6: an input the host has ended runs nothing more.
 *
 * Through the product path: the single-loop engine's table on the emitted kernel (build/kernel/rpc.mjs), the kernel
 * extension (extensions/kernel/index.ts) with its outcome guard (runtime/jev/refused-document-outcome.ts) and append binding
 * (runtime/jev/document-binding-domain.ts), the kernel's delivery record and capsule (kernel-ts/write/delivery.ts,
 * kernel-ts/write/index.ts, kernel-ts/read/assemble.ts), and the real shared decision adapter behind a controlled typed
 * endpoint (`fetch` answers the pinned Jev URL the way the typed API does). The Keeper's calls are TR-F2 run 3 turn 8's,
 * verbatim, in order (tests/extension/fixtures/tr-f2-run3-turn8.json); the endpoint uses controlled typed answers. The unresolved-carrier cases lower the carrier score to .63;
 * family 9 intentionally no longer replays the historical content veto. Whether a draft claims the recording is the model's judgement, not this file's: the answers are scripted.
 * What is under test is what the host does with them. No live model is called.
 *
 * On the table, turn 8 went: two appends refused by the binding, a narrate that said the player kept it in mind refused by
 * the guard (Jev .12, read as "terminal"), the unfinished notice in the middle of the run, and nine more calls until the
 * run's step limit. Here the same calls must end at the first narrate, delivered.
 */
import { strict as assert } from "node:assert";
import { after, test } from "node:test";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { customMessages, openTable, waitForIdle } from "./harness.mjs";
import { createHybridEngine } from "./hybrid-engine-fixture.mjs";
import { bindDocumentAppend, documentBindingScope, DOCUMENT_BINDING_FAMILY } from "../../runtime/jev/document-binding-domain.ts";
import { TaskLease } from "../../runtime/jev/task-context.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CAMPAIGN = "test-camp";
const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const TURN8 = JSON.parse(readFileSync(join(REPO, "tests/extension/fixtures/tr-f2-run3-turn8.json"), "utf8"));
const [FIRST_APPLY, SECOND_APPLY, MIND_NARRATE] = TURN8.calls;
/** The turn's own words for the note (the Keeper's proposal) and the draft the guard refused at .12. */
const NOTE = SECOND_APPLY.arguments.effects[0].document.text;
const KEPT_IN_MIND = MIND_NARRATE.arguments.text;
/** Drafts that do say the note is in the notebook (the claim §166.2 exists to correct). */
const CLAIM = "你把马卡里奥一家和罗克斯伯里记进笔记本，合上本子，动身去市政档案馆。";
const CLAIM_AGAIN = "笔记本上已经写好了马卡里奥一家和罗克斯伯里。你走进市政档案馆，档案职员抬头看你。";

// ---------------------------------------------------------------------------------------------------
// The kernel, in process, for the workspace before the session opens it (and for the kernel-only checks).
// ---------------------------------------------------------------------------------------------------

const temporary = await mkdtemp(join(tmpdir(), "document-recording-"));
after(() => rm(temporary, { recursive: true, force: true }));
await symlink(join(REPO, "node_modules"), join(temporary, "node_modules"), "dir");
await build({ stdin: { contents: "export * from './kernel-ts/testing/api.ts'; export {UNCONFIRMED_RECORDING_LINE} from './kernel-ts/read/assemble.ts'; export {documentKnowledge} from './kernel-ts/mods/document-knowledge.ts';",
	resolveDir: REPO, sourcefile: "document-recording-api.ts" }, outfile: join(temporary, "api.mjs"), bundle: true, packages: "external",
	format: "esm", platform: "node", target: "node22", logLevel: "silent" });
const api = await import(pathToFileURL(join(temporary, "api.mjs")).href);

async function inProcess(workspace, body) {
	const context = await api.createKernelContext({ workspace, content: join(REPO, "content"), seed: "document-recording",
		locks: api.createAdvisoryLocks(async () => {}), env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
	const runtime = api.createKernelRuntime(context);
	try { return await body((method, params = {}) => runtime.handlers[method]({ campaign: CAMPAIGN, ...params })); }
	finally { await runtime.close(); }
}
/**
 * Turn 8's carriers, registered the way the App's equipment preparation registers them: the investigator's 笔记本 (notebook)
 * and 钢笔 (paper), empty. Turn 0 then closes on turn 7's prose, which is what the binding reads as `justTold`.
 */
async function carriers(workspace, call) {
	await call("mods.configure",{id:"enhanced-items",enabled:true});
	await call("table.open");
	const party = join(workspace, ".coc/campaigns", CAMPAIGN, "party");
	const investigator = JSON.parse(await readFile(join(party, (await readdir(party)).find((name) => name.endsWith(".json"))), "utf8")).name;
	const effects = [];
	for (const [name, presentation] of [["笔记本", "notebook"], ["钢笔", "paper"]]) {
		const job = await call("mods.job", { role: "create", input: { name, category: "item", description: `The investigator's ${presentation}.` } });
		assert.equal(job.enabled, true, "the default item package registers carriers");
		const definition = { name, category: "item", description: `The investigator's ${presentation}.`, basis: "TR-F2 run 3's issued equipment.",
			parameters: { charges: null, effects: [] }, traits: [], player_view: { description: `The investigator's ${presentation}.`, fields: [] },
			document: { text: "", presentation } };
		await writeFile(join(job.cwd, "result.json"), JSON.stringify(definition));
		const accepted = await call("mods.accept", { job: job.job });
		effects.push({ kind: "define", name, category: "item", _definition: accepted.definition, _provenance: accepted.provenance },
			{ kind: "object", name, definition: name, to: investigator });
	}
	await call("table.apply", { call_id: "t0-c1", effects });
	await call("table.narrate", { call_id: "t0-c2", text: TURN8.just_told });
}
const prepareCarriers = (workspace) => inProcess(workspace, (call) => carriers(workspace, call));

// ---------------------------------------------------------------------------------------------------
// The typed endpoint the kernel extension's own adapters reach, and the engine's own (injected) Jev.
// ---------------------------------------------------------------------------------------------------

function distribution(keys, chosen, probability) {
	const rest = keys.length > 1 ? (1 - probability) / (keys.length - 1) : 0;
	return Object.fromEntries(keys.map((key) => [key, key === chosen ? probability : rest]));
}
const confidenceOf = (keys, probability) => keys.length > 1 ? (keys.length * probability - 1) / (keys.length - 1) : 1;
const choiceAnswer = (keys, chosen, probability) => ({ type: "choice", choice: chosen, confidence: confidenceOf(keys, probability),
	probabilities: distribution(keys, chosen, probability) });
function generic(question) {
	if (question.type === "noul") return { type: "noul", noul: 0.5 };
	const keys = Object.keys(question.criteria ?? {});
	if (question.type === "choice") return choiceAnswer(keys, keys[0], 0.99);
	const levels = (question.criteria ?? []).map((_, index) => String(index));
	return { type: "score", score: 0, confidence: 1, legend: Object.fromEntries(levels.map((level) => [level, level])),
		probabilities: Object.fromEntries(levels.map((level, index) => [level, index === 0 ? 1 : 0])) };
}
const reply = (answers) => new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 600, output_tokens: 20 } }), { status: 200 });
/**
 * Binding: the turn's own answers (笔记本 .91, 钢笔 .15, content outside .84). Outcome: `outcome(draft)` is the Noul, or
 * "unavailable" for an endpoint that fails. Everything else that reaches the endpoint gets a generic answer and is listed.
 */
function installJev(t, { outcome, binding = TURN8.jev.binding[0] }) {
	const original = globalThis.fetch;
	const asked = { binding: [], outcome: [], other: [] };
	globalThis.fetch = async (url, init) => {
		if (String(url) !== JEV_URL) return original(url, init);
		const body = JSON.parse(init.body), questions = Object.entries(body.questions);
		if (body.questions.false_completion) {
			asked.outcome.push(body.state.draft);
			const p = outcome(body.state.draft);
			return p === "unavailable" ? new Response("{}", { status: 500 }) : reply({ false_completion: { type: "noul", noul: p } });
		}
		if (body.questions.content || body.questions.execution || questions.some(([key]) => key.startsWith("document_"))) {
			asked.binding.push(body);
			return reply(Object.fromEntries(questions.map(([key, question]) => [key,
				key.startsWith("document_") ? { type: "noul", noul: body.state.documents[Number(key.slice("document_".length))].name === "笔记本"
					? binding.document_0.probability : binding.document_1.probability }
					: key === "content" ? choiceAnswer(Object.keys(question.criteria), binding.content.value, binding.content.probability)
						: key === "execution" ? choiceAnswer(Object.keys(question.criteria), "not_selected_operation", 0.9) : generic(question)])));
		}
		asked.other.push(Object.keys(body.questions));
		return reply(Object.fromEntries(questions.map(([key, question]) => [key,generic(question)])));
	};
	t.after(() => { globalThis.fetch = original; });
	return asked;
}
const engineChoice = (value, confidence = 0.9) => ({ status: "answered", type: "choice", choice: value, confidence, probabilities: { [value]: confidence } });
function engineAnswer(batch) {
	const answers = {};
	for (const question of batch.questions) {
		const criteria = Object.keys(question.criteria ?? {});
		answers[question.key] = engineChoice(question.key === "exit" ? "finish" : criteria[0] === "now" ? "later" : criteria.includes("unclear") ? "unclear"
			: criteria.includes("no") && criteria.includes("yes") ? "no" : "unknown");
	}
	return { batchId: batch.id, status: "complete", answers, issues: [], coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] } };
}

// ---------------------------------------------------------------------------------------------------
// The table.
// ---------------------------------------------------------------------------------------------------

// The historical unresolved-carrier path now uses a shortened reference; canonical names have a deterministic fast path.
const toolCall = (call) => {const args=structuredClone(call.arguments);if(call.name==='apply')for(const effect of args.effects??[])if(effect.document?.action==='append')effect.name='my notes';
    return fauxAssistantMessage([fauxToolCall(call.name, args)], { stopReason: "toolUse" });};
const narrate = (text) => toolCall({ name: "narrate", arguments: { text } });

/** Turn 8's table: the player's words, the interaction scope's .94 recording, and the Keeper's scripted calls, counted. */
async function turn8(t, { calls, outcome, documentRecording = TURN8.document_recording, binding = {...TURN8.jev.binding[0], document_0:{...TURN8.jev.binding[0].document_0,probability:.63}}, denyWriting = false, mode = "world", playerText = TURN8.player_text }) {
	const asked = installJev(t, { outcome, binding });
	const engine = createHybridEngine({ env: {}, decision: { decide: async (batch) => engineAnswer(batch) },
		interactionScope: { mode, reason: "preclassified_gameplay_fixture", calls: 0, documentRecording } });
	let keeperCalls = 0;
	const table = await openTable({ realKernel: true, prepareWorkspace: prepareCarriers,
		env: { PI_COC_LOOP_ENGINE: "hybrid-v1", COC_KERNEL_SEED: "1", EXT_JEV_APIKEY: "test-jev-key" }, runDriver: engine.runDriver,
		extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		...(denyWriting?{laneResponses:{admission:[()=>fauxAssistantMessage(JSON.stringify({player_words:"hold",verdict:"not_authorized",
            grounds:"This declaration does not choose physical writing now.",missing:"Physical writing now",open_choice:"keeper_added"}))]}}:{}),
		responses: calls.map((message) => () => { keeperCalls++; return message; }) });
	t.after(() => table.dispose());
	await table.session.prompt(playerText);
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	return { table, asked, keeperCalls: () => keeperCalls };
}
const turnRecord = (table, turn) => JSON.parse(readFileSync(join(table.workspace, ".coc/campaigns", CAMPAIGN, "turns", `${String(turn).padStart(4, "0")}.json`), "utf8"));
const refusals = (table, tool) => table.session.messages
	.filter((message) => message.role === "toolResult" && message.toolName === tool && message.details?.coc_error).map((message) => message.details.coc_error);
const outcomeRows = (table) => table.telemetry().filter((row) => row.lane === "refused_document_outcome")
	.map((row) => [row.status, row.reason, row.probability]);
const unfinishedNotices = (table) => customMessages(table.session, "coc-delivery").filter((message) => message.details?.turn_unfinished);
const steers = (table) => table.telemetry().filter((row) => row.lane === "turn" && row.event === "turn_close" && row.status === "steer");

test("§200.3, turn 8 calls with an unresolved carrier: the binding fails twice, the first narrate is delivered, and none of the ten later calls is asked", async (t) => {
	const { table, asked, keeperCalls } = await turn8(t, { calls: TURN8.calls.map(toolCall), outcome: () => TURN8.jev.outcome_probability });
	assert.equal(keeperCalls(), 3, "two appends and the first narrate; the run ends on that delivery");
	const applies = refusals(table, "apply");
	assert.deepEqual(applies.map((error) => [error.details?.reason, error.details?.cause]),
		[["document_binding_unresolved", "no_target"], ["document_binding_unresolved", "no_target"]]);
	// §200.5: the refusal names what happened, and its fix sends the batch's other effects back without the addition.
	assert.ok(applies.every((error) => !/unambiguous/.test(error.message)), JSON.stringify(applies.map((error) => error.message)));
	assert.equal(asked.binding.length, 2, "one binding question per append, no execution question after a refused content");
	assert.equal(asked.outcome.length, 1, "the guard asks once");
	assert.deepEqual(outcomeRows(table), [["unclear", "outcome_uncertain", 0.12]]);
	assert.deepEqual(refusals(table, "output"), [], "no narrate is refused");
	assert.deepEqual(unfinishedNotices(table), [], "the player is never told the turn ended without a result");
	assert.equal(table.telemetry().filter((row) => row.event === "input_ended").length, 0);
	// §200.4 writer: the delivery carries the recording to the turn record, with its reason.
	const record = turnRecord(table, 1);
	assert.equal(record.closed_by, "narrate");
	assert.equal(record.player_text, TURN8.player_text);
	assert.ok(String(record.rendered_text ?? record.text).includes("市政档案馆"), "the delivered prose is the Keeper's draft");
	assert.deepEqual(record.unconfirmed_recordings, [{ document: "笔记本", reason: "binding_unresolved", cause: "no_target" }]);
	assert.deepEqual(table.telemetry().filter((row) => row.lane === "document_recording").map((row) => [row.status, row.reason, row.cause]),
		[["unconfirmed", "binding_unresolved", "no_target"]]);

	// §200.4 reader: the next input's capsule tells the Keeper the recording is unconfirmed, without the text.
	table.faux.setResponses([narrate("档案职员把产权登记册推到你面前。")]);
	await table.session.prompt("我请档案职员调出科比特房子的产权登记。");
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	const capsule = JSON.parse(customMessages(table.session, "coc-capsule").at(-1).content);
	assert.equal(capsule.turn.number, 2);
	assert.deepEqual(capsule.unconfirmed_recordings, [{ turn: 1, document: "笔记本", reason: "binding_unresolved", line: api.UNCONFIRMED_RECORDING_LINE }]);
	assert.ok(!JSON.stringify(capsule.unconfirmed_recordings).includes(NOTE), "the refused text is not handed back as if written");
});

test("§227.5: the ordinarily admitted append settles without an after-draft semantic review, and public materials preceded the draft", async (t) => {
    const {table}=await turn8(t,{calls:[toolCall(SECOND_APPLY),narrate(KEPT_IN_MIND)],outcome:()=>.05,binding:TURN8.jev.binding[0]});
    assert.deepEqual(refusals(table,"apply"),[]);
    const view=await inProcess(table.workspace,call=>call("mods.document.view",{name:"笔记本"}));
    assert.equal(view.text,NOTE,"canonical text, not a prose claim");
    const result=table.session.messages.find(message=>message.role==="toolResult"&&message.toolName==="apply");
    assert.equal(result.details?.document_reviews,undefined);
    const handoff=table.session.messages.find(message=>message.role==="custom"&&typeof message.content==="string"&&message.content.includes('"document_recording_context"'));
    assert.ok(handoff,"KP receives public materials before its first draft: "+JSON.stringify(table.telemetry().filter(row=>row.lane==='document_knowledge')));
    const offered=JSON.parse(handoff.content).document_recording_context;
    assert.ok(offered.entries.some(entry=>entry.kind==='transcript'&&TURN8.just_told.startsWith(entry.preview)));
    assert.ok(offered.entries.every(entry=>entry.read?.focus==='knowledge'));
    assert.ok(Buffer.byteLength(JSON.stringify(offered))<=4096);
    assert.ok(!JSON.stringify(offered.owned_documents).includes("version"),"no opaque revision echo required from KP");
});

test("§227.5: advisory binding cannot bypass ordinary admission for reading-only or deferred writing", async (t) => {
    for(const playerText of ["I only read my notebook; I do not write anything.","After I return from the archives I will write this. First I go there."]){
        const {table}=await turn8(t,{playerText,documentRecording:.1,denyWriting:true,binding:TURN8.jev.binding[0],outcome:()=>.05,
            calls:[toolCall(SECOND_APPLY),narrate(KEPT_IN_MIND)]});
        const view=await inProcess(table.workspace,call=>call("mods.document.view",{name:"笔记本"}));
        assert.equal(view.text,"","the carrier and semantic advice establish no execution permission");
        assert.ok(refusals(table,"apply").some(error=>error.details?.reason==="action_not_authorized"));
    }
});

test("§227.5: low recording hints do not hide materials or lose completion of ordinarily admitted writing", async(t)=>{
    const {table}=await turn8(t,{documentRecording:.1,binding:TURN8.jev.binding[0],outcome:()=>.05,
        calls:[toolCall(SECOND_APPLY),narrate(KEPT_IN_MIND)]});
    assert.equal((await inProcess(table.workspace,call=>call("mods.document.view",{name:"笔记本"}))).text,NOTE);
    assert.equal(turnRecord(table,1).unconfirmed_recordings,undefined);
    const rows=table.telemetry().filter(row=>row.lane==='document_completion');
    assert.ok(rows.some(row=>row.status==='committed'),JSON.stringify(rows));
});

test("§227.5: reference questions receive the public catalogue without a recording threshold",async(t)=>{
    const {table}=await turn8(t,{mode:'reference',documentRecording:0,outcome:()=>.05,calls:[narrate('The earlier public terms remain in the account.')]});
    const handoff=table.session.messages.find(message=>message.role==='custom'&&typeof message.content==='string'&&message.content.includes('"document_recording_context"'));
    assert.ok(handoff);const offered=JSON.parse(handoff.content).document_recording_context;
    assert.ok(offered.entries.some(entry=>entry.kind==='transcript'));assert.equal(offered.recording_hint,0);
    assert.equal((await inProcess(table.workspace,call=>call("mods.document.view",{name:"笔记本"}))).text,'');
});

test("§200.3: a draft that claims the unconfirmed recording is corrected once, through the turn-close steer, and the correction is delivered", async (t) => {
	const { table, asked, keeperCalls } = await turn8(t, { calls: [toolCall(SECOND_APPLY), narrate(CLAIM), narrate(KEPT_IN_MIND)],
		outcome: (draft) => draft.includes("记进笔记本") ? 0.95 : 0.05 });
	assert.equal(keeperCalls(), 3);
	assert.deepEqual(refusals(table, "output").map((error) => [error.details?.reason, error.details?.outcome]), [["refused_document_outcome", "steer"]]);
	assert.equal(steers(table).length, 1, "one correction");
	assert.equal(steers(table)[0].kind, "refused_document_outcome");
	assert.deepEqual(asked.outcome, [CLAIM, KEPT_IN_MIND]);
	assert.deepEqual(outcomeRows(table), [["steer", "false_completion", 0.95], ["clean", "no_false_completion", 0.05]]);
	assert.deepEqual(unfinishedNotices(table), []);
	const record = turnRecord(table, 1);
	assert.equal(record.closed_by, "narrate");
	assert.ok(String(record.rendered_text ?? record.text).includes("记在心里"), "the corrected draft is what the player reads");
	assert.deepEqual(record.unconfirmed_recordings, [{ document: "笔记本", reason: "binding_unresolved", cause: "no_target" }]);
});

test("§200.3: a claim the correction did not remove is still delivered, recorded as claimed; the turn never ends empty for this", async (t) => {
	const { table, keeperCalls } = await turn8(t, { calls: [toolCall(SECOND_APPLY), narrate(CLAIM), narrate(CLAIM_AGAIN)], outcome: () => 0.95 });
	assert.equal(keeperCalls(), 3);
	assert.deepEqual(outcomeRows(table), [["steer", "false_completion", 0.95], ["claimed", "false_completion_after_correction", 0.95]]);
	assert.equal(steers(table).length, 1, "the correction is not given twice");
	assert.deepEqual(unfinishedNotices(table), []);
	assert.equal(turnRecord(table, 1).closed_by, "narrate");
});

for (const [name, answer, reason] of [["a gray answer", 0.5, "outcome_uncertain"], ["an unavailable check", "unavailable", "outcome_unavailable"]])
	test(`§200.3: ${name} delivers the draft as written`, async (t) => {
		const { table, keeperCalls } = await turn8(t, { calls: [toolCall(SECOND_APPLY), narrate(KEPT_IN_MIND)], outcome: () => answer });
		assert.equal(keeperCalls(), 2);
		assert.deepEqual(outcomeRows(table).map(([status, why]) => [status, why]), [["unclear", reason]]);
		assert.deepEqual(refusals(table, "output"), []);
		assert.deepEqual(unfinishedNotices(table), []);
		assert.equal(turnRecord(table, 1).closed_by, "narrate");
	});

test("§200.4: a recording the player chose and no call attempted is delivered past and recorded not_written", async (t) => {
	const { table, keeperCalls } = await turn8(t, { calls: [narrate(KEPT_IN_MIND)], outcome: () => TURN8.jev.outcome_probability });
	assert.equal(keeperCalls(), 1);
	assert.ok(table.telemetry().some((row) => row.lane === "document_recording_intent" && row.status === "selected_no_write"));
	assert.deepEqual(outcomeRows(table), [["unclear", "outcome_uncertain", 0.12]]);
	const record = turnRecord(table, 1);
	assert.equal(record.closed_by, "narrate");
	assert.deepEqual(record.unconfirmed_recordings, [{ reason: "not_written" }]);
});

// ---------------------------------------------------------------------------------------------------
// §200.6: an input the host has ended runs nothing more.
// ---------------------------------------------------------------------------------------------------

/** §38.11's refusal: the history store cannot write. The second one of the same cause ends the input. */
const COMMIT_FAILED = { code: "commit_failed", message: "git commit failed; the turn stays open: git add failed (69)", fix: "retry narrate with the same text",
	details: { turn: 1, git: { step: "add", code: 69, output: "xcrun: error: unable to find utility" } } };

test("§200.6: once the host ends the input, the single-loop run asks the Keeper nothing more and runs none of its calls", async (t) => {
	const engine = createHybridEngine({ env: {}, decision: { decide: async (batch) => engineAnswer(batch) } });
	let keeperCalls = 0;
	const table = await openTable({ env: { PI_COC_LOOP_ENGINE: "hybrid-v1", FAKE_KERNEL_WORKSPACE: "1", FAKE_KERNEL_PRESENT: "[]",
		FAKE_KERNEL_ERRORS: JSON.stringify({ "table.narrate": COMMIT_FAILED }) }, runDriver: engine.runDriver,
		extraExtensions: [{ name: "coc-hybrid-engine", factory: engine.extension }],
		responses: Array.from({ length: 8 }, (_, index) => () => { keeperCalls++; return narrate(`attempt ${index + 1}`); }) });
	t.after(() => table.dispose());
	await table.session.prompt("I write it down.");
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	assert.equal(keeperCalls, 2, "the second failure ends the input; no third model step");
	const ended = table.telemetry().filter((row) => row.lane === "turn" && row.event === "input_ended");
	assert.deepEqual(ended.map((row) => row.cause), ["commit_unavailable"]);
	assert.equal(table.kernelRequests().filter((request) => request.method === "table.narrate").length, 2, "nothing reaches the kernel after the end");
	assert.equal(table.telemetry().filter((row) => row.code === "blocked").length, 0, "no call is even proposed after it");
	assert.equal(customMessages(table.session, "coc-delivery").filter((message) => message.details?.commit_unavailable).length, 1);
	assert.deepEqual(unfinishedNotices(table), [], "the history-store notice, not the generic line");
});

// ---------------------------------------------------------------------------------------------------
// The kernel's side of §200.4, through its own handlers.
// ---------------------------------------------------------------------------------------------------

test("§200.4: narrate keeps the host's unconfirmed_recordings on the record, refuses a malformed one, and the capsule shows it while recent does", async () => {
	const workspace = await mkdtemp(join(temporary, "kernel-"));
	await inProcess(workspace, async (call) => {
		await call("campaign.create", { id: CAMPAIGN, module: "the-haunting", pregen: "thomas-hayes", play_language: "zh-Hans", title: "§200.4" });
		await call("table.open");
		await call("table.narrate", { call_id: "t0-c1", text: TURN8.just_told });
		await call("table.player_input", { text: TURN8.player_text });
		const row = { document: "笔记本", reason: "binding_unresolved", cause: "no_target" };
		for (const bad of [[{ reason: "" }], [{ ...row, text: NOTE }], [{ ...row, document: "x".repeat(201) }], Array(5).fill(row), row])
			await assert.rejects(call("table.narrate", { call_id: "t1-c1", text: KEPT_IN_MIND, unconfirmed_recordings: bad }),
				(error) => error.code === "invalid_params", JSON.stringify(bad).slice(0, 80));
		await call("table.narrate", { call_id: "t1-c1", text: KEPT_IN_MIND, unconfirmed_recordings: [row] });
		const record = JSON.parse(await readFile(join(workspace, ".coc/campaigns", CAMPAIGN, "turns/0001.json"), "utf8"));
		assert.deepEqual(record.unconfirmed_recordings, [row]);
		const shown = { turn: 1, document: "笔记本", reason: "binding_unresolved", line: api.UNCONFIRMED_RECORDING_LINE };
		await call("table.player_input", { text: "我去产权登记处。" });
		assert.deepEqual((await call("table.capsule")).unconfirmed_recordings, [shown]);
		await call("table.narrate", { call_id: "t2-c1", text: "档案职员抬头看你。" });
		await call("table.player_input", { text: "我递上名片。" });
		assert.deepEqual((await call("table.capsule")).unconfirmed_recordings, [shown], "still in recent's window");
		await call("table.narrate", { call_id: "t3-c1", text: "他接过名片。" });
		await call("table.player_input", { text: "我等着。" });
		assert.equal((await call("table.capsule")).unconfirmed_recordings, undefined, "gone with the window; a turn without one has no section");
		const turns = await readdir(join(workspace, ".coc/campaigns", CAMPAIGN, "turns"));
		assert.ok(turns.filter((name) => name !== "0001.json").every((name) =>
			JSON.parse(readFileSync(join(workspace, ".coc/campaigns", CAMPAIGN, "turns", name), "utf8")).unconfirmed_recordings === undefined));
	});
});

// ---------------------------------------------------------------------------------------------------
// §200.5: the binding's gates, through its own entry, on the answers measured live.
// ---------------------------------------------------------------------------------------------------

const DOCUMENTS = [{ name: "笔记本", owner: "托马斯·海斯", presentation: "notebook", version: "v1" }, { name: "钢笔", owner: "托马斯·海斯", presentation: "paper", version: "v2" }];
const answered = (value) => ({ status: "answered", ...value });
async function bind({ target = 0.91, other = 0.15, content, execution, playerText = TURN8.player_text, suffix = NOTE, recentTold, playerKnowledge, literal = ["other_quote", 0.9] }) {
	const batches = [];
	const decision = { async decide(batch) {
		batches.push(batch);
		const answers = Object.fromEntries(batch.questions.map((question) => [question.key,
			question.key === "document_0" ? answered({ type: "noul", noul: target }) : question.key === "document_1" ? answered({ type: "noul", noul: other })
				: question.key === "content" ? answered(choiceAnswer(Object.keys(question.criteria), ...content))
					: question.key === "execution" ? answered(choiceAnswer(Object.keys(question.criteria), ...execution))
						: answered(choiceAnswer(Object.keys(question.criteria), ...literal))]));
		return { batchId: batch.id, status: "complete", answers, issues: [], coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] } };
	} };
	const input = { campaign: CAMPAIGN, turn: 8, playerText, justTold: TURN8.just_told, ...(recentTold ? { recentTold } : {}), ...(playerKnowledge ? {playerKnowledge} : {}), actor: "托马斯·海斯", suffix, documents: DOCUMENTS };
	const lease = new TaskLease({ owner: DOCUMENT_BINDING_FAMILY, goal: "test", ...documentBindingScope(input), capabilities: ["decision"],
		signal: new AbortController().signal, budget: { deadlineAt: Date.now() + 10_000, remainingInputTokens: 200_000, remainingOutputTokens: 20_000, remainingCostUsd: 0.02, remainingActions: 2 } });
	try { return { result: await bindDocumentAppend(input, decision, lease), batches }; } finally { lease.close(); }
}

test("§227.5: family 9 binds carrier identity with one batch and never reviews the proposed contents or execution", async () => {
    const checked=await bind({content:["outside_selected_addition",.98],execution:["not_selected_operation",.99]});
    assert.equal(checked.result.status,"bound");assert.equal(checked.batches.length,1);
    assert.equal(checked.batches[0].familyVersion,"9");
    assert.ok(checked.batches[0].questions.every(question=>question.key.startsWith('document_')||question.key.startsWith('literal_')));
    assert.equal(checked.result.advice,undefined);
});

// §227.5, live 4d7 t76: "copy the item's original words into the notebook" -- the notebook led .87 with every other carrier
// at .04, and the words came from a clipping read the turn before, which justTold alone never showed.
test("§227.5: a clear leader names the carrier, and a copy of a text the player read binds on the recent told text", async () => {
	const clipping = "一九一二年 Chapel of Contemplation 该堂关门。";
	const recentTold = [{ turn: 75, text: `资料室的抽屉里有一条短讯：${clipping}` }, { turn: 76, text: "店员把抽屉合上。" }];
	const copied = await bind({ playerText: "我把那条短讯的原话抄进本子，谢过店员。", suffix: `\n${clipping}\n`, target: 0.87, other: 0.04, recentTold,
		content: ["within_selected_addition", 0.95], execution: ["selected_operation", 0.93] });
	assert.deepEqual([copied.result.status, copied.result.document?.name], ["bound", "笔记本"]);
	assert.equal(copied.batches.length,1,"no after-draft review or public-history duplication");
	const close = await bind({ target: 0.87, other: 0.3, content: ["within_selected_addition", 0.95], execution: ["selected_operation", 0.93] });
	assert.deepEqual([close.result.status, close.result.reason], ["unresolved", "no_target"], "a runner-up above .2 is no clear leader");
});

test("§227.5: content concerns are advisory and complete quotation substitution still needs .9", async () => {
    const outside=await bind({content:["outside_selected_addition",.98],execution:["selected_operation",.95]});
    assert.equal(outside.result.status,"bound");
    assert.equal(outside.batches.length,1);
    const playerText='I write in my notebook: "My own stated belief."';
    const weakQuote=await bind({playerText,literal:["addition_text",.89],content:["outside_selected_addition",.96],execution:["selected_operation",.9]});
    assert.deepEqual([weakQuote.result.status,weakQuote.result.reason],["unresolved","literal_binding_uncertain"]);
    const clearQuote=await bind({playerText,literal:["addition_text",.90],content:["outside_selected_addition",.96],execution:["selected_operation",.90]});
    assert.deepEqual([clearQuote.result.status,clearQuote.result.origin,clearQuote.result.suffix],["bound","player_span","My own stated belief."]);
});

test("§227.5: the full public day survives the capsule window, excludes other lines and secrets, without duplicating history into carrier identity", async () => {
    const early = "Knott offered twenty dollars per day and wanted findings he could use in an advertisement.";
    const clock = {at:"1920-01-02T18:00",minutes:1980};
    const record = (turn,text,minutes,extra={}) => ({turn,rendered_text:text,commit:"settled",worldline:"main",loop:0,
        world:{clock:{minutes},secret:"keeper-only world"},capsule:{where:{clock:{at:"1920-01-02T09:00",minutes:1440}},secret:"keeper-only capsule"},...extra});
    const view = {turn:8,clock,clues:{discovered:[{label:"Old house",how:"The house was sold in 1835.",summary:"unrevealed source"}]},
        handouts:[{name:"Clipping",text:"The newspaper's public text.",path:"private path"}]};
    const records = [record(2,early,1500),record(3,"public details ".repeat(600),1560),record(5,"Lunch.",1800),record(6,"Home.",1920),
        record(1,"Previous day",0,{capsule:{}}),record(4,"Other worldline",1620,{worldline:"other"}),record(4,"Other loop",1620,{loop:1}),
        record(4,"Superseded",1620,{superseded_by:7}),record(7,"Never delivered",1950,{commit:null}),record(9,"Future",2000)];
    const knowledge = api.documentKnowledge(view,records,{active_worldline:"main",worldlines:{main:{loop:0}}});
    assert.deepEqual(knowledge.narrations.map(entry=>entry.turn),[2,3,5,6]);
    assert.deepEqual(knowledge.clues,[{label:"Old house",how:"The house was sold in 1835."}]);
    assert.deepEqual(knowledge.handouts,[{name:"Clipping",text:"The newspaper's public text."}]);
    assert.ok(!JSON.stringify(knowledge).includes("keeper-only"));
    const checked = await bind({playerText:"I write up today's findings in my notebook.",suffix:early,playerKnowledge:knowledge,
        content:["within_selected_addition",.97],execution:["selected_operation",.96]});
    assert.equal(checked.result.status,"bound");
    assert.equal(checked.batches.length,1);
    assert.equal(checked.batches[0].state.playerKnowledge,undefined,"identity binding carries no unrelated public history");
    const crossMidnight=record(7,"I organized the day, then slept until morning.",2340);
    const tomorrow={...view,clock:{at:"1920-01-03T07:30",minutes:2790}};
    assert.deepEqual(api.documentKnowledge(tomorrow,[crossMidnight],{active_worldline:"main"}).narrations.map(entry=>entry.turn),[7]);
});

test("§227.5: canonical document options supplies only public knowledge when the host requests it", async () => {
    const workspace=join(temporary,"knowledge-options");
    await inProcess(workspace,async call=>{
        await call("campaign.create",{id:CAMPAIGN,module:"the-haunting",pregen:"thomas-hayes",play_language:"zh-Hans"});
        await carriers(workspace,call);
        const plain=await call("mods.document.options");
        assert.equal(plain.playerKnowledge,undefined);
        const catalogue=await call("mods.document.options",{_knowledge_catalog:true});
        assert.equal(catalogue.playerKnowledge,undefined);
        const original=await call("table.look",catalogue.knowledge.entries.find(entry=>entry.kind==='transcript').read);
        assert.equal(original.text,TURN8.just_told);
        const reordered={loop:original.context.loop,line:original.context.line,view:original.context.view,turn:original.context.turn};
        assert.equal((await call("table.look",{...catalogue.knowledge.entries[0].read,knowledge_page:{...catalogue.knowledge.entries[0].read.knowledge_page,context:reordered}})).status,'original');
        const savedPath=join(workspace,'.coc/campaigns',CAMPAIGN,'turns','0000.json');
        const saved=JSON.parse(await readFile(savedPath,'utf8'));
        await writeFile(savedPath,JSON.stringify({...saved,rendered_text:TURN8.just_told+' Changed public original.'}));
        assert.equal((await call('table.look',catalogue.knowledge.entries[0].read)).status,'stale','same-turn edits invalidate issued original references');
        const refreshed=await call('table.look',{focus:'knowledge'});
        assert.ok(refreshed.context.view>catalogue.knowledge.context.view);


        const supplied=await call("mods.document.options",{_binding_context:true});
        assert.equal(supplied.playerKnowledge.narrations[0].text,TURN8.just_told+' Changed public original.');
        assert.deepEqual(Object.keys(supplied.playerKnowledge).sort(),["clues","day","handouts","narrations"]);
    });
});
