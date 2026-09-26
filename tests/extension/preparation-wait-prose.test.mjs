/**
 * Contract §38.3 / §38.3's preparation handoff: a running preparation may spend one close steer,
 * but it must not discard every completed Keeper draft after that steer.
 *
 * These are deterministic extension-seam tests. The real Pi session, kernel RPC boundary, and Mod
 * bridge are used; only the upstream kernel and review lane are scripted dependencies.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { KernelError } from "../../extensions/kernel/client.ts";
import { FAKE_KERNEL, openTable, waitForIdle } from "./harness.mjs";

const PREPARE = fauxToolCall("lookup", {
	kind: "adaptation",
	action: "prepare",
	name: "luna-destination",
	purpose: "new_destination",
	request: "The destination the player chose",
	anchors: ["scene:commission-briefing"],
});

const firstDraft = "The first completed Keeper draft.";
const secondDraft = "The second completed Keeper draft is delivered.";

function textResponses() {
	return [
		fauxAssistantMessage([PREPARE], { stopReason: "toolUse" }),
		fauxAssistantMessage(firstDraft),
		fauxAssistantMessage(secondDraft),
	];
}

function installModsBridge(table, { prepare = async () => undefined, payloads = [] } = {}) {
	table.emit("coc:mods-bridge", {
		async after() {},
		async prepare(method, payload) {
			if (method === "narrate") payloads.push(structuredClone(payload));
			return prepare(method, payload);
		},
	});
}

function requests(table, method) {
	return table.kernelRequests().filter((request) => request.method === method);
}

function lookupResults(table) {
	return table.session.messages
		.filter((message) => message.role === "toolResult" && message.toolName === "lookup")
		.flatMap((message) => message.content)
		.flatMap((block) => {
			if (block.type !== "text") return [];
			try { return [JSON.parse(block.text)]; }
			catch { return []; }
		});
}

/** A review lane that has no verdict is a refusal boundary, not an approval. */
function unavailableReview() {
	return new KernelError({
		code: "needs",
		message: "Continuity review is paused",
		details: {
			reason: "continuity_review_unavailable",
			cause: "The fixture reviewer ended without a checked submission",
			service: true,
		},
	});
}

/**
 * The stock fixture has pending/ready adaptation states. This temporary dependency variant adds the
 * real third held state, reviewing, without replacing message_end or any host state in the test.
 */
async function reviewingKernel(t) {
	const fixtureDirectory = new URL("./fixtures/", import.meta.url).pathname;
	const path = join(fixtureDirectory, `.preparation-wait-reviewing-${process.pid}-${Date.now()}.mjs`);
	t.after(() => rm(path, { force: true }));
	const source = await readFile(FAKE_KERNEL, "utf8");
	const marker = "status: process.env.FAKE_KERNEL_ADAPTATION_PENDING === \"1\" ? \"pending\" : \"ready\"";
	const namedStatus = "\t\t\tadaptationStatusCalls += 1;";
	assert.equal(source.split(marker).length, 2, "the prepare boundary must be unique");
	assert.equal(source.split(namedStatus).length, 2, "the named status boundary must be unique");
	const prepared = source.replace(marker,
		"status: process.env.FAKE_KERNEL_ADAPTATION_REVIEWING === \"1\" ? \"reviewing\" : (" + marker.slice("status: ".length) + ")");
	await writeFile(path, prepared.replace(namedStatus, [
		namedStatus,
		"\t\t\tif (process.env.FAKE_KERNEL_ADAPTATION_REVIEWING === \"1\")",
		"\t\t\t\treturn { ok: true, result: { name: params.name, status: \"reviewing\" } };",
	].join("\n")));
	return path;
}

