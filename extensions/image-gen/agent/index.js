/**
 * image-gen extension — owns the image_gen / image_edit agent tools.
 *
 * Dispatch per call:
 *   1. Grok first. When the grok-build-oauth credential is usable, generation
 *      and editing delegate to its host library (broker, tier gate, reference
 *      containment, SessionImageWriter). A grok failure surfaces as-is — a
 *      logged-in grok never silently falls through to a paid vendor key.
 *   2. Otherwise the call routes by model id: the tool's `model` parameter
 *      wins, else `<agentHome>/image-model.json` (set with /image-gen:model).
 *      Credentials and base URL come from ctx.modelRegistry — auth.json is
 *      never read directly.
 *
 * This extension owns image_gen / image_edit on this host. Pi does not shadow
 * duplicate tool names by mount order — it refuses to load the second owner —
 * so the launcher passes PI_GROK_BUILD_IMAGE_TOOLS=0 and grok-build-oauth
 * leaves its two image tools unregistered (its provider, commands and hooks
 * are unaffected).
 */
import { resolveImageReference } from "../../grok-build-oauth/agent/images/client.js";
import { SessionImageWriter } from "../../grok-build-oauth/agent/images/storage.js";
import { grokUsable, grokGenerate, grokEdit } from "./grok.js";
import { imageResult } from "./result.js";
import { parseModelSpec, readConfiguredModel, writeConfiguredModel } from "./config.js";
import { routeByModelId, VENDOR_ADAPTERS, VENDOR_DEFAULT_BASE_URLS } from "./vendors.js";

const CONFIG_HINT = "run /image-gen:model <provider/model> to choose one (e.g. /image-gen:model openai/gpt-image-1)";

/**
 * Injectable seams for tests: grok wrapper, fetch, config IO, image writer,
 * poll interval. Production uses the default export at the bottom.
 */
