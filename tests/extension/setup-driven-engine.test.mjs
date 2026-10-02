/**
 * Contract §151.6 (spec jev-decides-llm-writes D-E, ticket 07): a setup session on the driven engine.
 *
 * The seam is the product's own: a real Pi session on the vendored build with the RunDriver the setup engine builds
 * (`runtime/jev/setup-engine.ts`, policy `coc-setup-v1`), the onboarding extension's real setup tool and executor, the
 * fake kernel, a fake Jev decision port and scripted model steps. What is asserted is what an owner observes: which
 * Jev families were asked, the tools each model request declared, what reached the kernel, and the setup run's own
 * telemetry row.
 */
import { strict as assert } from "node:assert";
import { stream as responsesStream } from "@earendil-works/pi-ai/api/openai-responses";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import { openTable, waitForIdle } from "./harness.mjs";
import { createSetupEngine, SETUP_CARD_TOOL, requireSetupCardTool } from "../../runtime/jev/setup-engine.ts";
import { SETUP_DRIVEN_FALLBACK, SETUP_FIELDS_FAMILY, SETUP_INTEREST_FAMILY, SETUP_ROUTE_FAMILY, cardPlan, fieldsBatch, interestBatches, interestCandidates, interpretInterest,
	interpretRoute, legalMoves, moveGates, routeBatch, setupDrivenBudget, clears } from "../../runtime/jev/setup-decisions.ts";
import { packDecisionBatch } from "../../runtime/jev/question-packing.ts";
import { selectLoopEngine } from "../../runtime/loop-engine.ts";
import { hybridMainOptions } from "../../runtime/pi-hybrid.ts";

const CAMPAIGN = "setup-drive";
/** A catalog with more than one trade: the kernel's §98 shape plus §151.6's characteristics and `listed: false`. */
const CATALOG = {
	occupations: [
		{ id: "Journalist", label: "记者", skills: ["Art and Craft (Photography)", "History", "Library Use", "Psychology"], credit_rating_range: [9, 30], formula: "EDU*4" },
		{ id: "Doctor of Medicine", label: "医生", skills: ["First Aid", "Medicine", "Psychology"], credit_rating_range: [30, 80], formula: "EDU*4" },
		{ id: "Police Detective", label: "警探", skills: ["Law", "Listen", "Spot Hidden"], credit_rating_range: [20, 50], formula: "EDU*2+DEX*2" },
	],
	skills: [
		{ name: "Spot Hidden", label: "侦查" }, { name: "Library Use", label: "图书馆使用" }, { name: "Drive Auto", label: "汽车驾驶" },
		{ name: "Psychology", label: "心理学" }, { name: "Credit Rating", label: "信用评级", listed: false },
		{ name: "Art and Craft (Photography)", label: "艺术与手艺（摄影）" }, { name: "First Aid", label: "急救" }, { name: "Law", label: "法律" },
		{ name: "Stealth", label: "潜行" }, { name: "Listen", label: "聆听" }, { name: "Mechanical Repair", label: "机械维修" },
	],
	characteristics: [{ abbr: "STR", name: "Strength" }, { abbr: "DEX", name: "Dexterity" }, { abbr: "INT", name: "Intelligence" }, { abbr: "POW", name: "Power" }],
	weapons: [".38 Revolver"], language_specialty: "Language (Other: English)",
};
const RESUME = { completed: ["choose-source", "create-campaign"], state: { source_kind: "starter", module_id: "the-haunting", play_language: "zh-Hans", rulebook_eras: ["1920s"] } };

/** A Jev answer for every question of a batch: `set` overrides by key (a skill by its catalog name); the rest say no. */
function answer(batch, set = {}) {
	const answers = {};
	for (const question of batch.questions) {
		let value = set[question.key];
		const skill = /^skills\[(\d+)\]$/.exec(question.target);
		if (value === undefined && skill) {
			// A skill's hold row is set as `hold:<name>`; every other row of that skill as `<name>`.
			const shown = String(batch.state.skills[Number(skill[1])]), prefix = question.key.startsWith("hold_") ? "hold:" : "";
			const name = Object.keys(set).filter((key) => key.startsWith(prefix) && (prefix || !key.startsWith("hold:")))
				.find((key) => shown === key.slice(prefix.length) || shown.endsWith(`(${key.slice(prefix.length)})`));
			value = name === undefined ? undefined : set[name];
		}
		if (question.type === "noul") answers[question.key] = { status: "answered", type: "noul", noul: typeof value === "number" ? value : 0.04 };
		else {
			const keys = Object.keys(question.criteria);
			const choice = typeof value === "string" ? value : keys.includes("not_stated") ? "not_stated" : keys.includes("none") ? "none" : "none_of_above";
			answers[question.key] = { status: "answered", type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 0.9 } };
		}
	}
	return { batchId: batch.id, status: "complete", answers, coverage: { required: Object.keys(answers), answered: Object.keys(answers), unknown: [] }, issues: [] };
}

/** The issued alias range of `word` inside the latest player input, read from the setup prompt's own source catalog. */
function selection(context, word) {
	const prompt = getCurrentSystemPrompt(context.messages);
	const line = prompt.split("\n").find((row) => row.startsWith('{"protocol":"setup-input-reference-v1"'));
	assert.ok(line, "the setup prompt carries the input source catalog");
	const source = JSON.parse(line).sources.findLast((row) => row.text.includes(word));
	const units = source.units, start = units.findIndex((_unit, index) => units.slice(index, index + [...word].length).map((unit) => unit.text).join("") === word);
	return { source: source.alias, range: { first: units[start].alias, last: units[start + [...word].length - 1].alias } };
}

/** A setup table on the driven engine; `requests` logs the tools every model request declared, in order. */
async function drivenSetup({ decide, responses, env = {}, budget, table: options = {} }) {
	const decisions = [], requests = [];
	let decider = decide;
	const engine = createSetupEngine({ env: process.env, ...(budget ? { budget } : {}),
		decision: decide === null ? null : { decide: async (batch, lease) => { decisions.push(batch); return decider(batch, lease); } } });
	const table = await openTable({
		mode: "setup", campaign: CAMPAIGN,
		env: { PI_COC_LOOP_ENGINE: "hybrid-v1", EXT_JEV_APIKEY: undefined, TYPESAFE_API_KEY: undefined,
			FAKE_SETUP_RESUME: JSON.stringify(RESUME), FAKE_SETUP_CATALOG: JSON.stringify(CATALOG), ...env },
		runDriver: engine.runDriver,
		extraExtensions: [{ name: "coc-setup-engine", factory: engine.extension }],
		responses: wrap(responses, requests),
		...options,
	});
	return { table, decisions, requests, respond: (next) => table.faux.setResponses(wrap(next, requests)), decide: (next) => { decider = next; } };
}
const wrap = (responses, requests) => responses.map((respond) => (context) => {
	requests.push(getCurrentTools(context.messages).map((tool) => tool.name).sort());
	return typeof respond === "function" ? respond(context) : respond;
});
const kernel = (table, method) => table.kernelRequests().filter((row) => row.method === method);
const setupRuns = (table) => table.entries("coc-telemetry").filter((row) => row.lane === "setup" && row.event === "run");
const toolResults = (table, name) => table.session.messages.filter((message) => message.role === "toolResult" && message.toolName === name);

