/**
 * The Codex route's credential side (contract §172.2): whether the player's
 * ChatGPT subscription can generate images, read only through Pi's built-in
 * `openai-codex` login.
 *
 * The token comes from the session's model registry, which refreshes it under
 * Pi's own lock before returning it. This module never reads or writes
 * auth.json and never refreshes a token itself (a refresh rotates the refresh
 * token every other auth.json copy shares). The JWT payload is decoded without
 * signature verification and is used only for routing, never for authorization.
 *
 * The adapter's single constants live here too, so the wire half in vendors.js,
 * the dispatch, the picker ref and the status line all name one endpoint.
 */

/** Pi's reserved official provider id for the ChatGPT OAuth login. */
export const CODEX_PROVIDER = "openai-codex";
/** The one image model the Codex endpoint serves (fixed, as in Codex CLI). */
export const CODEX_IMAGE_MODEL = "gpt-image-2";
/** The configured-model ref that pins the Codex route. */
export const CODEX_MODEL_REF = `${CODEX_PROVIDER}/${CODEX_IMAGE_MODEL}`;
/** HTTPS only; the generate and edit paths hang off it. */
export const CODEX_BASE_URL = "https://chatgpt.com/backend-api";
/** Matches Pi's own Codex chat traffic; accepted by the 2026-10-03 probe. */
export const CODEX_ORIGINATOR = "pi";

const AUTH_CLAIM = "https://api.openai.com/auth";

/** The `https://api.openai.com/auth` claim object, or an empty object for anything undecodable. */
export function codexAuthClaim(token) {
	try {
		const parts = String(token).split(".");
		if (parts.length !== 3) return {};
		const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
		const claim = payload?.[AUTH_CLAIM];
		return claim && typeof claim === "object" ? claim : {};
	} catch {
		return {};
	}
}

/**
 * The Codex state for one call, failing closed on anything unexpected:
 *
 *   { state: "usable", token, accountId, plan }
 *   { state: "not_signed_in" | "account_missing" | "plan_excluded", plan? }
 *
 * `token` is present only on the usable state and must never reach a log line,
 * tool result or error text.
 */
export async function inspectCodex(ctx) {
	const registry = ctx?.modelRegistry;
	if (!registry || typeof registry.getApiKeyForProvider !== "function") return { state: "not_signed_in" };
	let token;
	try {
		token = await registry.getApiKeyForProvider(CODEX_PROVIDER);
	} catch {
		return { state: "not_signed_in" };
	}
	if (typeof token !== "string" || !token.trim()) return { state: "not_signed_in" };
	const claim = codexAuthClaim(token.trim());
	const plan = typeof claim.chatgpt_plan_type === "string" ? claim.chatgpt_plan_type : undefined;
	if (plan === "free") return { state: "plan_excluded", plan };
	const accountId = typeof claim.chatgpt_account_id === "string" ? claim.chatgpt_account_id.trim() : "";
	if (!accountId) return { state: "account_missing", plan };
	return { state: "usable", token: token.trim(), accountId, plan };
}

const REFUSALS = {
	not_signed_in: ["codex_not_signed_in", `the image model ${CODEX_MODEL_REF} needs the OpenAI Codex login — sign in to "${CODEX_PROVIDER}" in the provider login panel (pi /login ${CODEX_PROVIDER}) and retry`],
	plan_excluded: ["codex_plan_excluded", "the signed-in ChatGPT plan (free) does not include Codex image generation — upgrade the plan or choose another image model"],
	account_missing: ["codex_account_missing", "the OpenAI Codex login carries no ChatGPT account id — sign in to OpenAI Codex again and retry"],
};

/** The stable-coded error (§172.7) for an explicit Codex choice whose state is not usable. */
export function codexRefusal(status) {
	const [code, message] = REFUSALS[status.state] ?? REFUSALS.not_signed_in;
	const error = new Error(message);
	error.code = code;
	return error;
}
