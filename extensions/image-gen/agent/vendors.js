/**
 * Vendor fallback adapters for image_gen / image_edit.
 *
 * Routing is a closed mapping on the model id (no semantic classification):
 * the vendor families this extension knows how to call, keyed by a substring
 * of the configured model id. Every adapter takes
 *
 *   req   = { kind: "gen" | "edit", prompt, aspectRatio?, images: dataUrl[] }
 *   creds = { apiKey, baseUrl, headers }   (from ctx.modelRegistry, never auth.json)
 *   opts  = { fetchImpl?, signal?, pollIntervalMs? }
 *
 * and resolves to `{ bytes, mime, model }`. Bearer credentials go over HTTPS
 * only — a plain-HTTP base URL is refused outright (same posture as the grok
 * images client; there is no loopback relay here at all). Response parsing is
 * defensive: where a vendor documents both b64 and URL result fields, both
 * are accepted.
 */
import { sniffImageMime } from "../../grok-build-oauth/agent/images/client.js";

export const VENDOR_DEFAULT_BASE_URLS = Object.freeze({
	openai: "https://api.openai.com",
	xai: "https://api.x.ai",
	ark: "https://ark.cn-beijing.volces.com",
	gemini: "https://generativelanguage.googleapis.com",
	"dashscope-sync": "https://dashscope.aliyuncs.com",
	"dashscope-async": "https://dashscope.aliyuncs.com",
});

const SUPPORTED_FAMILIES =
	"OpenAI (gpt-image-*, dall-e-*), xAI (grok-*-image*), Volcengine Ark (seedream/seededit), " +
	"Gemini (gemini-*-image), DashScope sync (qwen-image*) and DashScope async (wan/wanx)";

/**
 * Closed model-id → vendor mapping. Throws on an unsupported family, naming
 * what is supported (imagen-* is recognized but not implemented: Vertex
 * predict is out of scope for this extension).
 */
export function routeByModelId(modelId) {
	const id = String(modelId ?? "").trim().toLowerCase();
	if (!id) throw new Error("the image model id must not be empty");
	if (id.includes("gpt-image") || id.includes("dall-e")) return "openai";
	if (id.includes("seedream") || id.includes("seededit")) return "ark";
	if (id.includes("qwen-image")) return "dashscope-sync";
	if (id.includes("grok") && id.includes("image")) return "xai";
	if (id.includes("gemini") && id.includes("image")) return "gemini";
	if (id.includes("wan")) return "dashscope-async";
	if (id.includes("imagen")) {
		throw new Error(`image model "${modelId}" is an Imagen model; Vertex predict is not supported by this extension. Supported families: ${SUPPORTED_FAMILIES}.`);
	}
	throw new Error(`no image-generation adapter knows the model "${modelId}". Supported families: ${SUPPORTED_FAMILIES}.`);
}

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_POLL_ATTEMPTS = 90;

/** HTTPS-only: bearer credentials are never sent to a plain-HTTP endpoint. */
function ensureHttps(raw, label) {
	const trimmed = String(raw ?? "").trim();
	let url;
	try {
		url = new URL(trimmed);
	} catch {
		throw new Error(`invalid ${label}: ${trimmed}`);
	}
	if (url.protocol !== "https:") {
		throw new Error(`refusing a non-HTTPS ${label}: ${trimmed} (API keys are sent over HTTPS only)`);
	}
	return trimmed.replace(/\/+$/, "");
}

/** Join a registry/default base URL with a version prefix, without doubling it. */
function joinBase(baseUrl, versionPrefix, path) {
	const base = ensureHttps(baseUrl, "base URL");
	return base.endsWith(versionPrefix) ? `${base}${path}` : `${base}${versionPrefix}${path}`;
}

function combinedSignal(signal, timeoutMs) {
	const signals = [AbortSignal.timeout(timeoutMs)];
	if (signal) signals.push(signal);
	return AbortSignal.any(signals);
}

async function readErrorText(res) {
	const raw = await res.text().catch(() => "");
	return [...raw].slice(0, 200).join("");
}

async function postJson(fetchImpl, url, { headers, body, signal, timeoutMs = DEFAULT_TIMEOUT_MS }) {
	const res = await fetchImpl(url, {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: JSON.stringify(body),
		signal: combinedSignal(signal, timeoutMs),
	});
	if (!res.ok) throw new Error(`image request failed HTTP ${res.status}: ${await readErrorText(res)}`);
	return res.json().catch(() => {
		throw new Error("could not parse the image response as JSON");
	});
}

