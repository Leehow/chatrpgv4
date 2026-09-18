/**
 * Host state is not fiction, and a state said out loud is re-read first (contract §47).
 *
 * Three retained live tables on 2026-09-16 produced the same failure, and this file pins the three
 * layers of it that belong to the adaptation and source waits.
 *
 * `game-1c0faba5` turn 3 (`homes/t4`) is the hardest evidence. Its own telemetry:
 *
 *     12:09:35.086  apply   ok:false  reason: action_not_authorized
 *     12:09:58.164  lookup  ok:true   about: roxbury-sanitarium   (14742ms, returned 12:10:12.9)
 *     12:10:18.875  narrate ok:true
 *
 * and the session log shows what that successful `lookup` handed the Keeper at 12:10:12.911Z:
 *
 *     "service_status": "The retained preparation is still running ... Use narrate only to tell the
 *      player that preparation is pending and end the turn. ..."
 *
 * The Keeper executed it (Agents.md: a Keeper executes what it reads). The player read, in the
 * Keeper's own voice and in the play language, that the sanitarium "was still being checked against
 * the original book" and was asked to say their action again — while the turn's real refusal was
 * `action_not_authorized`, whose own `fix` says the opposite, and while the draft for that very
 * preparation landed four seconds before the turn closed. `turns/0003.json`: every one of
 * `receipts`, `mechanics`, `speech` and `intents` empty, `closed_by: "narrate"`.
 *
 * `game-b4cebfe0` turns 2 and 3 (`homes/t6`) are the source-reading half of the same seam: a
 * 120-second `reading_timeout` became a sentence inside the scene ("this part of the source is still
 * being prepared, the boat cannot land this turn"), and the material arrived seconds later.
 *
 * The wording has two carriers, and the second one was invisible. `game-1c0faba5` turn 12 and
 * `game-3dd94f0a` (M-MAIN) turn 52 close on the same sentence with *no* `ok:false` row anywhere in
 * the turn, which reads as a Keeper inventing a reason. It was not. Both turns have the same
 * telemetry shape:
 *
 *     lookup ok:true about:"南区慈善会办公室"  ms:20027       (12:37:22.850)
 *     provider-call  toolUse  blocks:[thinking, toolCall]    (12:37:49.928)   <- no tool row at all
 *     provider-call  toolUse  blocks:[thinking, toolCall]    (12:37:53.809)
 *     narrate ok:true                                         (12:37:53.816)
 *
 * That swallowed `toolCall` is the preparation-wait gate, which was the only tool-level block in
 * `beforeTool` that returned without a telemetry row while every other one wrote
 * `ok: false, code: "blocked"`. The Keeper was relaying `preparationWaitInstruction`, and the reason
 * nobody could see that is pinned here too: the UI step bar counted the block ("11 steps, 1 failed")
 * and telemetry recorded nothing.
 *
 * So the layers, one group below each: the instruction must not tell the Keeper what to *say*; the
 * block that carries it must be visible; the host must say it itself, out of fiction, on the channel
 * the other service notices use; and it must re-read the state before it says it.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { adaptationService } from "../../extensions/kernel/adaptation.ts";
import { KernelError } from "../../extensions/kernel/client.ts";
import { ReadingService } from "../../extensions/module/reading-service.ts";
import { extensionWords } from "../../extensions/ui/words.ts";
import { assistantTexts, customMessages, openTable, toolResultTexts, waitFor } from "./harness.mjs";

/** The notices this contract owns, as the player's surface actually carries them. */
const waitNotices = (table) =>
	customMessages(table.session, "coc-delivery").filter((message) => message.details?.preparation_wait);

/**
 * Every answer the §47 re-read is allowed to reach, as the telemetry names them. A test waits for the
 * *decision*, not for one of its outcomes: waiting for a single reason would hang, not fail, on the
 * day the host starts answering differently, and a hang says nothing about what changed.
 */
const NOTICE_DECISIONS = new Set(["preparation_wait_notice", "preparation_ready_notice", "preparation_wait_notice_withheld"]);