export function createImageGenExtension(deps = {}) {
	const grok = deps.grok ?? { usable: grokUsable, generate: grokGenerate, edit: grokEdit };
	const fetchImpl = deps.fetchImpl ?? fetch;
	const readModel = deps.readConfiguredModel ?? (() => readConfiguredModel());
	const writeModel = deps.writeConfiguredModel ?? ((model) => writeConfiguredModel(model));
	const makeWriter = deps.makeWriter ?? (() => new SessionImageWriter());
	const pollIntervalMs = deps.pollIntervalMs;

	/** Which model + vendor + credentials the fallback path will use. */
	async function resolveVendorTarget(ctx, modelParam) {
		const spec = modelParam ?? readModel()?.model;
		if (!spec) {
			throw new Error(`no image model is configured and grok-build is not logged in — ${CONFIG_HINT}`);
		}
		const { provider: providerSpec, modelId } = parseModelSpec(spec);
		const vendor = routeByModelId(modelId);
		let provider = providerSpec;
		let entry = provider ? ctx.modelRegistry.find(provider, modelId) : undefined;
		if (!provider) {
			entry = ctx.modelRegistry.getAll().find((model) => model.id === modelId);
			provider = entry?.provider;
		}
		if (!provider) {
			throw new Error(`cannot tell which provider serves the image model "${modelId}" — set it as <provider>/${modelId} with /image-gen:model`);
		}
		const apiKey = await ctx.modelRegistry.getApiKeyForProvider(provider);
		if (!apiKey) {
			throw new Error(`no API key is configured for provider "${provider}" — add one (pi /login ${provider}) and retry`);
		}
		return {
			vendor,
			modelId,
			creds: {
				apiKey,
				baseUrl: entry?.baseUrl ?? VENDOR_DEFAULT_BASE_URLS[vendor],
				headers: entry?.headers ?? {},
			},
		};
	}

	async function runImageOp(ctx, op, signal) {
		if (await grok.usable()) {
			const result = op.kind === "gen"
				? await grok.generate({ prompt: op.prompt, aspectRatio: op.aspectRatio, signal })
				: await grok.edit({ prompt: op.prompt, images: op.refs, aspectRatio: op.aspectRatio, signal });
			return imageResult({ path: result.path, mime: result.mime, b64: result.b64, backend: result.backend, model: result.model }, op.kind);
		}
		const target = await resolveVendorTarget(ctx, op.model);
		const images = op.kind === "edit"
			? await Promise.all(op.refs.map((ref) => resolveImageReference(ref)))
			: [];
		const adapter = VENDOR_ADAPTERS[target.vendor];
		const { bytes, mime, model } = await adapter(
			{ kind: op.kind, prompt: op.prompt, aspectRatio: op.aspectRatio, images, model: target.modelId },
			target.creds,
			{ fetchImpl, signal, ...(pollIntervalMs !== undefined ? { pollIntervalMs } : {}) },
		);
		const saved = await makeWriter().save(bytes, { signal });
		return imageResult({
			path: saved.path,
			mime: saved.mime ?? mime,
			b64: Buffer.from(bytes).toString("base64"),
			backend: target.vendor,
			model,
		}, op.kind);
	}

	async function statusSnapshot(ctx) {
		const grokReady = await grok.usable();
		const spec = readModel()?.model;
		let routed;
		if (spec) {
			try {
				const { modelId } = parseModelSpec(spec);
				routed = routeByModelId(modelId);
			} catch {
				routed = "unsupported";
			}
		}
		return { grokReady, configuredModel: spec, vendor: routed };
	}

	return function imageGenExtension(pi) {
		pi.registerTool({
			name: "image_gen",
			label: "Image Generation image_gen",
			description: "Generate a new image from a text description. Uses Grok Imagine when the grok-build login is usable; otherwise the image model configured with /image-gen:model (OpenAI, xAI, Ark Seedream, Gemini or DashScope family, routed by model id). Returns a typed image plus the saved file's absolute path under the session attachments directory. When telling the user where it was saved, refer to the short path. To produce multiple images, emit multiple tool calls with distinct prompts.",
			promptSnippet: "Generate images after the user confirms",
			parameters: {
				type: "object",
				properties: {
					prompt: { type: "string", description: "Text description of the image to generate." },
					aspect_ratio: {
						type: "string",
						description: "Aspect ratio. Defaults to 'auto'. Supported: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 2:1, 1:2, 19.5:9, 9:19.5, 20:9, 9:20, auto.",
					},
					model: {
						type: "string",
						description: "Optional image model override as <provider>/<model-id> or a bare model id. Wins over the /image-gen:model configuration for this call. Only shapes the vendor fallback; a usable grok-build login always takes precedence.",
					},
				},
				required: ["prompt"],
				additionalProperties: false,
			},
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const p = params;
				return runImageOp(ctx, { kind: "gen", prompt: p.prompt, aspectRatio: p.aspect_ratio, model: p.model }, signal);
			},
		});

		pi.registerTool({
			name: "image_edit",
			label: "Image Generation image_edit",
			description: "Edit or transform existing image(s); use instead of image_gen for image-to-image work (preserve likeness, transfer style, remix). Each `image` entry is a data:image/...;base64,... URL or a path to a JPEG/PNG ≤400KB inside the current workspace or the session attachments directory (arbitrary absolute paths are rejected). Backend dispatch is the same as image_gen. Returns a typed image plus the saved file's absolute path.",
			promptSnippet: "Edit images after the user confirms",
			parameters: {
				type: "object",
				properties: {
					prompt: { type: "string", description: "A text description of the desired edit or transformation." },
					image: {
						type: "array",
						items: { type: "string" },
						description: "Reference image(s): data:image/...;base64,... URLs or in-workspace/attachment filesystem paths.",
					},
					aspect_ratio: {
						type: "string",
						description: "Output aspect ratio. Defaults to 'auto'.",
					},
					model: {
						type: "string",
						description: "Optional image model override as <provider>/<model-id> or a bare model id. Wins over the /image-gen:model configuration for this call. Only shapes the vendor fallback; a usable grok-build login always takes precedence.",
					},
				},
				required: ["prompt", "image"],
				additionalProperties: false,
			},
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const p = params;
				return runImageOp(ctx, { kind: "edit", prompt: p.prompt, aspectRatio: p.aspect_ratio, refs: p.image ?? [], model: p.model }, signal);
			},
		});

		pi.registerCommand("image-gen:model", {
			description: "Set or show the fallback image model (<provider>/<model-id>, e.g. openai/gpt-image-1)",
			handler: async (args, ctx) => {
				const spec = typeof args === "string" ? args.trim() : "";
				if (!spec) {
					const current = readModel()?.model;
					ctx.ui.notify(current
						? `fallback image model: ${current} (used only when grok-build is not logged in)`
						: `no fallback image model configured — ${CONFIG_HINT}`, "info");
					return;
				}
				try {
					const { modelId } = parseModelSpec(spec);
					const vendor = routeByModelId(modelId);
					writeModel(spec);
					ctx.ui.notify(`fallback image model set to ${spec} (adapter: ${vendor}); it is used whenever grok-build is not logged in.`, "info");
				} catch (error) {
					ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				}
			},
		});

		pi.registerCommand("image-gen:status", {
			description: "Show image-generation dispatch status (grok first, then the configured fallback model)",
			handler: async (_args, ctx) => {
				const status = await statusSnapshot(ctx);
				const lines = [
					status.grokReady
						? "grok-build: logged in — image_gen/image_edit delegate to Grok Imagine"
						: "grok-build: not usable — the vendor fallback is active",
					status.configuredModel
						? `fallback model: ${status.configuredModel} (adapter: ${status.vendor})`
						: `fallback model: none — ${CONFIG_HINT}`,
				];
				ctx.ui.notify(lines.join("; "), "info");
			},
		});
	};
}

export default createImageGenExtension();
