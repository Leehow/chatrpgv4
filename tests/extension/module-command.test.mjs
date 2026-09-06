/**
 * `/coc module` (contract §20.3): what is in the store, how to play one of them, and reading a new
 * book in.
 *
 * The law over the whole command surface holds here too (contract §19.1): the output goes to the
 * person through `ctx.ui` and never into the Keeper's context, the command spends no turn, and
 * outside an interactive terminal it answers one line and does nothing.
 */

import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execPath } from "node:process";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createFakeUI, FAKE_BUNDLE, FAKE_EXTRACT, FAKE_OCR, openTable, waitFor } from "./harness.mjs";

/** Two books in the store: one that can be played right now, one still being built. */
const LIBRARY = [
	{ module_id: "the-haunting", title: "The Haunting", source: "starter", status: "installed", opening_ready: true, sections: [] },
	{
		module_id: "amaranthine-desire",
		title: "An Amaranthine Desire",
		source: "pdf",
		status: "building",
		page_count: 41,
		opening_ready: false,
		sections: [{ id: "front", status: "accepted" }, { id: "scene-1", status: "planned" }, { id: "scene-2", status: "planned" }],
	},
];

function keeperTurn(text) {
	return [
		fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("narrate", { text })], { stopReason: "toolUse" }),
		fauxAssistantMessage("a sentence after the delivery"),
	];
}

async function openWithLibrary(t, { ui, env = {} } = {}) {
	const table = await openTable({
		uiMode: "tui",
		responses: keeperTurn("A deep scratch runs down the door frame."),
		...(ui ? { ui } : {}),
		env: { FAKE_KERNEL_MODULE: JSON.stringify({ module_id: "ingested-book", library: LIBRARY }), ...env },
	});
	t.after(() => table.dispose());
	await table.session.prompt("I look at the door frame");
	table.ui.notifications.length = 0;
	return table;
}

function lastNotice(table) {
	return table.ui.notifications.at(-1);
}

test("/coc module: the store, and which of those books can be played right now", async (t) => {
	const table = await openWithLibrary(t);

	await table.session.prompt("/coc module");
	const view = lastNotice(table).message;

	assert.match(view, /^modules .*\.coc\/modules$/m, "the store's path is on the first line");
	assert.match(view, /^ {2}the-haunting .*starter .*installed .*opening ready .*playable now$/m, "an installed book with its opening ready is playable");
	assert.match(view, /^ {2}amaranthine-desire .*pdf .*building .*pages 41 .*sections 1\/3 .*opening not ready .*not yet \(building\)$/m, "one still being read says so, with its section count");
	assert.match(view, /\/coc module parse <pdf>/, "it says how to read a new book in");

	// A read-out, nothing more: no turn, no player input, no model context.
	assert.equal(
		table.session.messages.filter((message) => message.role === "user").length,
		1,
		"the command did not become a player line",
	);
	assert.equal(
		table.kernelRequests().filter((row) => row.method === "table.player_input").length,
		1,
		"the turn state machine was not touched",
	);
});

test("/coc module use: no hot switch, just the two commands that start a table on that book", async (t) => {
	const table = await openWithLibrary(t);

	await table.session.prompt("/coc module use the-haunting");
	const view = lastNotice(table).message;
	assert.match(view, /^use {5}the-haunting {2}The Haunting {2}playable now$/m);
	assert.match(view, /cannot switch campaigns/, "it says plainly that a running session stays where it is");
	assert.match(view, /bin\/pi-coc setup/, "and how to start another table on it");
	assert.match(view, /bin\/pi-coc --campaign/);

	await table.session.prompt("/coc module use amaranthine-desire");
	assert.match(lastNotice(table).message, /not yet \(building\)/);
	assert.match(lastNotice(table).message, /not ready to play yet/, "a half-built book offers no command");

	await table.session.prompt("/coc module use nothing-like-that");
	assert.match(lastNotice(table).message, /is not in the store/);

	await table.session.prompt("/coc module use");
	assert.match(lastNotice(table).message, /which book\?/);
});