const FIRST_INPUT = "我叫艾伦，是自由摄影记者，眼睛尖、擅长查资料。其余的背景和装备都帮我决定，出卡吧。";
/** The route clears the card-field move; the card fields bind a trade outside the catalog and two named skills. */
const cardFieldsJev = (fields, interest = {}) => (batch) => batch.family === SETUP_ROUTE_FAMILY
	? answer(batch, { exit: "continue", move_card_fields: 0.95 })
	: batch.family === SETUP_INTEREST_FAMILY ? answer(batch, interest) : answer(batch, fields);
const FIRST_FIELDS = { occupation: "o0", occupation_stated: 0.96, occupation_outside: 0.9, strong: "INT", "Spot Hidden": 0.93, "Library Use": 0.81, "Drive Auto": 0.2,
	stated_name: 0.97, delegated: 0.92 };
/** The bind step's one call: open words only, the name and the trade words selected from the input, never retyped. */
const bindCallFor = (name) => (context) => fauxAssistantMessage([fauxToolCall(SETUP_CARD_TOOL, { profile: {
	name: selection(context, name), occupation_stated: selection(context, "自由摄影记者"), sex: "男", concept: "开旧皮卡跑新闻的自由摄影记者", own_language: "英语",
	backstory: { personal_description: "瘦高，总背着相机。", significant_people: "纽约的图片编辑玛吉。", meaningful_locations: "西德克萨斯的公路。", scenario_bound: "为专题拍荒漠公路。" },
	key_connection: { backstory_field: "significant_people", summary: "图片编辑玛吉" }, equipment: ["旁轴相机", "旧皮卡"] } })], { stopReason: "toolUse" });
const bindCall = bindCallFor("艾伦");

test("a real bind call executes once without exposing its accompanying argument JSON as prose", async t => {
	const raw = '{"profile":{"name":"working draft"}}';
	const run = await drivenSetup({decide: cardFieldsJev(FIRST_FIELDS), responses: [context => {
		const call = bindCall(context);
		return {...call, content: [{type: "text", text: raw}, ...call.content]};
	}, fauxAssistantMessage("The card is ready.")]});
	t.after(() => run.table.dispose());
	await run.table.session.prompt(FIRST_INPUT);
	await waitForIdle(run.table.session);
	assert.equal(kernel(run.table, "setup.draft").length, 1);
	const bound = run.table.session.messages.find(m => m.role === "assistant" && m.content.some(b => b.type === "toolCall"));
	assert.equal(bound.content.some(block => block.type === "text"), false);
	assert.equal(run.table.entries("coc-setup-output-rejected")[0].message.content[0].text, raw);
	assert.equal(run.table.session.messages.findLast(m => m.role === "assistant").content[0].text, "The card is ready.");
});

test("bind requires the sole native function without changing ordinary or unsupported requests", () => {
	for (const payload of [
		{input: [], tools: [{type: "function", name: SETUP_CARD_TOOL, parameters: {type: "object"}}]},
		{messages: [], tools: [{type: "function", function: {name: SETUP_CARD_TOOL, parameters: {type: "object"}}}]},
	]) {
		const before = structuredClone(payload), result = requireSetupCardTool(payload);
		assert.equal(result.tool_choice, "required");
		assert.equal(result.parallel_tool_calls, false);
		assert.deepEqual(result.tools, payload.tools);
		assert.deepEqual(payload, before);
	}
	for (const payload of [{input: [], tools: []}, {input: [], tools: [{type: "function", name: "setup"}]},
		{input: [], tools: [{type: "function", name: SETUP_CARD_TOOL}, {type: "web_search"}]},
		{messages: [], tools: [{name: SETUP_CARD_TOOL, input_schema: {type: "object"}}]}])
		assert.equal(requireSetupCardTool(payload), undefined);
});

test("bare bind arguments fail explicitly, preserve evidence and do not instruct the following question", async t => {
	const raw = JSON.stringify({profile: {name: {generated: "Alan"}, sex: "male"}});
	const run = await drivenSetup({decide: cardFieldsJev(FIRST_FIELDS), responses: [fauxAssistantMessage(raw)]});
	t.after(() => run.table.dispose());
	await run.table.session.prompt(FIRST_INPUT);
	await waitForIdle(run.table.session);
	assert.equal(kernel(run.table, "setup.draft").length, 0);
	const message = run.table.session.messages.findLast(m => m.role === "assistant");
	assert.equal(message.stopReason, "error");
	assert.equal(message.content.some(block => block.type === "text"), false);
	assert.match(message.errorMessage, /setup_card/);
	assert.equal(setupRuns(run.table).at(-1).reason, "setup_bind_missing_call");
	assert.equal(run.table.entries("coc-setup-output-rejected")[0].message.content[0].text, raw);
	run.decide(batch => answer(batch, {exit: "ask_llm"}));
	run.respond([context => {
		const text = context.messages.flatMap(message => typeof message.content === "string" ? [message.content]
			: (message.content ?? []).filter(block => block.type === "text").map(block => block.text)).join("\n");
		assert.equal(text.includes('"purpose":"bind"'), false);
		assert.deepEqual(getCurrentTools(context.messages).map(tool => tool.name), ["setup"]);
		return fauxAssistantMessage("A private investigator can carry ordinary notebooks.");
	}]);
	await run.table.session.prompt("Can a private investigator carry a notebook?");
	await waitForIdle(run.table.session);
	assert.equal(run.table.session.messages.findLast(m => m.role === "assistant").stopReason, "stop");
	assert.ok(run.table.session.messages.some(m => m.role === "custom" && m.customType === "coc-setup-step"));
	assert.deepEqual(run.table.extensionErrors, []);
});

test("the real Responses converter and setup hook require bind, then release the compose request", async () => {
	const engine = createSetupEngine({env: {}, decision: null}), handlers = new Map(), tools = [];
	engine.extension({events: {on() {}}, registerTool: tool => tools.push(tool), on: (name, fn) => handlers.set(name, fn),
		getAllTools: () => tools, setActiveTools() {}, appendEntry() {}});
	const run = await engine.runDriver.prepare({session: {sessionId: "request-probe"}, runId: "request-probe"});
	const model = {api: "openai-responses", provider: "grok-build", id: "grok-4.7-build-fast", baseUrl: "https://example.invalid/v1",
		input: ["text"], reasoning: true, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}, contextWindow: 256000, maxTokens: 16384};
	for (const purpose of ["bind", "compose"]) {
		await run.ports.projection.project({step: {kind: "infer", purpose, reason: "request-probe", request: {}}, stepId: purpose});
		const messages = [{role: "system", content: "Setup", timestamp: 0},
			{role: "user", content: [{type: "text", text: "Make the card."}], timestamp: 1}];
		const projected = handlers.get("context_with_system")({messages})?.messages ?? messages;
		let payload;
		const stream = responsesStream(model, {messages: projected}, {apiKey: "fixture", onPayload: value => {
			payload = handlers.get("before_provider_request")({payload: value}) ?? value;
			throw new Error("Captured before network");
		}, fetch: () => {throw new Error("No network is allowed");}});
		await stream.result();
		assert.ok(payload);
		assert.deepEqual(payload.tools?.map(tool => tool.name) ?? [], purpose === "bind" ? [SETUP_CARD_TOOL] : []);
		assert.equal(payload.tool_choice, purpose === "bind" ? "required" : undefined);
	}
});

