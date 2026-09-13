/**
 * image-gen extension — owns the image_gen / image_edit agent tools.
 *
 * Dispatch per call:
 *   1. Explicit choice wins. The tool's `model` parameter, else the configured
 *      model (`<agentHome>/image-model.json`, set with /image-gen:model or the
 *      settings picker) routes to the matching vendor adapter. Credentials and
 *      base URL come from ctx.modelRegistry — auth.json is never read directly.
 *   2. Otherwise grok-build is the default: when its OAuth credential is
 *      usable, generation and editing delegate to its host library (broker,
 *      tier gate, reference containment, SessionImageWriter).
 *   A failure on the chosen route surfaces as-is — no silent fall-through to
 *   another paid lane in either direction.
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

/** The explicit choice for one dispatch, when there is one: the call's own parameter, else the configured model. */
function explicitModel(readModel, modelParam) {
	return modelParam ?? readModel()?.model;
}

/** Which model + vendor + credentials the fallback path will use. */
async function resolveVendorTarget(readModel, ctx, modelParam) {
	const spec = modelParam ?? readModel()?.model;
	if (!spec) {
		// A stable code lets host lanes tell "go configure a model" from a vendor
		// failure without matching on this sentence.
		const error = new Error(`no image model is configured and grok-build is not logged in — ${CONFIG_HINT}`);
		error.code = "image_model_unconfigured";
		throw error;
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

/**
 * The dispatch half both the tools and host lanes share: an explicit model choice
 * wins, otherwise a usable grok-build login (its host library saves the session
 * attachment itself), otherwise the configured vendor adapter. Bytes, not a file, so a
 * caller with its own storage -- the sheet's portrait mount (contract §22.7) -- reuses the same
 * path without a session attachment it never asked for.
 */
async function dispatchImageOp(deps, ctx, op, signal) {
	// An explicit choice wins: the call's own `model` parameter, else the configured
	// model. Grok is the default only while nothing is chosen — a logged-in grok
	// never overrides a deliberate selection, and a chosen route that fails never
	// silently falls through to another lane.
	if (!explicitModel(deps.readModel, op.model) && await deps.grok.usable()) {
		return op.kind === "gen"
			? await deps.grok.generate({ prompt: op.prompt, aspectRatio: op.aspectRatio, signal })
			: await deps.grok.edit({ prompt: op.prompt, images: op.refs, aspectRatio: op.aspectRatio, signal });
	}
	const target = await resolveVendorTarget(deps.readModel, ctx, op.model);
	const images = op.kind === "edit"
		? await Promise.all(op.refs.map((ref) => resolveImageReference(ref)))
		: [];
	const adapter = VENDOR_ADAPTERS[target.vendor];
	const { bytes, mime, model } = await adapter(
		{ kind: op.kind, prompt: op.prompt, aspectRatio: op.aspectRatio, images, model: target.modelId },
		target.creds,
		{ fetchImpl: deps.fetchImpl ?? fetch, signal, ...(deps.pollIntervalMs !== undefined ? { pollIntervalMs: deps.pollIntervalMs } : {}) },
	);
	return { bytes, b64: Buffer.from(bytes).toString("base64"), mime, model, backend: target.vendor };
}

/**
 * Host lanes reuse the tools' dispatch without the tool wrapper: the same model
 * resolution and credential resolution as image_gen, bytes back. `ctx` is the
 * session's extension context; the vendor half reads credentials from its
 * modelRegistry, never auth.json.
 */
export async function generateImage(ctx, op, signal) {
	return dispatchImageOp({
		grok: { usable: grokUsable, generate: grokGenerate, edit: grokEdit },
		readModel: () => readConfiguredModel(),
	}, ctx, op, signal);
}

/**
 * Injectable seams for tests: grok wrapper, fetch, config IO, image writer,
 * poll interval. Production uses the default export at the bottom.
 */
export function createImageGenExtension(deps = {}) {
	const grok = deps.grok ?? { usable: grokUsable, generate: grokGenerate, edit: grokEdit };
	const readModel = deps.readConfiguredModel ?? (() => readConfiguredModel());
	const writeModel = deps.writeConfiguredModel ?? ((model) => writeConfiguredModel(model));
	const makeWriter = deps.makeWriter ?? (() => new SessionImageWriter());

	async function runImageOp(ctx, op, signal) {
		const result = await dispatchImageOp({
			grok, readModel, fetchImpl: deps.fetchImpl, pollIntervalMs: deps.pollIntervalMs,
		}, ctx, op, signal);
		if (result.path) {
			return imageResult({ path: result.path, mime: result.mime, b64: result.b64, backend: result.backend, model: result.model }, op.kind);
		}
		const saved = await makeWriter().save(result.bytes, { signal });
		return imageResult({
			path: saved.path,
			mime: saved.mime ?? result.mime,
			b64: result.b64,
			backend: result.backend,
			model: result.model,
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
			description: "Generate a new image from a text description. Uses the image model configured with /image-gen:model or the settings picker (OpenAI, xAI, Ark Seedream, Gemini or DashScope family, routed by model id); when none is configured, uses Grok Imagine if the grok-build login is usable. Returns a typed image plus the saved file's absolute path under the session attachments directory. When telling the user where it was saved, refer to the short path. To produce multiple images, emit multiple tool calls with distinct prompts.",
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
						description: "Optional image model override as <provider>/<model-id> or a bare model id. Wins over the configured image model (and over the grok-build default) for this call.",
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
						description: "Optional image model override as <provider>/<model-id> or a bare model id. Wins over the configured image model (and over the grok-build default) for this call.",
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
			description: "Set or show the image model (<provider>/<model-id>, e.g. openai/gpt-image-1); a choice overrides the grok-build default",
			handler: async (args, ctx) => {
				const spec = typeof args === "string" ? args.trim() : "";
				if (!spec) {
					const current = readModel()?.model;
					ctx.ui.notify(current
						? `image model: ${current} (overrides the grok-build default)`
						: `no image model configured — ${CONFIG_HINT}`, "info");
					return;
				}
				try {
					const { modelId } = parseModelSpec(spec);
					const vendor = routeByModelId(modelId);
					writeModel(spec);
					ctx.ui.notify(`image model set to ${spec} (adapter: ${vendor}); it overrides the grok-build default.`, "info");
				} catch (error) {
					ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				}
			},
		});

		pi.registerCommand("image-gen:status", {
			description: "Show image-generation dispatch status (the configured model first, grok-build as the default when none is)",
			handler: async (_args, ctx) => {
				const status = await statusSnapshot(ctx);
				const lines = [
					status.configuredModel
						? `configured model: ${status.configuredModel} (adapter: ${status.vendor}) — used for every generation`
						: `configured model: none — ${CONFIG_HINT}`,
					status.grokReady
						? status.configuredModel
							? "grok-build: logged in, idle while a model is configured"
							: "grok-build: logged in — the default while no model is configured"
						: "grok-build: not usable",
				];
				ctx.ui.notify(lines.join("; "), "info");
			},
		});
	};
}

export default createImageGenExtension();
