/**
 * The case board panel's pack side (contract §39.3): the right rail's third panel shows what this
 * table already knows -- the maps it has been shown, the clues it has found, the people it has met.
 *
 * Clues and people are read straight out of `table.view` (§23), the same player-safe projection the
 * investigator sheet draws, so the board is not a second source of truth for them. Maps are the one
 * thing `table.view` does not carry, and a panel may not call `look`: that moves the turn from
 * `open` to `acting` and a view has no business forging one. `table.maps` (§39.3) is the read that
 * exists instead, and it is host-facing on purpose -- its rows carry the private layer geometry, so
 * this hop composes the pixels with the same `renderMapView` the delivery path uses and hands the
 * panel only the flattened attachments. A source path, a redaction box and a placement box never
 * cross into the answer, which is the rule §39 already states for a player projection.
 *
 * Two channels, both host-mediated (`host-bridge.ts`):
 * - the panel asks (`invoke("board")`) when it mounts and when it is told something changed;
 * - the panel is told (`ext.emit "board-changed"`) when a turn commits, because a map the player
 *   just watched arrive has to show up without them poking the panel.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { emitToPanel, registerInvokeHandlers } from "./host-bridge.ts";
import { uiWordsSurface } from "./ui-words.ts";
import { PACK_ID } from "./sheet.ts";
import { renderMapView, type MapAttachment } from "../extensions/kernel/map-view.ts";
import { AUTHORED_MAP_WORDS, KEEPER_MAP_WORDS, projectMapCard, readMapWords } from "../extensions/module/map-presentation.ts";
import type { UiWords } from "../runtime/ui-words.ts";
import type { HostRuntime } from "../runtime/host.ts";

type Row = Record<string, unknown>;
type KernelCall = (method: string, params: Record<string, unknown>) => Promise<unknown>;

interface KernelBridgeEvent {
	campaign?: string;
	call?: KernelCall;
	/** The composed runtime: the content root its words are read from, the home they are cached in, and the lane that projects them. */
	runtime?: HostRuntime;
}

export interface BoardAnswer {
	/** `unbound` is a session with no table yet; `error` is a read that stopped. Both draw a caption, not a crash. */
	status: "ready" | "unbound" | "error";
	/** Which campaign the answer came from, so a panel left open across tables can tell. */
	campaign: string | null;
	/** The word the panel shows for a refusal is looked up by this (contract §23). English is for the log. */
	code?: string;
	reason?: string;
	/** The product's own captions for this session's play language, so no renderer keeps a table. */
	ui?: UiWords;
	/** The `table.view` result (§23) verbatim, or null when the table could not be read. */
	view?: Row | null;
	/** One flattened attachment per map this table has seen (§39.3). Pixels only; never layer geometry. */
	maps?: MapAttachment[];
}