for (const stopReason of ["error", "aborted", "length"]) test(`bind preserves the provider's ${stopReason} outcome`, async t => {
	const response = fauxAssistantMessage("Partial output", {stopReason, ...(stopReason === "error" ? {errorMessage: "Provider rejected request"} : {})});
	const run = await drivenSetup({decide: cardFieldsJev(FIRST_FIELDS), responses: [response]});
	t.after(() => run.table.dispose());
	await run.table.session.prompt(FIRST_INPUT);
	await waitForIdle(run.table.session);
	assert.equal(run.table.session.messages.findLast(m => m.role === "assistant").stopReason, stopReason);
	assert.equal(run.table.entries("coc-setup-output-rejected").length, 0);
	assert.equal(kernel(run.table, "setup.draft").length, 0);
});

test("§151.6: a trade outside the catalog binds the closest catalog occupation, the player's words are copied to occupation_stated, named skills bind by Noul, numbers stay the kernel's, and only the narrowed tool writes the open words", async (t) => {
	const run = await drivenSetup({ decide: cardFieldsJev(FIRST_FIELDS), responses: [bindCall, fauxAssistantMessage("艾伦的卡已经放在桌上了。")] });
	t.after(() => run.table.dispose());
	await run.table.session.prompt(FIRST_INPUT);
	await waitForIdle(run.table.session);
	const { table, decisions, requests } = run;
	assert.deepEqual(table.extensionErrors, []);
	assert.equal(table.session.runEngine, "hybrid-v1");

	assert.deepEqual(decisions.map((batch) => batch.family), [SETUP_ROUTE_FAMILY, SETUP_FIELDS_FAMILY, SETUP_INTEREST_FAMILY],
		"one route, the card fields, then (a delegated card with points left) the interest fit");
	// D2 hygiene: one Noul per legal move plus the exit Choice; the catalog skills a list never holds are not offered.
	assert.deepEqual(decisions[0].questions.map((question) => question.key), ["move_card_fields", "exit"]);
	assert.ok(!JSON.stringify(decisions[1].state.skills).includes("Credit Rating"), "Credit Rating is never offered as a named skill");

	assert.deepEqual(requests, [[SETUP_CARD_TOOL], []], "bind declares only the narrowed tool; compose declares none");
	const [draft] = kernel(table, "setup.draft");
	assert.ok(draft, "the card was drawn through the setup step executor");
	const profile = draft.params.profile;
	assert.equal(profile.occupation, "Journalist", "the closest catalog trade, bound by Jev");
	assert.equal(profile.occupation_stated, "自由摄影记者", "the player's own words, copied by the host from the input alias");
	assert.equal(profile.name, "艾伦", "the name is the player's selected words");
	assert.deepEqual(profile.occupation_skills, ["Spot Hidden", "Library Use"], "named skills in the order of their Noul");
	assert.deepEqual(profile.aptitude, { strong: ["INT"], weak: [], origin: "player" });
	for (const key of ["numbers", "limits", "auto_spread"]) assert.ok(!Object.hasOwn(draft.params, key), `no ${key}: every number is the kernel's default`);
	assert.equal(kernel(table, "setup.confirm").length, 0, "the policy never confirms");

	const [row] = setupRuns(table);
	assert.ok(row, "the run wrote its setup telemetry row");
	assert.equal(row.policy, "coc-setup-v1");
	assert.deepEqual(row.families, [SETUP_ROUTE_FAMILY, SETUP_FIELDS_FAMILY, SETUP_INTEREST_FAMILY]);
	assert.deepEqual(row.model_steps, { bind: 1, compose: 1, adjudicate: 0 });
	const path = (field) => row.bound.find((entry) => entry.field === field)?.path;
	assert.equal(path("occupation"), "jev");
	assert.equal(path("occupation_skills"), "jev");
	assert.equal(path("occupation_stated"), "stated");
	assert.equal(path("characteristics"), "rule-default");
	assert.equal(path("credit_rating"), "rule-default");
	assert.equal(row.fallback, null);
});

test("§151.6: a stated catalog occupation on the card binds without a model call; the one model step is the reply, with no tool", async (t) => {
	const run = await drivenSetup({ decide: cardFieldsJev(FIRST_FIELDS), responses: [bindCall, fauxAssistantMessage("卡好了。")] });
	t.after(() => run.table.dispose());
	await run.table.session.prompt(FIRST_INPUT);
	await waitForIdle(run.table.session);
	run.decisions.length = 0; run.requests.length = 0;
	run.respond([fauxAssistantMessage("好，艾伦现在是警探。")]);
	run.decide(cardFieldsJev({ occupation: "o2", occupation_stated: 0.95 }));
	await run.table.session.prompt("其实他是个警探。");
	await waitForIdle(run.table.session);
	const { table, requests } = run;
	assert.deepEqual(run.decisions.map((batch) => batch.family), [SETUP_ROUTE_FAMILY, SETUP_FIELDS_FAMILY]);
	assert.ok(run.decisions[0].questions.some((question) => question.key === "move_approve_card"), "with a card on the table, approval is a legal move too");
	assert.deepEqual(requests, [[]], "one model request, the reply, with no tool");
	const revisions = kernel(table, "setup.revise");
	assert.equal(revisions.length, 1);
	assert.deepEqual(revisions[0].params.profile, { occupation: "Police Detective" }, "the bound trade, and nothing the model wrote");
	const last = setupRuns(table).at(-1);
	assert.deepEqual(last.model_steps, { bind: 0, compose: 1, adjudicate: 0 });
	assert.equal(last.plan, "direct");
	assert.equal(kernel(table, "setup.confirm").length, 0);
});

test("a compose reply's commentary-phase preambles are the guide's working: kept as evidence, off the reply; a reply of commentary alone stands", async (t) => {
	// Installed App, 2026-10-02: in a step with no tool, gpt-6-luna wrote four English preambles ("**Recording the
	// strengths ...**") marked phase "commentary" ahead of its Chinese reply, and the player read all five.
	const phase = (text, value) => ({ type: "text", text, textSignature: JSON.stringify({ v: 1, id: `msg_${value}_${text.length}`, phase: value }) });
	const reply = fauxAssistantMessage("卡好了。");
	const run = await drivenSetup({ decide: cardFieldsJev(FIRST_FIELDS), responses: [bindCall, reply] });
	t.after(() => run.table.dispose());
	await run.table.session.prompt(FIRST_INPUT);
	await waitForIdle(run.table.session);
	const before = run.table.entries("coc-setup-output-rejected").length;
	run.respond([{ ...fauxAssistantMessage("x"), content: [phase("**Recording the strengths.**", "commentary"), phase("**Noting the trade.**", "commentary"),
		phase("好，艾伦现在是警探。", "final_answer")] }]);
	run.decide(cardFieldsJev({ occupation: "o2", occupation_stated: 0.95 }));
	await run.table.session.prompt("其实他是个警探。");
	await waitForIdle(run.table.session);
	const last = run.table.session.messages.findLast((message) => message.role === "assistant");
	assert.deepEqual(last.content.filter((block) => block.type === "text").map((block) => block.text), ["好，艾伦现在是警探。"]);
	const evidence = run.table.entries("coc-setup-output-rejected").slice(before);
	assert.equal(evidence.length, 1);
	assert.equal(evidence[0].reason, "setup_commentary_text");
	assert.deepEqual(evidence[0].message.content.map((block) => block.text), ["**Recording the strengths.**", "**Noting the trade.**", "好，艾伦现在是警探。"]);
	// Commentary alone is left as it is: the player is never handed an empty reply.
	run.respond([{ ...fauxAssistantMessage("x"), content: [phase("只有一句。", "commentary")] }]);
	run.decide(cardFieldsJev({ occupation: "o1", occupation_stated: 0.95 }));
	await run.table.session.prompt("还是改成医生吧。");
	await waitForIdle(run.table.session);
	assert.deepEqual(run.table.session.messages.findLast((message) => message.role === "assistant").content.map((block) => block.text), ["只有一句。"]);
});

