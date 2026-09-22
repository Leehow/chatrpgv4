/**
 * COC's bounded play-context policy at the real extension seam (contract §19.2,
 * `docs/specs/bounded-play-context.md` decisions D2-D4).
 *
 * The policy keeps two adapters of one pure selection: the outbound projector bounds what reaches
 * a request, and the compaction hook persists a bounded representation of closed history. These
 * cases run the product path -- a real Pi `AgentSession`, the real TypeScript kernel over RPC, and
 * a scripted Keeper -- and read entry types, turn distance and structural metadata, not prose.
 *
 * What the persisted fold writes now: a versioned v2 manifest plus the shared bounded history view
 * (the latest two committed dialogue pairs quoted from canonical records, with read references).
 * The v1 cumulative `details.coc_fold.lines` is gone; closed capsules and tool round trips leave
 * the active window, the current player group is protected, and the archive is never rewritten.
 */

import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { assistantTexts, customMessages, openTable, waitForIdle } from "./harness.mjs";

/**
 * `enabled: false` stops Pi compacting mid-turn on its own, so a turn is deterministic;
 * `keepRecentTokens: 1` keeps Pi's own cut tight against the last entry, which is the premise
 * for "there is something to fold".
 */
const COMPACTION = { compaction: { enabled: false, reserveTokens: 16384, keepRecentTokens: 1 } };

/** The opening turn: a `look` to load the table, a `narrate` that closes turn 0, then a tail. */
const OPENING = [
	fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" }),
	fauxAssistantMessage([fauxToolCall("narrate", { text: "开场。" })], { stopReason: "toolUse" }),
	fauxAssistantMessage("opening tail, replaced by the committed delivery"),
];

/**
 * One committed played turn: a `resolve` receipt, a `clue` effect, the `narrate` delivery, then a
 * Keeper tail. The clue discharges a Director recovery debt (contract §40) deterministically, so
 * the turn does not trip the once-per-turn recovery refusal. The tail is what Pi lets the Keeper
 * keep writing after `narrate`; the kernel replaces it with the committed rendering, so it must
 * never appear in the folded history.
 */
const CLUES = ["clue-knott-research-leads", "clue-knott-keys", "clue-knott-macario-summary"];

function playedTurn(n) {
	return [
		fauxAssistantMessage(
			[fauxToolCall("resolve", { action: { intent: "investigate", goal: `goal ${n}`, method: `method ${n}`, skill: "Spot Hidden" } })],
			{ stopReason: "toolUse" },
		),
		fauxAssistantMessage(
			[fauxToolCall("apply", { effects: [{ kind: "clue", clue: CLUES[(n - 1) % CLUES.length], how: `turn ${n}` }] })],
			{ stopReason: "toolUse" },
		),
		fauxAssistantMessage([fauxToolCall("narrate", { text: `第 ${n} 回合的交付。` })], { stopReason: "toolUse" }),
		fauxAssistantMessage(`不交付的收尾 ${n}`),
	];
}

/**
 * Open a real table and play `turns` committed turns one player utterance at a time. The player
 * says `第 n 句`; the Keeper delivers `第 n 回合的交付。`.
 */
async function openPlayed(t, { campaign, turns = 3, env, settings = COMPACTION } = {}) {
	const table = await openTable({
		realKernel: true,
		campaign,
		settings,
		env,
		responses: [...OPENING, ...Array.from({ length: turns }, (_, index) => playedTurn(index + 1)).flat()],
	});
	t.after(() => table.dispose());
	await waitForIdle(table.session, { timeoutMs: 60_000 });
	for (let n = 1; n <= turns; n++) await table.session.prompt(`第 ${n} 句`);
	await waitForIdle(table.session, { timeoutMs: 30_000 });
	return table;
}

const compactionEntries = (table) => table.rawEntries().filter((entry) => entry.type === "compaction");
const foldRows = (table) => table.entries("coc-telemetry").filter((row) => row.lane === "fold");
const folded = (table) => compactionEntries(table).at(-1);
/** The shape the model actually sees after a fold: role plus customType is enough to judge it. */
const contextShape = (table) =>
	table.session.messages.map((message) => `${message.role}${message.customType ? `:${message.customType}` : ""}`);