async function postForm(fetchImpl, url, { headers, form, signal, timeoutMs = DEFAULT_TIMEOUT_MS }) {
	const res = await fetchImpl(url, {
		method: "POST",
		headers: { ...headers },
		body: form,
		signal: combinedSignal(signal, timeoutMs),
	});
	if (!res.ok) throw new Error(`image request failed HTTP ${res.status}: ${await readErrorText(res)}`);
	return res.json().catch(() => {
		throw new Error("could not parse the image response as JSON");
	});
}

/** Fetch image bytes from an HTTPS URL result field. */
async function fetchImageBytes(fetchImpl, url, { headers, signal } = {}) {
	const target = ensureHttps(url, "image result URL");
	const res = await fetchImpl(target, { headers, signal: combinedSignal(signal, DEFAULT_TIMEOUT_MS) });
	if (!res.ok) throw new Error(`fetching the image result failed HTTP ${res.status}: ${await readErrorText(res)}`);
	const bytes = Buffer.from(await res.arrayBuffer());
	if (bytes.byteLength === 0) throw new Error("the image result URL returned no data");
	const contentType = res.headers?.get?.("content-type")?.split(";")[0]?.trim();
	return { bytes, mime: contentType?.startsWith("image/") ? contentType : sniffImageMime(bytes) };
}

/** Bytes + mime from a `data:image/...;base64,...` URL (reference images are pre-resolved). */
function dataUrlParts(dataUrl) {
	const comma = dataUrl.indexOf(",");
	const mime = dataUrl.slice("data:".length, dataUrl.indexOf(";")) || "image/png";
	return { mime, bytes: Buffer.from(dataUrl.slice(comma + 1), "base64") };
}

/** Accept both documented OpenAI-shape result fields: b64_json or url. */
async function bytesFromOpenAiData(fetchImpl, json, { signal }) {
	const entry = Array.isArray(json?.data) ? json.data[0] : undefined;
	const b64 = entry?.b64_json;
	if (typeof b64 === "string" && b64.trim()) {
		const bytes = Buffer.from(b64.replace(/\s+/g, ""), "base64");
		if (bytes.byteLength === 0) throw new Error("the image response contained empty b64_json data");
		return { bytes, mime: sniffImageMime(bytes) };
	}
	const url = entry?.url;
	if (typeof url === "string" && url.trim()) return fetchImageBytes(fetchImpl, url, { signal });
	throw new Error("the image response is missing both b64_json and url image data");
}

const PORTRAIT_RATIOS = new Set(["9:16", "2:3", "3:4", "1:2", "9:19.5", "9:20"]);
const LANDSCAPE_RATIOS = new Set(["16:9", "3:2", "4:3", "2:1", "19.5:9", "20:9"]);

function openAiSize(model, aspectRatio) {
	const dallE = model.includes("dall-e");
	if (PORTRAIT_RATIOS.has(aspectRatio)) return dallE ? "1024x1792" : "1024x1536";
	if (LANDSCAPE_RATIOS.has(aspectRatio)) return dallE ? "1792x1024" : "1536x1024";
	return "1024x1024";
}

/** DashScope sizes are `W*H`; a small closed map, everything else square. */
function dashScopeSize(aspectRatio) {
	switch (aspectRatio) {
		case "16:9": return "1664*928";
		case "9:16": return "928*1664";
		case "4:3": return "1472*1104";
		case "3:4": return "1104*1472";
		default: return "1328*1328";
	}
}

function bearerHeaders(creds) {
	if (!creds.apiKey) throw new Error("missing API key for the configured image model provider");
	return { authorization: `Bearer ${creds.apiKey}`, ...creds.headers };
}

/** OpenAI Images API — POST {base}/v1/images/generations; edits are multipart. */
async function openaiAdapter(req, creds, opts) {
	const model = req.model;
	const headers = bearerHeaders(creds);
	const fetchImpl = opts.fetchImpl ?? fetch;
	if (req.kind === "edit") {
		if (!req.images.length) throw new Error("image_edit needs at least one reference image");
		const form = new FormData();
		form.set("model", model);
		form.set("prompt", req.prompt);
		for (const [index, dataUrl] of req.images.entries()) {
			const { mime, bytes } = dataUrlParts(dataUrl);
			const name = `image${index}.${mime === "image/png" ? "png" : "jpg"}`;
			form.append("image[]", new Blob([bytes], { type: mime }), name);
		}
		const json = await postForm(fetchImpl, joinBase(creds.baseUrl, "/v1", "/images/edits"), { headers, form, signal: opts.signal });
		const { bytes, mime } = await bytesFromOpenAiData(fetchImpl, json, { signal: opts.signal });
		return { bytes, mime, model };
	}
	const body = {
		model,
		prompt: req.prompt,
		n: 1,
		size: openAiSize(model, req.aspectRatio ?? "auto"),
	};
	// response_format is DALL·E-era; gpt-image models always return b64_json and
	// strict parameter validation can reject the field outright.
	if (model.includes("dall-e")) body.response_format = "b64_json";
	const json = await postJson(fetchImpl, joinBase(creds.baseUrl, "/v1", "/images/generations"), { headers, body, signal: opts.signal });
	const { bytes, mime } = await bytesFromOpenAiData(fetchImpl, json, { signal: opts.signal });
	return { bytes, mime, model };
}