async function readyAfterSourceWaitKernel(t) {
	const fixtureDirectory = new URL("./fixtures/", import.meta.url).pathname;
	const path = join(fixtureDirectory, `.preparation-wait-ready-${process.pid}-${Date.now()}.mjs`);
	t.after(() => rm(path, { force: true }));
	const source = await readFile(FAKE_KERNEL, "utf8");
	// Target the named status branch, not the similarly shaped prepare result. Cold discovery
	// must remain none so the preceding source read can run before this proposal becomes ready.
	const marker = "\t\t\tadaptationStatusCalls += 1;";
	assert.equal(source.split(marker).length, 2, "the named status boundary must be unique");
	const replacement = [
		marker,
		"\t\t\tif (process.env.FAKE_KERNEL_READY_DURING_REFRESH === \"1\")",
		"\t\t\t\treturn { ok: true, result: { name: params.name, status: \"ready\" } };",
	].join("\n");
	await writeFile(path, source.replace(marker, replacement));
	return path;
}

async function runHeldPreparation(t, { kernel, env = {}, prepare, responses = textResponses() } = {}) {
	const payloads = [];
	const table = await openTable({
		env: {
			FAKE_KERNEL_ADAPTATION_PENDING: "1",
			PI_COC_ADAPTATION_WAIT_MS: "0",
			...(kernel ? { PI_COC_KERNEL_CMD: JSON.stringify([process.execPath, kernel]), FAKE_KERNEL_ADAPTATION_REVIEWING: "1" } : {}),
			...env,
		},
		responses,
	});
	t.after(() => table.dispose());
	installModsBridge(table, { prepare, payloads });
	await table.session.prompt("I follow the destination the player chose.");
	await waitForIdle(table.session);
	return { table, payloads };
}

test("pending preparation steers once, then delivers the second pure draft through implicit narrate", async (t) => {
	const { table, payloads } = await runHeldPreparation(t);
	const narrates = requests(table, "table.narrate");
	assert.equal(narrates.length, 1, "the second completed draft closes the real turn");
	assert.equal(narrates[0].params.text, secondDraft);
	assert.deepEqual(narrates[0].params.preparation_wait, { kind: "adaptation", name: "luna-destination" });

	const hostSteers = table.session.messages.filter((message) =>
		message.role === "custom" && message.customType === "coc-host" && message.details?.kind === "adaptation-wait");
	assert.equal(hostSteers.length, 1, "the first pure response spends exactly one preparation steer");
	assert.ok(table.telemetry().some((row) => row.reason === "preparation_wait_requires_close"),
		"the first pure response is dropped for the one bounded handoff");
	assert.ok(payloads.some((payload) => payload.preparation_wait?.kind === "adaptation"),
		"the implicit delivery still enters the Mod boundary with preparation context");
	assert.equal(requests(table, "table.apply").length, 0, "the prose-only repair does not move or create effects");
	assert.equal(requests(table, "adaptation.accept").length, 0, "a delivery never accepts the pending proposal");
	assert.ok(table.telemetry().some((row) => row.tool === "narrate" && row.ok === true),
		"the turn has a real successful narrate receipt, not merely assistant text");
});

test("reviewing preparation has the same one-steer handoff and preserves its context", async (t) => {
	const kernel = await reviewingKernel(t);
	const { table, payloads } = await runHeldPreparation(t, { kernel });
	assert.ok(lookupResults(table).some((result) => result.status === "reviewing"),
		"the fixture must actually expose reviewing rather than merely repeat the pending case");
	const narrates = requests(table, "table.narrate");
	assert.equal(narrates.length, 1, "reviewing work is still in flight, so the second draft may close normally");
	assert.equal(narrates[0].params.text, secondDraft);
	assert.deepEqual(narrates[0].params.preparation_wait, { kind: "adaptation", name: "luna-destination" });
	assert.ok(payloads.some((payload) => payload.preparation_wait?.kind === "adaptation"),
		"reviewing preparation context reaches mods.prepare on the implicit narrate");
	assert.equal(requests(table, "table.apply").length, 0);
	assert.equal(requests(table, "adaptation.accept").length, 0);
});

