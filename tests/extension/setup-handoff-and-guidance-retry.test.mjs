/**
 * SL-103 (contract §98 addendum 10): the handoff command is the host's, never the guide's words; a
 * guidance draft the reviewer refused is retried by the host before the step answers.
 *
 * The Masks re-run (masks2-2238-20260927T023845Z): the `complete` step's result carried
 * `handoff_command: "bin/pi-coc --campaign masks2-2238"` (and `setup.complete`'s own `launch`), and the
 * guide ended its reply to the player with the command, while the host had already shown that line
 * itself. Earlier in the same setup, `create-campaign` answered `guidance_failed` / `preparation_failed`
 * ("Character guidance needs revision": the reviewer refused both rounds), and the retry only ran when
 * the player wrote another line.
 *
 * Every case drives the real `setup` tool through the onboarding extension. The handoff cases run on
 * the real kernel, whose `setup.complete` answers with the `launch` line; the retry cases run the real
 * guidance preparer over a fake reader child that plays author and reviewer.
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { playerReason } from "../../extensions/onboarding/reasons.ts";
import { openTable, waitForIdle } from "./harness.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const setupCall = (params) => fauxAssistantMessage([fauxToolCall("setup", params)], { stopReason: "toolUse" });

/** Every `setup` result, parsed, in call order: exactly what the guide reads. */
function setupResults(session) {
	return session.messages
		.filter((message) => message.role === "toolResult" && message.toolName === "setup")
		.map((message) => JSON.parse((message.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join("")));
}

// ---- The handoff (§98 addendum 10.1) ---------------------------------------------------------

/** One cold kernel process over the workspace: each request in order, every one must succeed. */
function coldKernel(workspace, requests) {
	const input = requests.map(([method, params], index) => JSON.stringify({ id: String(index), method, params })).join("\n");
	const run = spawnSync(process.execPath, [join(REPO, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(REPO, "content")],
		{ cwd: REPO, input: `${input}\n`, encoding: "utf8" });
	const frames = run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress);
	for (const frame of frames) if (!frame.ok) throw new Error(`cold ${requests[Number(frame.id)][0]} failed: ${JSON.stringify(frame.error)}`);
	return frames.map((frame) => frame.result);
}

const profile = { name: "Helen", occupation: "Journalist", age: 29, sex: "female",
	concept: "A cautious local reporter seeking rent money.", own_language: "English",
	occupation_skills: ["Art and Craft (Photography)", "History", "Language (Own)", "Library Use", "Psychology", "Persuade", "Spot Hidden", "Listen"],
	interest_skills: ["Accounting", "Law", "First Aid", "Drive Auto"],
	backstory: { personal_description: "A practical coat", ideology_beliefs: "Evidence before rumors",
		significant_people: "An editor friend", scenario_bound: "Meeting Knott about the house investigation" },
	key_connection: { backstory_field: "significant_people", summary: "The editor friend" },
	equipment: ["Press card", "Notebook", "Camera", "Flashlight"] };

/**
 * A Haunting campaign on the real kernel with a drafted card, walked by the guide through
 * confirm-investigator and complete. `app` is the frontend's path (`PI_COC_SETUP_AUTOSTART=1`), where
 * the host opens the table itself and shows no line.
 */
async function completeSetup(t, campaign, { app }) {
	const table = await openTable({
		mode: "setup", campaign, realKernel: true, seedCampaign: false,
		env: app ? { PI_COC_SETUP_AUTOSTART: "1" } : {},
		prepareWorkspace: (workspace) => coldKernel(workspace, [
			["campaign.create", { id: campaign, module: "the-haunting", play_language: "en" }],
			["setup.draft", { campaign, profile }],
		]),
		responses: [
			setupCall({ step: "confirm-investigator", consent: "approved" }),
			setupCall({ step: "complete" }),
			fauxAssistantMessage("Helen is ready."),
		],
	});
	t.after(() => table.dispose());
	await table.session.prompt("That card is right. Let's play.");
	await waitForIdle(table.session);
	assert.deepEqual(table.extensionErrors, []);
	const results = setupResults(table.session);
	const finished = results.at(-1);
	assert.equal(finished.ok, true, JSON.stringify(results));
	assert.equal(finished.step, "complete");
	return { table, finished };
}

test("the complete step tells the guide the host has handed off and gives it no command to repeat (§98 addendum 10.1)", async (t) => {
	const campaign = "handoff-terminal";
	const { table, finished } = await completeSetup(t, campaign, { app: false });
	const command = `bin/pi-coc --campaign ${campaign}`;

	// The host's own handoff is unchanged: the line the player reads, and the entry the wrapper reads.
	const [handoff] = table.entries("coc-setup-handoff");
	assert.equal(handoff?.command, command, "the host still holds the command");
	assert.ok(table.ui.notifications.some((row) => row.type === "info" && row.message.includes(command)), "and shows it to the player itself");
	assert.equal(table.entries("coc-session").at(-1)?.mode, "play", "the play-mode session entry the App switches on");

	// The guide is told the handoff happened, and is handed no command anywhere in the result.
	assert.equal(finished.handoff_command, undefined, "no command field for the guide");
	assert.equal(typeof finished.handoff_shown, "string", "the result says the host has handed off, as opening_shown does");
	assert.ok(finished.handoff_shown.length > 0);
	const text = JSON.stringify(finished);
	for (const piece of [command, "bin/pi-coc", "--campaign"])
		assert.ok(!text.includes(piece), `nothing in the result the guide reads carries ${piece}: ${text.slice(0, 600)}`);
	assert.ok(finished["setup.complete"]?.receipt, "the completion itself still reaches the guide");
	assert.equal(finished["setup.complete"].launch, undefined, "without the kernel's launch line");

	// The kernel's record keeps its launch line: only the guide's view drops it.
	const meta = JSON.parse(readFileSync(join(table.workspace, ".coc/campaigns", campaign, "campaign.json"), "utf8"));
	assert.equal(meta.status, "ready_for_table");
	assert.equal(meta.setup?.handoff?.launch, command, "the kernel's handoff record is unchanged");
});

test("in the frontend the host opens the table itself, and the guide is told that, not that a line was shown (§98 addendum 10.1)", async (t) => {
	const terminal = await completeSetup(t, "handoff-told-terminal", { app: false });
	const app = await completeSetup(t, "handoff-told-app", { app: true });
	assert.equal(app.table.entries("coc-setup-handoff").length, 1, "the App's handoff entry is written as before");
	assert.ok(!app.table.ui.notifications.some((row) => row.type === "info" && row.message.includes("bin/pi-coc")), "the App shows no command line");
	assert.equal(app.finished.handoff_command, undefined);
	assert.equal(typeof app.finished.handoff_shown, "string");
	assert.ok(!JSON.stringify(app.finished).includes("bin/pi-coc"), "no command in the App's result either");
	assert.notEqual(app.finished.handoff_shown, terminal.finished.handoff_shown,
		"the guide is told which handoff happened: a line shown in the terminal, the table opened in the App");
});

test("the setup prompt tells the guide the handoff is the host's and names the field it is told by (§98 addendum 10.1)", () => {
	const prompt = readFileSync(join(REPO, "prompts/setup.md"), "utf8");
	assert.ok(prompt.includes("`handoff_shown`"), "the guide is told what handoff_shown is for");
	assert.ok(!/launch command/i.test(prompt), "and is never told to read out a launch command");
});

// ---- The retry (§98 addendum 10.2) -----------------------------------------------------------

/** The Haunting's module on disk, as the guidance preparer reads it: one opening, one scene. */
function installGuidanceModule(table) {
	const folder = join(table.workspace, ".coc/modules/the-haunting");
	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, "module.json"), JSON.stringify({ id: "the-haunting", opening: { start_scene: "scene-meeting" } }));
	writeFileSync(join(folder, "module-graph.json"), JSON.stringify({ nodes: [
		{ node_id: "module-the-haunting", node_kind: "module", name: "Prepared source", summary: "An opening meeting." },
		{ node_id: "scene-meeting", node_kind: "scene", name: "The meeting begins.", summary: "An opening meeting." }], relations: [] }));
}