test("/coc module parse: it only puts the request on the bus, and the job's progress comes back to the person", async (t) => {
	const scratch = mkdtempSync(join(tmpdir(), "pi-coc-book-"));
	t.after(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
	const book = join(scratch, "An Amaranthine Desire.pdf");
	writeFileSync(book, "%PDF-1.4\nfake\n", "utf8");

	const table = await openWithLibrary(t, {
		env: {
			PI_COC_EXTRACT: JSON.stringify([execPath, FAKE_EXTRACT]),
			PI_COC_OCR_CMD: JSON.stringify([execPath, FAKE_OCR]),
			PI_COC_BUNDLE_CMD: JSON.stringify([execPath, FAKE_BUNDLE]),
			BAIDUOCR_TOKEN: "a-token",
			FAKE_PDF: JSON.stringify({ page_count: 2, pages_needing_ocr: [] }),
			FAKE_KERNEL_MODULE: JSON.stringify({
				module_id: "amaranthine-desire",
				library: LIBRARY,
				sections: [{ id: "front", priority: 100 }],
				opening_after: 1,
			}),
		},
	});

	await table.session.prompt(`/coc module parse "${book}" --id amaranthine-desire --language zh-Hans`);

	// The command carries no logic: it emits the same request a front end's file picker would (contract §20.4).
	const started = table.bus("coc:module-ingest");
	assert.equal(started.length, 1);
	assert.deepEqual(started[0].data, { pdf: book, module_id: "amaranthine-desire", language: "zh-Hans" });
	assert.match(table.ui.notifications[0].message, /^parse {3}.*An Amaranthine Desire\.pdf$/m, "the quoted path survived tokenising");
	assert.match(table.ui.notifications[0].message, /language zh-Hans {2}id amaranthine-desire/);

	const done = await waitFor(() => table.bus("coc:module-ingest-done")[0], { label: "the parse finished" });
	assert.equal(done.data.page_count, 2);
	// The progress and the ending reach the person through the same interface, not the Keeper.
	const lines = table.ui.notifications.map((row) => row.message);
	assert.ok(lines.some((line) => line.startsWith("parse   classify")), "the stages are reported");
	assert.ok(lines.some((line) => /^parse {3}done {2}amaranthine-desire/.test(line)), "so is the end");
	assert.equal(
		table.session.messages.filter((message) => message.role === "user").length,
		1,
		"none of it became a player line",
	);
	const row = table.entries("coc-telemetry").find((entry) => entry.lane === "command" && entry.command === "module parse");
	assert.equal(row.language, "zh-Hans");

	// The whole book landed under the workspace's own `.coc/ingest/<file digest>/`.
	assert.ok(existsSync(join(done.data.work_dir, "bundle", "manifest.json")));
	assert.match(readFileSync(join(done.data.work_dir, "pages", "0001.md"), "utf8"), /native text for page 1/);
});

test("/coc module parse: the language is asked for, never guessed, and a cancelled answer starts nothing", async (t) => {
	const asked = await openWithLibrary(t, { ui: createFakeUI({ inputs: ["en"] }) });
	await asked.session.prompt("/coc module parse /tmp/whatever.pdf");
	assert.equal(asked.ui.prompts.at(-1).kind, "input", "the person is asked");
	assert.match(asked.ui.prompts.at(-1).title, /BCP 47/);
	assert.equal(asked.bus("coc:module-ingest")[0].data.language, "en", "the answer is what the job gets");

	// The default fake interface cancels every prompt, which is a person pressing escape.
	const cancelled = await openWithLibrary(t);
	await cancelled.session.prompt("/coc module parse /tmp/whatever.pdf");
	assert.match(lastNotice(cancelled).message, /language has to be declared/);
	assert.equal(cancelled.bus("coc:module-ingest").length, 0, "nothing was started");

	await cancelled.session.prompt("/coc module parse");
	assert.match(lastNotice(cancelled).message, /give me a PDF to read/);

	await cancelled.session.prompt("/coc module frobnicate");
	assert.match(lastNotice(cancelled).message, /is not a \/coc module sub-command/);
});

test("/coc module outside an interactive terminal: one line, no bus request, no kernel call (contract §19.1)", async (t) => {
	// The harness binds print mode by default, the side the RPC driver is on.
	const table = await openTable({
		responses: keeperTurn("A deep scratch runs down the door frame."),
		env: { FAKE_KERNEL_MODULE: JSON.stringify({ module_id: "ingested-book", library: LIBRARY }) },
	});
	t.after(() => table.dispose());
	await table.session.prompt("I look at the door frame");
	table.ui.notifications.length = 0;
	const before = table.kernelRequests().length;

	for (const command of ["/coc module", "/coc module use the-haunting", "/coc module parse /tmp/book.pdf --language en"]) {
		await table.session.prompt(command);
	}

	assert.equal(table.ui.notifications.length, 3);
	for (const note of table.ui.notifications) {
		assert.equal(note.type, "warning");
		assert.match(note.message, /^\/coc is interactive only/);
	}
	assert.equal(table.bus("coc:module-ingest").length, 0, "no job is started");
	assert.deepEqual(
		table
			.kernelRequests()
			.slice(before)
			.map((row) => row.method)
			.filter((method) => !method.startsWith("module.deepen.")),
		[],
		"not one kernel call",
	);
});