test("§151.6: an open field on the card goes through the narrowed tool, which refuses a closed key with the open keys and the bound values; the refusal goes to the full tool", async (t) => {
	const run = await drivenSetup({ decide: cardFieldsJev(FIRST_FIELDS), responses: [bindCall, fauxAssistantMessage("卡好了。")] });
	t.after(() => run.table.dispose());
	await run.table.session.prompt(FIRST_INPUT);
	await waitForIdle(run.table.session);
	run.requests.length = 0;
	const revisionsBefore = kernel(run.table, "setup.revise").length;
	run.decide(cardFieldsJev({ stated_sex: 0.94 }));
	run.respond([
		fauxAssistantMessage([fauxToolCall(SETUP_CARD_TOOL, { profile: { sex: "女", occupation: "Doctor of Medicine" } })], { stopReason: "toolUse" }),
		fauxAssistantMessage("我来确认一下：你想让她是医生吗？"),
	]);
	await run.table.session.prompt("她其实是女性。");
	await waitForIdle(run.table.session);
	const { table, requests } = run;
	assert.deepEqual(requests, [[SETUP_CARD_TOOL], ["setup"]], "bind first; the refused call hands the step to the full tool");
	const refused = toolResults(table, SETUP_CARD_TOOL).at(-1).details;
	assert.equal(refused.ok, false);
	assert.equal(refused.code, "closed_key");
	assert.deepEqual(refused.refused, ["occupation"]);
	assert.deepEqual(refused.open_keys, ["sex"], "the step's open keys are the candidates");
	assert.equal(kernel(table, "setup.revise").length, revisionsBefore, "a refused call executes nothing");
	const last = setupRuns(table).at(-1);
	assert.deepEqual(last.model_steps, { bind: 1, compose: 0, adjudicate: 1 });
	assert.equal(last.fallback, "bind_refused");
	assert.ok(last.refusals.some((entry) => entry.code === "closed_key"));
});

test("§151.6: a question routes to adjudicate with today's full setup tool, and no card field is asked", async (t) => {
	const run = await drivenSetup({ decide: (batch) => answer(batch, { exit: "ask_llm" }), responses: [fauxAssistantMessage("可以带，但1920年代的枪支要看职业。")] });
	t.after(() => run.table.dispose());
	await run.table.session.prompt("调查员能带枪吗？");
	await waitForIdle(run.table.session);
	assert.deepEqual(run.decisions.map((batch) => batch.family), [SETUP_ROUTE_FAMILY]);
	assert.deepEqual(run.requests, [["setup"]]);
	const [row] = setupRuns(run.table);
	assert.equal(row.fallback, "ask_llm");
	assert.deepEqual(row.model_steps, { bind: 0, compose: 0, adjudicate: 1 });
});

const legacyCard = fauxAssistantMessage([fauxToolCall("setup", { step: "create-investigator", profile: { name: { generated: "Alan" }, occupation: "Journalist", sex: "male",
	concept: "a photographer", own_language: "English", backstory: { personal_description: "tall", significant_people: "an editor", meaningful_locations: "the road", scenario_bound: "a job" },
	key_connection: { backstory_field: "significant_people", summary: "an editor" }, equipment: ["camera"] } })], { stopReason: "toolUse" });

for (const [label, decide] of [
	["a Jev outage", () => ({ batchId: "b", status: "unavailable", answers: {}, coverage: { required: [], answered: [], unknown: [] }, issues: [], failure: { code: "service_error", retryable: true } })],
	["no Jev at all", null],
]) test(`§151.6: ${label} runs today's model-led setup: the full tool, the model's own call, no narrowed step`, async (t) => {
	const run = await drivenSetup({ decide, responses: [legacyCard, fauxAssistantMessage("Alan is on the card.")] });
	t.after(() => run.table.dispose());
	await run.table.session.prompt("Make me a journalist called Alan.");
	await waitForIdle(run.table.session);
	assert.deepEqual(run.requests, [["setup"], ["setup"]], "every request has the full setup tool, as the legacy loop does");
	assert.equal(kernel(run.table, "setup.draft")[0]?.params.profile.occupation, "Journalist", "the model's own setup call reached the kernel");
	assert.equal(toolResults(run.table, SETUP_CARD_TOOL).length, 0);
	assert.equal(run.table.session.messages.filter((message) => message.role === "custom" && message.customType === "coc-setup-step").length, 0,
		"the fallback adds no note: the model reads today's request");
	const [row] = setupRuns(run.table);
	assert.equal(row.fallback, decide ? "jev_service_error" : "jev_unavailable");
	assert.deepEqual(row.model_steps, { bind: 0, compose: 0, adjudicate: 2 });
});

test("§151.6: approving the card is never the policy's: the route hands it to the full tool, and nothing confirms unless the Keeper does", async (t) => {
	const run = await drivenSetup({ decide: cardFieldsJev(FIRST_FIELDS), responses: [bindCall, fauxAssistantMessage("卡好了。")] });
	t.after(() => run.table.dispose());
	await run.table.session.prompt(FIRST_INPUT);
	await waitForIdle(run.table.session);
	run.requests.length = 0; run.decisions.length = 0;
	run.decide((batch) => answer(batch, { exit: "continue", move_approve_card: 0.96 }));
	run.respond([fauxAssistantMessage("好的，我们开始吧。")]);
	await run.table.session.prompt("可以，就这样开始吧。");
	await waitForIdle(run.table.session);
	assert.deepEqual(run.decisions.map((batch) => batch.family), [SETUP_ROUTE_FAMILY], "approval asks no card field");
	assert.deepEqual(run.requests, [["setup"]], "the Keeper gets the full tool for the approval");
	assert.equal(kernel(run.table, "setup.confirm").length, 0, "the policy never issues setup.confirm");
	const note = run.table.session.messages.filter((message) => message.role === "custom" && message.customType === "coc-setup-step").at(-1);
	assert.equal(JSON.parse(note.content).reason, "approve_card");
	assert.equal(setupRuns(run.table).at(-1).fallback, "approve_card");
});