/**
 * The guidance author and reviewer as one fake reader child. Each preparation writes into its own
 * attempt folder (`request.cwd`), so the folders count the preparations. `verdict(attempt)` is the
 * reviewer's answer for the n-th preparation (1-based); `author(attempt, request)` may replace the
 * author's run. The ledger also records how many children ever ran at once.
 */
function withGuidanceChild(table, { verdict, author }) {
	const ledger = { attempts: [], authors: [], reviews: [], running: 0, most: 0 };
	const current = table.runtimeBridges().at(-1);
	table.emit("coc:kernel-bridge", { ...current, runtime: { ...current.runtime, async runTask(task) {
		const request = task.request, review = request.systemPrompt.endsWith("character-guidance-review.md");
		if (!ledger.attempts.includes(request.cwd)) ledger.attempts.push(request.cwd);
		const attempt = ledger.attempts.indexOf(request.cwd) + 1;
		ledger.running++; ledger.most = Math.max(ledger.most, ledger.running);
		try {
			if (review) {
				ledger.reviews.push(attempt);
				const approved = verdict(attempt);
				writeFileSync(join(request.cwd, "review.json"), JSON.stringify({ approved, issues: approved ? [] : ["The opening names a secret."] }));
				return { ok: true };
			}
			ledger.authors.push(attempt);
			if (author) { const outcome = await author(attempt, request); if (outcome) return outcome; }
			writeFileSync(join(request.cwd, "guidance.json"), JSON.stringify({ protocol: "setup-guidance-reference-v2",
				opening: `Who joins the meeting? (draft ${attempt})`, advice: "Choose a fitting investigator.", guide: null, handoff: "Continue the meeting." }));
			return { ok: true };
		} finally { ledger.running--; }
	} } });
	return ledger;
}