test("a ready proposal cannot use a source wait to bypass explicit control", async (t) => {
	const kernel = await readyAfterSourceWaitKernel(t);
	const table = await openTable({
		env: {
			PI_COC_KERNEL_CMD: JSON.stringify([process.execPath, kernel]),
			FAKE_KERNEL_ADAPTATION_PENDING: "1",
			FAKE_KERNEL_READING: "1",
			FAKE_KERNEL_READY_DURING_REFRESH: "1",
			PI_COC_ADAPTATION_WAIT_MS: "0",
		},
		responses: [
			fauxAssistantMessage([fauxToolCall("lookup", { kind: "source", query: "adventure-begins", question: "who holds the lamp" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([PREPARE], { stopReason: "toolUse" }),
			fauxAssistantMessage(firstDraft),
			fauxAssistantMessage([fauxToolCall("lookup", { kind: "adaptation", action: "status", name: "luna-destination" })], { stopReason: "toolUse" }),
			fauxAssistantMessage(secondDraft),
		],
	});
	t.after(() => table.dispose());
	table.emit("coc:reading-bridge", {
		async prepare() { return { ok: true }; },
		async ensure() {
			throw new KernelError({ code: "needs", message: "the source is still being read", details: {
				reason: "reading_timeout", read: { purpose: "detail", focus: "adventure-begins", question: "who holds the lamp" },
			} });
		},
		reading() { return true; },
	});
	await table.session.prompt("I reach for the destination after checking the source.");
	await waitForIdle(table.session);

	assert.ok(table.telemetry().some((row) => row.reason === "reading_timeout"),
		"the fixture must establish a real source wait before checking the ready boundary");
	assert.ok(lookupResults(table).some((result) => result.name === "luna-destination" && result.status === "ready"),
		"the named foreground status must actually report ready before its draft is checked");
	assert.equal(requests(table, "table.narrate").length, 0,
		"a ready proposal remains undelivered even while a source wait is present");
	assert.equal(requests(table, "table.apply").length, 0);
	assert.equal(requests(table, "adaptation.accept").length, 0);
	assert.ok(table.telemetry().some((row) => row.reason === "preparation_wait_requires_close"),
		"the ready control gate, not the source wait, owns the final pure draft");
	assert.ok(requests(table, "table.release").some((request) => request.params.release === "stranded"),
		"the unapproved ready proposal follows the existing stranded path");
});

test("a retained ready proposal never becomes an implicit delivery", async (t) => {
	const table = await openTable({
		env: {
			FAKE_KERNEL_RETAINED_ADAPTATION_STATUS: "ready",
			PI_COC_ADAPTATION_WAIT_MS: "0",
		},
		responses: [fauxAssistantMessage(firstDraft), fauxAssistantMessage(secondDraft)],
	});
	t.after(() => table.dispose());
	const payloads = [];
	installModsBridge(table, { payloads });
	await table.session.prompt("I return to the retained proposal.");
	await waitForIdle(table.session);

	assert.equal(requests(table, "table.narrate").length, 0,
		"ready requires an explicit adaptation control decision; prose cannot accept it");
	assert.equal(requests(table, "table.apply").length, 0);
	assert.equal(requests(table, "adaptation.accept").length, 0);
	assert.equal(payloads.length, 0, "the ready proposal is rejected before mods.prepare can make it a delivery");
	assert.ok(table.telemetry().some((row) => row.reason === "preparation_wait_requires_close"),
		"the dropped drafts name the retained-control boundary");
	assert.ok(requests(table, "table.release").some((request) => request.params.release === "stranded"),
		"two pure drafts cannot silently close a ready proposal");
});

test("a review-unavailable second draft remains undelivered and exposes the service outcome", async (t) => {
	const { table, payloads } = await runHeldPreparation(t, {
		prepare: async (method) => {
			if (method === "narrate") throw unavailableReview();
		},
	});
	assert.equal(requests(table, "table.narrate").length, 0,
		"review unavailability is not approval and never reaches the kernel delivery");
	assert.equal(payloads.length, 1, "the second draft reached the review boundary once");
	const refused = table.telemetry().find((row) => row.tool === "narrate" && row.ok === false);
	assert.equal(refused?.reason, "continuity_review_unavailable");
	const notices = table.session.messages.filter((message) =>
		message.role === "custom" && message.customType === "coc-delivery" && message.details?.review_unavailable);
	assert.equal(notices.length, 1, "the player receives the existing review service notice");
	assert.ok(requests(table, "table.release").some((request) => request.params.release === "stranded"),
		"the failed review leaves the turn on the existing stranded path");
});