test("§151.6: setup is driven only with a Jev key and no explicit legacy switch, and the hybrid entry gives it the setup policy, never the play one", async () => {
	const key = { EXT_JEV_APIKEY: "fixture" };
	assert.equal(selectLoopEngine(key, "setup"), "hybrid-v1");
	assert.equal(selectLoopEngine({ ...key, PI_COC_LOOP_ENGINE: "hybrid-v1" }, "setup"), "hybrid-v1");
	assert.equal(selectLoopEngine({ ...key, PI_COC_LOOP_ENGINE: "legacy" }, "setup"), "legacy", "the env switch keeps legacy reachable");
	assert.equal(selectLoopEngine({ PI_COC_LOOP_ENGINE: "hybrid-v1" }, "setup"), "legacy", "no Jev, nothing to drive setup");
	assert.equal(selectLoopEngine({}, "setup"), "legacy");
	assert.equal(selectLoopEngine({ ...key, PI_COC_JEV_S0: "1" }, "setup"), "legacy");
	assert.equal(selectLoopEngine({ PI_COC_LOOP_ENGINE: "hybrid-v1" }, "play"), "hybrid-v1", "play keeps its own rule");
	const setup = hybridMainOptions({ PI_COC_MODE: "setup", PI_COC_LOOP_ENGINE: "hybrid-v1" });
	assert.deepEqual(setup.extensionFactories.map((entry) => entry.name), ["coc-setup-engine"]);
	const plan = await setup.runDriver.prepare({ runId: "r", inputRevision: "i", rawInput: "", session: { sessionId: "s" } });
	assert.equal(plan.policy.name, "coc-setup-v1");
	const play = hybridMainOptions({ PI_COC_MODE: "play", PI_COC_LOOP_ENGINE: "hybrid-v1" });
	assert.deepEqual(play.extensionFactories.map((entry) => entry.name), ["coc-hybrid-engine"]);
});

/** A setup read as the onboarding extension issues it, for the pure decisions. */
function read(overrides = {}) {
	return { ready: true, blocked: null, complete: false, campaign: CAMPAIGN, created: true, next: "create-investigator", allowed: ["create-investigator"],
		completed: ["choose-source", "create-campaign"], source_kind: "starter", investigator_source: null,
		steps: { choose: "choose-source", create: "create-campaign", draft: "create-investigator", confirm: "confirm-investigator", browse: "browse-library", load: "load-investigator" },
		card: null, confirmed: false, loaded: false, brief_holds: false, sources: [], openings: null, library: [],
		catalog: { occupations: CATALOG.occupations, skills: CATALOG.skills, characteristics: CATALOG.characteristics }, eras: ["1920s"],
		input: { key: "k", text: FIRST_INPUT }, play_language: "zh-Hans", ...overrides };
}
const scope = { owner: "setup", campaign: CAMPAIGN, audience: "keeper" };
const fields = (overrides = {}) => ({ outside: false, skills: [], stated: [], delegated: false, numbers: false, removal: false, reason: "fields", ...overrides });

test("§151.6: the families keep D2's hygiene: a Noul per issued move with the exit Choice, a Noul per listable catalog skill, and the full batch packs", () => {
	assert.deepEqual(legalMoves(read()), ["card_fields"]);
	assert.deepEqual(legalMoves(read({ brief_holds: true })), ["draft_now"], "a package brief still asking holds card_fields; only asking for the card is a move");
	assert.deepEqual(legalMoves(read({ card: { revision: 1, summary: {}, profile: {} } })), ["card_fields", "approve_card"]);
	assert.deepEqual(legalMoves(read({ completed: [], created: false, sources: [{ kind: "starter", module: "the-haunting" }] })), ["choose_source"]);
	const route = routeBatch({ read: read({ card: { revision: 1, summary: {}, profile: {} } }), scope, readSet: [] });
	assert.deepEqual(route.questions.map((question) => [question.key, question.type]),
		[["move_card_fields", "noul"], ["move_approve_card", "noul"], ["exit", "choice"]]);
	assert.deepEqual(Object.keys(route.questions.at(-1).criteria), ["continue", "ask_llm", "none_of_above"], "the exit is never a pick-one over the moves");
	// The real catalog's size: 28 trades and 79 skills (two never listed) still pack into one request.
	const big = read({ catalog: { occupations: Array.from({ length: 28 }, (_, index) => ({ id: `Occupation ${index}`, label: `职业${index}` })),
		skills: Array.from({ length: 79 }, (_, index) => ({ name: `Skill ${index}`, label: `技能${index}`, ...(index < 2 ? { listed: false } : {}) })),
		characteristics: CATALOG.characteristics } });
	const batch = fieldsBatch({ read: big, scope, readSet: [] });
	assert.equal(batch.questions.filter((question) => question.key.startsWith("skill_")).length, 77);
	assert.doesNotThrow(() => packDecisionBatch(batch));
});

test("§151.6: the card plan: stated numbers and removals are the full tool's; a first card binds open words, waits for a name, or needs a trade; closed fields alone revise directly", () => {
	const journalist = { id: "Journalist", label: "记者" };
	assert.equal(cardPlan(read(), fields({ occupation: journalist, numbers: true })).kind, "adjudicate");
	const card = { revision: 2, summary: { card: { occupation: "Journalist" } }, profile: { occupation: "Journalist", occupation_skills: ["History", "Library Use"], interest_skills: ["Dodge"] } };
	assert.equal(cardPlan(read({ card }), fields({ removal: true })).reason, "removal");
	assert.deepEqual(cardPlan(read(), fields()), { kind: "compose", missing: ["occupation"], bound: [] }, "no trade stated: the Keeper asks");
	assert.equal(cardPlan(read(), fields({ delegated: true })).reason, "delegated_trade", "inventing a trade is the full tool's");
	assert.deepEqual(cardPlan(read(), fields({ occupation: journalist })).kind, "compose", "a first card waits for a name unless the player delegated");
	const first = cardPlan(read(), fields({ occupation: journalist, outside: true, stated: ["name"], skills: [{ name: "Spot Hidden", noul: 0.9 }] }));
	assert.equal(first.kind, "bind");
	assert.ok(first.required.includes("occupation_stated") && first.required.includes("backstory"));
	assert.deepEqual(first.closed, { occupation: "Journalist", occupation_skills: ["Spot Hidden"] });
	// On a drawn card a named skill already listed moves to the front; an unlisted one leads the interest list.
	const revise = cardPlan(read({ card }), fields({ skills: [{ name: "Library Use", noul: 0.9 }, { name: "Spot Hidden", noul: 0.8 }] }));
	assert.deepEqual(revise, { kind: "direct", profile: { occupation_skills: ["Library Use", "History"], interest_skills: ["Spot Hidden", "Dodge"] },
		bound: [{ field: "occupation_skills", path: "jev", value: ["Library Use", "History"] }, { field: "interest_skills", path: "jev", value: ["Spot Hidden", "Dodge"] }] });
	assert.equal(cardPlan(read({ card }), fields({ occupation: journalist })).reason, "nothing_bound", "the trade the card already has is no change");
	assert.deepEqual(cardPlan(read({ card }), fields({ stated: ["age"] })).open, ["age"]);
});

test("§151.6: a listed starter the player chooses runs choose-source and the host's own continuation, then one reply with no tool", async (t) => {
	const run = await drivenSetup({ decide: (batch) => answer(batch, { exit: "continue", move_choose_source: 0.95, source: "s0", language_change: 0.03 }),
		responses: [fauxAssistantMessage("好，我们用《the-haunting》开局。")], env: { FAKE_SETUP_RESUME: undefined } });
	t.after(() => run.table.dispose());
	await run.table.session.prompt("就玩 the-haunting 吧。");
	await waitForIdle(run.table.session);
	const { table } = run;
	assert.deepEqual(run.decisions.map((batch) => batch.family), [SETUP_ROUTE_FAMILY]);
	assert.deepEqual(run.decisions[0].state.sources.map((row) => row.kind), ["starter", "module"], "the kernel's starters and its installed modules are the listed sources");
	assert.deepEqual(run.decisions[0].state.sources[0], { key: "s0", name: "the-haunting", kind: "starter" });
	assert.deepEqual(run.requests, [[]], "the move is the host's; the one model step is the reply");
	const [created] = kernel(table, "campaign.create");
	assert.equal(created?.params.id, CAMPAIGN, "create-campaign ran with the known campaign id");
	assert.equal(created.params.module, "the-haunting");
	assert.equal(setupRuns(table)[0].move, "choose_source");
});