const draftProfile = { name: { generated: "Helen" }, occupation: "journalist", age: 29, sex: "female", concept: "A cautious reporter.", own_language: "English" };

test("a draft the reviewer refused is prepared again in the same create-campaign step, which answers with the accepted guidance (§98 addendum 10.2)", async (t) => {
	const table = await openTable({ mode: "setup", campaign: null, responses: [
		setupCall({ step: "choose-source", kind: "starter", module: "the-haunting" }),
		setupCall({ step: "create-campaign", id: "retry-once", title: "Prepared source", play_language: "en" }),
		setupCall({ step: "create-investigator", profile: draftProfile }),
		fauxAssistantMessage("Here is Helen."),
	] });
	t.after(() => table.dispose());
	installGuidanceModule(table);
	const ledger = withGuidanceChild(table, { verdict: (attempt) => attempt >= 2 });

	await table.session.prompt("Start with this prepared source.");
	await waitForIdle(table.session);
	const [, created, drafted] = setupResults(table.session);
	assert.equal(created.ok, true, `the step answers after the retry, with its success: ${JSON.stringify(created)}`);
	assert.equal(created.character_guidance?.opening, "Who joins the meeting? (draft 2)", "the guidance is the retried draft's");
	assert.ok(created.opening_shown, "and the accepted opening is shown, as on any success");
	assert.equal(created.player_reason, undefined, "the player is not asked to wait for anything");
	assert.equal(ledger.attempts.length, 2, "one retry: two preparations");
	assert.deepEqual(ledger.reviews, [1, 1, 2], "the first preparation's two review rounds refused, the retry's first round approved");
	assert.equal(ledger.most, 1, "the retry never runs beside the preparation it retries");
	assert.equal(drafted.ok, true, `nothing blocks the card steps: ${JSON.stringify(drafted)}`);
	assert.deepEqual(table.ui.notifications.filter((row) => row.type === "error"), [], "no failure is announced");
	assert.equal(table.kernelRequests().find((row) => row.method === "setup.prologue")?.params.text, "Who joins the meeting? (draft 2)");

	// The accepted guidance is kept: the next turn prepares nothing, so nothing is paid twice.
	table.faux.setResponses([fauxAssistantMessage("Anything else about Helen?")]);
	await table.session.prompt("She is thirty.");
	await waitForIdle(table.session);
	assert.equal(ledger.attempts.length, 2, "no third preparation on the next turn");
});

