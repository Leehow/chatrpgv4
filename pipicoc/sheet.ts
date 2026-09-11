/**
 * The investigator sheet the right sidebar shows (contract §22.7).
 *
 * This is a projection, not a second source of truth: everything comes from one kernel read,
 * `table.view` (§22.7), which assembles the same blocks the Keeper's own reads return. Nothing here
 * computes, derives or caches a value — a panel that did its own arithmetic would be a second
 * rules engine, and the first divergence would be invisible.
 *
 * `table.view` and not `table.look`, because `look` touches the turn from `open` into `acting`
 * (§12): a Keeper looking is the Keeper acting. A panel refreshing itself must never forge that.
 *
 * Two channels, both host-mediated (`host-bridge.ts`):
 * - the panel asks (`invoke("sheet")`) when it mounts and when it is told something changed;
 * - the turn tells (`ext.emit "sheet-changed"`) when a turn commits, because a delta the player
 *   just watched land has to show up without them poking the panel.
 *
 * The push carries no data on purpose. The panel re-reads, so the sheet it draws is always one
 * kernel read old at worst, never a payload that drifted from the kernel's own answer.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { emitToPanel, registerInvokeHandlers } from "./host-bridge.ts";
import { uiWordsSurface } from "./ui-words.ts";
import type { UiWords } from "../runtime/ui-words.ts";
import type { HostRuntime } from "../runtime/host.ts";

/** The manifest id. The invoke registry and the bridge both namespace by it. */
export const PACK_ID = "coc-keeper";

// Decorative product assets follow the document paper's host-read transport: the
// controlled panel is a data URL module and cannot resolve relative image URLs.
let identityArt: Promise<NonNullable<SheetAnswer["identity_art"]>> | undefined;
function loadIdentityArt() {
	const image = (file: string, mime: string) => readFile(new URL(`./assets/${file}`, import.meta.url))
		.then(bytes => `data:${mime};base64,${bytes.toString("base64")}`).catch(() => undefined);
	return identityArt ??= Promise.all([
		image("investigator-backplate.png", "image/png"),
		image("investigator-seal.png", "image/png"),
	]).then(([backplate, seal]) => ({backplate, seal}));
}

type KernelCall = (method: string, params: Record<string, unknown>) => Promise<unknown>;

interface KernelBridgeEvent {
	campaign?: string;
	call?: KernelCall;
	/** The composed runtime: the content root its words are read from, the home they are cached in, and the lane that projects them. */
	runtime?: HostRuntime;
}

export interface SheetAnswer {
	status?: "ready" | "error";
	/** The `table.view` result (§22.7) verbatim, or null when there is no table yet. */
	view: Record<string, unknown> | null;
	/** Which campaign it came from, so a panel left open across tables can tell. */
	campaign: string | null;
	/** Why there is no view, when there is none. English: this string is for the log, not the player. */
	reason?: string;
	/** The word the panel shows for that refusal is looked up by this (contract §23). */
	code?: string;
	/** The product's own captions for this session's play language, so no renderer keeps a table. */
	ui?: UiWords;
	/** Bundled decoration only; never an investigator image or game state. */
	identity_art?: {backplate?: string; portrait?: string; seal?: string};
}

/**
 * Register the sheet's two channels.
 *
 * Called from the pack entry, so it only exists where PipiUI is the host; `bin/pi-coc` in a
 * terminal loads the same canonical gameplay extensions without it and behaves exactly as before.
 */