/** xAI — OpenAI-shaped at https://api.x.ai; JSON edits with image references. */
async function xaiAdapter(req, creds, opts) {
	const model = req.model;
	const headers = bearerHeaders(creds);
	const fetchImpl = opts.fetchImpl ?? fetch;
	const body = { model, prompt: req.prompt, n: 1, response_format: "b64_json", resolution: "1k" };
	let suffix = "/images/generations";
	if (req.kind === "edit") {
		if (!req.images.length) throw new Error("image_edit needs at least one reference image");
		suffix = "/images/edits";
		const refs = req.images.map((url) => ({ url }));
		if (refs.length === 1) body.image = refs[0];
		else body.images = refs;
	}
	if (req.aspectRatio && req.aspectRatio !== "auto") body.aspect_ratio = req.aspectRatio;
	const json = await postJson(fetchImpl, joinBase(creds.baseUrl, "/v1", suffix), { headers, body, signal: opts.signal });
	const { bytes, mime } = await bytesFromOpenAiData(fetchImpl, json, { signal: opts.signal });
	return { bytes, mime, model };
}

/** Volcengine Ark Seedream — OpenAI-shaped; edits reuse the generations path with `image`. */
async function arkAdapter(req, creds, opts) {
	const model = req.model;
	const headers = bearerHeaders(creds);
	const fetchImpl = opts.fetchImpl ?? fetch;
	const body = {
		model,
		prompt: req.prompt,
		n: 1,
		// Seedream 4+ accepts the "1K"/"2K"/"4K" shorthand; Seedream 3 wants WxH.
		size: model.includes("seedream-3") ? "1024x1024" : "2K",
		response_format: "b64_json",
	};
	if (req.kind === "edit") {
		if (!req.images.length) throw new Error("image_edit needs at least one reference image");
		body.image = req.images.length === 1 ? req.images[0] : req.images;
	}
	const json = await postJson(fetchImpl, joinBase(creds.baseUrl, "/api/v3", "/images/generations"), { headers, body, signal: opts.signal });
	const { bytes, mime } = await bytesFromOpenAiData(fetchImpl, json, { signal: opts.signal });
	return { bytes, mime, model };
}

/** Gemini native image models — POST {base}/v1beta/models/{m}:generateContent. */
async function geminiAdapter(req, creds, opts) {
	const model = req.model;
	if (!creds.apiKey) throw new Error("missing API key for the configured image model provider");
	const fetchImpl = opts.fetchImpl ?? fetch;
	const parts = [{ text: req.prompt }];
	for (const dataUrl of req.images) {
		const { mime, bytes } = dataUrlParts(dataUrl);
		parts.push({ inlineData: { mimeType: mime, data: bytes.toString("base64") } });
	}
	const generationConfig = { responseModalities: ["TEXT", "IMAGE"] };
	if (req.aspectRatio && req.aspectRatio !== "auto") generationConfig.imageConfig = { aspectRatio: req.aspectRatio };
	const body = { contents: [{ role: "user", parts }], generationConfig };
	const url = joinBase(creds.baseUrl, "/v1beta", `/models/${encodeURIComponent(model)}:generateContent`);
	const json = await postJson(fetchImpl, url, {
		headers: { "x-goog-api-key": creds.apiKey, ...creds.headers },
		body,
		signal: opts.signal,
	});
	const responseParts = json?.candidates?.[0]?.content?.parts;
	if (Array.isArray(responseParts)) {
		for (const part of responseParts) {
			const data = part?.inlineData?.data;
			if (typeof data === "string" && data.trim()) {
				const bytes = Buffer.from(data.replace(/\s+/g, ""), "base64");
				if (bytes.byteLength === 0) continue;
				const mime = typeof part.inlineData.mimeType === "string" && part.inlineData.mimeType.startsWith("image/")
					? part.inlineData.mimeType
					: sniffImageMime(bytes);
				return { bytes, mime, model };
			}
		}
	}
	throw new Error("the Gemini response contained no inlineData image part");
}

