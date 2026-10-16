/** Shared settings/dispatch policy. Provider and image model IDs are API enums. */
const DEFAULTS = Object.freeze({
	"openai-codex": ["gpt-image-2", "Codex (gpt-image-2)"],
	"grok-build": ["grok-imagine-image", "Grok Imagine"],
	openai: ["gpt-image-1", "GPT Image 1"],
	xai: ["grok-imagine-image", "Grok Imagine"],
	"minimax-cn": ["image-01", "MiniMax Image 01"],
	minimax: ["image-01", "MiniMax Image 01"],
});

export function isImageModelId(modelId) {
	const id = String(modelId ?? "").toLowerCase();
	return id === "image-01" || id === "image-01-live"
		|| id.includes("gpt-image") || id.includes("dall-e")
		|| id.includes("seedream") || id.includes("seededit")
		|| id.includes("qwen-image") || id.includes("wan")
		|| id.includes("grok") && id.includes("image")
		|| id.includes("gemini") && id.includes("image");
}

/** Only credential-backed providers enter this list; never return model headers or keys. */
export function imageModelOptions(models, providers) {
	const available = new Set(providers);
	const rows = new Map();
	for (const model of models) {
		if (available.has(model.provider) && isImageModelId(model.id)) {
			rows.set(`${model.provider}/${model.id}`, { provider: model.provider, id: model.id, name: model.name || model.id });
		}
	}
	for (const [provider, [id, name]] of Object.entries(DEFAULTS)) {
		if (!available.has(provider)) continue;
		// A registered API image model takes precedence over the synthetic default.
		if (![...rows.values()].some(row => row.provider === provider)) rows.set(`${provider}/${id}`, { provider, id, name });
		if (provider === "minimax" || provider === "minimax-cn") {
			const live = { provider, id: "image-01-live", name: "MiniMax Image 01 Live" };
			if (!rows.has(`${provider}/${live.id}`)) rows.set(`${provider}/${live.id}`, live);
		}
	}
	return [...rows.values()];
}

export function automaticImageModel(selected, options) {
	const forProvider = provider => {
		const candidates = options.filter(model => model.provider === provider);
		const row = candidates.find(model => model.id === DEFAULTS[provider]?.[0])
			?? candidates.sort((a, b) => a.id.localeCompare(b.id))[0];
		return row ? `${row.provider}/${row.id}` : undefined;
	};
	if (selected?.provider && Object.hasOwn(DEFAULTS, selected.provider)) {
		return forProvider(selected.provider) ?? `${selected.provider}/${DEFAULTS[selected.provider][0]}`;
	}
	// GPT relay models do not grant image API access through the relay itself.
	if (selected?.id?.startsWith("gpt-")) {
		return forProvider("openai-codex") ?? forProvider("openai");
	}
	return forProvider("openai-codex") ?? forProvider("grok-build");
}