test("a draft refused again after the retry answers with SL-100's player_reason, once, and no third preparation runs (§98 addendum 10.2)", async (t) => {
	const table = await openTable({ mode: "setup", campaign: null, responses: [
		setupCall({ step: "choose-source", kind: "starter", module: "the-haunting" }),
		setupCall({ step: "create-campaign", id: "retry-refused", title: "Prepared source", play_language: "en" }),
		fauxAssistantMessage("The introduction could not be prepared this time."),
	] });
	t.after(() => table.dispose());
	installGuidanceModule(table);
	const ledger = withGuidanceChild(table, { verdict: () => false });

	await table.session.prompt("Start with this prepared source.");
	await waitForIdle(table.session);
	const created = setupResults(table.session).at(-1);
	assert.equal(created.ok, false);
	assert.equal(created.code, "guidance_failed", JSON.stringify(created));
	assert.equal(created.cause, "preparation_failed");
	assert.equal(created.player_reason, playerReason({ code: "guidance_failed", cause: "preparation_failed" }), "the player's reason is SL-100's");
	assert.equal(ledger.attempts.length, 2, "the first preparation and one retry, never more");
	assert.deepEqual(ledger.reviews, [1, 1, 2, 2]);
	assert.equal(ledger.most, 1);
	const errors = table.ui.notifications.filter((row) => row.type === "error");
	assert.equal(errors.length, 1, `one notice for the one failure the step answered: ${JSON.stringify(errors)}`);
});

test("a preparation that failed for any other reason is answered at once, not retried (§98 addendum 10.2)", async (t) => {
	const table = await openTable({ mode: "setup", campaign: null, responses: [
		setupCall({ step: "choose-source", kind: "starter", module: "the-haunting" }),
		setupCall({ step: "create-campaign", id: "no-retry", title: "Prepared source", play_language: "en" }),
		fauxAssistantMessage("The introduction could not be prepared this time."),
	] });
	t.after(() => table.dispose());
	installGuidanceModule(table);
	// The author child fails: the preparation is `preparation_failed` too, but no reviewer refused anything.
	const ledger = withGuidanceChild(table, { verdict: () => true, author: async () => ({ ok: false, reason: "reader offline" }) });

	await table.session.prompt("Start with this prepared source.");
	await waitForIdle(table.session);
	const created = setupResults(table.session).at(-1);
	assert.equal(created.code, "guidance_failed", JSON.stringify(created));
	assert.equal(created.cause, "preparation_failed");
	assert.equal(ledger.attempts.length, 1, "a failed reader is not a refused draft: one preparation");
	assert.deepEqual(ledger.reviews, []);
});

test("a stop while the retry runs ends it: its child sees the abort, no reviewer runs and nothing is prepared after it (§98 addendum 10.2)", async (t) => {
	const table = await openTable({ mode: "setup", campaign: null, responses: [
		setupCall({ step: "choose-source", kind: "starter", module: "the-haunting" }),
		setupCall({ step: "create-campaign", id: "retry-stopped", title: "Prepared source", play_language: "en" }),
		fauxAssistantMessage("Stopped."),
	] });
	t.after(() => table.dispose());
	installGuidanceModule(table);
	let retryStarted = false, retrySawStop;
	const ledger = withGuidanceChild(table, { verdict: () => false, author: async (attempt, request) => {
		if (attempt < 2) return undefined;
		retryStarted = true;
		// The retry's author runs until it is stopped (or, if the stop never reaches it, gives up late).
		await new Promise((resolve) => {
			if (request.signal?.aborted) return resolve();
			request.signal?.addEventListener("abort", resolve, { once: true });
			setTimeout(resolve, 8_000).unref();
		});
		retrySawStop = request.signal?.aborted === true;
		return { ok: false, reason: "stopped" };
	} });

	const started = Date.now();
	const run = table.session.prompt("Start with this prepared source.");
	while (!retryStarted && Date.now() - started < 10_000) await new Promise((resolve) => setTimeout(resolve, 10));
	assert.ok(retryStarted, "the refused draft's retry started");
	await table.session.abort();
	await run.catch(() => {});
	await waitForIdle(table.session);

	assert.equal(retrySawStop, true, "the stop reached the retry's child");
	assert.ok(Date.now() - started < 7_000, "the retry ended at the stop, not when its child gave up");
	assert.deepEqual(ledger.reviews, [1, 1], "no reviewer ran for the stopped retry");
	assert.equal(ledger.attempts.length, 2, "and no preparation was started after it");
	const created = setupResults(table.session).at(-1);
	assert.equal(created?.code, "guidance_failed", `the stopped create-campaign still answers: ${JSON.stringify(setupResults(table.session))}`);
	assert.equal(created.ok, false, JSON.stringify(created));
	assert.equal(created.cause, "interrupted", "the step answers the stop, which the player's next line retries");
});