test("§151.6: a route move clears only on its own Noul and target; a different play language stays the Keeper's", () => {
	const fresh = read({ completed: [], created: false, sources: [{ kind: "starter", module: "the-haunting" }] });
	const batch = routeBatch({ read: fresh, scope, readSet: [] });
	const chosen = interpretRoute(fresh, answer(batch, { exit: "continue", move_choose_source: 0.95, source: "s0", language_change: 0.03 }), SETUP_DRIVEN_FALLBACK);
	assert.deepEqual([chosen.move, chosen.target], ["choose_source", { kind: "source", source: { kind: "starter", module: "the-haunting" } }]);
	assert.equal(interpretRoute(fresh, answer(batch, { exit: "continue", move_choose_source: 0.95, source: "s0", language_change: 0.8 }), SETUP_DRIVEN_FALLBACK).reason, "language_change");
	assert.equal(interpretRoute(fresh, answer(batch, { exit: "continue", move_choose_source: 0.4, source: "s0", language_change: 0.03 }), SETUP_DRIVEN_FALLBACK).reason, "move_below_gate");
	assert.equal(interpretRoute(fresh, answer(batch, { exit: "continue", move_choose_source: 0.95, language_change: 0.03 }), SETUP_DRIVEN_FALLBACK).reason, "source_below_gate");
	const drawn = read({ card: { revision: 1, summary: {}, profile: {} } });
	assert.equal(interpretRoute(drawn, answer(routeBatch({ read: drawn, scope, readSet: [] }), { move_card_fields: 0.9, move_approve_card: 0.9 }), SETUP_DRIVEN_FALLBACK).reason,
		"several_moves", "an input that both changes and approves the card is the Keeper's");
	const opening = read({ openings: [{ scene: "source-entry-16", name: "The highway" }, { scene: "source-entry-30", name: "The town" }] });
	const picked = interpretRoute(opening, answer(routeBatch({ read: opening, scope, readSet: [] }), { exit: "continue", move_pick_opening: 0.9, opening: "o1" }), SETUP_DRIVEN_FALLBACK);
	assert.deepEqual(picked.target, { kind: "opening", opening: { scene: "source-entry-30", name: "The town" } });
	const library = read({ library: [{ library_id: "ada-1", name: "Ada" }] });
	assert.ok(legalMoves(library).includes("load_library"));
	const loaded = interpretRoute(library, answer(routeBatch({ read: library, scope, readSet: [] }), { exit: "continue", move_load_library: 0.9, library: "l0" }), SETUP_DRIVEN_FALLBACK);
	assert.deepEqual(loaded.target, { kind: "library", entry: { library_id: "ada-1", name: "Ada" } });
});

// ---- §151.6 decision 9: setup-interest-fit v1 ---------------------------------------------------------------------

const fitStateSkills = (batch) => batch.state.skills.map((shown) => /\(([^()]+(?:\([^()]*\))?)\)$/.exec(shown)?.[1] ?? shown);
const interestRevisions = (table) => kernel(table, "setup.revise").filter((row) => Array.isArray(row.params.profile?.interest_skills));

test("§151.6 interest fit: a delegated card gets the cleared skills in probability order, capped by data, through one direct revise and no extra model request", async (t) => {
	const run = await drivenSetup({ budget: { ...SETUP_DRIVEN_FALLBACK, interestSkillMax: 2 },
		decide: cardFieldsJev(FIRST_FIELDS, { exists: 0.93, "Drive Auto": 0.9, Stealth: 0.72, Listen: 0.81, Law: 0.2 }),
		responses: [bindCall, fauxAssistantMessage("艾伦的卡好了。")] });
	t.after(() => run.table.dispose());
	await run.table.session.prompt(FIRST_INPUT);
	await waitForIdle(run.table.session);
	const { table, decisions, requests } = run;
	const fit = decisions.filter((batch) => batch.family === SETUP_INTEREST_FAMILY);
	assert.equal(fit.length, 1, "one fan-out");
	const offered = fit.flatMap(fitStateSkills);
	for (const never of ["Spot Hidden", "Library Use", "Psychology", "Art and Craft (Photography)", "Credit Rating"])
		assert.ok(!offered.includes(never), `${never} is on the card, the trade's own, or never listed: not a candidate`);
	assert.deepEqual(offered.sort(), ["Drive Auto", "First Aid", "Law", "Listen", "Mechanical Repair", "Stealth"]);
	assert.deepEqual(Object.keys(fit[0].state), ["investigator", "player_input", "skills"], "state is the card's words, the player's own words and the candidates (D2.3)");
	assert.equal(fit[0].state.investigator.concept, "开旧皮卡跑新闻的自由摄影记者", "the fit reads the bind step's words");
	const [revise] = interestRevisions(table);
	assert.deepEqual(revise.params.profile, { interest_skills: ["Drive Auto", "Listen"] }, "cleared skills, strongest first, cut at interest_skill_max");
	assert.equal(revise.params.auto_spread, true, "the kernel spreads the points; no number comes from Jev or the model");
	assert.deepEqual(requests, [[SETUP_CARD_TOOL], []], "no extra model request");
	const [row] = setupRuns(table);
	assert.deepEqual(row.bound.find((entry) => entry.field === "interest_skills"), { field: "interest_skills", path: "jev", value: ["Drive Auto", "Listen"] });
	const note = JSON.parse(table.session.messages.filter((message) => message.role === "custom" && message.customType === "coc-setup-step").at(-1).content);
	assert.equal(note.interest.status, "set");
	assert.equal(note.interest.revised, true);
	assert.deepEqual(note.interest.values, { "Drive Auto": 40, Listen: 40 }, "the reply is told the exact skills raised and their values");
	assert.match(note.interest_note, /exactly these interest skills.*Drive Auto, Listen/);
});

test("§151.6 interest fit: a skill the player asked to keep at its starting value is never picked, whatever its fit, and the reply is told it was held", async (t) => {
	const input = "我叫艾伦，是自由摄影记者，驾驶保留基础值，其余都帮我决定，出卡吧。";
	const run = await drivenSetup({ decide: cardFieldsJev(FIRST_FIELDS, { exists: 0.9, "Drive Auto": 0.95, "hold:Drive Auto": 0.9, Listen: 0.8 }),
		responses: [bindCall, fauxAssistantMessage("艾伦的卡好了，驾驶保持基础值。")] });
	t.after(() => run.table.dispose());
	await run.table.session.prompt(input);
	await waitForIdle(run.table.session);
	const fit = run.decisions.find((batch) => batch.family === SETUP_INTEREST_FAMILY);
	assert.equal(fit.state.player_input, input, "the hold is judged on the player's own words");
	assert.ok(fit.questions.some((question) => question.key.startsWith("hold_") && /Drive Auto/.test(question.instructions)), "one hold row per candidate, naming the skill");
	const [revise] = interestRevisions(run.table);
	assert.deepEqual(revise.params.profile, { interest_skills: ["Listen"] }, "the held skill is not raised");
	const note = JSON.parse(run.table.session.messages.filter((message) => message.role === "custom" && message.customType === "coc-setup-step").at(-1).content);
	assert.deepEqual(note.interest.held, ["Drive Auto"]);
	assert.match(note.interest_note, /keep Drive Auto at the starting value/);
});