test("bounded fold: closed capsules and tool round trips leave the window, the latest two committed dialogues are quoted verbatim, the current player group is protected (D2/D3)", async (t) => {
	const table = await openPlayed(t, { campaign: "bounded-fold" });

	await table.session.compact();

	const entry = folded(table);
	assert.ok(entry, "the compaction entry landed");
	assert.equal(entry.fromHook, true, "the summary is the extension's bounded view, not a model summary");

	const summary = JSON.parse(entry.summary);
	assert.equal(summary.before_turn, 3, "the view is bound to the canonical turn it addresses");
	assert.deepEqual(
		summary.quotes.map((quote) => [quote.turn, quote.role, quote.text]),
		[
			[1, "player", "第 1 句"],
			[1, "keeper", "第 1 回合的交付。"],
			[2, "player", "第 2 句"],
			[2, "keeper", "第 2 回合的交付。"],
		],
		"exactly the latest two committed pairs, quoted from the canonical records",
	);
	for (const quote of summary.quotes) {
		assert.equal(quote.verified, true, "an original recording is quoted, not a reconstruction");
		assert.equal(quote.read.read.turn, quote.turn, "each quote carries the read arguments back to its original");
		assert.equal(quote.truncated, false, "these short originals are complete");
	}
	assert.ok(typeof summary.memory_coverage === "object", "the bounded view carries the extraction-coverage annotation");
	assert.equal(summary.earlier_than, 1, "the view says where the omitted history starts");

	// Folded noise does not enter the bounded view: no capsule prose, no tool exchange, no tail.
	const serialized = JSON.stringify(summary);
	assert.doesNotMatch(serialized, /coc-capsule|Everything at the start of this turn/, "no closed capsule content is copied into the view");
	assert.doesNotMatch(serialized, /不交付的收尾/, "the replaced Keeper tail is not a recording");
	assert.doesNotMatch(serialized, /toolCall|toolResult/, "no old tool exchange is copied into the view");

	// The active window: the system checkpoint leads, then the bounded view. Dialogue is found by content, not by a fixed index.
	const messages = table.session.messages;
	const checkpoint = messages[0];
	const savedCheckpoint = entry.systemMessage;
	assert.equal(checkpoint?.role, "system", "the system checkpoint heads the window");
	assert.ok(savedCheckpoint, "the compaction entry preserves the system checkpoint");
	assert.equal(checkpoint.content, savedCheckpoint.content, "the window keeps the checkpoint prompt");
	assert.deepEqual(checkpoint.sections ?? null, savedCheckpoint.sections ?? null, "the window keeps the checkpoint sections");
	assert.deepEqual(
		(checkpoint.toolsAdded ?? []).map((tool) => tool.name),
		(savedCheckpoint.toolsAdded ?? []).map((tool) => tool.name),
		"the window keeps the checkpoint tool declarations",
	);
	const shape = contextShape(table);
	const summaryAt = messages.findIndex((message) => message.role === "compactionSummary");
	assert.ok(summaryAt > 0, "the bounded view follows the checkpoint");
	assert.equal(messages[summaryAt].summary, entry.summary, "the window quotes the persisted bounded view");
	assert.equal(shape.filter((row) => row === "user").length, 1, "only the current player utterance remains");
	assert.equal(shape.filter((row) => row === "custom:coc-capsule").length, 1, "only the current turn's capsule remains");
	assert.ok(table.session.messages.some((message) => message.role === "user" && JSON.stringify(message.content).includes("第 3 句")), "the current player group is retained verbatim");
	assert.ok(assistantTexts(table.session).some((text) => text.includes("第 3 回合的交付。")), "the current committed delivery is retained");
	// Closed-turn prose is gone from the message stream itself; only the bounded view quotes it.
	const assistantText = table.session.messages.filter((message) => message.role === "assistant").map((message) => JSON.stringify(message.content)).join("");
	assert.ok(!assistantText.includes("第 1 回合的交付。") && !assistantText.includes("第 2 回合的交付。"), "closed-turn deliveries are no longer assistant messages");
});

