/**
 * S0 delivery-guard conformance through the real kernel extension/openTable seam.
 *
 * The semantic review and kernel are controlled faux backends. These cases prove placement and
 * re-checking of the generic delivery guard; they are not real Keeper, Jev, or product acceptance.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { openTable, waitForIdle } from "./harness.mjs";

const NO_BACKFILL = { PI_COC_MEMORY_BACKFILL: "0" };

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function explicit(tool = "narrate") {
	const args = tool === "ask"
		? { kind: "mechanics", text: "Choose whether to continue.", options: ["accept", "flee"] }
		: { text: "The guarded delivery reaches the player." };
	return [
		fauxAssistantMessage([fauxToolCall(tool, args)], { stopReason: "toolUse" }),
		fauxAssistantMessage(""),
	];
}

function implicit() {
	return [
		fauxAssistantMessage([fauxToolCall("look", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage("The guarded implicit delivery reaches the player."),
		fauxAssistantMessage(""),
	];
}

function deliveryRequests(table) {
	return table.kernelRequests().filter((row) => row.method === "table.narrate" || row.method === "table.ask");
}

function toolResults(table, name) {
	return table.session.messages.filter((message) => message.role === "toolResult" && message.toolName === name);
}

function guardExtension(control) {
	return {
		name: "jev-s0-delivery-guard-test",
		factory(pi) {
			pi.on("session_start", () => {
				if (control.guard) {
					pi.events.emit("coc:task-delivery-guard", (message) => {
						control.guardCalls.push(message);
						control.guard(message);
					});
				}
				if (control.review) {
					pi.events.emit("coc:mods-bridge", {
						async prepare(method, payload) {
							if (method === "narrate" || method === "ask") {
								control.reviewCalls.push({ method, payload: structuredClone(payload) });
								await control.review(method, payload);
							}
						},
					});
				}
				if (control.reading) {
					pi.events.emit("coc:reading-bridge", {
						async ensure(module, request) {
							control.readingCalls.push({ module, request: structuredClone(request) });
							return control.reading(module, request);
						},
					});
				}
			});
			pi.on("session_shutdown", () => pi.events.emit("coc:task-delivery-guard", undefined));
		},
	};
}

async function guardedTable(t, { responses, guard, review, reading, env = {} }) {
	const control = { guard, review, reading, guardCalls: [], reviewCalls: [], readingCalls: [] };
	const table = await openTable({
		responses,
		env: { ...NO_BACKFILL, PI_COC_SPEECH_STEER: "0", ...env },
		extraExtensions: [guardExtension(control)],
	});
	t.after(() => table.dispose());
	return { table, control };
}

async function play(table) {
	await table.session.prompt("Open the bounded delivery-guard conformance turn.").catch(() => undefined);
	await waitForIdle(table.session);
}

function assertTaskGuardError(table, tool) {
	const result = toolResults(table, tool).at(-1);
	assert.ok(result, `${tool} returns a normal Pi tool result carrying the guard refusal`);
	assert.equal(result.isError, true);
	assert.equal(result.details?.coc_error?.details?.reason, "task_delivery_blocked");
	return result;
}

test("conformance: no installed task guard preserves explicit and implicit delivery", async (t) => {
	await t.test("explicit narrate remains unchanged", async (t) => {
		const table = await openTable({ responses: explicit("narrate"), env: NO_BACKFILL });
		t.after(() => table.dispose());
		await play(table);
		assert.equal(deliveryRequests(table).filter((row) => row.method === "table.narrate").length, 1);
		assert.equal(table.committed().length, 1);
		assert.equal(toolResults(table, "narrate").at(-1)?.isError, false);
	});

	await t.test("implicit narrate remains unchanged", async (t) => {
		const table = await openTable({ responses: implicit(), env: { ...NO_BACKFILL, PI_COC_SPEECH_STEER: "0" } });
		t.after(() => table.dispose());
		await play(table);
		const narrates = deliveryRequests(table).filter((row) => row.method === "table.narrate");
		assert.equal(narrates.length, 1);
		assert.equal(narrates[0].params.implicit, true);
		assert.equal(table.committed().length, 1);
	});
});

for (const tool of ["narrate", "ask"]) {
	test(`conformance: an immediate task guard blocks explicit ${tool} before review and kernel invocation`, async (t) => {
		const { table, control } = await guardedTable(t, {
			responses: explicit(tool),
			guard() { throw new Error("S0 attempt expired before delivery"); },
			review: async () => { throw new Error("review must not run"); },
		});
		await play(table);

		assert.equal(control.guardCalls.length, 1);
		assert.equal(control.reviewCalls.length, 0);
		assert.equal(deliveryRequests(table).length, 0);
		assert.equal(table.committed().length, 0);
		assert.match(assertTaskGuardError(table, tool).content[0].text, /expired before delivery/);
	});
}

test("conformance: explicit delivery is rechecked after a semantic review crosses its deadline", async (t) => {
	let deadlineAt;
	const { table, control } = await guardedTable(t, {
		responses: explicit("narrate"),
		guard() {
			deadlineAt ??= Date.now() + 10;
			if (Date.now() >= deadlineAt) throw new Error("S0 attempt expired during review");
		},
		review: async () => delay(25),
	});
	await play(table);

	assert.equal(control.reviewCalls.length, 1);
	assert.equal(control.guardCalls.length, 2, "one check precedes review and one precedes kernel invocation");
	assert.equal(deliveryRequests(table).length, 0);
	assert.equal(table.committed().length, 0);
	assert.match(assertTaskGuardError(table, "narrate").content[0].text, /expired during review/);
});

test("conformance: implicit delivery is rechecked after a semantic review crosses its deadline", async (t) => {
	let deadlineAt;
	const { table, control } = await guardedTable(t, {
		responses: implicit(),
		guard(message) {
			assert.equal(message?.role, "assistant", "implicit checks carry the actual writer message");
			deadlineAt ??= Date.now() + 10;
			if (Date.now() >= deadlineAt) throw new Error("S0 implicit attempt expired during review");
		},
		review: async () => delay(25),
	});
	await play(table);

	assert.equal(control.reviewCalls.length, 1);
	assert.equal(control.guardCalls.length, 2);
	assert.equal(deliveryRequests(table).length, 0);
	assert.equal(table.committed().length, 0);
	assert.equal(table.telemetry().some((row) => row.tool === "narrate" && row.ok === false && row.implicit === true), true);
});

test("conformance: a material retry rechecks the task guard immediately before its second kernel invocation", async (t) => {
	let checks = 0;
	const material = {
		"table.narrate": {
			code: "needs",
			message: "delivery material is pending",
			details: { reason: "material_pending", read: { purpose: "detail", focus: "delivery-evidence", question: "" } },
		},
	};
	const { table, control } = await guardedTable(t, {
		responses: explicit("narrate"),
		guard() {
			checks += 1;
			if (checks === 3) throw new Error("S0 attempt expired before material retry");
		},
		review: async () => undefined,
		reading: async () => ({ status: "ready" }),
		env: { FAKE_KERNEL_ERRORS: JSON.stringify(material), FAKE_KERNEL_ERRORS_ONCE: "1" },
	});
	await play(table);

	assert.equal(control.reviewCalls.length, 2, "material retry reruns the ordinary Mod review before its guarded kernel invoke");
	assert.equal(control.readingCalls.length, 1);
	assert.equal(control.guardCalls.length, 3, "before review, before first invoke, before retry");
	assert.equal(deliveryRequests(table).filter((row) => row.method === "table.narrate").length, 1,
		"the first invoke reached the faux kernel and the guarded retry did not");
	assert.equal(table.committed().length, 0);
	assert.match(assertTaskGuardError(table, "narrate").content[0].text, /expired before material retry/);
});