export function registerSheetPanel(pi: ExtensionAPI): void {
	let bridge: KernelCall | undefined;
	let campaign: string | undefined;
	let runtime: HostRuntime | undefined;
	let context: ExtensionContext | undefined;
	let language: string | undefined;

	/**
	 * The chrome's words for this table's language (contract §23).
	 *
	 * A tag with a shipped seed or a cached projection answers projected. A tag with neither answers
	 * with the authored words and `projected: false` -- so the sheet draws at once rather than
	 * waiting on a model round -- and one background projection starts for it. When that lands, the
	 * panel is told to re-read and the extensions to drop the words they were holding.
	 *
	 * A build whose words cannot be read answers without a `ui` block rather than failing the read,
	 * and the panel then draws identifiers, never another language.
	 */
	const words = uiWordsSurface((tag) => {
		pi.events.emit("coc:ui-words", { tag });
		void emitToPanel(PACK_ID, "sheet-changed");
	});
	function chrome(): Promise<UiWords | undefined> {
		return words.words(language, runtime ? {
			runtime,
			model: context?.model ? `${context.model.provider}/${context.model.id}` : undefined,
			thinking: context?.thinkingLevel,
		} : undefined);
	}
	async function answer(row: SheetAnswer): Promise<SheetAnswer> {
		const ui = await chrome();
		return ui ? { ...row, ui } : row;
	}

	// The kernel extension puts the closure on the bus in `session_start`; `call: undefined` revokes
	// it. Subscribing at load time (not in our own `session_start`) means both orders work.
	pi.events.on("coc:kernel-bridge", (data) => {
		const event = (data ?? {}) as KernelBridgeEvent;
		bridge = event.call;
		if (event.campaign) campaign = event.campaign;
		if (event.runtime?.contentRoot) runtime = event.runtime;
	});
	pi.on("session_start", async (_event, ctx) => { context = ctx; });
	pi.on("before_agent_start", async (_event, ctx) => { context = ctx; });
	pi.events.on("coc:table-open", (data) => {
		const opened = (data ?? {}) as { campaign?: string; open?: { campaign?: { play_language?: string } } };
		if (opened.campaign) campaign = opened.campaign;
		if (opened.open?.campaign?.play_language) language = opened.open.campaign.play_language;
		void emitToPanel(PACK_ID, "sheet-changed");
	});

  pi.events.on("coc:session-bound", (data) => {
    const linked = data as {campaign?:string; play_language?:string};
    if (linked?.campaign) campaign = linked.campaign;
    if (linked?.play_language) language = linked.play_language;
    void emitToPanel(PACK_ID, "sheet-changed");
  });
  pi.on("tool_result", (event) => {
    if (event.toolName === "setup") void emitToPanel(PACK_ID, "sheet-changed");
  });

	async function read(): Promise<SheetAnswer> {
		if (!bridge) return answer({ view: null, campaign: campaign ?? null, code: "table_not_open", reason: "the table is not open" });
		if (!campaign) return answer({ view: null, campaign: null, code: "campaign_not_open", reason: "no campaign is open" });
		try {
			const result = await bridge("table.view", { campaign });
			const view = result && typeof result === "object" ? (result as Record<string, unknown>) : null;
			// The kernel's own answer names the campaign's language; later reads keep it after a
			// restart that missed `coc:table-open`.
			if (typeof view?.play_language === "string" && view.play_language) language = view.play_language;
			return answer({ status: "ready", view, campaign });
		} catch (error) {
			// A kernel refusal is an answer, not a crash: a campaign with no party yet, a turn
			// record that is still being rebuilt, a kernel that just went away.
			const code = (error as { code?: unknown })?.code;
			return answer({
				view: null,
				campaign: campaign ?? null,
				status: "error",
				code: typeof code === "string" && code ? code : "kernel_error",
				reason: error instanceof Error ? error.message : String(error),
			});
		}
	}

	registerInvokeHandlers(PACK_ID, {
		// `retry_projection` is the player asking again for a lane run that failed -- the same word
		// the sheet's own vocabulary lanes take, so one button covers both.
		sheet: async (raw: unknown) => {
			if (raw && typeof raw === "object" && !Array.isArray(raw)
				&& (raw as { retry_projection?: unknown }).retry_projection === true) words.retry();
			const result = await read();
			return result.view && (raw as {include_identity_art?: unknown})?.include_identity_art === true
				? {...result, identity_art:await loadIdentityArt()} : result;
		},
	});

	// One push per committed turn (contract §12.8). Damage, a spent bullet, a SAN loss and a coin
	// spent all land as receipts inside a turn, so the commit is the one moment that covers them.
	pi.events.on("coc:turn-committed", () => {
		void emitToPanel(PACK_ID, "sheet-changed");
	});
}