function record(value: unknown): Row {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function rows(value: unknown): Row[] {
	return Array.isArray(value) ? value.filter(item => item && typeof item === "object" && !Array.isArray(item)) as Row[] : [];
}

/**
 * What the panel draws when a row's pixels could not be composed: the map it is, the regions it
 * knows, and `document: "none"` -- the §59 vocabulary that says "delivered, no page", which is the
 * truth here. It is never a source path said in another shape.
 */
function unavailable(row: Row): MapAttachment {
	const regions = rows(row.regions).map(region => ({
		id: String(region.id ?? ""),
		label: String(region.label ?? region.id ?? ""),
		...(typeof region.level === "string" && region.level ? { level: region.level } : {}),
	}));
	return {
		kind: "map",
		map: typeof row.map === "string" ? row.map : "",
		name: typeof row.name === "string" ? row.name : typeof row.map === "string" ? row.map : "",
		...(typeof row.label === "string" && row.label ? { label: row.label } : {}),
		...(typeof row.words === "string" && row.words ? { words: row.words } : {}),
		view_id: "unavailable",
		regions,
		levels: [],
		document: "none",
	};
}

export function registerBoardPanel(pi: ExtensionAPI): void {
	let bridge: KernelCall | undefined;
	let campaign: string | undefined;
	let runtime: HostRuntime | undefined;
	let context: ExtensionContext | undefined;
	let language: string | undefined;

	/**
	 * The chrome's words for this table's language (§23): a shipped seed or a cached projection when
	 * there is one, and otherwise the authored words at once plus one background projection.
	 */
	const words = uiWordsSurface((tag) => {
		pi.events.emit("coc:ui-words", { tag });
		void emitToPanel(PACK_ID, "board-changed");
	});
	function chrome(): Promise<UiWords | undefined> {
		return words.words(language, runtime ? {
			runtime,
			model: context?.model ? `${context.model.provider}/${context.model.id}` : undefined,
			thinking: context?.thinkingLevel,
		} : undefined);
	}
	async function answer(row: BoardAnswer): Promise<BoardAnswer> {
		const ui = await chrome();
		return ui ? { ...row, ui } : row;
	}
	function refuse(code: string, reason: string): Promise<BoardAnswer> {
		return answer({ status: "error", campaign: campaign ?? null, code, reason, view: null, maps: [] });
	}

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
		void emitToPanel(PACK_ID, "board-changed");
	});
	pi.events.on("coc:session-bound", (data) => {
		const linked = data as { campaign?: string; play_language?: string };
		if (linked?.campaign) campaign = linked.campaign;
		if (linked?.play_language) language = linked.play_language;
		void emitToPanel(PACK_ID, "board-changed");
	});

	/**
	 * The map rows this table has seen, as flattened attachments.
	 *
	 * The words come first: a row the arrival hop minted is still in the module's own language
	 * (§39.2), and the host projects it from the dictionary the table's open warmed -- never by
	 * comparing a tag or guessing what language a label is already in. A row that cannot be wholly
	 * projected keeps its authored words, exactly as a card does; half a floor plan in each language
	 * reads as a rendering fault rather than as a pending lane.
	 */
	async function maps(): Promise<MapAttachment[]> {
		if (!bridge || !campaign || !runtime?.home) return [];
		const result = record(await bridge("table.maps", { campaign }).catch(() => null));
		if (!Array.isArray(result.maps)) return [];
		const projection = await readMapWords({ home: runtime.home, play_language: language ?? "", resourceRoot: runtime.resourceRoot }).catch(() => ({}));
		const campaignDir = join(runtime.home, ".coc", "campaigns", campaign);
		const modulesRoot = join(runtime.home, ".coc", "modules");
		const campaignModulesRoot = join(runtime.home, ".coc", "module-campaigns", campaign, "modules");
		const prepared: MapAttachment[] = [];
		for (const row of rows(result.maps)) {
			let card = row;
			if (row.words === AUTHORED_MAP_WORDS) {
				const projected = projectMapCard(row as { name?: string; label?: string; words?: string; regions?: Row[]; levels?: string[] }, projection);
				if (projected.projected) card = { ...projected.card, words: KEEPER_MAP_WORDS };
			}
			const composed = await renderMapView(card, { modulesRoot, sourceRoots: [campaignModulesRoot], campaignDir }).catch(() => null);
			prepared.push(composed ?? unavailable(card));
		}
		return prepared;
	}

	async function board(raw: unknown): Promise<BoardAnswer> {
		if (raw !== undefined && raw !== null && (typeof raw !== "object" || Array.isArray(raw)))
			return refuse("invalid_params", "Expected board parameters to be an object");
		if ((raw as Row | undefined)?.retry_projection === true) words.retry();
		if (!bridge) return refuse("table_not_open", "the table is not open");
		if (!campaign) return answer({ status: "unbound", campaign: null, view: null, maps: [] });
		const view = record(await bridge("table.view", { campaign }).catch(() => null));
		if (typeof view.play_language === "string" && view.play_language) language = view.play_language;
		if (!Object.keys(view).length) return refuse("kernel_error", "the table could not be read just now");
		return answer({ status: "ready", campaign, view, maps: await maps() });
	}

	registerInvokeHandlers(PACK_ID, { board });

	// A committed turn is where a new map or clue lands (contract §12.8); the push carries no data,
	// so the panel re-reads and can never draw a payload that drifted from the kernel's own answer.
	pi.events.on("coc:turn-committed", () => {
		void emitToPanel(PACK_ID, "board-changed");
	});
}