test("a stop that lands after the refusal and before the retry skips it: the step answers the refusal and no second preparation starts (§98 addendum 10.2)", async (t) => {
	const table = await openTable({ mode: "setup", campaign: null, responses: [
		setupCall({ step: "choose-source", kind: "starter", module: "the-haunting" }),
		setupCall({ step: "create-campaign", id: "stop-before-retry", title: "Prepared source", play_language: "en" }),
		fauxAssistantMessage("Stopped."),
	] });
	t.after(() => table.dispose());
	installGuidanceModule(table);
	// The reviewer's second refusal returns; the stop arrives on the next turn of the event loop, while the
	// preparer is still reading that verdict from disk -- after its own last look at the signal, before
	// anything could start the retry.
	const ledger = withGuidanceChild(table, { verdict: () => false });
	const refuse = table.runtimeBridges().at(-1).runtime.runTask;
	table.emit("coc:kernel-bridge", { ...table.runtimeBridges().at(-1), runtime: { ...table.runtimeBridges().at(-1).runtime, async runTask(task, signal) {
		const outcome = await refuse(task, signal);
		if (task.request.systemPrompt.endsWith("character-guidance-review.md") && ledger.reviews.length === 2) setImmediate(() => { void table.session.abort(); });
		return outcome;
	} } });

	const run = table.session.prompt("Start with this prepared source.");
	await run.catch(() => {});
	await waitForIdle(table.session);
	assert.equal(ledger.attempts.length, 1, "no second preparation started after the stop");
	assert.deepEqual(ledger.reviews, [1, 1]);
	const created = setupResults(table.session).at(-1);
	assert.equal(created?.code, "guidance_failed", JSON.stringify(setupResults(table.session)));
	assert.equal(created.cause, "preparation_failed", "the step answers the refusal it had, not a stop of a retry that never ran");
	assert.equal(created.player_reason, playerReason({ code: "guidance_failed", cause: "preparation_failed" }));
});

test("the player's next line prepares with the same one retry at the start of the turn (§98 addendum 10.2)", async (t) => {
	// Turn one creates the campaign before the module is on disk, so nothing is prepared; turn two's
	// start prepares it, and its reviewer refuses the first draft.
	const table = await openTable({ mode: "setup", campaign: null, responses: [
		setupCall({ step: "choose-source", kind: "starter", module: "the-haunting" }),
		setupCall({ step: "create-campaign", id: "retry-at-turn", title: "Prepared source", play_language: "en" }),
		fauxAssistantMessage("The campaign is open. Who are you?"),
	] });
	t.after(() => table.dispose());
	await table.session.prompt("Start with this prepared source.");
	await waitForIdle(table.session);

	installGuidanceModule(table);
	const ledger = withGuidanceChild(table, { verdict: (attempt) => attempt >= 2 });
	table.faux.setResponses([setupCall({ step: "create-investigator", profile: draftProfile }), fauxAssistantMessage("Here is Helen.")]);
	await table.session.prompt("I am Helen, a journalist.");
	await waitForIdle(table.session);
	const drafted = setupResults(table.session).at(-1);
	assert.equal(drafted.ok, true, `the turn is not blocked: ${JSON.stringify(drafted)}`);
	assert.equal(ledger.attempts.length, 2);
	assert.deepEqual(table.ui.notifications.filter((row) => row.type === "error"), []);
});
