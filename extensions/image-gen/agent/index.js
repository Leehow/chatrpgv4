/**
 * image-gen extension — owns the image_gen / image_edit agent tools.
 *
 * Dispatch per call (contract §172.1):
 *   1. Explicit choice wins. The tool's `model` parameter, else the configured
 *      model (`<agentHome>/image-model.json`, set with /image-gen:model or the
 *      settings picker) routes to the matching adapter: `openai-codex/...` to
 *      the Codex adapter, everything else to the vendor adapter its model id
 *      names. Credentials and base URL come from ctx.modelRegistry — auth.json
 *      is never read directly.
 *   2. Otherwise Codex, when usable: the player's ChatGPT subscription through
 *      Pi's built-in openai-codex login, on a paid plan (§172.2).
 *   3. Otherwise grok-build, when its OAuth credential is usable: generation
 *      and editing delegate to its host library (broker, tier gate, reference
 *      containment, SessionImageWriter).
 *   4. Otherwise the `image_model_unconfigured` refusal.
 *   A failure on the route taken surfaces as-is — no silent fall-through to
 *   another paid lane in either direction, quota exhaustion included.
 *
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
import { CODEX_IMAGE_MODEL, CODEX_MODEL_REF, CODEX_PROVIDER, codexRefusal, inspectCodex } from "./codex.js";
import { parseModelSpec, readConfiguredModel, writeConfiguredModel } from "./config.js";
import { routeImageModel, VENDOR_ADAPTERS, VENDOR_DEFAULT_BASE_URLS } from "./vendors.js";

const CONFIG_HINT = "sign in to OpenAI Codex or grok-build, or run /image-gen:model <provider/model> to choose one (e.g. /image-gen:model openai/gpt-image-1)";

/** The explicit choice for one dispatch, when there is one: the call's own parameter, else the configured model. */
function explicitModel(readModel, modelParam) {
	return modelParam ?? readModel()?.model;
}