/** DashScope synchronous multimodal generation (qwen-image*). */
async function dashScopeSyncAdapter(req, creds, opts) {
	const model = req.model;
	const headers = bearerHeaders(creds);
	const fetchImpl = opts.fetchImpl ?? fetch;
	const content = [{ text: req.prompt }];
	for (const dataUrl of req.images) content.push({ image: dataUrl });
	const body = {
		model,
		input: { messages: [{ role: "user", content }] },
		parameters: { size: dashScopeSize(req.aspectRatio ?? "auto"), n: 1 },
	};
	const url = joinBase(creds.baseUrl, "/api/v1", "/services/aigc/multimodal-generation/generation");
	const json = await postJson(fetchImpl, url, { headers, body, signal: opts.signal });
	const outContent = json?.output?.choices?.[0]?.message?.content;
	if (Array.isArray(outContent)) {
		for (const part of outContent) {
			const image = part?.image;
			if (typeof image !== "string" || !image.trim()) continue;
			if (image.startsWith("data:image/")) {
				const { mime, bytes } = dataUrlParts(image);
				return { bytes, mime, model };
			}
			const { bytes, mime } = await fetchImageBytes(fetchImpl, image, { signal: opts.signal });
			return { bytes, mime, model };
		}
	}
	throw new Error("the DashScope response contained no image in output.choices[0].message.content");
}

/** DashScope asynchronous task API (wan / wanx) — create, poll, fetch the result URL. */
async function dashScopeAsyncAdapter(req, creds, opts) {
	if (req.kind === "edit") {
		throw new Error("wan/wanx image edit is not supported by this extension — use a qwen-image, seedream, gpt-image or gemini image model for edits");
	}
	const model = req.model;
	const headers = bearerHeaders(creds);
	const fetchImpl = opts.fetchImpl ?? fetch;
	const body = {
		model,
		input: { prompt: req.prompt },
		parameters: { size: dashScopeSize(req.aspectRatio ?? "auto"), n: 1 },
	};
	const createUrl = joinBase(creds.baseUrl, "/api/v1", "/services/aigc/image-generation/generation");
	const created = await postJson(fetchImpl, createUrl, {
		headers: { ...headers, "X-DashScope-Async": "enable" },
		body,
		signal: opts.signal,
	});
	const taskId = created?.output?.task_id;
	if (typeof taskId !== "string" || !taskId) throw new Error("the DashScope async response is missing output.task_id");
	const taskUrl = joinBase(creds.baseUrl, "/api/v1", `/tasks/${encodeURIComponent(taskId)}`);
	const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	// Attempt count is not a deadline: cap the whole poll loop at 10 minutes of
	// wall clock so a slow-trickling vendor cannot stretch 90 × per-request
	// timeouts into hours.
	const deadline = AbortSignal.timeout(10 * 60_000);
	const pollSignal = opts.signal ? AbortSignal.any([opts.signal, deadline]) : deadline;
	for (let attempt = 0; attempt < DEFAULT_POLL_ATTEMPTS; attempt++) {
		pollSignal.throwIfAborted();
		await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
		const task = await fetchImpl(taskUrl, { headers, signal: combinedSignal(pollSignal, DEFAULT_TIMEOUT_MS) });
		if (!task.ok) throw new Error(`polling the DashScope task failed HTTP ${task.status}: ${await readErrorText(task)}`);
		const json = await task.json().catch(() => null);
		const status = json?.output?.task_status;
		if (status === "SUCCEEDED") {
			const results = json?.output?.results;
			const url = Array.isArray(results) ? results.find((r) => typeof r?.url === "string")?.url : undefined;
			if (!url) throw new Error("the DashScope task succeeded but output.results holds no image URL");
			const { bytes, mime } = await fetchImageBytes(fetchImpl, url, { signal: pollSignal });
			return { bytes, mime, model };
		}
		if (status === "FAILED" || status === "CANCELED") {
			const message = json?.output?.message ?? json?.output?.code ?? "unknown reason";
			throw new Error(`the DashScope image task ${String(status).toLowerCase()}: ${message}`);
		}
	}
	throw new Error("the DashScope image task did not finish in time");
}

export const VENDOR_ADAPTERS = Object.freeze({
	openai: openaiAdapter,
	xai: xaiAdapter,
	ark: arkAdapter,
	gemini: geminiAdapter,
	"dashscope-sync": dashScopeSyncAdapter,
	"dashscope-async": dashScopeAsyncAdapter,
});