/** A host reading bridge under the test's control: `ensure` always times out, `reading` is scripted. */
function readingBridge(stillReading) {
	const asked = [];
	return {
		asked,
		bridge: {
			async prepare() { return { ok: true }; },
			async ensure(_mid, params) {
				throw new KernelError({ code: "needs", message: "the source is still being read",
					fix: "use ask to return control",
					details: { reason: "reading_timeout", read: { purpose: "detail", focus: params.focus ?? "", question: params.question ?? "" } } });
			},
			reading(mid, params) { asked.push({ mid, ...params }); return stillReading(); },
		},
	};
}

const PREPARE = fauxToolCall("lookup", { kind: "adaptation", action: "prepare", name: "roxbury-sanitarium",
	purpose: "new_destination", request: "The sanitarium the player walked into", anchors: ["scene: commission-briefing"] });

// ---- Layer 1: the instruction says what the Keeper does, never what it says -------------------

test("the pending adaptation payload no longer tells the Keeper to tell the player", async () => {
	const previous = process.env.PI_COC_ADAPTATION_WAIT_MS;
	process.env.PI_COC_ADAPTATION_WAIT_MS = "0";
	const root = await mkdtemp(join(tmpdir(), "host-state-not-fiction-"));
	await mkdir(join(root, "create"), { recursive: true });
	await writeFile(join(root, "create", "focus.json"), JSON.stringify({ purpose: "new_destination", request: "one route" }));
	const owner = new AbortController();
	const call = async (method, args) => {
		if (method === "adaptation.prepare") return { name: args.name, status: "pending",
			task: { key: "k", attempt: 1, role: "create", cwd: join(root, "create"), system_prompt: join(root, "create", "prompt.md") } };
		return { name: args.name, status: "pending" };
	};
	const runtime = { signal: owner.signal, runTask: async (_task, signal) => {
		await new Promise((resolve) => { if (signal.aborted) resolve(); else signal.addEventListener("abort", resolve, { once: true }); });
		return { ok: false, code: "interrupted" };
	} };
	const service = adaptationService(runtime, call, () => ({ name: "deepseek/deepseek-v4-flash" }));
	try {
		const result = await service.lookup({ campaign: "c1", action: "prepare", name: "roxbury-sanitarium" });
		assert.equal(result.status, "pending");
		// The operational half survives: a Keeper that does not know it must close the turn hangs it.
		assert.match(result.service_status, /No fictional event or player action has happened/);
		assert.match(result.service_status, /close the turn with narrate on what the player actually said/);
		assert.match(result.service_status, /lookup kind=adaptation action=status/);
		// The half that produced the live defect, verbatim from the retained session log.
		assert.doesNotMatch(result.service_status, /tell the player/i,
			`the payload must not hand the Keeper a line to deliver: ${result.service_status}`);
		assert.match(result.service_status, /keep the preparation, the wait and the destination out of the fiction/);
	} finally {
		owner.abort();
		if (previous === undefined) delete process.env.PI_COC_ADAPTATION_WAIT_MS;
		else process.env.PI_COC_ADAPTATION_WAIT_MS = previous;
	}
});

