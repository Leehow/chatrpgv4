/**
 * Grok-first dispatch half: a thin wrapper over the grok-build-oauth host
 * library (compile-time import; esbuild bundles it, packages stay external).
 * The host library owns the OAuth broker, the advisory tier gate, reference
 * containment and the SessionImageWriter — delegating here keeps the grok
 * path byte-identical to the grok-build-oauth tools this extension shadows.
 */
import { createGrokBuildHostLibrary } from "../../grok-build-oauth/agent/host.js";

let library;

function hostLibrary() {
	library ??= createGrokBuildHostLibrary();
	return library;
}

/** True when the grok OAuth credential is present and usable (fail-closed). */
export async function grokUsable() {
	try {
		const status = await hostLibrary().status();
		return Boolean(status?.usable);
	} catch {
		return false;
	}
}

function shape(result) {
	return {
		bytes: result.bytes,
		b64: result.b64 ?? Buffer.from(result.bytes).toString("base64"),
		mime: result.mime,
		path: result.path,
		model: result.model,
		backend: result.backend ?? "grok-build",
	};
}

/** generateImage via the host library; errors surface to the caller (no silent fallback). */
export async function grokGenerate(req) {
	return shape(await hostLibrary().generateImage(req));
}

/** editImage via the host library; references are resolved inside the host library. */
export async function grokEdit(req) {
	return shape(await hostLibrary().editImage(req));
}