/** Which model + vendor + credentials an explicit non-Codex choice uses. */
async function resolveVendorTarget(ctx, spec) {
	const { provider: providerSpec, modelId } = parseModelSpec(spec);
	const vendor = routeImageModel(providerSpec, modelId);
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
 * The dispatch half both the tools and host lanes share (§172.1): an explicit model
 * choice wins, otherwise a usable Codex login, otherwise a usable grok-build login
 * (its host library saves the session attachment itself), otherwise the refusal.
 * Bytes, not a file, so a caller with its own storage -- the sheet's portrait mount
 * (contract §22.7) -- reuses the same path without a session attachment it never asked for.
 */
async function dispatchImageOp(deps, ctx, op, signal) {
	const fetchImpl = deps.fetchImpl ?? fetch;
	const spec = explicitModel(deps.readModel, op.model);
	let target;
	if (spec) {
		const { provider } = parseModelSpec(spec);
		if (provider === CODEX_PROVIDER) {
			// Chosen explicitly: an unusable Codex is an error, never a reason to try another lane.
			const codex = await inspectCodex(ctx);
			if (codex.state !== "usable") throw codexRefusal(codex);
			target = codexTarget(codex);
		} else {
			target = await resolveVendorTarget(ctx, spec);
		}
	} else {
		const codex = await inspectCodex(ctx);
		if (codex.state === "usable") {
			target = codexTarget(codex);
		} else if (await deps.grok.usable()) {
			return op.kind === "gen"
				? await deps.grok.generate({ prompt: op.prompt, aspectRatio: op.aspectRatio, signal })
				: await deps.grok.edit({ prompt: op.prompt, images: op.refs, aspectRatio: op.aspectRatio, signal });
		} else {
			// A stable code lets host lanes tell "go configure a model" from a vendor
			// failure without matching on this sentence.
			const error = new Error(`no image model is configured and neither OpenAI Codex nor grok-build is usable — ${CONFIG_HINT}`);
			error.code = "image_model_unconfigured";
			throw error;
		}
	}
	const images = op.kind === "edit"
		? await Promise.all(op.refs.map((ref) => resolveImageReference(ref)))
		: [];
	const adapter = VENDOR_ADAPTERS[target.vendor];
	const { bytes, mime, model } = await adapter(
		{ kind: op.kind, prompt: op.prompt, aspectRatio: op.aspectRatio, images, model: target.modelId },
		target.creds,
		{ fetchImpl, signal, ...(deps.pollIntervalMs !== undefined ? { pollIntervalMs: deps.pollIntervalMs } : {}) },
	);
	return { bytes, b64: Buffer.from(bytes).toString("base64"), mime, model, backend: target.vendor };
}

/** The Codex adapter's target from a usable state; the token rides only in creds. */
function codexTarget(codex) {
	return { vendor: "codex", modelId: CODEX_IMAGE_MODEL, creds: { apiKey: codex.token, accountId: codex.accountId } };
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
 * Injectable seams for tests: grok wrapper, fetch, config IO,
 * image writer, poll interval. Codex credentials come from the call's
 * ctx.modelRegistry like every other provider. Production uses the default
 * export at the bottom.
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
		const codex = await inspectCodex(ctx);
		const spec = readModel()?.model;
		let routed;
		if (spec) {
			try {
				const { provider, modelId } = parseModelSpec(spec);
				routed = routeImageModel(provider, modelId);
			} catch {
				routed = "unsupported";
			}
		}
		return { grokReady, codexState: codex.state, codexPlan: codex.plan, configuredModel: spec, vendor: routed };
	}

	/** One status line for the Codex half; the token never leaves inspectCodex's caller. */
	function codexLine(status) {
		const plan = status.codexPlan ? `plan ${status.codexPlan}` : "plan unknown";
		switch (status.codexState) {
			case "usable":
				return status.configuredModel
					? status.vendor === "codex"
						? `OpenAI Codex: signed in (${plan}) — active as the configured model`
						: `OpenAI Codex: signed in (${plan}), idle while another model is configured`
					: `OpenAI Codex: signed in (${plan}) — the default while no model is configured`;
			case "plan_excluded":
				return `OpenAI Codex: signed in (${plan}), but the plan does not include image generation`;
			case "account_missing":
				return `OpenAI Codex: signed in (${plan}), but the login carries no ChatGPT account id`;
			default:
				return "OpenAI Codex: not signed in";
		}
	}

	return function imageGenExtension(pi) {
		pi.registerTool({
			name: "image_gen",
			label: "Image Generation image_gen",
			description: "Generate a new image from a text description. Uses the image model configured with /image-gen:model or the settings picker (OpenAI Codex as openai-codex/gpt-image-2, or an OpenAI, xAI, Ark Seedream, Gemini or DashScope family model routed by model id); when none is configured, uses OpenAI Codex (gpt-image-2 on the player's ChatGPT subscription) if that login is usable on a paid plan, else Grok Imagine if the grok-build login is usable. Returns a typed image plus the saved file's absolute path under the session attachments directory. When telling the user where it was saved, refer to the short path. To produce multiple images, emit multiple tool calls with distinct prompts.",
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
						description: "Optional image model override as <provider>/<model-id> or a bare model id. Wins over the configured image model (and over the automatic OpenAI Codex / grok-build route) for this call; openai-codex/gpt-image-2 pins OpenAI Codex.",
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
			description: "Edit or transform existing image(s); use instead of image_gen for image-to-image work (preserve likeness, transfer style, remix). Each `image` entry is a data:image/...;base64,... URL or a path to a JPEG/PNG ≤400KB inside the current workspace or the session attachments directory (arbitrary absolute paths are rejected). Backend dispatch is the same as image_gen (configured model, else OpenAI Codex, else grok-build); OpenAI Codex takes at most 5 reference images. Returns a typed image plus the saved file's absolute path.",
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
						description: "Optional image model override as <provider>/<model-id> or a bare model id. Wins over the configured image model (and over the automatic OpenAI Codex / grok-build route) for this call; openai-codex/gpt-image-2 pins OpenAI Codex.",
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
			description: `Set or show the image model (<provider>/<model-id>, e.g. ${CODEX_MODEL_REF} or openai/gpt-image-1); a choice overrides the automatic OpenAI Codex / grok-build route`,
			handler: async (args, ctx) => {
				const spec = typeof args === "string" ? args.trim() : "";
				if (!spec) {
					const current = readModel()?.model;
					ctx.ui.notify(current
						? `image model: ${current} (overrides the automatic OpenAI Codex / grok-build route)`
						: `no image model configured — ${CONFIG_HINT}`, "info");
					return;
				}
				try {
					const { provider, modelId } = parseModelSpec(spec);
					const vendor = routeImageModel(provider, modelId);
					writeModel(spec);
					ctx.ui.notify(`image model set to ${spec} (adapter: ${vendor}); it overrides the automatic OpenAI Codex / grok-build route.`, "info");
				} catch (error) {
					ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				}
			},
		});

		pi.registerCommand("image-gen:status", {
			description: "Show image-generation dispatch status (the configured model first, then OpenAI Codex, then grok-build)",
			handler: async (_args, ctx) => {
				const status = await statusSnapshot(ctx);
				const codexDefault = !status.configuredModel && status.codexState === "usable";
				const lines = [
					status.configuredModel
						? `configured model: ${status.configuredModel} (adapter: ${status.vendor}) — used for every generation`
						: `configured model: none — ${CONFIG_HINT}`,
					codexLine(status),
					status.grokReady
						? status.configuredModel
							? "grok-build: logged in, idle while a model is configured"
							: codexDefault
								? "grok-build: logged in, idle while OpenAI Codex is usable"
								: "grok-build: logged in — the default while no model is configured and OpenAI Codex is not usable"
						: "grok-build: not usable",
				];
				ctx.ui.notify(lines.join("; "), "info");
			},
		});
	};
}

export default createImageGenExtension();