test("neither wait instruction asks the Keeper to put the wait in front of the player", async (t) => {
	const table = await openTable({
		env: { FAKE_KERNEL_ADAPTATION_PENDING: "1", PI_COC_ADAPTATION_WAIT_MS: "0" },
		responses: [
			fauxAssistantMessage([PREPARE], { stopReason: "toolUse" }),
			// The live Keeper's next move: an ordinary write, which the wait blocks with the instruction.
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "time", minutes: 10, why: "wait" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你在门口把外套抻平，把名片捏在手里。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("你在门口把外套抻平，把名片捏在手里。"),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("我进门找值班的人。");
	// The blocked `apply` reads the instruction back; that text is what the Keeper acts on.
	const blocked = toolResultTexts(table.session).join("\n");
	assert.match(blocked, /Adaptation preparation for roxbury-sanitarium is still running/);
	assert.doesNotMatch(blocked, /tell the player that preparation is pending/,
		"the adaptation wait instruction must not name the sentence the Keeper delivers");
	assert.match(blocked, /Do not put this preparation into the fiction at all/);
	assert.match(blocked, /do not ask the player to say their action again/);
});

test("a tool the preparation wait blocks leaves a telemetry row, like every other block", async (t) => {
	const table = await openTable({
		env: { FAKE_KERNEL_ADAPTATION_PENDING: "1", PI_COC_ADAPTATION_WAIT_MS: "0" },
		responses: [
			fauxAssistantMessage([PREPARE], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "move", to: "roxbury-sanitarium" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你在门口把外套抻平。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("你在门口把外套抻平。"),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("我进门找值班的人。");

	const blocked = table.telemetry().filter((row) => row.reason === "preparation_wait" && row.code === "blocked");
	assert.equal(blocked.length, 1,
		`the swallowed call must be readable: ${JSON.stringify(table.telemetry().filter((row) => row.tool))}`);
	assert.equal(blocked[0].tool, "apply", "the row names the verb the gate refused");
	assert.equal(blocked[0].ok, false);
	assert.equal(blocked[0].proposal, "roxbury-sanitarium");
	// The evidence's own symptom: a turn that spent a call and looks, in telemetry, like zero failures.
	assert.ok(table.telemetry().some((row) => row.tool === "narrate" && row.ok === true), "and the turn still closed");
});

test("a pending adaptation cannot block the pure registration its narration audit requires", async (t) => {
	const delivered = "你扣好头盔，手扶着已经登记的摩托，等镇里的路接通。";
	const registration = fauxToolCall("apply", { effects: [
		{ kind: "define", name: "Black motorcycle", description: "The investigator's existing motorcycle.", category: "item", template: "" },
		{ kind: "object", name: "The investigator's motorcycle", to: "托马斯·海耶斯", adopt: "Black motorcycle",
			definition: "Black motorcycle", why: "Register existing owned transport without awarding another copy" },
	] });
	const table = await openTable({
		env: { FAKE_KERNEL_ADAPTATION_PENDING: "1", PI_COC_ADAPTATION_WAIT_MS: "0" },
		responses: [
			fauxAssistantMessage([PREPARE], { stopReason: "toolUse" }),
			fauxAssistantMessage([registration], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: delivered })], { stopReason: "toolUse" }),
			fauxAssistantMessage(delivered),
		],
	});
	t.after(() => table.dispose());
	// Isolate the host wait gate: Mod materialization is covered by its own registration suites.
	table.emit("coc:mods-bridge", { async after() {}, async prepare() {} });
	await table.session.prompt("我跨上自己的摩托，准备去镇里的酒馆。");

	assert.equal(table.kernelRequests().filter(row => row.method === "table.apply").length, 1,
		"pure registration reaches the kernel while the destination preparation remains pending");
	assert.equal(table.telemetry().filter(row => row.reason === "preparation_wait" && row.tool === "apply").length, 0,
		"the wait does not classify registration bookkeeping as destination-dependent work");
	assert.equal(table.kernelRequests().filter(row => row.method === "table.narrate").length, 1,
		"the audited turn still has a door after registration");
});

test("a finished preparation is never described as still running", async (t) => {
	// `ADAPTATION_HELD` keeps `ready` as a wait because the Keeper owes it an answer. On campaign
	// game-ef7545c5 the single adaptation row in 785 telemetry lines was
	// {"proposal":"圣马丁广场照相馆","status":"ready","held":true} — built, reviewed, done — and the
	// player was told it was still being checked against the book, for six minutes.
	const table = await openTable({
		env: { FAKE_KERNEL_ADAPTATION_PENDING: "1", PI_COC_ADAPTATION_WAIT_MS: "0",
			FAKE_KERNEL_ADAPTATION_READY_ON_SECOND_STATUS: "1" },
		responses: [
			fauxAssistantMessage([PREPARE], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你在门口把外套抻平。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("你在门口把外套抻平。"),
			// The second turn: the wait is now retained as `ready`, and every verb but an adaptation
			// control reads the terminal instruction back.
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "move", to: "roxbury-sanitarium" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: "你跨过门槛。" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("你跨过门槛。"),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("我进门找值班的人。");
	await table.session.prompt("我走进去。");

	const said = toolResultTexts(table.session).join("\n");
	assert.match(said, /is ready, which means it has finished/);
	assert.match(said, /Never tell the player this is still being prepared/);
	assert.doesNotMatch(said, /Retained adaptation preparation for roxbury-sanitarium is ready\. Use lookup/,
		"the bare status line is what let a finished job be narrated as unfinished");
	// And the host does not say it either: a finished job is not a pending one. §75 keeps that and
	// narrows it to the sentence — the player still hears that the place landed, on the row below.
	assert.deepEqual(table.telemetry().filter((row) => row.reason === "preparation_wait_notice"), [],
		"a job that has finished produces no 'still preparing' notice");
	assert.ok(waitNotices(table).length >= 1, "and the player is not left with silence either");
	assert.ok(waitNotices(table).every((notice) => notice.details.preparation_wait.landed === true),
		"every notice the player did get says the place landed, not that it is running");
});

// ---- Layer 2: the host says it itself, out of fiction ----------------------------------------

test("a delivery made under an adaptation wait carries the host's own notice, beside the fiction", async (t) => {
	const delivered = "你在门口把外套抻平，把名片捏在手里，找值班的人。";
	const table = await openTable({
		env: { FAKE_KERNEL_ADAPTATION_PENDING: "1", PI_COC_ADAPTATION_WAIT_MS: "0" },
		responses: [
			fauxAssistantMessage([PREPARE], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: delivered })], { stopReason: "toolUse" }),
			fauxAssistantMessage(delivered),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("我进门找值班的人。");
	await waitFor(() => waitNotices(table).length > 0, { label: "the host's preparation-wait notice" });

	const notice = waitNotices(table).at(-1);
	assert.deepEqual(notice.details.preparation_wait, { kind: "adaptation", name: "roxbury-sanitarium" });
	assert.equal(notice.customType, "coc-delivery", "it rides the channel the other service notices use");
	// It is the host's line, not the Keeper's: the delivered fiction is untouched and separate.
	assert.equal(assistantTexts(table.session).filter(Boolean).at(-1), delivered);
	assert.notEqual(notice.content, delivered);
	assert.ok(notice.content.trim(), "a notice with no words tells the player nothing");
	const rows = table.telemetry().filter((row) => row.reason === "preparation_wait_notice");
	assert.equal(rows.length, 1, `said once per delivered turn: ${JSON.stringify(rows)}`);
	assert.equal(rows[0].kind, "adaptation");
});

test("a delivery made under a source-reading wait carries the same notice, named for that material", async (t) => {
	const delivered = "缆绳还勒在舷桩上，六包烟压着艇头。";
	const { bridge, asked } = readingBridge(() => true);
	const table = await openTable({
		responses: [
			fauxAssistantMessage([fauxToolCall("lookup", { kind: "source", query: "adventure-begins", question: "who holds the lamp" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: delivered })], { stopReason: "toolUse" }),
			fauxAssistantMessage(delivered),
		],
	});
	t.after(() => table.dispose());
	table.emit("coc:reading-bridge", bridge);
	await table.session.prompt("我把橹插下去，往滩头去。");
	await waitFor(() => waitNotices(table).length > 0, { label: "the host's source-wait notice" });

	const notice = waitNotices(table).at(-1);
	assert.deepEqual(notice.details.preparation_wait, { kind: "source", name: "adventure-begins" });
	assert.equal(assistantTexts(table.session).filter(Boolean).at(-1), delivered);
	assert.ok(asked.length >= 1, "the host asked the reading service where that material stands");
	assert.equal(asked.at(-1).focus, "adventure-begins");
});

// ---- Layer 3: re-read before saying it -------------------------------------------------------

test("a preparation that landed before the player was told is not announced as still running", async (t) => {
	const delivered = "你在门口把外套抻平，把名片捏在手里，找值班的人。";
	const table = await openTable({
		// The first status — the one the Keeper's own `prepare` reads — is pending; by the time the
		// delivery lands the job is ready. That is `game-1c0faba5` turn 3 with its 20-second gap.
		env: { FAKE_KERNEL_ADAPTATION_PENDING: "1", PI_COC_ADAPTATION_WAIT_MS: "0",
			FAKE_KERNEL_ADAPTATION_READY_ON_SECOND_STATUS: "1" },
		responses: [
			fauxAssistantMessage([PREPARE], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: delivered })], { stopReason: "toolUse" }),
			fauxAssistantMessage(delivered),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("我进门找值班的人。");
	await waitFor(() => table.telemetry().some((row) => NOTICE_DECISIONS.has(String(row.reason ?? ""))),
		{ label: "the host's decision about the notice" });

	assert.deepEqual(table.telemetry().filter((row) => row.reason === "preparation_wait_notice"), [],
		"a job that has landed is not described to the player as pending");
	// §75: and it is not silence either. The re-read is still the decision; it now has three answers.
	const landed = table.telemetry().filter((row) => row.reason === "preparation_ready_notice");
	assert.equal(landed.length, 1, `the re-read must be recorded: ${JSON.stringify(table.telemetry().filter(r => r.lane === "delivery"))}`);
	assert.equal(landed[0].kind, "adaptation");
	assert.equal(landed[0].name, "roxbury-sanitarium");
	// The Keeper's own status call stays pending: this is the host re-reading, not the Keeper polling.
	const statuses = table.kernelRequests().filter((row) => row.method === "adaptation.status");
	assert.ok(statuses.length >= 2, `the notice read the status again for itself: ${statuses.length}`);
});

test("a source reading that finished before the player was told is not announced as still running", async (t) => {
	const delivered = "缆绳还勒在舷桩上，六包烟压着艇头。";
	let landed = false;
	const { bridge } = readingBridge(() => !landed);
	const table = await openTable({
		responses: [
			fauxAssistantMessage([fauxToolCall("lookup", { kind: "source", query: "adventure-begins", question: "who holds the lamp" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: delivered })], { stopReason: "toolUse" }),
			fauxAssistantMessage(delivered),
		],
	});
	t.after(() => table.dispose());
	table.emit("coc:reading-bridge", bridge);
	// The five seconds of `game-b4cebfe0`: the reader lands while the turn is closing.
	landed = true;
	await table.session.prompt("我把橹插下去，往滩头去。");
	await waitFor(() => table.telemetry().some((row) => NOTICE_DECISIONS.has(String(row.reason ?? ""))),
		{ label: "the host's decision about the notice" });

	assert.deepEqual(waitNotices(table), [], "a reading that has landed is not described to the player as pending");
	assert.equal(table.telemetry().filter((row) => row.reason === "preparation_wait_notice_withheld").length, 1);
});

// ---- Layer 4 (§75): "not still running" is two answers, and only one of them is silence --------

/**
 * The cost this layer exists for, from `homes/t4` (`game-1c0faba5`). Four turns — 66, 73, 93, 95 —
 * each declared a new destination, each prepared an adaptation, each had the very next verb refused
 * with `reason: "preparation_wait"`, and each closed with `receipts: []`. On all four the §47 notice
 * was the only thing that could have told the player why, and on all four its telemetry row reads
 * `preparation_wait_notice_withheld`: the job reached `ready` in the seconds between the delivery
 * and the re-read (turn 93: `narrate` 02:15:36.296, withheld 02:15:40.018), and "no longer pending"
 * was being read as "nothing to say". Turn 93's player had said he would be at the elders' side door
 * at nine; the prose he got stops at the lamp going out, with no receipt and no notice, and turn 94
 * is him saying the same thing over again.
 *
 * `ready` is the answer arriving, not the work disappearing, so it is the case with the *most* to
 * say — and it is the only case where what the player needs next is one more sentence from them.
 */
test("a preparation that landed is told to the player, not withheld as if there were nothing to say", async (t) => {
	const delivered = "你在门口把外套抻平，把名片捏在手里，找值班的人。";
	const words = await extensionWords(undefined), source = await extensionWords("en");
	const table = await openTable({
		env: { FAKE_KERNEL_ADAPTATION_PENDING: "1", PI_COC_ADAPTATION_WAIT_MS: "0",
			FAKE_KERNEL_ADAPTATION_READY_ON_SECOND_STATUS: "1" },
		responses: [
			fauxAssistantMessage([PREPARE], { stopReason: "toolUse" }),
			// Turn 93's own shape: the move the player asked for, refused by the wait the same turn made.
			fauxAssistantMessage([fauxToolCall("apply", { effects: [{ kind: "move", to: "roxbury-sanitarium" }] })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: delivered })], { stopReason: "toolUse" }),
			fauxAssistantMessage(delivered),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("我进门找值班的人。");
	await waitFor(() => table.telemetry().some((row) => NOTICE_DECISIONS.has(String(row.reason ?? ""))),
		{ label: "the host's decision about the notice" });

	// The turn the player paid for: a refused verb, and a delivery that carries no receipt of it.
	assert.ok(table.telemetry().some((row) => row.reason === "preparation_wait" && row.code === "blocked" && row.tool === "apply"),
		"the turn under test is one where the preparation took the player's move");
	const notice = waitNotices(table).at(-1);
	assert.ok(notice, `the player is owed a line on a turn that cost them one: ${JSON.stringify(table.telemetry().filter((row) => row.lane === "delivery"))}`);
	assert.equal(notice.customType, "coc-delivery", "it rides the channel the other service notices use");
	assert.equal(notice.details.preparation_wait.kind, "adaptation");
	assert.equal(notice.details.preparation_wait.name, "roxbury-sanitarium");
	assert.equal(notice.details.preparation_wait.landed, true, "and it says which of the two answers the re-read reached");
	assert.equal(notice.content, words.line("adaptation_ready_notice"), "the projected caption, like every other notice");
	assert.notEqual(notice.content, words.line("adaptation_wait_notice"),
		"the landed line is its own caption: reusing the waiting one would say the job is still running");
	// The rule §47 set and this section keeps, checked in the authored source the projection is made
	// from rather than in whatever the table happened to render.
	assert.doesNotMatch(source.word("adaptation_ready_notice"), /still/i,
		"a finished job is never described to the player as running");
	assert.deepEqual(table.telemetry().filter((row) => row.reason === "preparation_wait_notice_withheld"), [],
		"withholding is for a preparation that is gone, and this one is waiting for the table");
});

test("a preparation that is gone is still withheld: the player hears about work, not about history", async (t) => {
	const delivered = "你在门口把外套抻平，把名片捏在手里，找值班的人。";
	const table = await openTable({
		// §60's case: the retained creator or its reviewer gave up. Nothing was built and nothing is
		// waiting for an answer, so there is no place to tell the player about.
		env: { FAKE_KERNEL_ADAPTATION_PENDING: "1", PI_COC_ADAPTATION_WAIT_MS: "0",
			FAKE_KERNEL_ADAPTATION_FAILED_ON_SECOND_STATUS: "1" },
		responses: [
			fauxAssistantMessage([PREPARE], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("narrate", { text: delivered })], { stopReason: "toolUse" }),
			fauxAssistantMessage(delivered),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("我进门找值班的人。");
	await waitFor(() => table.telemetry().some((row) => NOTICE_DECISIONS.has(String(row.reason ?? ""))),
		{ label: "the host's decision about the notice" });

	assert.equal(table.telemetry().filter((row) => row.reason === "preparation_wait_notice_withheld").length, 1);
	assert.deepEqual(waitNotices(table), [],
		"a dead proposal is not a place that is ready, and the player is not told one landed");
});

test("`reading` answers for the material the wait retained, and only while it is in flight", async () => {
	const root = await mkdtemp(join(tmpdir(), "host-state-reading-"));
	let release;
	const held = new Promise((resolve) => { release = resolve; });
	const service = new ReadingService({
		call: async (method) => {
			if (method === "module.read.request") { await held; return { state: "ready", generation: 1 }; }
			return {};
		},
		campaign: () => "c1",
		home: root,
		model: () => ({ id: "m", vision: false }),
		progress: () => {},
		record: () => {},
	});
	const read = { purpose: "detail", focus: "adventure-begins", question: "who holds the lamp" };
	assert.equal(service.reading("the-haunting", read), false, "nothing is in flight before the first ensure");

	const previous = process.env.PI_COC_READ_WAIT_MS;
	process.env.PI_COC_READ_WAIT_MS = "40";
	const timedOut = service.ensure("the-haunting", read).then(() => null, (error) => error);
	try {
		await waitFor(() => service.reading("the-haunting", read), { label: "the reading to register" });
		// The Keeper's foreground wait ends; the reader has not.
		assert.equal((await timedOut)?.details?.reason, "reading_timeout");
		assert.equal(service.reading("the-haunting", read), true, "the host's patience ending is not the reader finishing");
		assert.equal(service.reading("the-haunting", { ...read, focus: "dunwich-1287" }), false, "it answers for this material only");
		assert.equal(service.reading("another-module", read), false, "and for this module only");
		assert.equal(service.reading("the-haunting", { focus: "", question: "" }), false, "an unnamed wait matches nothing");
	} finally {
		release();
		if (previous === undefined) delete process.env.PI_COC_READ_WAIT_MS;
		else process.env.PI_COC_READ_WAIT_MS = previous;
	}
	await waitFor(() => !service.reading("the-haunting", read), { label: "the reading to leave the map" });
});
