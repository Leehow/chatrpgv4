/**
 * §143.2 (docs/specs/npc-acts-first.md D2, ticket 02): what an NPC does is written first, by one zero-tool completion,
 * and only then bound. These cases drive the product port `createNpcActLane` through the real `runLane` and the real
 * lane telemetry writer (the campaign's `telemetry.jsonl`); only the provider is fake -- a session context whose model
 * registry answers as scripted, the way the other lane tests fake it. No live model is called.
 *
 * The situation packet is built here in the shape the shared brief fixes for §143.1 (ticket 01 lands the kernel read in
 * parallel); the port sends it whole, which the first case checks, so nothing here depends on its field names.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFixtureNpcActPort, createNpcActLane, mayProduce, NPC_ACT_MAX_CHARS, NPC_PRODUCES_MAX_CHARS, playLanguageName } from "../../runtime/jev/npc-act.ts";
import { NPC_ACT_FALLBACK, npcActBudget } from "../../runtime/jev/host-budgets.ts";
import { TaskLease } from "../../runtime/jev/task-context.ts";
import { createTaskProviderBudget } from "../../runtime/jev/provider-budget.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const INSTRUCTION = join(ROOT, "content/setup/npc-act.md");
const CAMPAIGN = "game-npc-act";
const ACT = "他转身冲向楼梯口，朝楼下大喊有人打人。";
const TABLE_MODEL = { provider: "table", id: "keeper", api: "openai-responses", maxTokens: 400, contextWindow: 10000,
	cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1 } };
const USAGE = { input: 10, output: 5, cacheRead: 2, cacheWrite: 3, totalTokens: 20, cost: { total: 0.00004 } };

/** Set (or, with undefined, remove) process variables for one case and put them back after. */
function withEnv(t, values) {
	const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
	for (const [key, value] of Object.entries(values)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
	t.after(() => { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
}

function packet(extra = {}) {
	return {
		npc: { handle: "steven-knott", name: "Steven Knott" },
		who: { personality: { description: "A landlord who keeps out of trouble", origin: "source_authored" }, goals: "keep the house let",
			fears: "the police", commitments: [], relationships: [] },
		happened: ["The investigator struck Steven Knott with a fist and hurt him."],
		state: { hp: 6, hp_max: 9, conditions: [], stance: "hostile", in_session: false, my_turn: false },
		at_hand: { holdings: ["brass bell"], objects: ["telephone"], exits: ["stairs"], present: ["Steven Knott", "Harvey Walters"] },
		done: [{ ref: "intent:steven-knott:1", text: "ring for the porter", status: "attempted", since_turn: 2, last_turn: 2 }],
		recent_speech: ["Get out of my house."],
		constraints: [],
		truncated: [],
		...extra,
	};
}

const reply = (text, usage) => ({ stopReason: "stop", content: [{ type: "text", text }], ...(usage ? { usage } : {}) });
const json = (value) => reply(JSON.stringify(value));
/** A model that never answers on its own: it only lets go when its round is aborted. */
const hang = (options) => new Promise((settle) => options.signal.addEventListener("abort", () => settle({ stopReason: "aborted", content: [] }), { once: true }));

/**
 * One product port on a scripted model registry, in a workspace of its own. `answers` are served in order: a value is
 * the reply, a function is called with the completion's options. `rows()` reads the campaign's telemetry file back.
 */
async function lane(t, { answers = [], model = TABLE_MODEL, env = {}, setting, timeoutMs, contentRoot, ctx: ctxOverride, find } = {}) {
	const cwd = await mkdtemp(join(tmpdir(), "npc-act-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	const agent = join(cwd, "agent");
	await mkdir(agent);
	if (setting) await writeFile(join(agent, "pipiui-settings.json"), JSON.stringify({ extensions: { "coc-keeper": { settings: {
		"ext.coc-keeper.laneModel": { model: setting } } } } }));
	withEnv(t, { PI_CODING_AGENT_DIR: agent, PI_COC_NPC_ACT_MODEL: undefined, PI_COC_LANE_THINKING: undefined, PI_COC_HOME: undefined, ...env });
	const calls = [];
	const queue = [...answers];
	const ctx = {
		cwd, model, thinkingLevel: "off",
		sessionManager: { getSessionId: () => undefined },
		modelRegistry: {
			find: find ?? ((provider, id) => ({ ...TABLE_MODEL, provider, id })),
			complete: async (asked, context, options) => {
				calls.push({ model: `${asked.provider}/${asked.id}`, systemPrompt: context.systemPrompt,
					input: context.messages.flatMap((message) => message.content).map((block) => block.text).join(""), options });
				const next = queue.shift();
				if (typeof next === "function") return next(options, asked);
				return next ?? { stopReason: "error", errorMessage: "no scripted answer left", content: [] };
			},
		},
	};
	const entries = [], bus = [];
	const pi = { appendEntry: (type, data) => entries.push({ type, data }), events: { emit: (channel, data) => bus.push({ channel, data }) } };
	const port = createNpcActLane(pi, { ctx: ctxOverride ?? (() => ctx), campaign: () => CAMPAIGN,
		...(timeoutMs !== undefined ? { timeoutMs } : {}), ...(contentRoot ? { contentRoot } : {}) });
	const rows = async () => (await readFile(join(cwd, ".coc", "campaigns", CAMPAIGN, "telemetry.jsonl"), "utf8").catch(() => ""))
		.split("\n").filter(Boolean).map((line) => JSON.parse(line));
	/** The lane's own outcome rows; the §12.8.1 `lane-call` rows carry a lane of their own. */
	const outcomes = async () => (await rows()).filter((row) => row.lane === "npc-act");
	return { port, calls, entries, bus, rows, outcomes, generate: (input = {}, signal = new AbortController().signal) =>
		port.generate({ packet: packet(), play_language: "zh-Hans", ...input }, signal) };
}

async function onlyRow(table) {
	const rows = await table.outcomes();
	assert.equal(rows.length, 1, `exactly one npc-act row per generation: ${JSON.stringify(rows)}`);
	return rows[0];
}

test('an expired shared author deadline schedules no provider call, even with a larger per-call budget',async t=>{
    const table=await lane(t,{answers:[json({act:ACT})],timeoutMs:5000});
    const result=await table.generate({deadline:Date.now()-1});
    assert.equal(result.unavailable,'timeout');assert.equal(table.calls.length,0);
});
test('a shared remaining deadline bounds a hanging generation rather than renewing the configured budget',async t=>{
    const table=await lane(t,{answers:[hang],timeoutMs:5000});
    const result=await table.generate({deadline:Date.now()+80});
    assert.equal(result.unavailable,'timeout');assert.equal(table.calls.length,1);assert.ok(result.ms<1500);
});

test("a good answer flows through: the authored instruction, the whole packet beside play_language, the act back verbatim, one row", async (t) => {
	const table = await lane(t, { answers: [reply(`{"act": "  ${ACT}  "}`, USAGE)] });
	// A field the kernel adds later still reaches the model: there is no second whitelist between the read and the lane.
	const situation = packet({ added_by_a_later_ticket: ["he has already tried the bell once"] });
	const result = await table.generate({ packet: situation });

	assert.equal(result.act, ACT, "the act comes back trimmed and otherwise untouched");
	assert.equal(result.model, "table/keeper");
	assert.equal(result.attempts, 1);
	assert.deepEqual(result.usage, { inputTokens: 15, outputTokens: 5, costUsd: 0.00004, actions: 1 }, "usage is returned for the run budget");
	assert.equal(table.calls.length, 1);
	assert.equal(table.calls[0].systemPrompt, await readFile(INSTRUCTION, "utf8"), "the system prompt is content/setup/npc-act.md, whole");
	// §143.21: the play language's English name rides beside its tag (the runtime's `Intl.DisplayNames`, no table).
	assert.deepEqual(JSON.parse(table.calls[0].input), { play_language: "zh-Hans", play_language_name: "Simplified Chinese", situation },
		"the input is the packet, whole, and the play language");

	const row = await onlyRow(table);
	assert.equal(row.npc, "steven-knott");
	assert.equal(row.ok, true);
	assert.equal(row.act, ACT);
	assert.equal(row.model, "table/keeper");
	assert.equal(row.attempts, 1);
	assert.equal(typeof row.ms, "number");
	assert.equal(row.reason, undefined);
	assert.deepEqual(row.usage, result.usage);
	const calls = (await table.rows()).filter((entry) => entry.lane === "lane-call");
	assert.ok(calls.some((entry) => entry.subsession === "npc-act" && entry.phase === "start"), "the §12.8.1 lane-call rows name this lane");
});

test("a structurally bad answer is asked for once more, with the reason; a good second answer is taken", async (t) => {
	const table = await lane(t, { answers: [reply("He would probably run for the stairs."), json({ act: ACT })] });
	const result = await table.generate();

	assert.equal(result.act, ACT);
	assert.equal(result.attempts, 2);
	assert.equal(table.calls.length, 2, "one retry");
	assert.ok(table.calls[1].input.startsWith(table.calls[0].input), "the retry carries the same situation");
	assert.notEqual(table.calls[1].input, table.calls[0].input, "and says why the first answer was refused");
	const row = await onlyRow(table);
	assert.equal(row.ok, true);
	assert.equal(row.attempts, 2);
});

test("two bad answers are bad_output: each shape the check refuses is refused, and nothing is retried a second time", async (t) => {
	const bad = {
		"not JSON": reply("He runs."),
		"no act field": json({ action: ACT }),
		"act not a string": json({ act: 42 }),
		"empty act": json({ act: "" }),
		"blank act": json({ act: "   " }),
		"two lines": json({ act: `${ACT}\n${ACT}` }),
		"one character over the bound": json({ act: "楼".repeat(NPC_ACT_MAX_CHARS + 1) }),
	};
	for (const [name, answer] of Object.entries(bad)) await t.test(name, async (t) => {
		const table = await lane(t, { answers: [answer, answer, json({ act: ACT })] });
		const result = await table.generate();
		assert.equal(result.unavailable, "bad_output", JSON.stringify(result));
		assert.equal(result.attempts, 2);
		assert.equal(table.calls.length, 2, "exactly one retry, never a third call");
		const row = await onlyRow(table);
		assert.equal(row.ok, false);
		assert.equal(row.reason, "bad_output");
		assert.equal(row.model, "table/keeper");
	});
});

test("the bound is 200 characters counted as characters, not UTF-16 units", async (t) => {
	for (const [name, act] of Object.entries({ "200 CJK": "楼".repeat(NPC_ACT_MAX_CHARS), "200 astral": "\u{1F514}".repeat(NPC_ACT_MAX_CHARS) })) {
		await t.test(name, async (t) => {
			const table = await lane(t, { answers: [json({ act })] });
			const result = await table.generate();
			assert.equal(result.act, act);
			assert.equal(table.calls.length, 1);
		});
	}
});

test("a model that never answers is cut at the deadline: timeout, one row, no retry", async (t) => {
	const table = await lane(t, { answers: [hang, json({ act: ACT })], timeoutMs: 40 });
	const result = await table.generate();

	assert.equal(result.unavailable, "timeout", JSON.stringify(result));
	assert.equal(table.calls.length, 1, "a timeout is not retried");
	const row = await onlyRow(table);
	assert.equal(row.ok, false);
	assert.equal(row.reason, "timeout");
	assert.equal(row.model, "table/keeper", "the timed-out row still names the model");
	assert.match(String(row.detail), /within the 40 ms deadline/);
});

test("one deadline covers the retry: the second attempt gets only what is left of it", async (t) => {
	const late = () => new Promise((settle) => setTimeout(() => settle(reply("not json")), 50));
	// Wide margins on purpose: a loaded test box must not turn this into a test of its timers.
	const table = await lane(t, { answers: [late, hang], timeoutMs: 2000 });
	const result = await table.generate();

	assert.equal(result.unavailable, "timeout", JSON.stringify(result));
	assert.equal(result.attempts, 2);
	assert.equal(table.calls.length, 2);
	const granted = Number(/did not answer within (\d+) ms/.exec(String(result.detail))?.[1]);
	assert.ok(granted > 0 && granted < 2000, `the retry ran on the rest of the one deadline, not a fresh 2000 ms: ${result.detail}`);
	assert.equal((await onlyRow(table)).reason, "timeout");
});

test("the deadline is npc_act.timeout_ms in host-budgets.json, read from the file, with the shipped value 12000 (the probe of ticket 07 measured p90 at the old 8000 cap)", async (t) => {
	// §143.4 / §143.5 (ticket 03/04) grew the section by two named defaults beside the deadline.
	assert.deepEqual(await npcActBudget(), { timeoutMs: 12000, maxPerTurn: 2, sameActRows: 5 }, "the shipped file");
	assert.equal(NPC_ACT_FALLBACK.timeoutMs, 8000);
	const content = await mkdtemp(join(tmpdir(), "npc-act-content-"));
	t.after(() => rm(content, { recursive: true, force: true }));
	await mkdir(join(content, "rulesets", "coc7"), { recursive: true });
	await mkdir(join(content, "setup"), { recursive: true });
	await writeFile(join(content, "setup", "npc-act.md"), await readFile(INSTRUCTION, "utf8"));
	await writeFile(join(content, "rulesets", "coc7", "host-budgets.json"), JSON.stringify({ schema_version: 1, npc_act: { timeout_ms: 30 } }));
	assert.deepEqual(await npcActBudget(content), { timeoutMs: 30, maxPerTurn: 2, sameActRows: 5 }, "the two counts fall back to their defaults");

	// No timeoutMs handed to the port: the 30 in the file is the only thing that can end this round early.
	const table = await lane(t, { answers: [hang], contentRoot: content });
	const result = await table.generate();
	assert.equal(result.unavailable, "timeout");
	assert.match(String(result.detail), /within the 30 ms deadline/);

	await writeFile(join(content, "rulesets", "coc7", "host-budgets.json"), JSON.stringify({ schema_version: 1, npc_act: { timeout_ms: -5 } }));
	assert.deepEqual(await npcActBudget(content), NPC_ACT_FALLBACK, "an unusable value falls back to the default");
});

test("no model: model_unavailable, one row, no completion, never a throw", async (t) => {
	await t.test("the table has no model and nothing names one", async (t) => {
		const table = await lane(t, { model: null, answers: [json({ act: ACT })] });
		const result = await table.generate();
		assert.equal(result.unavailable, "model_unavailable");
		assert.equal(table.calls.length, 0);
		assert.equal(result.attempts, 1, "an unavailable model is not asked twice");
		const row = await onlyRow(table);
		assert.equal(row.reason, "model_unavailable");
		assert.equal(row.model, null);
	});
	await t.test("the lane's variable names a model the registry does not have", async (t) => {
		const table = await lane(t, { env: { PI_COC_NPC_ACT_MODEL: "gone/model" }, find: () => undefined, answers: [json({ act: ACT })] });
		const result = await table.generate();
		assert.equal(result.unavailable, "model_unavailable");
		assert.match(String(result.detail), /PI_COC_NPC_ACT_MODEL/);
		assert.equal(table.calls.length, 0);
		assert.equal((await onlyRow(table)).reason, "model_unavailable");
	});
	// With no context there is no workspace to find the campaign's file in: the row is the session entry alone,
	// exactly as the shared lane writer does for every lane.
	const sessionRows = (table) => table.entries.filter((entry) => entry.type === "coc-telemetry" && entry.data.lane === "npc-act").map((entry) => entry.data);
	await t.test("there is no session context", async (t) => {
		const table = await lane(t, { ctx: () => undefined });
		const result = await table.generate();
		assert.equal(result.unavailable, "model_unavailable");
		assert.deepEqual(sessionRows(table).map((row) => row.reason), ["model_unavailable"]);
	});
	await t.test("the session context is stale and throws", async (t) => {
		const table = await lane(t, { ctx: () => { throw new Error("stale after session replacement"); } });
		const result = await table.generate();
		assert.equal(result.unavailable, "model_unavailable");
		assert.deepEqual(sessionRows(table).map((row) => row.reason), ["model_unavailable"]);
	});
});

test("the host's own failures are lane_error, one row, no completion: no packet, an unreadable instruction", async (t) => {
	await t.test("no situation packet", async (t) => {
		const table = await lane(t, { answers: [json({ act: ACT })] });
		const result = await table.port.generate({ play_language: "zh-Hans" }, new AbortController().signal);
		assert.equal(result.unavailable, "lane_error");
		assert.equal(table.calls.length, 0);
		assert.equal((await onlyRow(table)).reason, "lane_error");
	});
	await t.test("the instruction file cannot be read", async (t) => {
		const content = await mkdtemp(join(tmpdir(), "npc-act-empty-content-"));
		t.after(() => rm(content, { recursive: true, force: true }));
		const table = await lane(t, { answers: [json({ act: ACT })], contentRoot: content, timeoutMs: 1000 });
		const result = await table.generate();
		assert.equal(result.unavailable, "lane_error");
		assert.match(String(result.detail), /npc-act\.md/);
		assert.equal(table.calls.length, 0, "no completion without the authored instruction");
		assert.equal((await onlyRow(table)).reason, "lane_error");
	});
});

test("the lane's model: PI_COC_NPC_ACT_MODEL, then the fast-model setting, then the table", async (t) => {
	for (const [name, options, expected] of [
		["the operator's variable", { env: { PI_COC_NPC_ACT_MODEL: "operator/pinned" }, setting: "fast/small" }, "operator/pinned"],
		["the fast-model setting", { setting: "fast/small" }, "fast/small"],
		["the table", {}, "table/keeper"],
	]) await t.test(name, async (t) => {
		const table = await lane(t, { ...options, answers: [json({ act: ACT })] });
		const result = await table.generate();
		assert.equal(result.act, ACT);
		assert.equal(table.calls[0].model, expected);
		assert.equal((await onlyRow(table)).model, expected);
	});
});

test("a provider error is model_error and is not retried", async (t) => {
	const table = await lane(t, { answers: [{ stopReason: "error", errorMessage: "503 upstream", content: [] }, json({ act: ACT })] });
	const result = await table.generate();
	assert.equal(result.unavailable, "model_error");
	assert.equal(table.calls.length, 1);
	assert.equal((await onlyRow(table)).reason, "model_error");
});

test("a caller that cancels gets cancelled, not an outage reason, and one row", async (t) => {
	await t.test("before the generation begins", async (t) => {
		const table = await lane(t, { answers: [json({ act: ACT })] });
		const stop = new AbortController();
		stop.abort();
		const result = await table.generate({}, stop.signal);
		assert.equal(result.unavailable, "cancelled");
		assert.equal(table.calls.length, 0);
		assert.equal((await onlyRow(table)).reason, "cancelled");
	});
	await t.test("while the model is answering", async (t) => {
		const table = await lane(t, { answers: [hang] });
		const stop = new AbortController();
		setTimeout(() => stop.abort(), 20);
		const result = await table.generate({}, stop.signal);
		assert.equal(result.unavailable, "cancelled");
		assert.equal(table.calls.length, 1);
		assert.equal((await onlyRow(table)).reason, "cancelled");
	});
});

test("the run's provider budget is charged by the completion, with the provider's own usage", async (t) => {
	const root = new TaskLease({ owner: "npc-act-test", goal: "Account the act generation", scope: { owner: "test", audience: "keeper" }, readSet: [], capabilities: [],
		budget: { deadlineAt: Date.now() + 10000, remainingInputTokens: 20000, remainingOutputTokens: 1000, remainingCostUsd: 1, remainingActions: 10 } });
	t.after(() => root.close());
	const before = root.context.budget;
	const table = await lane(t, { answers: [async (options, asked) => {
		await options.onPayload({ model: asked.id, input: "the situation" });
		return reply(JSON.stringify({ act: ACT }), USAGE);
	}] });
	const result = await table.generate({ providerBudget: createTaskProviderBudget(root) });
	assert.equal(result.act, ACT);
	assert.equal(root.context.budget.remainingActions, before.remainingActions - 1, "one provider action spent from the run's budget");
	assert.equal(root.context.budget.remainingInputTokens, before.remainingInputTokens - 15, "settled with the actual usage");
	assert.equal(result.usage.inputTokens, 15);
});

test("three failures in a row raise the shared lane notice under this lane's name and variable", async (t) => {
	const table = await lane(t, { model: null });
	for (let index = 0; index < 3; index++) await table.generate();
	const notice = table.bus.find((event) => event.channel === "coc:lane-status");
	assert.ok(notice, "the operator hears about an outage");
	assert.equal(notice.data.lane, "npc-act");
	assert.match(notice.data.fix, /PI_COC_NPC_ACT_MODEL/);
	assert.equal(notice.data.reason, "model_unavailable");
	assert.equal((await table.outcomes()).filter((row) => row.ok === false).length, 3);
});

test("the instruction file: the bound, the play language, the JSON shape, and no list of any kind", async () => {
	const text = await readFile(INSTRUCTION, "utf8");
	assert.match(text, /\b200 characters\b/);
	assert.match(text, /play_language/);
	assert.match(text, /\{"act": /, "the output shape is stated");
	// §143.19: what an act may bring out is the stakes die's permission, in the answer's own field, with its bound.
	assert.match(text, /`stakes\.surprise` is true/);
	assert.match(text, /`produces` beside `act`/);
	assert.match(text, new RegExp(`\\b${NPC_PRODUCES_MAX_CHARS} characters\\b`));
	// §143.30: the severe surprise is the table's fun, and the table's list of what came out is named for it.
	assert.match(text, /`stakes\.outcome` is `severe` too, the surprise is\s+for the table's fun/);
	assert.match(text, /not the same kind of thing as anything in\s+`table_brought_out`/);
	// Structure, not words: an action menu is a list, so the file carries no markdown list item at all (Agents.md: no
	// hard-coded action menus; the ticket's guard against examples of acts).
	const items = text.split("\n").filter((line) => /^\s*(?:[-*+]|\d+[.)])\s/.test(line));
	assert.deepEqual(items, [], "no markdown list items in content/setup/npc-act.md");
});

// ---------------------------------------------------------------------------------------------------
// §143.19 (ticket 20, spec D10): `produces`, the one thing an act brings out that no one knew this person had. Taken only
// when the packet's stakes die allowed a surprise; then held to one line of at most 60 characters like the act's own
// bound; without a surprise it is dropped and said on the row, never asked again.
// ---------------------------------------------------------------------------------------------------

const SURPRISE = { rung: "dangerous", outcome: "escalates", line: "This turn, this person goes further.", surprise: true,
	surprise_line: "This person may have something on them that no one knew they had." };
const PISTOL = "袖珍手枪";
const surprised = (extra = {}) => ({ packet: packet({ stakes: SURPRISE, ...extra }) });

test("§143.19 mayProduce: the stakes die's surprise, and nothing else", () => {
	assert.equal(mayProduce(packet({ stakes: SURPRISE })), true);
	for (const stakes of [undefined, null, { ...SURPRISE, surprise: false }, { ...SURPRISE, surprise: "true" }, { rung: "lethal", outcome: "severe", line: "x" }])
		assert.equal(mayProduce(packet({ stakes })), false, JSON.stringify(stakes));
});

test("§143.19 produces with a surprise: taken, trimmed, on the result and the row; up to 60 characters counted as characters", async (t) => {
	for (const [name, produces] of Object.entries({ "a short phrase": `  ${PISTOL}  `, "60 CJK": "枪".repeat(NPC_PRODUCES_MAX_CHARS),
		"60 astral": "\u{1F52B}".repeat(NPC_PRODUCES_MAX_CHARS) })) await t.test(name, async (t) => {
		const table = await lane(t, { answers: [json({ act: ACT, produces })] });
		const result = await table.generate(surprised());
		assert.equal(result.act, ACT);
		assert.equal(result.produces, produces.trim());
		assert.equal(result.producesDropped, undefined);
		assert.equal(table.calls.length, 1);
		const row = await onlyRow(table);
		assert.equal(row.produces, produces.trim(), "the row keeps what the act brings out");
		assert.equal(row.produces_dropped, undefined);
	});
});

test("§143.19 produces with a surprise but of the wrong shape: asked once more with the reason, like a bad act", async (t) => {
	const bad = {
		"one character over the bound": "枪".repeat(NPC_PRODUCES_MAX_CHARS + 1),
		"two lines": `${PISTOL}\n一把刀`,
		"not a string": 7,
	};
	for (const [name, produces] of Object.entries(bad)) await t.test(name, async (t) => {
		const table = await lane(t, { answers: [json({ act: ACT, produces }), json({ act: ACT, produces: PISTOL })] });
		const result = await table.generate(surprised());
		assert.equal(result.act, ACT);
		assert.equal(result.produces, PISTOL, "the second, well-shaped answer is taken");
		assert.equal(table.calls.length, 2, "one retry");
		assert.match(table.calls[1].input, /"produces"/, "the retry says what was refused");
		assert.equal((await onlyRow(table)).attempts, 2);
	});
	await t.test("twice the wrong shape is bad_output", async (t) => {
		const answer = json({ act: ACT, produces: "枪".repeat(NPC_PRODUCES_MAX_CHARS + 1) });
		const table = await lane(t, { answers: [answer, answer] });
		const result = await table.generate(surprised());
		assert.equal(result.unavailable, "bad_output");
		assert.equal(table.calls.length, 2);
	});
});

test("§143.19 produces absent, null or blank is no produces, surprise or not; nothing is dropped", async (t) => {
	for (const [name, answer] of Object.entries({ absent: { act: ACT }, null: { act: ACT, produces: null }, blank: { act: ACT, produces: "   " } })) {
		await t.test(name, async (t) => {
			const table = await lane(t, { answers: [json(answer)] });
			const result = await table.generate(surprised());
			assert.deepEqual([result.act, result.produces, result.producesDropped], [ACT, undefined, undefined]);
			const row = await onlyRow(table);
			assert.deepEqual([row.produces, row.produces_dropped], [undefined, undefined]);
		});
	}
});

test("§143.19 produces without a surprise: dropped whatever its shape, the act kept, produces_dropped on the row, never asked again", async (t) => {
	const cases = {
		"no stakes at all": [packet(), PISTOL],
		"a severe roll with no surprise": [packet({ stakes: { ...SURPRISE, outcome: "severe", surprise: false, surprise_line: null } }), PISTOL],
		"a produces too long to take anyway": [packet({ stakes: null }), "枪".repeat(NPC_PRODUCES_MAX_CHARS + 5)],
	};
	for (const [name, [situation, produces]] of Object.entries(cases)) await t.test(name, async (t) => {
		const table = await lane(t, { answers: [json({ act: ACT, produces }), json({ act: ACT })] });
		const result = await table.generate({ packet: situation });
		assert.equal(result.act, ACT, "the act stands");
		assert.equal(result.produces, undefined, "what it brings out is not taken");
		assert.equal(result.producesDropped, true);
		assert.equal(table.calls.length, 1, "no retry");
		const row = await onlyRow(table);
		assert.deepEqual([row.ok, row.act, row.produces, row.produces_dropped], [true, ACT, undefined, true]);
	});
});

test("the fixture port answers from its table, by handle, then name, then *, in order, verbatim", async () => {
	const fixture = createFixtureNpcActPort({
		"steven-knott": ["first act", "second act"],
		Porter: "the porter's act",
		quiet: { unavailable: "timeout" },
		"*": "anyone's act",
	});
	const signal = new AbortController().signal;
	const ask = (npc) => fixture.generate({ packet: packet({ npc }), play_language: "zh-Hans" }, signal);
	assert.deepEqual(await ask({ handle: "steven-knott", name: "Steven Knott" }), { act: "first act" });
	assert.deepEqual(await ask({ handle: "steven-knott", name: "Steven Knott" }), { act: "second act" });
	assert.deepEqual(await ask({ handle: "steven-knott", name: "Steven Knott" }), { act: "second act" }, "the last entry repeats");
	assert.deepEqual(await ask({ handle: "porter-1", name: "Porter" }), { act: "the porter's act" });
	assert.deepEqual(await ask({ handle: "quiet", name: "Quiet" }), { unavailable: "timeout" });
	assert.deepEqual(await ask({ handle: "someone", name: "Someone" }), { act: "anyone's act" });
	assert.equal(fixture.calls.length, 6);
	assert.equal(fixture.calls[0].packet.npc.handle, "steven-knott", "the inputs are kept for assertions on what a re-ask sent");

	// §143.19: an answer with what the act brings out comes back as it is, stakes or not (the act step holds it to the die).
	const producing = createFixtureNpcActPort({ "steven-knott": { act: "他掏出一把袖珍手枪。", produces: PISTOL } });
	assert.deepEqual(await producing.generate({ packet: packet(), play_language: "zh-Hans" }, signal), { act: "他掏出一把袖珍手枪。", produces: PISTOL });

	const bare = createFixtureNpcActPort({ "steven-knott": "x" });
	const missing = await bare.generate({ packet: packet({ npc: { handle: "nobody", name: "Nobody" } }), play_language: "en" }, signal);
	assert.equal(missing.unavailable, "model_unavailable");
	const stop = new AbortController();
	stop.abort();
	assert.deepEqual(await bare.generate({ packet: packet(), play_language: "en" }, stop.signal), { unavailable: "cancelled" });
});

test("§143.21: the play language's name is the runtime's (Intl.DisplayNames), for any tag; a tag it cannot name adds nothing", () => {
	assert.equal(playLanguageName("zh-Hans"), "Simplified Chinese");
	assert.equal(playLanguageName("pt-BR"), "Brazilian Portuguese", "an open set: no tag is listed anywhere");
	assert.equal(playLanguageName("xx"), undefined, "named only by repeating the tag");
	assert.equal(playLanguageName("not a tag"), undefined, "not a tag at all");
});