test("the fold writes a v2 manifest and never regrows cumulative v1 lines; raw session and canonical records stay readable (D3)", async (t) => {
	const table = await openPlayed(t, { campaign: "bounded-manifest" });
	const rawBefore = table.rawEntries().length;
	// Raw-retained pressure is diagnostic only; the explicit manual fold adds one.
	const foldsBefore = compactionEntries(table).length;

	await table.session.compact();

	const entry = folded(table);
	const manifest = entry.details.coc_fold;
	assert.equal(manifest.version, 2);
	assert.deepEqual(manifest.source, { campaign: "bounded-manifest", worldline: "main", loop: 0, turn: 3 });
	assert.equal(typeof manifest.retained_from, "string");
	assert.equal(typeof manifest.plan_key, "string", "the coalescing key is part of the manifest");
	assert.equal(manifest.earlier_than, 1);
	assert.ok(manifest.history_bytes > 0 && manifest.history_bytes <= 32 * 1024, `bounded history bytes, measured ${manifest.history_bytes}`);
	assert.ok(!("lines" in manifest), "no cumulative v1 lines array is written");
	assert.ok(!("quotes" in manifest) && !("archive" in manifest), "the archive is not copied into every details object");

	// The raw archive is appended to, never rewritten: every original entry is still there.
	const raw = table.rawEntries();
	assert.ok(raw.length > rawBefore, "compaction appends an entry");
	assert.ok(raw.some((row) => JSON.stringify(row).includes("第 1 句")), "the first turn's original player entry is still readable");
	assert.ok(raw.some((row) => JSON.stringify(row).includes("Everything at the start of this turn")), "the closed capsules are still persisted");
	assert.equal(compactionEntries(table).length, foldsBefore + 1, "the manual fold added exactly one persisted fold");

	const turns = join(table.workspace, ".coc", "campaigns", "bounded-manifest", "turns");
	assert.ok(existsSync(join(turns, "0001.json")), "the canonical turn record is on disk");
	assert.equal(JSON.parse(readFileSync(join(turns, "0001.json"), "utf8")).player_text, "第 1 句", "the canonical original is exactly what was quoted");
});

test("after a fold the host note points at bounded recall and does not start a turn (D4)", async (t) => {
	const table = await openPlayed(t, { campaign: "bounded-note" });
	const turnsBefore = table.rawEntries().filter((row) => row.type === "message").length;

	await table.session.compact();
	await waitForIdle(table.session, { timeoutMs: 10_000 });

	const notes = customMessages(table.session, "coc-host").filter((message) => message.details?.kind === "compacted");
	assert.equal(notes.length, 1, "exactly one post-fold note");
	assert.equal(notes[0].display, false, "the player does not see it, the model does");
	assert.match(notes[0].content, /bounded recall/, "it names the recovery path");
	assert.match(notes[0].content, /capsule/);
	assert.match(notes[0].content, /briefing/);
	assert.equal(contextShape(table).at(-1), "custom:coc-host", "the note is the last thing appended; the fold did not open a turn");
	assert.equal(table.session.isStreaming, false, "the note did not trigger a model turn");
	assert.ok(table.rawEntries().filter((row) => row.type === "message").length >= turnsBefore, "the note added no turn messages");
});

test("the fold records its trigger, outcome and measured sizes in telemetry (D9)", async (t) => {
	const table = await openPlayed(t, { campaign: "bounded-telemetry" });
	// Pressure and pre-emptive folds have their own rows; inspect only what this manual fold wrote.
	const rowsBefore = foldRows(table).length;

	await table.session.compact();

	const rows = foldRows(table).slice(rowsBefore);
	assert.equal(rows.length, 1, "the manual fold wrote exactly one new telemetry row");
	assert.equal(rows[0].ok, true);
	assert.equal(rows[0].trigger, "manual", "`/compact` is the manual trigger");
	assert.equal(rows[0].version, 2);
	assert.ok(rows[0].folded_entries > 0);
	assert.ok(rows[0].history_bytes > 0 && rows[0].history_bytes <= 32 * 1024);
	assert.equal(typeof rows[0].tokens_before, "number");
});

