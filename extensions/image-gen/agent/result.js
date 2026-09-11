/**
 * Shared tool-result shape for image_gen / image_edit (pi AgentToolResult):
 * a text block, a typed image block, and the required `details` record the
 * host UI renders from (path, mime, backend, model). Mirrors the helper in
 * extensions/grok-build-oauth so both backends read identically to hosts.
 */

/**
 * @param {{path: string, mime: string, b64: string, backend: string, model: string}} saved
 * @param {"gen" | "edit"} kind
 */
export function imageResult(saved, kind) {
	const prefix = kind === "gen" ? "image generated" : "image edited";
	return {
		content: [
			{ type: "text", text: `${prefix} (${saved.backend}, ${saved.model}): ${saved.path}` },
			{ type: "image", data: saved.b64, mimeType: saved.mime },
		],
		details: { path: saved.path, mime: saved.mime, backend: saved.backend, model: saved.model },
	};
}
