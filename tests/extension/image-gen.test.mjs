/**
 * Unit tests for extensions/image-gen: provider-aware routing, the vendor and
 * Codex adapters (with a stubbed fetch — no network), and the dispatch (an
 * explicit model choice wins, then Codex, then grok-build, with the grok host
 * library injected and a fake model registry for the Codex token).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { arch, platform, release, tmpdir } from "node:os";
import { join } from "node:path";
import { routeByModelId, routeImageModel, VENDOR_ADAPTERS } from "../../extensions/image-gen/agent/vendors.js";
import { createImageGenExtension, generateImage } from "../../extensions/image-gen/agent/index.js";
import { createComponent as createSettingsComponent } from "../../extensions/image-gen/app/settings-model.js";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PNG_B64 = PNG_BYTES.toString("base64");
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const JPEG_B64 = JPEG_BYTES.toString("base64");

function jsonResponse(body, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
		text: async () => JSON.stringify(body),
		headers: { get: () => null },
	};
}

function bytesResponse(bytes, contentType = "image/png") {
	return {
		ok: true,
		status: 200,
		arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
		text: async () => "",
		headers: { get: (name) => (String(name).toLowerCase() === "content-type" ? contentType : null) },
	};
}

function recordingFetch(...responses) {
	const calls = [];
	const fetchImpl = async (url, init) => {
		calls.push({ url: String(url), init });
		const next = responses.length > 1 ? responses.shift() : responses[0];
		if (!next) throw new Error(`unexpected fetch call: ${url}`);
		return next;
	};
	return { calls, fetchImpl };
}

function bodyOf(call) {
	return JSON.parse(call.init.body);
}

test("routeByModelId: the closed model-id mapping", () => {
	assert.equal(routeByModelId("gpt-image-1"), "openai");
	assert.equal(routeByModelId("dall-e-3"), "openai");
	assert.equal(routeByModelId("grok-2-image"), "xai");
	assert.equal(routeByModelId("doubao-seedream-4-0"), "ark");
	assert.equal(routeByModelId("gemini-2.5-flash-image"), "gemini");
	assert.equal(routeByModelId("qwen-image-3.0"), "dashscope-sync");
	assert.equal(routeByModelId("wan2.5"), "dashscope-async");
	assert.throws(() => routeByModelId("imagen-4"), /Imagen.*not supported/s);
	assert.throws(() => routeByModelId("random-model"), /no image-generation adapter knows the model/);
});

test("openai adapter: POST /v1/images/generations with Bearer, parses b64_json", async () => {
	const { calls, fetchImpl } = recordingFetch(jsonResponse({ data: [{ b64_json: PNG_B64 }] }));
	const out = await VENDOR_ADAPTERS.openai(
		{ kind: "gen", prompt: "a cat", aspectRatio: "16:9", images: [], model: "gpt-image-1" },
		{ apiKey: "sk-test", baseUrl: "https://api.openai.com", headers: {} },
		{ fetchImpl },
	);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, "https://api.openai.com/v1/images/generations");
	assert.equal(calls[0].init.method, "POST");
	assert.equal(calls[0].init.headers.authorization, "Bearer sk-test");
	const body = bodyOf(calls[0]);
	assert.equal(body.model, "gpt-image-1");
	assert.equal(body.prompt, "a cat");
	assert.equal(body.size, "1536x1024");
	assert.deepEqual(out.bytes, PNG_BYTES);
	assert.equal(out.mime, "image/png");
	assert.equal(out.model, "gpt-image-1");
});

test("openai adapter: a base URL already ending in /v1 is not doubled", async () => {
	const { calls, fetchImpl } = recordingFetch(jsonResponse({ data: [{ b64_json: PNG_B64 }] }));
	await VENDOR_ADAPTERS.openai(
		{ kind: "gen", prompt: "x", aspectRatio: "auto", images: [], model: "dall-e-3" },
		{ apiKey: "sk-test", baseUrl: "https://proxy.example.com/v1", headers: {} },
		{ fetchImpl },
	);
	assert.equal(calls[0].url, "https://proxy.example.com/v1/images/generations");
});

test("openai adapter: parses the url variant by fetching the result URL", async () => {
	const { calls, fetchImpl } = recordingFetch(
		jsonResponse({ data: [{ url: "https://cdn.example.com/img.png" }] }),
		bytesResponse(PNG_BYTES),
	);
	const out = await VENDOR_ADAPTERS.openai(
		{ kind: "gen", prompt: "a cat", aspectRatio: "1:1", images: [], model: "dall-e-3" },
		{ apiKey: "sk-test", baseUrl: "https://api.openai.com", headers: {} },
		{ fetchImpl },
	);
	assert.equal(calls.length, 2);
	assert.equal(calls[1].url, "https://cdn.example.com/img.png");
	assert.deepEqual(out.bytes, PNG_BYTES);
	assert.equal(out.mime, "image/png");
});

test("openai adapter: response_format goes to dall-e only, gpt-image omits it", async () => {
	const dallE = recordingFetch(jsonResponse({ data: [{ b64_json: PNG_B64 }] }));
	await VENDOR_ADAPTERS.openai(
		{ kind: "gen", prompt: "x", aspectRatio: "auto", images: [], model: "dall-e-3" },
		{ apiKey: "sk-test", baseUrl: "https://api.openai.com", headers: {} },
		{ fetchImpl: dallE.fetchImpl },
	);
	assert.equal(bodyOf(dallE.calls[0]).response_format, "b64_json");
	const gptImage = recordingFetch(jsonResponse({ data: [{ b64_json: PNG_B64 }] }));
	await VENDOR_ADAPTERS.openai(
		{ kind: "gen", prompt: "x", aspectRatio: "auto", images: [], model: "gpt-image-1" },
		{ apiKey: "sk-test", baseUrl: "https://api.openai.com", headers: {} },
		{ fetchImpl: gptImage.fetchImpl },
	);
	assert.equal(bodyOf(gptImage.calls[0]).response_format, undefined);
});

test("dashscope async adapter: image_edit is rejected instead of silently dropping the reference", async () => {
	await assert.rejects(
		VENDOR_ADAPTERS["dashscope-async"](
			{ kind: "edit", prompt: "x", aspectRatio: "auto", images: ["data:image/png;base64," + PNG_B64], model: "wan2.5" },
			{ apiKey: "ds-test", baseUrl: "https://dashscope.aliyuncs.com", headers: {} },
			{ fetchImpl: async () => { throw new Error("must not be called"); } },
		),
		/wan\/wanx image edit is not supported/,
	);
});

test("openai adapter: refuses a plain-HTTP base URL", async () => {
	await assert.rejects(
		VENDOR_ADAPTERS.openai(
			{ kind: "gen", prompt: "x", aspectRatio: "auto", images: [], model: "gpt-image-1" },
			{ apiKey: "sk-test", baseUrl: "http://insecure.example.com", headers: {} },
			{ fetchImpl: async () => { throw new Error("must not be called"); } },
		),
		/non-HTTPS/,
	);
});

test("gemini adapter: generateContent shape, x-goog-api-key, parses inlineData.data", async () => {
	const { calls, fetchImpl } = recordingFetch(
		jsonResponse({ candidates: [{ content: { parts: [{ text: "here it is" }, { inlineData: { mimeType: "image/png", data: PNG_B64 } }] } }] }),
	);
	const out = await VENDOR_ADAPTERS.gemini(
		{ kind: "gen", prompt: "a cat", aspectRatio: "16:9", images: [], model: "gemini-2.5-flash-image" },
		{ apiKey: "gm-test", baseUrl: "https://generativelanguage.googleapis.com", headers: {} },
		{ fetchImpl },
	);
	assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent");
	assert.equal(calls[0].init.headers["x-goog-api-key"], "gm-test");
	const body = bodyOf(calls[0]);
	assert.equal(body.contents[0].parts[0].text, "a cat");
	assert.deepEqual(body.generationConfig.responseModalities, ["TEXT", "IMAGE"]);
	assert.equal(body.generationConfig.imageConfig.aspectRatio, "16:9");
	assert.deepEqual(out.bytes, PNG_BYTES);
	assert.equal(out.mime, "image/png");
});

test("dashscope sync adapter: request shape and output.choices image URL", async () => {
	const { calls, fetchImpl } = recordingFetch(
		jsonResponse({ output: { choices: [{ message: { content: [{ text: "done" }, { image: "https://cdn.example.com/qwen.png" }] } }] } }),
		bytesResponse(JPEG_BYTES, "image/jpeg"),
	);
	const out = await VENDOR_ADAPTERS["dashscope-sync"](
		{ kind: "gen", prompt: "a cat", aspectRatio: "auto", images: [], model: "qwen-image-3.0" },
		{ apiKey: "ds-test", baseUrl: "https://dashscope.aliyuncs.com", headers: {} },
		{ fetchImpl },
	);
	assert.equal(calls[0].url, "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation");
	assert.equal(calls[0].init.headers.authorization, "Bearer ds-test");
	const body = bodyOf(calls[0]);
	assert.equal(body.model, "qwen-image-3.0");
	assert.equal(body.input.messages[0].role, "user");
	assert.equal(body.input.messages[0].content[0].text, "a cat");
	assert.equal(body.parameters.size, "1328*1328");
	assert.equal(calls[1].url, "https://cdn.example.com/qwen.png");
	assert.deepEqual(out.bytes, JPEG_BYTES);
	assert.equal(out.mime, "image/jpeg");
});

test("dashscope async adapter: X-DashScope-Async create, polls until SUCCEEDED", async () => {
	const { calls, fetchImpl } = recordingFetch(
		jsonResponse({ output: { task_id: "task-1", task_status: "PENDING" } }),
		jsonResponse({ output: { task_id: "task-1", task_status: "PENDING" } }),
		jsonResponse({ output: { task_id: "task-1", task_status: "SUCCEEDED", results: [{ url: "https://cdn.example.com/wan.png" }] } }),
		bytesResponse(PNG_BYTES),
	);
	const out = await VENDOR_ADAPTERS["dashscope-async"](
		{ kind: "gen", prompt: "a cat", aspectRatio: "auto", images: [], model: "wan2.5" },
		{ apiKey: "ds-test", baseUrl: "https://dashscope.aliyuncs.com", headers: {} },
		{ fetchImpl, pollIntervalMs: 1 },
	);
	assert.equal(calls.length, 4);
	assert.equal(calls[0].url, "https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation");
	assert.equal(calls[0].init.headers["X-DashScope-Async"], "enable");
	assert.equal(calls[1].url, "https://dashscope.aliyuncs.com/api/v1/tasks/task-1");
	assert.equal(calls[2].url, "https://dashscope.aliyuncs.com/api/v1/tasks/task-1");
	assert.equal(calls[3].url, "https://cdn.example.com/wan.png");
	assert.deepEqual(out.bytes, PNG_BYTES);
});

function fakePi() {
	const tools = new Map();
	const commands = new Map();
	return {
		tools,
		commands,
		api: {
			registerTool: (tool) => tools.set(tool.name, tool),
			registerCommand: (id, def) => commands.set(id, def),
		},
	};
}

// openai-codex answers only when the test hands it a token: a key for "any provider" would
// otherwise leak into the Codex usability check and hide which route a test exercises.
function fakeCtx({ apiKey = "sk-test", models = [], codexToken } = {}) {
	return {
		modelRegistry: {
			find: (provider, id) => models.find((m) => m.provider === provider && m.id === id),
			getAll: () => models,
			getApiKeyForProvider: async (provider) => (provider === "openai-codex" ? codexToken : apiKey),
		},
	};
}

test("dispatch: grok usable and nothing configured delegates to the grok path and never touches fetch", async () => {
	const { tools, api } = fakePi();
	createImageGenExtension({
		grok: {
			usable: async () => true,
			generate: async () => ({ path: "/tmp/grok/1.jpg", mime: "image/jpeg", b64: JPEG_B64, model: "grok-imagine-image", backend: "grok-build" }),
			edit: async () => { throw new Error("not this call"); },
		},
		readConfiguredModel: () => undefined,
		fetchImpl: async () => { throw new Error("vendor fetch must not run when grok is usable"); },
	})(api);
	const result = await tools.get("image_gen").execute("call-1", { prompt: "a cat" }, undefined, undefined, fakeCtx());
	assert.equal(result.details.backend, "grok-build");
	assert.equal(result.details.model, "grok-imagine-image");
	assert.equal(result.details.path, "/tmp/grok/1.jpg");
	assert.equal(result.content[1].type, "image");
	assert.equal(result.content[1].data, JPEG_B64);
});

test("dispatch: a configured model wins over a usable grok login", async () => {
	const { tools, api } = fakePi();
	const { calls, fetchImpl } = recordingFetch(jsonResponse({ data: [{ b64_json: PNG_B64 }] }));
	createImageGenExtension({
		grok: {
			usable: async () => true,
			generate: async () => { throw new Error("grok must not run when a model is configured"); },
			edit: async () => { throw new Error("grok must not run when a model is configured"); },
		},
		readConfiguredModel: () => ({ model: "openai/gpt-image-1" }),
		makeWriter: () => ({ save: async () => ({ path: "/tmp/img/1.jpg", mime: "image/png" }) }),
		fetchImpl,
	})(api);
	const ctx = fakeCtx({ models: [{ provider: "openai", id: "gpt-image-1", baseUrl: "https://api.openai.com" }] });
	const result = await tools.get("image_gen").execute("call-1", { prompt: "a cat" }, undefined, undefined, ctx);
	assert.equal(calls.length, 1);
	assert.equal(result.details.backend, "openai");
	assert.equal(result.details.model, "gpt-image-1");
});

test("dispatch: the tool model parameter wins over a usable grok login", async () => {
	const { tools, api } = fakePi();
	const { calls, fetchImpl } = recordingFetch(
		jsonResponse({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: PNG_B64 } }] } }] }),
	);
	createImageGenExtension({
		grok: {
			usable: async () => true,
			generate: async () => { throw new Error("grok must not run when the call names a model"); },
			edit: async () => { throw new Error("grok must not run when the call names a model"); },
		},
		readConfiguredModel: () => undefined,
		makeWriter: () => ({ save: async () => ({ path: "/tmp/img/2.jpg", mime: "image/png" }) }),
		fetchImpl,
	})(api);
	const result = await tools.get("image_gen").execute(
		"call-1",
		{ prompt: "a cat", model: "gemini/gemini-2.5-flash-image" },
		undefined, undefined,
		fakeCtx({ apiKey: "gm-test" }),
	);
	assert.ok(calls[0].url.includes(":generateContent"));
	assert.equal(result.details.backend, "gemini");
});

test("dispatch: a failing configured model surfaces the error and never falls back to grok", async () => {
	const { tools, api } = fakePi();
	createImageGenExtension({
		grok: {
			usable: async () => true,
			generate: async () => { throw new Error("grok must not run as a fallback"); },
			edit: async () => { throw new Error("grok must not run as a fallback"); },
		},
		readConfiguredModel: () => ({ model: "openai/gpt-image-1" }),
		fetchImpl: async () => { throw new Error("vendor upstream exploded"); },
	})(api);
	const ctx = fakeCtx({ models: [{ provider: "openai", id: "gpt-image-1", baseUrl: "https://api.openai.com" }] });
	await assert.rejects(
		tools.get("image_gen").execute("call-1", { prompt: "a cat" }, undefined, undefined, ctx),
		/vendor upstream exploded/,
	);
});

test("dispatch: grok unusable + configured model takes the vendor path", async () => {
	const { tools, api } = fakePi();
	const { calls, fetchImpl } = recordingFetch(jsonResponse({ data: [{ b64_json: PNG_B64 }] }));
	createImageGenExtension({
		grok: { usable: async () => false },
		readConfiguredModel: () => ({ model: "openai/gpt-image-1" }),
		makeWriter: () => ({ save: async () => ({ path: "/tmp/img/1.jpg", mime: "image/png" }) }),
		fetchImpl,
	})(api);
	const ctx = fakeCtx({ models: [{ provider: "openai", id: "gpt-image-1", baseUrl: "https://api.openai.com" }] });
	const result = await tools.get("image_gen").execute("call-1", { prompt: "a cat" }, undefined, undefined, ctx);
	assert.equal(calls.length, 1);
	assert.equal(result.details.backend, "openai");
	assert.equal(result.details.model, "gpt-image-1");
	assert.equal(result.details.path, "/tmp/img/1.jpg");
	assert.equal(result.details.mime, "image/png");
	assert.equal(typeof result.content[0].text, "string");
	assert.ok(result.content[0].text.includes("/tmp/img/1.jpg"));
	assert.equal(result.content[1].type, "image");
	assert.equal(result.content[1].mimeType, "image/png");
	assert.equal(result.content[1].data, PNG_B64);
});

test("dispatch: the tool model parameter wins over the configured model", async () => {
	const { tools, api } = fakePi();
	const { calls, fetchImpl } = recordingFetch(
		jsonResponse({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: PNG_B64 } }] } }] }),
	);
	createImageGenExtension({
		grok: { usable: async () => false },
		readConfiguredModel: () => ({ model: "openai/gpt-image-1" }),
		makeWriter: () => ({ save: async () => ({ path: "/tmp/img/2.jpg", mime: "image/png" }) }),
		fetchImpl,
	})(api);
	const result = await tools.get("image_gen").execute(
		"call-1",
		{ prompt: "a cat", model: "gemini/gemini-2.5-flash-image" },
		undefined, undefined,
		fakeCtx({ apiKey: "gm-test" }),
	);
	assert.ok(calls[0].url.includes(":generateContent"));
	assert.equal(result.details.backend, "gemini");
});

test("dispatch: neither grok nor a configured model errors naming /image-gen:model", async () => {
	const { tools, api } = fakePi();
	createImageGenExtension({ grok: { usable: async () => false }, readConfiguredModel: () => undefined })(api);
	await assert.rejects(
		tools.get("image_gen").execute("call-1", { prompt: "a cat" }, undefined, undefined, fakeCtx()),
		(error) => {
			// The stable code is how host lanes tell "go configure a model" from a vendor failure.
			assert.match(error.message, /image-gen:model/);
			assert.equal(error.code, "image_model_unconfigured");
			return true;
		},
	);
});

test("dispatch: an unknown configured model fails with the supported families", async () => {
	const { tools, api } = fakePi();
	createImageGenExtension({
		grok: { usable: async () => false },
		readConfiguredModel: () => ({ model: "acme/random-model" }),
	})(api);
	await assert.rejects(
		tools.get("image_gen").execute("call-1", { prompt: "a cat" }, undefined, undefined, fakeCtx()),
		/no image-generation adapter knows the model/,
	);
});

test("dispatch: grok usable but the call fails surfaces the error and never falls back", async () => {
	const { tools, api } = fakePi();
	createImageGenExtension({
		grok: {
			usable: async () => true,
			generate: async () => { throw new Error("grok upstream exploded"); },
			edit: async () => { throw new Error("not this call"); },
		},
		readConfiguredModel: () => undefined,
		fetchImpl: async () => { throw new Error("vendor fetch must not run when the grok call fails"); },
	})(api);
	await assert.rejects(
		tools.get("image_gen").execute("call-1", { prompt: "a cat" }, undefined, undefined, fakeCtx()),
		/grok upstream exploded/,
	);
});

test("dispatch: no API key for the resolved provider errors before any fetch", async () => {
	const { tools, api } = fakePi();
	const { calls, fetchImpl } = recordingFetch(jsonResponse({ data: [{ b64_json: PNG_B64 }] }));
	createImageGenExtension({
		grok: { usable: async () => false },
		readConfiguredModel: () => ({ model: "openai/gpt-image-1" }),
		fetchImpl,
	})(api);
	await assert.rejects(
		tools.get("image_gen").execute("call-1", { prompt: "a cat" }, undefined, undefined, fakeCtx({ apiKey: null, models: [{ provider: "openai", id: "gpt-image-1" }] })),
		/no API key is configured for provider "openai"/,
	);
	assert.equal(calls.length, 0);
});

test("commands: image-gen:model validates, persists and reports", async () => {
	const { commands, api } = fakePi();
	const written = [];
	const notices = [];
	createImageGenExtension({
		grok: { usable: async () => false },
		readConfiguredModel: () => ({ model: "openai/gpt-image-1" }),
		writeConfiguredModel: (model) => written.push(model),
	})(api);
	const ctx = { ui: { notify: (msg) => notices.push(msg) } };
	await commands.get("image-gen:model").handler("", ctx);
	assert.ok(notices.at(-1).includes("openai/gpt-image-1"));
	await commands.get("image-gen:model").handler("gemini/gemini-2.5-flash-image", ctx);
	assert.deepEqual(written, ["gemini/gemini-2.5-flash-image"]);
	assert.ok(notices.at(-1).includes("gemini"));
	await commands.get("image-gen:model").handler("acme/random-model", ctx);
	assert.deepEqual(written, ["gemini/gemini-2.5-flash-image"], "an unroutable model is not persisted");
});

// ---------------------------------------------------------------------------
// Codex route (contract §172): the player's ChatGPT subscription through Pi's
// built-in openai-codex login. Tokens are fake JWTs built here; nothing leaves
// the process.
// ---------------------------------------------------------------------------

function fakeJwt(authClaim) {
	const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
	return `${part({ alg: "RS256", typ: "JWT" })}.${part({ exp: 4102444800, "https://api.openai.com/auth": authClaim })}.c2lnbmF0dXJl`;
}

const CODEX_TOKEN = fakeJwt({ chatgpt_account_id: "acct-123", chatgpt_plan_type: "plus" });
const CODEX_FREE_TOKEN = fakeJwt({ chatgpt_account_id: "acct-123", chatgpt_plan_type: "free" });
const CODEX_NO_ACCOUNT_TOKEN = fakeJwt({ chatgpt_plan_type: "pro" });
const CODEX_CREDS = { apiKey: CODEX_TOKEN, accountId: "acct-123" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function codexResponse(bytes = PNG_BYTES) {
	return jsonResponse({ created: 1, data: [{ b64_json: bytes.toString("base64") }] });
}

function errorResponse(status, body, headers = {}) {
	const raw = typeof body === "string" ? body : JSON.stringify(body);
	return {
		ok: false,
		status,
		json: async () => JSON.parse(raw),
		text: async () => raw,
		headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
	};
}

function codexGen(fields = {}) {
	return { kind: "gen", prompt: "a brass key", images: [], model: "gpt-image-2", ...fields };
}

const grokThatMustNotRun = {
	usable: async () => true,
	generate: async () => { throw new Error("grok must not run on this route"); },
	edit: async () => { throw new Error("grok must not run on this route"); },
};

const savingWriter = () => ({ save: async () => ({ path: "/tmp/img/codex.png", mime: "image/png" }) });

test("routeImageModel: provider openai-codex is the Codex adapter; other providers keep the model-id map", () => {
	assert.equal(routeImageModel("openai-codex", "gpt-image-2"), "codex");
	assert.equal(routeImageModel("openai", "gpt-image-2"), "openai", "gpt-image still means the OpenAI Images API");
	assert.equal(routeImageModel(undefined, "gpt-image-2"), "openai", "a bare id never reaches Codex");
	assert.equal(routeImageModel("gemini", "gemini-2.5-flash-image"), "gemini");
	assert.throws(() => routeImageModel("acme", "random-model"), /no image-generation adapter knows the model/);
});

test("codex adapter: generation request shape — URL, every header, fixed body, nothing else", async () => {
	const { calls, fetchImpl } = recordingFetch(codexResponse(), codexResponse());
	await VENDOR_ADAPTERS.codex(codexGen(), CODEX_CREDS, { fetchImpl });
	await VENDOR_ADAPTERS.codex(codexGen(), CODEX_CREDS, { fetchImpl });
	assert.equal(calls[0].url, "https://chatgpt.com/backend-api/codex/images/generations");
	assert.equal(calls[0].init.method, "POST");
	const headers = calls[0].init.headers;
	assert.deepEqual(Object.keys(headers).sort(), [
		"Authorization", "ChatGPT-Account-ID", "Content-Type", "User-Agent", "originator", "x-codex-image-turn-id",
	].sort());
	assert.equal(headers.Authorization, `Bearer ${CODEX_TOKEN}`);
	assert.equal(headers["ChatGPT-Account-ID"], "acct-123");
	assert.equal(headers.originator, "pi");
	assert.equal(headers["User-Agent"], `pi (${platform()} ${release()}; ${arch()})`);
	assert.match(headers["x-codex-image-turn-id"], UUID);
	assert.notEqual(headers["x-codex-image-turn-id"], calls[1].init.headers["x-codex-image-turn-id"], "a fresh turn id per call");
	assert.equal(headers["Content-Type"], "application/json");
	assert.deepEqual(bodyOf(calls[0]), {
		prompt: "a brass key", model: "gpt-image-2", background: "auto", quality: "auto", size: "auto",
	}, "the fixed values Codex CLI sends; never n or response_format");
	// The token rides in Authorization and nowhere else.
	const { Authorization: _auth, ...rest } = headers;
	assert.equal(JSON.stringify(rest).includes(CODEX_TOKEN), false);
	assert.equal(calls[0].init.body.includes(CODEX_TOKEN), false);
});

test("codex adapter: the aspect ratio travels as a fixed sentence at the head of the prompt", async () => {
	const cases = [
		["3:4", "Vertical portrait-orientation image, 3:4 aspect ratio, taller than wide. a brass key"],
		["9:16", "Vertical portrait-orientation image, 9:16 aspect ratio, taller than wide. a brass key"],
		["16:9", "Horizontal landscape-orientation image, 16:9 aspect ratio, wider than tall. a brass key"],
		["1:1", "Square image, 1:1 aspect ratio. a brass key"],
		["5:4", "Square image, 1:1 aspect ratio. a brass key"],
		["auto", "a brass key"],
		[undefined, "a brass key"],
	];
	for (const [aspectRatio, prompt] of cases) {
		const { calls, fetchImpl } = recordingFetch(codexResponse());
		await VENDOR_ADAPTERS.codex(codexGen({ aspectRatio }), CODEX_CREDS, { fetchImpl });
		const body = bodyOf(calls[0]);
		assert.equal(body.prompt, prompt, `aspect ratio ${aspectRatio}`);
		assert.equal(body.size, "auto", "size stays auto: the server ignores it");
	}
	const edit = recordingFetch(codexResponse());
	await VENDOR_ADAPTERS.codex(
		{ kind: "edit", prompt: "same face", aspectRatio: "3:4", images: [`data:image/png;base64,${PNG_B64}`], model: "gpt-image-2" },
		CODEX_CREDS, { fetchImpl: edit.fetchImpl },
	);
	assert.equal(bodyOf(edit.calls[0]).prompt, "Vertical portrait-orientation image, 3:4 aspect ratio, taller than wide. same face");
});

test("codex adapter: edits are JSON with data-URL references, between 1 and 5", async () => {
	const refs = [`data:image/png;base64,${PNG_B64}`, `data:image/jpeg;base64,${JPEG_B64}`];
	const { calls, fetchImpl } = recordingFetch(codexResponse());
	await VENDOR_ADAPTERS.codex({ kind: "edit", prompt: "remix", images: refs, model: "gpt-image-2" }, CODEX_CREDS, { fetchImpl });
	assert.equal(calls[0].url, "https://chatgpt.com/backend-api/codex/images/edits");
	assert.equal(typeof calls[0].init.body, "string", "JSON, never multipart");
	assert.equal(calls[0].init.headers["Content-Type"], "application/json");
	const body = bodyOf(calls[0]);
	assert.deepEqual(body.images, refs.map((image_url) => ({ image_url })));
	assert.equal(body.n, undefined);
	assert.equal(body.response_format, undefined);
	const five = recordingFetch(codexResponse());
	await VENDOR_ADAPTERS.codex({ kind: "edit", prompt: "x", images: Array(5).fill(refs[0]), model: "gpt-image-2" }, CODEX_CREDS, { fetchImpl: five.fetchImpl });
	assert.equal(bodyOf(five.calls[0]).images.length, 5);
	const never = async () => { throw new Error("must not be called"); };
	await assert.rejects(
		VENDOR_ADAPTERS.codex({ kind: "edit", prompt: "x", images: Array(6).fill(refs[0]), model: "gpt-image-2" }, CODEX_CREDS, { fetchImpl: never }),
		/at most 5 reference images/,
	);
	await assert.rejects(
		VENDOR_ADAPTERS.codex({ kind: "edit", prompt: "x", images: [], model: "gpt-image-2" }, CODEX_CREDS, { fetchImpl: never }),
		/at least one reference image/,
	);
});

test("codex adapter: data[0].b64_json decodes to bytes with a sniffed mime; missing data is an error", async () => {
	const ok = recordingFetch(codexResponse(JPEG_BYTES));
	const out = await VENDOR_ADAPTERS.codex(codexGen(), CODEX_CREDS, { fetchImpl: ok.fetchImpl });
	assert.deepEqual(out.bytes, JPEG_BYTES);
	assert.equal(out.mime, "image/jpeg");
	assert.equal(out.model, "gpt-image-2");
	for (const body of [{}, { data: [] }, { data: [{ url: "https://cdn.example.com/x.png" }] }]) {
		const missing = recordingFetch(jsonResponse(body));
		await assert.rejects(VENDOR_ADAPTERS.codex(codexGen(), CODEX_CREDS, { fetchImpl: missing.fetchImpl }), /missing data\[0\]\.b64_json/);
		assert.equal(missing.calls.length, 1, "a url result is not fetched: the Codex result is b64 only");
	}
});

test("codex adapter: a 429 usage_limit_reached is image_quota_exhausted with resets_at and the limit id verbatim", async () => {
	const { fetchImpl } = recordingFetch(errorResponse(429,
		{ error: { type: "usage_limit_reached", message: "limit", resets_at: 1791158400 } },
		{ "x-codex-active-limit": "imagegen_premium" }));
	await assert.rejects(VENDOR_ADAPTERS.codex(codexGen(), CODEX_CREDS, { fetchImpl }), (error) => {
		assert.equal(error.code, "image_quota_exhausted");
		assert.equal(error.resets_at, 1791158400);
		assert.equal(error.limit, "imagegen_premium");
		assert.match(error.message, /imagegen_premium/);
		assert.match(error.message, new RegExp(new Date(1791158400 * 1000).toISOString().replace(/[.]/g, "\\.")));
		assert.equal(error.message.includes(CODEX_TOKEN), false);
		return true;
	});
	// Another limit id is reported the same way: nothing is matched against a list.
	const other = recordingFetch(errorResponse(429, { error: { type: "usage_limit_reached" } }, { "x-codex-active-limit": "some_future_limit" }));
	await assert.rejects(VENDOR_ADAPTERS.codex(codexGen(), CODEX_CREDS, { fetchImpl: other.fetchImpl }), (error) => {
		assert.equal(error.code, "image_quota_exhausted");
		assert.equal(error.limit, "some_future_limit");
		assert.equal("resets_at" in error, false);
		return true;
	});
});

test("codex adapter: any other non-2xx keeps the generic shape, with the token redacted", async () => {
	const rateLimited = recordingFetch(errorResponse(429, { error: { type: "rate_limit_exceeded" } }));
	await assert.rejects(VENDOR_ADAPTERS.codex(codexGen(), CODEX_CREDS, { fetchImpl: rateLimited.fetchImpl }), (error) => {
		assert.equal(error.code, undefined);
		assert.match(error.message, /^image request failed HTTP 429: /);
		return true;
	});
	const echoed = recordingFetch(errorResponse(500, `bad token ${CODEX_TOKEN.slice(0, 40)}`));
	await assert.rejects(VENDOR_ADAPTERS.codex(codexGen(), { apiKey: CODEX_TOKEN.slice(0, 40), accountId: "acct-123" }, { fetchImpl: echoed.fetchImpl }), (error) => {
		assert.match(error.message, /^image request failed HTTP 500: bad token \[redacted\]$/);
		return true;
	});
});

test("dispatch: Codex usable beats a usable grok when nothing is chosen; the token stays out of the result", async () => {
	const { tools, api } = fakePi();
	const { calls, fetchImpl } = recordingFetch(codexResponse());
	createImageGenExtension({ grok: grokThatMustNotRun, readConfiguredModel: () => undefined, makeWriter: savingWriter, fetchImpl })(api);
	const result = await tools.get("image_gen").execute("call-1", { prompt: "a cat", aspect_ratio: "3:4" }, undefined, undefined, fakeCtx({ codexToken: CODEX_TOKEN }));
	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, "https://chatgpt.com/backend-api/codex/images/generations");
	assert.equal(calls[0].init.headers["ChatGPT-Account-ID"], "acct-123");
	assert.match(bodyOf(calls[0]).prompt, /^Vertical portrait-orientation image, 3:4 aspect ratio/);
	assert.equal(result.details.backend, "codex");
	assert.equal(result.details.model, "gpt-image-2");
	assert.equal(JSON.stringify(result).includes(CODEX_TOKEN), false);
});

test("dispatch: image_edit on the Codex route sends the references as data URLs", async () => {
	const { tools, api } = fakePi();
	const { calls, fetchImpl } = recordingFetch(codexResponse());
	createImageGenExtension({ grok: grokThatMustNotRun, readConfiguredModel: () => undefined, makeWriter: savingWriter, fetchImpl })(api);
	const ref = `data:image/png;base64,${PNG_B64}`;
	await tools.get("image_edit").execute("call-1", { prompt: "same face", image: [ref] }, undefined, undefined, fakeCtx({ codexToken: CODEX_TOKEN }));
	assert.equal(calls[0].url, "https://chatgpt.com/backend-api/codex/images/edits");
	assert.deepEqual(bodyOf(calls[0]).images, [{ image_url: ref }]);
});

test("dispatch: a configured model and the tool model parameter both beat a usable Codex", async () => {
	const ctx = fakeCtx({ codexToken: CODEX_TOKEN, models: [{ provider: "openai", id: "gpt-image-1", baseUrl: "https://api.openai.com" }] });
	const configured = fakePi();
	const first = recordingFetch(jsonResponse({ data: [{ b64_json: PNG_B64 }] }));
	createImageGenExtension({ grok: grokThatMustNotRun, readConfiguredModel: () => ({ model: "openai/gpt-image-1" }), makeWriter: savingWriter, fetchImpl: first.fetchImpl })(configured.api);
	const one = await configured.tools.get("image_gen").execute("call-1", { prompt: "a cat" }, undefined, undefined, ctx);
	assert.equal(first.calls[0].url, "https://api.openai.com/v1/images/generations");
	assert.equal(one.details.backend, "openai");
	const param = fakePi();
	const second = recordingFetch(jsonResponse({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: PNG_B64 } }] } }] }));
	createImageGenExtension({ grok: grokThatMustNotRun, readConfiguredModel: () => undefined, makeWriter: savingWriter, fetchImpl: second.fetchImpl })(param.api);
	const two = await param.tools.get("image_gen").execute("call-1", { prompt: "a cat", model: "gemini/gemini-2.5-flash-image" }, undefined, undefined, ctx);
	assert.ok(second.calls[0].url.includes(":generateContent"));
	assert.equal(two.details.backend, "gemini");
});

test("dispatch: a bare gpt-image-2 keeps the registry lookup and never reaches Codex", async () => {
	const { tools, api } = fakePi();
	const { calls, fetchImpl } = recordingFetch(jsonResponse({ data: [{ b64_json: PNG_B64 }] }));
	createImageGenExtension({ grok: grokThatMustNotRun, readConfiguredModel: () => ({ model: "gpt-image-2" }), makeWriter: savingWriter, fetchImpl })(api);
	const ctx = fakeCtx({ codexToken: CODEX_TOKEN, models: [{ provider: "openai", id: "gpt-image-2", baseUrl: "https://api.openai.com" }] });
	const result = await tools.get("image_gen").execute("call-1", { prompt: "a cat" }, undefined, undefined, ctx);
	assert.equal(calls[0].url, "https://api.openai.com/v1/images/generations");
	assert.equal(result.details.backend, "openai");
});

test("dispatch: an explicit openai-codex/gpt-image-2 pins Codex even when grok is usable", async () => {
	const { tools, api } = fakePi();
	const { calls, fetchImpl } = recordingFetch(codexResponse());
	createImageGenExtension({ grok: grokThatMustNotRun, readConfiguredModel: () => ({ model: "openai-codex/gpt-image-2" }), makeWriter: savingWriter, fetchImpl })(api);
	const result = await tools.get("image_gen").execute("call-1", { prompt: "a cat" }, undefined, undefined, fakeCtx({ codexToken: CODEX_TOKEN }));
	assert.equal(calls[0].url, "https://chatgpt.com/backend-api/codex/images/generations");
	assert.equal(result.details.backend, "codex");
});

test("dispatch: an unusable Codex falls to grok automatically — free plan, no account claim, no token, a throwing registry, no context", async () => {
	const throwing = { modelRegistry: { getApiKeyForProvider: async () => { throw new Error("refresh failed"); } } };
	for (const ctx of [
		fakeCtx({ codexToken: CODEX_FREE_TOKEN }),
		fakeCtx({ codexToken: CODEX_NO_ACCOUNT_TOKEN }),
		fakeCtx({ codexToken: "not-a-jwt" }),
		fakeCtx(),
		throwing,
		undefined,
	]) {
		const { tools, api } = fakePi();
		let grokCalls = 0;
		createImageGenExtension({
			grok: {
				usable: async () => true,
				generate: async () => { grokCalls++; return { path: "/tmp/grok/1.jpg", mime: "image/jpeg", b64: JPEG_B64, model: "grok-imagine-image", backend: "grok-build" }; },
			},
			readConfiguredModel: () => undefined,
			fetchImpl: async () => { throw new Error("the Codex endpoint must not be called"); },
		})(api);
		const result = await tools.get("image_gen").execute("call-1", { prompt: "a cat" }, undefined, undefined, ctx);
		assert.equal(result.details.backend, "grok-build");
		assert.equal(grokCalls, 1);
	}
});

test("dispatch: neither Codex nor grok usable refuses with image_model_unconfigured", async () => {
	const { tools, api } = fakePi();
	createImageGenExtension({ grok: { usable: async () => false }, readConfiguredModel: () => undefined, fetchImpl: async () => { throw new Error("no fetch"); } })(api);
	await assert.rejects(
		tools.get("image_gen").execute("call-1", { prompt: "a cat" }, undefined, undefined, fakeCtx({ codexToken: CODEX_FREE_TOKEN })),
		(error) => error.code === "image_model_unconfigured",
	);
});

test("dispatch: an explicit Codex choice that cannot run fails with its own code and never tries another lane", async () => {
	const cases = [
		[fakeCtx({ codexToken: CODEX_FREE_TOKEN }), "codex_plan_excluded"],
		[fakeCtx(), "codex_not_signed_in"],
		[fakeCtx({ codexToken: "   " }), "codex_not_signed_in"],
		[undefined, "codex_not_signed_in"],
		[fakeCtx({ codexToken: CODEX_NO_ACCOUNT_TOKEN }), "codex_account_missing"],
	];
	for (const [ctx, code] of cases) {
		const { tools, api } = fakePi();
		createImageGenExtension({
			grok: grokThatMustNotRun,
			readConfiguredModel: () => undefined,
			fetchImpl: async () => { throw new Error("no request may leave"); },
		})(api);
		await assert.rejects(
			tools.get("image_gen").execute("call-1", { prompt: "a cat", model: "openai-codex/gpt-image-2" }, undefined, undefined, ctx),
			(error) => {
				assert.equal(error.code, code);
				return true;
			},
		);
	}
});

test("dispatch: a Codex failure on the automatic route never falls through — 429 quota or 500", async () => {
	for (const response of [
		errorResponse(429, { error: { type: "usage_limit_reached", resets_at: 1791158400 } }, { "x-codex-active-limit": "imagegen_premium" }),
		errorResponse(500, "upstream exploded"),
	]) {
		const { tools, api } = fakePi();
		const { calls, fetchImpl } = recordingFetch(response);
		createImageGenExtension({ grok: grokThatMustNotRun, readConfiguredModel: () => undefined, fetchImpl })(api);
		await assert.rejects(
			tools.get("image_gen").execute("call-1", { prompt: "a cat" }, undefined, undefined, fakeCtx({ codexToken: CODEX_TOKEN })),
			response.status === 429 ? /quota is exhausted/ : /image request failed HTTP 500/,
		);
		assert.equal(calls.length, 1);
	}
});

test("generateImage (the host-lane entry) takes the Codex route too", async (t) => {
	// The host entry reads the configured model from the agent home; point it at an empty one.
	const home = mkdtempSync(join(tmpdir(), "image-gen-home-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const prior = process.env.PI_COC_AGENT_DIR;
	process.env.PI_COC_AGENT_DIR = home;
	t.after(() => { if (prior === undefined) delete process.env.PI_COC_AGENT_DIR; else process.env.PI_COC_AGENT_DIR = prior; });
	const realFetch = globalThis.fetch;
	const { calls, fetchImpl } = recordingFetch(codexResponse());
	globalThis.fetch = fetchImpl;
	t.after(() => { globalThis.fetch = realFetch; });
	const out = await generateImage(fakeCtx({ codexToken: CODEX_TOKEN }), { kind: "gen", prompt: "portrait", aspectRatio: "3:4" });
	assert.equal(calls[0].url, "https://chatgpt.com/backend-api/codex/images/generations");
	assert.equal(out.backend, "codex");
	assert.deepEqual(out.bytes, PNG_BYTES);
});

test("commands: /image-gen:model openai-codex/gpt-image-2 persists and names the Codex adapter", async () => {
	const { commands, api } = fakePi();
	const written = [];
	const notices = [];
	createImageGenExtension({ grok: { usable: async () => false }, readConfiguredModel: () => undefined, writeConfiguredModel: (model) => written.push(model) })(api);
	await commands.get("image-gen:model").handler("openai-codex/gpt-image-2", { ui: { notify: (msg) => notices.push(msg) } });
	assert.deepEqual(written, ["openai-codex/gpt-image-2"]);
	assert.match(notices.at(-1), /adapter: codex/);
});

test("commands: /image-gen:status reports the Codex state beside grok-build and the configured model", async () => {
	async function status({ codexToken, configured, grok = true }) {
		const { commands, api } = fakePi();
		const notices = [];
		createImageGenExtension({ grok: { usable: async () => grok }, readConfiguredModel: () => (configured ? { model: configured } : undefined) })(api);
		await commands.get("image-gen:status").handler("", { ...fakeCtx({ codexToken }), ui: { notify: (msg) => notices.push(msg) } });
		return notices.at(-1);
	}
	const auto = await status({ codexToken: CODEX_TOKEN });
	assert.match(auto, /OpenAI Codex: signed in \(plan plus\) — the default while no model is configured/);
	assert.match(auto, /grok-build: logged in, idle while OpenAI Codex is usable/);
	assert.equal(auto.includes(CODEX_TOKEN), false);
	const pinned = await status({ codexToken: CODEX_TOKEN, configured: "openai-codex/gpt-image-2" });
	assert.match(pinned, /adapter: codex/);
	assert.match(pinned, /OpenAI Codex: signed in \(plan plus\) — active as the configured model/);
	const other = await status({ codexToken: CODEX_TOKEN, configured: "openai/gpt-image-1" });
	assert.match(other, /OpenAI Codex: signed in \(plan plus\), idle while another model is configured/);
	const free = await status({ codexToken: CODEX_FREE_TOKEN });
	assert.match(free, /OpenAI Codex: signed in \(plan free\), but the plan does not include image generation/);
	assert.match(free, /grok-build: logged in — the default while no model is configured and OpenAI Codex is not usable/);
	assert.match(await status({}), /OpenAI Codex: not signed in/);
});

test("the image_gen / image_edit descriptions name the Codex backend", () => {
	const { tools, api } = fakePi();
	createImageGenExtension({ grok: { usable: async () => false } })(api);
	for (const name of ["image_gen", "image_edit"]) {
		assert.match(tools.get(name).description, /OpenAI Codex/);
		assert.equal("quality" in tools.get(name).parameters.properties, false, "the tools expose no quality parameter");
	}
	assert.match(tools.get("image_gen").description, /openai-codex\/gpt-image-2/);
});

// The settings section is a data: module with React passed in; a hook-less stand-in renders it
// once with a given model-invoke answer, which is all the Codex row and the subtitle depend on.
function renderSettings(data, catalog = []) {
	const invokes = [];
	const states = [data, null];
	const React = {
		useState: () => [states.shift(), () => {}],
		useEffect: () => {},
		useCallback: (fn) => fn,
		createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
	};
	const Section = createSettingsComponent(React);
	const tree = Section({
		api: { invoke: async (method, params) => { invokes.push({ method, params }); return { ok: true, data }; } },
		ctx: { visibility: { models: catalog } },
	});
	const rows = [];
	const walk = (node) => {
		if (!node || typeof node !== "object") return;
		if (node.props?.["data-testid"]?.startsWith("image-model-row-")) rows.push(node);
		for (const child of node.children ?? []) walk(child);
	};
	walk(tree);
	const text = (node) => (typeof node === "string" ? node : (node?.children ?? []).map(text).join(" "));
	return { rows: rows.map((row) => ({ key: row.props["data-testid"].slice("image-model-row-".length), text: text(row), click: row.props.onClick })), invokes };
}

test("settings section: a Codex row whenever codexSignedIn, and the Automatic subtitle names autoRoute", async () => {
	const signedIn = renderSettings({ current: null, grokDefault: true, codexSignedIn: true, autoRoute: "codex" },
		[{ provider: "openai", id: "gpt-image-1", name: "GPT Image 1" }]);
	assert.deepEqual(signedIn.rows.map((row) => row.key), ["auto", "openai-codex/gpt-image-2", "openai/gpt-image-1"]);
	assert.match(signedIn.rows[0].text, /OpenAI Codex/);
	assert.match(signedIn.rows[1].text, /Codex \(gpt-image-2\)/);
	signedIn.rows[1].click();
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(signedIn.invokes.at(-1), { method: "model", params: { op: "set", model: "openai-codex/gpt-image-2" } });

	const grokOnly = renderSettings({ current: null, grokDefault: true, codexSignedIn: false, autoRoute: "grok-build" },
		[{ provider: "openai", id: "gpt-image-1" }]);
	assert.deepEqual(grokOnly.rows.map((row) => row.key), ["auto", "openai/gpt-image-1"], "no Codex row without the login");
	assert.match(grokOnly.rows[0].text, /grok-build is signed in/);

	const freePlan = renderSettings({ current: "openai-codex/gpt-image-2", grokDefault: false, codexSignedIn: true, autoRoute: "none" });
	assert.deepEqual(freePlan.rows.map((row) => row.key), ["auto", "openai-codex/gpt-image-2"]);
	assert.match(freePlan.rows[0].text, /No model selected/);
	assert.match(freePlan.rows[1].text, /Current/, "the pinned Codex ref shows as current");
});
