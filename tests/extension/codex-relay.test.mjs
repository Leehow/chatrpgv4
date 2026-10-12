import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { Type } from "typebox";
import { ModelRuntime } from "./pi.mjs";
import relayExtension from "../../extensions/codex-relay/agent/index.js";
import { createAuthProvider, normalizeRelayUrl } from "../../extensions/codex-relay/agent/provider.js";
import { providerExtensionManifests } from "../../runtime/deployment.mjs";

const root = resolve(import.meta.dirname, "../..");
const manifest = JSON.parse(readFileSync(join(root, "extensions/codex-relay/pipiui-extension.json")));

test("host, agent and lane discovery expose only Luna without Pi OAuth", () => {
    const provider = createAuthProvider({ env: {} });
    assert.deepEqual(provider.models, manifest.auth.provider.models);
    assert.deepEqual(provider.models.map(model => model.id), ["gpt-6-luna"]);
    assert.equal(provider.baseUrl, "http://127.0.0.1:18890/v1");
    assert.equal(provider.oauth, undefined);
    assert.equal(provider.apiKey, "codex-relay-local");
    let registered;
    relayExtension({ registerProvider: (id, config) => { registered = { id, config }; } });
    assert.equal(registered.id, "codex-relay");
    assert.deepEqual(registered.config.models, provider.models);
    assert.ok(providerExtensionManifests(root).some(entry => entry.providers.includes("codex-relay")));
    assert.match(readFileSync(join(root, "pipicoc/install"), "utf8"), /\['codex-relay',codexRelay.entry\]/);
});

test("endpoint selection uses extension settings and stays local", () => {
    const env = { PIPIUI_EXT_SETTINGS_CODEX_RELAY: JSON.stringify({ "ext.codex-relay.baseUrl": "http://localhost:18890/v1/" }) };
    assert.equal(createAuthProvider({ env }).baseUrl, "http://localhost:18890/v1");
    env.PIPICOC_CODEX_RELAY_URL = "http://127.0.0.1:18891/v1";
    assert.equal(createAuthProvider({ env }).baseUrl, env.PIPICOC_CODEX_RELAY_URL);
    assert.equal(normalizeRelayUrl("http://[::1]:18890/v1"), "http://[::1]:18890/v1");
    for (const url of ["https://api.openai.com/v1", "http://192.168.1.2/v1", "http://user:pass@localhost/v1", "http://localhost/v1?key=secret"]) {
        assert.throws(() => normalizeRelayUrl(url), /loopback/);
    }
});

test("real Pi registry sends tool schemas, reasoning and replay through Responses with no OAuth", async t => {
    const home = mkdtempSync(join(tmpdir(), "codex-relay-test-"));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const runtime = await ModelRuntime.create({ authPath: join(home, "auth.json"), modelsPath: null, cacheDir: null, allowModelNetwork: false });
    runtime.registerProvider("codex-relay", createAuthProvider({ env: {} }));
    const available = await runtime.getAvailable("codex-relay");
    assert.deepEqual(available.map(model => model.id), ["gpt-6-luna"]);
    const model = available[0];
    const requests = [];
    const fetch = async (url, init) => {
        requests.push({ url: String(url), body: JSON.parse(init.body) });
        const item = { type: "function_call", id: "fc_test", call_id: "call_test", name: "look", arguments: '{"focus":"room"}', status: "completed" };
        const events = [
            { type: "response.output_item.added", output_index: 0, item },
            { type: "response.output_item.done", output_index: 0, item },
            { type: "response.completed", response: { id: "resp_test", status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 0 } } } },
        ];
        return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
    };
    const context = { systemPrompt: "Use the look tool.", messages: [{ role: "user", content: "Inspect the room.", timestamp: Date.now() }],
        tools: [{ name: "look", description: "Inspect a focus.", parameters: Type.Object({ focus: Type.String() }) }] };
    const first = await runtime.completeSimple(model, context, { reasoning: "low", fetch, maxTokens: 512 });
    assert.equal(first.stopReason, "toolUse", first.errorMessage);
    assert.equal(first.content[0].name, "look");
    assert.deepEqual(first.content[0].arguments, { focus: "room" });
    const sent = requests[0];
    assert.equal(sent.url, "http://127.0.0.1:18890/v1/responses");
    assert.equal(sent.body.model, "gpt-6-luna");
    assert.equal(sent.body.reasoning.effort, "low");
    assert.equal(sent.body.tools[0].strict, false);
    assert.equal(sent.body.max_output_tokens, undefined);
    assert.equal(sent.body.prompt_cache_retention, undefined);
    context.messages.push(first, { role: "toolResult", toolCallId: first.content[0].id, toolName: "look", content: [{ type: "text", text: "The room is empty." }], isError: false, timestamp: Date.now() });
    const replay = await runtime.completeSimple(model, context, { reasoning: "off", fetch });
    assert.equal(replay.stopReason, "toolUse", replay.errorMessage);
    assert.equal(requests[1].body.reasoning.effort, "none");
    const call = requests[1].body.input.find(item => item.type === "function_call");
    const output = requests[1].body.input.find(item => item.type === "function_call_output");
    assert.equal(call.call_id, output.call_id);
});
