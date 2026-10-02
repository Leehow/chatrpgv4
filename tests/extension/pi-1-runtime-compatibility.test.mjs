/** Deterministic Pi upgrade seams; these are not live-table acceptance. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { Agent } from "./pi-agent-core.mjs";
import { SessionManager } from "./pi.mjs";
import { createCanonicalOperationDispatcher } from "../../extensions/kernel/canonical-operation-dispatcher.ts";

test("a driven run preserves provider observation, tool updates and native errors without continuation", async () => {
	const faux = fauxProvider();
	faux.setResponses([fauxAssistantMessage([fauxToolCall("probe", {})], { stopReason: "toolUse" })]);
	const log = [];
	const agent = new Agent({
		initialState: { model: faux.getModel(), thinkingLevel: "low", tools: [{
			name: "probe", label: "Probe", description: "Return a refusal with progress.", parameters: Type.Object({}),
			execute: async (_id, _args, _signal, onUpdate) => {
				onUpdate({ content: [{ type: "text", text: "checking" }], details: {} });
				return { content: [{ type: "text", text: "refused" }], details: { reason: "probe" }, isError: true };
			},
		}] },
		onProviderStreamEvent: async (data, model) => { log.push({ type: "raw", data, model: model.id }); },
		streamFn: async (model, context, options) => {
			await options.onProviderStreamEvent({ kind: "probe-event" }, model);
			return faux.provider.streamSimple(model, context, options);
		},
	});
	agent.subscribe(event => log.push(event));
	agent.continue = async () => { throw new Error("a driven run must not continue"); };
	const result = await agent.runDriven("probe", { policy: {
		name: "upgrade-probe", version: "1", initial: () => ({}), reduce: state => state,
		next: view => view.pendingProposals.length ? { kind: "operate", proposals: view.pendingProposals }
			: view.observations.length ? { kind: "finish", outcome: "undelivered", reason: "probe-complete" }
				: { kind: "infer", purpose: "adjudicate", reason: "probe" },
	} });
	assert.equal(result.reason, "probe-complete");
	const update = log.find(event => event.type === "tool_execution_update");
	const end = log.find(event => event.type === "tool_execution_end");
	assert.equal(update.toolCallId, end.toolCallId);
	assert.equal(update.partialResult.content[0].text, "checking");
	assert.equal(end.isError, true);
	assert.ok(log.findIndex(event => event.type === "raw") < log.findIndex(event => event.type === "message_start" && event.message.role === "assistant"));
	assert.ok(log.indexOf(update) < log.indexOf(end));
	assert.equal(agent.state.messages.find(message => message.role === "toolResult").isError, true);
	assert.equal(agent.state.messages.find(message => message.role === "assistant").thinkingLevel, "low");
	assert.equal(agent.state.isStreaming, false);
});

test("a first user message is durable before any assistant response exists", (t) => {
	const root = mkdtempSync(join(tmpdir(), "pi-first-input-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const manager = SessionManager.create(root, join(root, "sessions"));
	manager.appendMessage({ role: "user", content: "retain the first input", timestamp: Date.now() });
	const entries = readFileSync(manager.getSessionFile(), "utf8").trim().split("\n").map(line => JSON.parse(line));
	assert.equal(entries.filter(entry => entry.message?.role === "user").length, 1);
	assert.equal(entries.filter(entry => entry.message?.role === "assistant").length, 0);
	assert.equal(SessionManager.open(manager.getSessionFile()).buildSessionContext().messages[0].content, "retain the first input");
});

test("canonical COC execution returns native isError while preserving refusal details and finalization", async () => {
	const details = { coc_error: { code: "needs_choice", message: "choose the target" } };
	let finalized = 0;
	const dispatcher = createCanonicalOperationDispatcher({
		execute: async () => ({ content: [{ type: "text", text: "refused" }], details }),
		finalize: async () => { finalized++; return { isError: true }; },
	});
	const result = await dispatcher.execute();
	assert.equal(result.isError, true);
	assert.equal(result.details, details);
	assert.equal(finalized, 0);
	await dispatcher.finalize({ details: result.details });
	assert.equal(finalized, 1);
});
