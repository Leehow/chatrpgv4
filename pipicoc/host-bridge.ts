/**
 * The two PipiUI handshakes the sheet panel needs (contract §22.7), restated here.
 *
 * A pack cannot import the host's runtime tree — it lives outside every package — so each pack
 * carries its own copy of these few lines; writepaper's own packs do the same. Both shapes are
 * the host's, not ours: change them only to follow the host.
 *
 * Neither is required for the table to work. A missing registry or bridge means the panel is not
 * there (a terminal `bin/pi-coc` run, a test harness), and every function below degrades to a
 * no-op rather than failing a turn.
 */

/** Must match `EXT_INVOKE_REGISTRY_SYMBOL` in `@pipiui/extension-api`. */
const EXT_INVOKE_REGISTRY_KEY = Symbol.for("pipiui.ext-invoke.registry");

interface InvokeRegistry {
	readonly version: 1;
	register(extensionId: string, method: string, handler: (params: unknown) => unknown | Promise<unknown>): () => void;
}

function invokeRegistry(host: Record<symbol, unknown>): InvokeRegistry | undefined {
	const registry = host[EXT_INVOKE_REGISTRY_KEY] as InvokeRegistry | undefined;
	return registry && registry.version === 1 && typeof registry.register === "function" ? registry : undefined;
}

/**
 * App → agent. The kernel's `ext-invoke` mount publishes the registry on that well-known global and
 * long-polls the host for requests; a package publishes its handlers there when it loads.
 *
 * `pi.registerCommand` is NOT this channel: pi types a command handler as returning `void`, so a
 * value registered there can never reach the panel.
 *
 * Returns the disposers; an empty array means no host is listening.
 */
export function registerInvokeHandlers(
	extensionId: string,
	handlers: Record<string, (params: unknown) => unknown | Promise<unknown>>,
	host: Record<symbol, unknown> = globalThis as unknown as Record<symbol, unknown>,
): Array<() => void> {
	const registry = invokeRegistry(host);
	if (!registry) return [];
	return Object.entries(handlers).map(([method, handler]) => registry.register(extensionId, method, handler));
}

/**
 * Agent → app. POST the namespaced `ext.emit` envelope to the host bridge; the host routes it to
 * the panel's `api.subscribeExt`. Requires the `bridge.emit` capability, a minted session
 * capability, and this id mounted on the session — the two env vars are how we know all three hold.
 *
 * Do not open a fourth transport; do not talk to the renderer directly.
 */
export async function emitToPanel(extensionId: string, event: string, payload?: unknown): Promise<void> {
	const port = process.env.PIPIUI_BRIDGE_PORT;
	const sessionCapability = process.env.PIPIUI_SESSION_CAPABILITY;
	if (!port || !sessionCapability) return;
	try {
		await fetch(`http://127.0.0.1:${port}/rpc`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				schemaVersion: 1,
				sessionCapability,
				action: "ext.emit",
				extensionId,
				event,
				payload,
			}),
		});
	} catch {
		// The panel is a view. A turn is never failed because the view could not be told.
	}
}