test("a repeated fold makes no progress: the same plan is cancelled and the v1 lines do not regrow (D3/D4)", async (t) => {
	const table = await openPlayed(t, { campaign: "bounded-repeat" });
	const foldsBefore = compactionEntries(table).length;
	const rowsBefore = foldRows(table).length;

	await table.session.compact();
	assert.equal(compactionEntries(table).length, foldsBefore + 1, "the first manual fold wrote exactly one entry");
	const first = folded(table);
	const firstSummary = first.summary;

	await assert.rejects(() => table.session.compact(), /cancel/i, "the second fold is honestly cancelled");

	assert.equal(compactionEntries(table).length, foldsBefore + 1, "the cancelled repeat added no second entry");
	assert.equal(folded(table).summary, firstSummary, "the visible summary did not change");
	assert.equal(folded(table).details.coc_fold.version, 2);
	assert.ok(!("lines" in folded(table).details.coc_fold), "the repeated fold did not grow a lines array");

	const manualRows = foldRows(table).slice(rowsBefore);
	assert.equal(manualRows.length, 2, "the first manual fold and its cancelled repeat");
	assert.deepEqual(manualRows.map((row) => [row.trigger, row.ok]), [["manual", true], ["manual", false]]);
	const last = manualRows.at(-1);
	assert.equal(last.reason, "no_progress");
	assert.ok(
		!foldRows(table).some((row) => row.event === "pre-emptive" && row.reason === "no_progress"),
		"a cancelled repeat is never misreported as a successful pre-emptive fold",
	);
});

test("threshold reached: `before_agent_start` pre-empts, accepting both a fraction and a percentage (D4)", async (t) => {
	// Each case runs in its own subtest so its `PI_COC_COMPACT_AT` is restored before the next one.
	for (const [label, env] of [["fraction", { PI_COC_COMPACT_AT: "0.05" }], ["percentage", { PI_COC_COMPACT_AT: "5" }]]) {
		await t.test(label, async (t2) => {
			const table = await openPlayed(t2, { campaign: `bounded-threshold-${label}`, turns: 2, env });
			const preemptive = foldRows(table).find((row) => row.event === "pre-emptive" && row.ok === true);
			assert.ok(preemptive, "a pre-emptive fold was recorded");
			assert.ok(preemptive.percent > 5, `it fired above the configured threshold, measured ${preemptive.percent}`);
			assert.equal(compactionEntries(table).length, 1, "exactly one fold");

			// The fold lands before the turn: the turn's tool round trips all follow the compaction entry.
			const entries = table.rawEntries();
			const compactionIndex = entries.findIndex((row) => row.type === "compaction");
			const lastToolResult = entries.findLastIndex((row) => row.type === "message" && row.message.role === "toolResult");
			assert.ok(compactionIndex < lastToolResult, "the fold did not split the exchange");
		});
	}
});

test("threshold not reached: the default 80% is far away, so nothing is folded (D4)", async (t) => {
	const table = await openPlayed(t, { campaign: "bounded-below-threshold", turns: 2 });

	assert.deepEqual(foldRows(table), [], "no telemetry row before the threshold");
	assert.equal(compactionEntries(table).length, 0, "no fold before the threshold");
});

test("no safe cut: the fold cancels honestly instead of calling a model for a generic summary (D4)", async (t) => {
	const table = await openPlayed(t, { campaign: "bounded-no-cut", turns: 0 });

	await assert.rejects(() => table.session.compact(), /cancel/i);

	assert.equal(compactionEntries(table).length, 0, "nothing was persisted");
	assert.ok(!table.session.messages.some((message) => message.role === "compactionSummary"), "no generic model summary entered the window");
	assert.deepEqual(table.extensionErrors, [], "the extension did not fail on the cancelled path");
	const row = foldRows(table).at(-1);
	assert.equal(row.ok, false);
	assert.equal(row.reason, "no_safe_cut");
	assert.equal(row.trigger, "manual");
});
