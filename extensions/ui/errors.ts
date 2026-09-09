/**
 * A failure an extension hands back for a host to show.
 *
 * Contract §23 (2026-09-09): "errors carry codes". The renderer draws
 * `ui.words.errors[code]` in the play language and keeps `message` behind a fold for the log, so
 * the message stays English (system language) and the code is what has to be right. An error
 * thrown without one arrives at the renderer as `errors.unknown`: a visible gap, not a wrong word.
 *
 * The code is read structurally everywhere (`instanceof` is unreliable across extensions, which are
 * loaded as separate module instances), so this is a plain `Error` with one added field rather than
 * a subclass.
 */

/** The contract's code list is open-ended by design; this is a string, not a closed union in code. */
export interface CodedError extends Error {
	code: string;
}

/** `new Error(message)` with the code a renderer looks its word up by. */
export function coded(code: string, message: string): CodedError {
	return Object.assign(new Error(message), { code });
}

/** The code of any error envelope, read structurally; undefined when it carries none. */
export function errorCodeOf(error: unknown): string | undefined {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" && code ? code : undefined;
}