test("§151.6 interest fit: nothing cleared leaves the points unspent, no revise, and the reply is told the points remain", async (t) => {
	const run = await drivenSetup({ decide: cardFieldsJev(FIRST_FIELDS, { exists: 0.9, "Drive Auto": 0.3, Listen: 0.2 }),
		responses: [bindCall, fauxAssistantMessage("卡好了，兴趣点还没分。")] });
	t.after(() => run.table.dispose());
	await run.table.session.prompt(FIRST_INPUT);
	await waitForIdle(run.table.session);
	assert.equal(interestRevisions(run.table).length, 0, "nothing is invented");
	assert.deepEqual(run.requests, [[SETUP_CARD_TOOL], []]);
	const note = JSON.parse(run.table.session.messages.filter((message) => message.role === "custom" && message.customType === "coc-setup-step").at(-1).content);
	assert.equal(note.interest.status, "none_cleared");
	assert.equal(note.interest.points_left, 90);
	assert.match(note.interest_note, /still unspent/);
});

test("§151.6 interest fit: a card the player did not delegate never asks the family", async (t) => {
	const run = await drivenSetup({ decide: cardFieldsJev({ ...FIRST_FIELDS, delegated: 0.05 }, { exists: 0.95, "Drive Auto": 0.95 }),
		responses: [bindCall, fauxAssistantMessage("卡好了。")] });
	t.after(() => run.table.dispose());
	await run.table.session.prompt(FIRST_INPUT);
	await waitForIdle(run.table.session);
	assert.deepEqual(run.decisions.map((batch) => batch.family), [SETUP_ROUTE_FAMILY, SETUP_FIELDS_FAMILY]);
	assert.equal(interestRevisions(run.table).length, 0);
});

test("§151.6 interest fit: an outage leaves the card unchanged and the reply says the points remain; no model picks skills", async (t) => {
	const outage = { batchId: "b", status: "unavailable", answers: {}, coverage: { required: [], answered: [], unknown: [] }, issues: [], failure: { code: "service_error", retryable: true } };
	const run = await drivenSetup({ decide: (batch) => batch.family === SETUP_INTEREST_FAMILY ? outage : cardFieldsJev(FIRST_FIELDS)(batch),
		responses: [bindCall, fauxAssistantMessage("卡好了。")] });
	t.after(() => run.table.dispose());
	await run.table.session.prompt(FIRST_INPUT);
	await waitForIdle(run.table.session);
	assert.equal(interestRevisions(run.table).length, 0, "the card is unchanged");
	assert.deepEqual(run.requests, [[SETUP_CARD_TOOL], []], "no fallback to the model");
	const note = JSON.parse(run.table.session.messages.filter((message) => message.role === "custom" && message.customType === "coc-setup-step").at(-1).content);
	assert.equal(note.interest.status, "unavailable");
	assert.match(note.interest_note, /still unspent/);
	assert.equal(setupRuns(run.table)[0].model_steps.adjudicate, 0);
});

test("§151.6 interest fit: candidates exclude listed, printed and unlisted skills; a batch too large to pack splits into one fan-out with exists on the first; the gate and cap are data", () => {
	const card = { revision: 1, era: "1920s", summary: { card: { occupation: "Journalist" }, budget: { interest: { unspent: 60 } } },
		profile: { occupation: "Journalist", concept: "a photographer", backstory: { traits: "quiet" }, occupation_skills: ["Spot Hidden"], interest_skills: ["Law"] } };
	const drawn = read({ card });
	assert.deepEqual(interestCandidates(drawn).map((row) => row.name).sort(), ["Drive Auto", "First Aid", "Listen", "Mechanical Repair", "Stealth"]);
	const pack = (batch) => { if (batch.questions.length > 3) throw new Error("packing_limit"); };
	const batches = interestBatches({ read: drawn, scope, readSet: [] }, pack);
	assert.ok(batches.length > 1, "split");
	assert.deepEqual(batches.map((batch) => batch.questions.filter((question) => question.key === "exists").length), [1, ...batches.slice(1).map(() => 0)]);
	assert.equal(new Set(batches.flatMap((batch) => batch.questions.map((question) => question.key))).size, 11, "five fit rows, five hold rows and exists, unique across the fan-out");
	const results = batches.map((batch) => answer(batch, { exists: 0.9, Listen: 0.95, Stealth: 0.8, "First Aid": 0.85 }));
	assert.deepEqual(interpretInterest(drawn, results, { ...SETUP_DRIVEN_FALLBACK, interestSkillMax: 2 }).skills, ["Listen", "First Aid"]);
	assert.deepEqual(interpretInterest(drawn, results, { ...SETUP_DRIVEN_FALLBACK, interestRowMin: 0.9 }).skills, ["Listen"], "the family's own gate is data");
	const noExists = batches.map((batch) => answer(batch, { exists: 0.2, Listen: 0.95 }));
	assert.equal(interpretInterest(drawn, noExists, SETUP_DRIVEN_FALLBACK).status, "none_cleared", "nothing is picked unless the exists row clears");
	const holding = batches.map((batch) => answer(batch, { exists: 0.9, Listen: 0.95, "hold:Listen": 0.7, Stealth: 0.6 }));
	assert.deepEqual(interpretInterest(drawn, holding, SETUP_DRIVEN_FALLBACK), { status: "set", skills: ["Stealth"], held: ["Listen"] }, "a hold wins over the fit");
	assert.equal(cardPlan(drawn, fields({ delegatedSkills: true })).kind, "interest", "delegated skills on a drawn card: the fit alone");
	assert.equal(cardPlan(drawn, fields()).kind, "adjudicate");
});

// ---- §151.6 decision 10: a package brief that still asks (live acceptance jev-accept-blood-02, turn 2) ------------

const BRIEF = { FAKE_SETUP_SLOTS: "1" };
const DRAFT_NOW_INPUT = "我叫艾琳，35岁，是自由摄影记者，擅长观察和查资料。驾驶保留基础值，其他背景和能力由你按这个概念安排，现在出卡。";

test("§151.6 brief: asking for the card while the brief still asks issues draft_now, records the brief's stop note, and reaches the card fields and the draft", async (t) => {
	const run = await drivenSetup({ env: BRIEF, responses: [bindCallFor("艾琳"), fauxAssistantMessage("艾琳的卡好了。")],
		decide: (batch) => batch.family === SETUP_ROUTE_FAMILY ? answer(batch, { exit: "continue", move_draft_now: 0.94 })
			: batch.family === SETUP_INTEREST_FAMILY ? answer(batch, {}) : answer(batch, { ...FIRST_FIELDS, stated_name: 0.97 }) });
	t.after(() => run.table.dispose());
	await run.table.session.prompt(DRAFT_NOW_INPUT);
	await waitForIdle(run.table.session);
	const { table, decisions } = run;
	assert.deepEqual(decisions[0].questions.map((question) => question.key), ["move_draft_now", "exit"], "the brief withholds card_fields and issues draft_now");
	assert.equal(decisions[1]?.family, SETUP_FIELDS_FAMILY, "the card-field path runs");
	const [stop] = kernel(table, "setup.note").filter((row) => row.params.slot === "stop");
	assert.deepEqual([stop?.params.value, stop?.params.origin], [DRAFT_NOW_INPUT, "player"], "the brief's own stop note, in the player's words");
	assert.ok(kernel(table, "setup.draft").length, "the draft is no longer held by the brief");
	assert.equal(toolResults(table, SETUP_CARD_TOOL).at(-1)?.details.ok, true);
	const [row] = setupRuns(table);
	assert.equal(row.move, "draft_now");
	assert.ok(row.withheld.includes("card_fields:brief_holds"));
});

