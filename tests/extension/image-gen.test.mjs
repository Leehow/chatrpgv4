/**
 * Unit tests for extensions/image-gen: closed model-id routing, the vendor
 * adapters (with a stubbed fetch — no network), and the grok-first dispatch
 * (with the grok host library injected).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { routeByModelId, VENDOR_ADAPTERS } from "../../extensions/image-gen/agent/vendors.js";
import { createImageGenExtension } from "../../extensions/image-gen/agent/index.js";

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

function fakeCtx({ apiKey = "sk-test", models = [] } = {}) {
	return {
		modelRegistry: {
			find: (provider, id) => models.find((m) => m.provider === provider && m.id === id),
			getAll: () => models,
			getApiKeyForProvider: async () => apiKey,
		},
	};
}

test("dispatch: grok usable delegates to the grok path and never touches fetch", async () => {
	const { tools, api } = fakePi();
	createImageGenExtension({
		grok: {
			usable: async () => true,
			generate: async () => ({ path: "/tmp/grok/1.jpg", mime: "image/jpeg", b64: JPEG_B64, model: "grok-imagine-image", backend: "grok-build" }),
			edit: async () => { throw new Error("not this call"); },
		},
		fetchImpl: async () => { throw new Error("vendor fetch must not run when grok is usable"); },
	})(api);
	const result = await tools.get("image_gen").execute("call-1", { prompt: "a cat" }, undefined, undefined, fakeCtx());
	assert.equal(result.details.backend, "grok-build");
	assert.equal(result.details.model, "grok-imagine-image");
	assert.equal(result.details.path, "/tmp/grok/1.jpg");
	assert.equal(result.content[1].type, "image");
	assert.equal(result.content[1].data, JPEG_B64);
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
		/image-gen:model/,
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
		readConfiguredModel: () => ({ model: "openai/gpt-image-1" }),
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
