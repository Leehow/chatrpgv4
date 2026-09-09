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
import { extensionWords } from "../../extensions/ui/words.ts";
import { createFakeUI, openTable, waitFor } from "./harness.mjs";

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

test("/coc module parse forwards the original quoted path and keeps progress out of player context", async (t) => {
 const table = await openWithLibrary(t);
 await table.session.prompt('/coc module parse "/tmp/a book.pdf" --id a-book');
 const started=table.bus("coc:module-ingest");
 assert.equal(started.length,1);
 assert.deepEqual(started[0].data,{pdf:"/tmp/a book.pdf",module_id:"a-book"});
 assert.ok(table.ui.notifications.some(r=>r.message.includes("/tmp/a book.pdf")));
 await waitFor(()=>table.bus("coc:module-ingest-failed")[0],{label:"missing source is reported"});
 // Command-view fixtures; source processing is tested at its own seam.
 table.emit("coc:module-ingest-progress",{stage:"index",page:10,of:20});
 table.emit("coc:module-ingest-done",{module_id:"a-book",opening_ready:true});
 // The parse job's unprompted lines read their words from the campaign's `extension` surface
 // (contract §23); the page numbers and the module id inside them stay the job's own.
 const words = await extensionWords("zh-Hans");
 const english = await extensionWords("en");
 const page = words.line("parse_page",{page:10,of:20});
 assert.notEqual(page, english.line("parse_page",{page:10,of:20}), "a second language reports pages in its own words");
 await waitFor(()=>table.ui.notifications.some(r=>r.message.includes(page)),{label:"the progress line reaches the person"});
 await waitFor(()=>lastNotice(table).message.includes(words.word("parse_opening_ready")),{label:"the done line reaches the person"});
 assert.equal(table.session.messages.filter(m=>m.role==="user").length,1);
});

test("/coc module parse does not require the player to identify the source language", async (t) => {
 const table=await openWithLibrary(t);
 await table.session.prompt("/coc module parse /tmp/whatever.pdf");
 assert.equal(table.ui.prompts.filter(r=>r.kind==="input").length,0);
 assert.equal(table.bus("coc:module-ingest")[0].data.pdf,"/tmp/whatever.pdf");
 assert.equal(table.bus("coc:module-ingest")[0].data.language,undefined);
 await table.session.prompt("/coc module parse");
 assert.match(lastNotice(table).message,/give me a PDF to read/);
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
			.map((row) => row.method),
		[],
		"not one kernel call",
	);
});