test("§151.6 brief: answering a brief question without asking for the card stays the Keeper's: no stop note, no fields, no draft, and the run row names what was withheld", async (t) => {
	const run = await drivenSetup({ env: BRIEF, responses: [fauxAssistantMessage("记者，好。那别人通常说你最擅长什么？")],
		decide: (batch) => answer(batch, { exit: "ask_llm", move_draft_now: 0.08 }) });
	t.after(() => run.table.dispose());
	await run.table.session.prompt("我是个自由摄影记者。");
	await waitForIdle(run.table.session);
	assert.deepEqual(run.decisions.map((batch) => batch.family), [SETUP_ROUTE_FAMILY]);
	assert.deepEqual(run.requests, [["setup"]], "the Keeper notes the answer and asks the next question with the full tool");
	assert.equal(kernel(run.table, "setup.note").filter((row) => row.params.slot === "stop").length, 0);
	assert.equal(kernel(run.table, "setup.draft").length, 0);
	const [row] = setupRuns(run.table);
	assert.equal(row.fallback, "ask_llm");
	assert.ok(row.withheld.includes("card_fields:brief_holds") && row.withheld.includes("approve_card:no_card"), JSON.stringify(row.withheld));
});

test("§151.6: a run that offers no move says why: the decide row and the run row list the withheld conditions", async (t) => {
	// A card already confirmed: no card-field move, nothing to load, nothing left to approve.
	const run = await drivenSetup({ env: { FAKE_SETUP_RESUME: JSON.stringify({ ...RESUME, completed: [...RESUME.completed, "create-investigator", "confirm-investigator"] }) },
		responses: [fauxAssistantMessage("好的。")], decide: (batch) => answer(batch, {}) });
	t.after(() => run.table.dispose());
	await run.table.session.prompt("随便看看。");
	await waitForIdle(run.table.session);
	assert.deepEqual(run.decisions, [], "nothing to ask");
	const decide = run.table.entries("coc-telemetry").find((row) => row.lane === "setup" && row.event === "decide");
	assert.equal(decide.status, "no_candidates");
	assert.ok(decide.withheld.includes("card_fields:confirmed") && decide.withheld.includes("load_library:new_lane"), JSON.stringify(decide.withheld));
	const [row] = setupRuns(run.table);
	assert.equal(row.fallback, "no_candidates");
	assert.deepEqual(row.withheld, decide.withheld);
});

test("§151.6: move gates name every withheld condition structurally", () => {
	const brief = moveGates(read({ brief_holds: true }));
	assert.deepEqual(brief.moves, ["draft_now"]);
	assert.ok(brief.withheld.includes("card_fields:brief_holds") && brief.withheld.includes("choose_source:no_sources"));
	assert.deepEqual(moveGates(read({ brief_holds: true, card: { revision: 1, summary: {}, profile: {} } })).moves, ["card_fields", "approve_card"], "a drawn card is revised, never held by the brief");
	assert.ok(moveGates(read({ created: false })).withheld.includes("card_fields:no_campaign"));
	assert.ok(moveGates(read({ catalog: null })).withheld.includes("draft_now:no_catalog"));
});

/** A cold call on the emitted kernel, the way the setup tests put a campaign in place before the session opens it. */
function coldKernel(workspace, requests) {
	const repo = join(import.meta.dirname, "..", "..");
	const input = requests.map(([method, params], index) => JSON.stringify({ id: String(index), method, params })).join("\n");
	const run = spawnSync(process.execPath, [join(repo, "build/kernel/rpc.mjs"), "--workspace", workspace, "--content", join(repo, "content")], { cwd: repo, input: `${input}\n`, encoding: "utf8" });
	const frames = run.stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((frame) => !frame.progress);
	for (const frame of frames) if (!frame.ok) throw new Error(`cold ${requests[Number(frame.id)][0]} failed: ${JSON.stringify(frame.error)}`);
	return frames.map((frame) => frame.result);
}

test("§151.6 on the real kernel: a freshly created campaign's setup read offers a card move when the player first describes the investigator", async (t) => {
	const campaign = "setup-drive-real";
	const run = await drivenSetup({ responses: [fauxAssistantMessage("好的。")], decide: (batch) => answer(batch, { exit: "ask_llm" }),
		env: { FAKE_SETUP_RESUME: undefined, FAKE_SETUP_CATALOG: undefined },
		table: { campaign, realKernel: true, seedCampaign: false,
			prepareWorkspace: (workspace) => coldKernel(workspace, [["campaign.create", { id: campaign, module: "the-haunting", play_language: "zh-Hans" }]]) } });
	t.after(() => run.table.dispose());
	await run.table.session.prompt("我叫艾琳，是自由摄影记者，现在出卡。");
	await waitForIdle(run.table.session);
	assert.deepEqual(run.table.extensionErrors, []);
	const [route] = run.decisions;
	assert.ok(route, "the route was asked: the real read issues at least one move");
	const offered = route.questions.filter((question) => question.key.startsWith("move_")).map((question) => question.key.slice(5));
	assert.ok(offered.includes("card_fields") || offered.includes("draft_now"), `a card move is offered: ${offered}`);
	const [row] = setupRuns(run.table);
	for (const blocked of ["no_campaign", "no_catalog", "library_lane", "confirmed", "loaded"])
		assert.ok(!row.withheld.some((entry) => entry.endsWith(`:${blocked}`) && (entry.startsWith("card_fields") || entry.startsWith("draft_now"))), `${blocked} holds no card move: ${row.withheld}`);
});

test("§151.6: the shipped interest-fit gate is 0.5 (interest_row_ratio 1), and the named-skill rows carry the play-language label beside the rules name", async () => {
	const shipped = await setupDrivenBudget(join(import.meta.dirname, "..", "..", "content"));
	assert.deepEqual([shipped.interestRowMin, shipped.interestRowRatio, shipped.interestSkillMax], [0.5, 1, 6]);
	const gate = { ...shipped, rowMin: shipped.interestRowMin, rowRatio: shipped.interestRowRatio };
	assert.equal(clears({ status: "answered", type: "noul", noul: 0.5 }, gate), true);
	assert.equal(clears({ status: "answered", type: "noul", noul: 0.49 }, gate), false);
	const batch = fieldsBatch({ read: read(), scope, readSet: [] });
	const spot = batch.questions.find((question) => question.key.startsWith("skill_") && /Spot Hidden/.test(question.instructions));
	assert.match(spot.instructions, /"侦查" \(Spot Hidden\)/, "like with like: the label the catalog issues for the play language, beside the rules name");
	assert.match(spot.instructions, /in any words/);
	assert.match(spot.instructions, /kept at its starting value/);
});
