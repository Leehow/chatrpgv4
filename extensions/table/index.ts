/**
 * The table display. When the kernel extension has opened a table it puts `coc:table-open` on
 * the bus and one line about the table is reported here; every `resolve` sends `coc:resolve`, and
 * when it carries a session (combat, chase, sanity bout) the summary is hung on a status line and
 * taken down again when the session ends; each turn's capsule arrives on `coc:capsule` and the
 * Director's suggested beat goes on another line (contract §13.9: displayed only, never
 * interpreted, never acted on); each turn's mechanics projection arrives on `coc:mechanics` and a
 * compact status line is drawn from it (contract §16.2 — a status line, never an injection into
 * the Keeper's prose). No rule is ever explained here.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { cocMode } from "../lanes/host.ts";

/** The session summary of contract §11.5; a missing field just means that piece is not shown. */
interface SessionSummary {
	kind?: string;
	round?: number;
	status?: string;
	ended?: boolean;
	turn_of?: string;
	active_actor?: string;
	pending_defense?: { for?: string; defender?: string; options?: string[] } | null;
}

interface ResolveEvent {
	result?: { session?: SessionSummary | null };
}

/** The `director` section of contract §13.1; only the two displayed fields are taken, scores and grounds stay off the status line. */
interface DirectorSection {
	beat?: string;
	override?: string;
}

interface CapsuleEvent {
	capsule?: { director?: DirectorSection | null } | null;
}

interface MechanicsEvent {
	turn?: number;
	mechanics?: Array<Record<string, unknown>>;
}

interface TableOpenEvent {
	campaign?: string;
	open?: {
		campaign?: { title?: string };
		turn?: { number?: number; state?: string };
		investigators?: Array<{ name?: string; hp?: number; san?: number }>;
		scene?: { name?: string; display_name?: string };
	};
}

function describe(payload: TableOpenEvent): string {
	const open = payload.open ?? {};
	const title = open.campaign?.title ?? payload.campaign ?? "unnamed campaign";
	const scene = open.scene?.display_name ?? open.scene?.name ?? "unknown scene";
	const who = (open.investigators ?? [])
		.map((inv) => `${inv.name ?? "unnamed investigator"}  HP ${inv.hp ?? "?"} / SAN ${inv.san ?? "?"}`)
		.join(" | ");
	const turn = open.turn?.number ?? 0;
	return `${title}  turn ${turn}  ${scene}${who ? `\n${who}` : ""}`;
}

/** One line of session summary; undefined when there is no session or it has ended, and the caller takes the line down. */
function sessionLine(session: SessionSummary | null | undefined): string | undefined {
	if (!session?.kind) return undefined;
	if (session.ended === true || session.status === "ended") return undefined;
	// Session kinds and defence options are closed enums from the contract: shown verbatim, never
	// translated — the status line is provenance for a human, not an instruction for the Keeper,
	// and a translation layer would only stop matching the words in the capsule.
	const parts = [session.kind];
	if (typeof session.round === "number") parts.push(`round ${session.round}`);
	const whose = session.turn_of ?? session.active_actor;
	if (whose) parts.push(`turn: ${whose}`);
	const defense = session.pending_defense;
	if (defense) {
		const who = defense.for === "player" ? "player" : (defense.defender ?? "NPC");
		const options = (defense.options ?? []).join("/");
		parts.push(`defence: ${who}${options ? ` (${options})` : ""}`);
	}
	return parts.join("  ");
}

/**
 * One line of Director suggestion; undefined when there is no `director` section (slice 0-2 kernels),
 * and the caller takes the line down. Beat names and hard-rule names are closed enums from the
 * contract, shown verbatim.
 */
function directorLine(director: DirectorSection | null | undefined): string | undefined {
	const beat = typeof director?.beat === "string" ? director.beat.trim() : "";
	if (!beat) return undefined;
	const override = typeof director?.override === "string" ? director.override.trim() : "";
	return override ? `beat ${beat}  override ${override}` : `beat ${beat}`;
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function num(value: unknown): string | undefined {
	return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}

/**
 * One mechanics row as a compact status fragment. The kinds are the closed set of contract §16.2;
 * an unknown kind is shown by its name alone. Nothing here is player-facing text: it is the
 * language-neutral projection rendered for whoever is watching the terminal.
 */
function mechanicsFragment(row: Record<string, unknown>): string | undefined {
	const kind = text(row.kind);
	if (!kind) return undefined;
	switch (kind) {
		case "roll": {
			const roll = num(row.roll);
			const target = num(row.target);
			if (!roll || !target) return "roll";
			return `roll ${roll}/${target} ${row.passed === true ? "pass" : "fail"}`;
		}
		case "dice": {
			const total = num(row.total);
			const label = text(row.expression) ?? text(row.label) ?? "dice";
			return total ? `${label} = ${total}` : label;
		}
		case "change": {
			const resource = text(row.resource) ?? "change";
			const before = num(row.before);
			const after = num(row.after);
			return before && after ? `${resource} ${before}->${after}` : resource;
		}
		case "cash": {
			const before = num(row.before);
			const after = num(row.after);
			return before && after ? `cash ${before}->${after}` : "cash";
		}
		case "scene": {
			const to = text(row.to);
			return to ? `move -> ${to}` : "move";
		}
		case "clue":
			return `clue ${text(row.label) ?? text(row.clue) ?? ""}`.trim();
		case "time": {
			const minutes = num(row.minutes);
			return minutes ? `+${minutes}m` : "time";
		}
		case "item": {
			const name = text(row.name) ?? "item";
			const quantity = typeof row.quantity === "number" && row.quantity !== 1 ? ` x${row.quantity}` : "";
			return `item ${name}${quantity}`;
		}
		case "session": {
			const family = text(row.family) ?? "session";
			const transition = text(row.transition);
			return transition ? `${family} ${transition}` : family;
		}
		case "choice":
			return `choice ${text(row.option) ?? ""}`.trim();
		case "handout":
			return `handout ${text(row.name) ?? ""}`.trim();
		default:
			return kind;
	}
}

/** The compact status line for one turn's mechanics; undefined when there is nothing to show. */
function mechanicsLine(event: MechanicsEvent): string | undefined {
	const rows = Array.isArray(event.mechanics) ? event.mechanics : [];
	const parts = rows
		.map((row) => (row && typeof row === "object" ? mechanicsFragment(row as Record<string, unknown>) : undefined))
		.filter((part): part is string => Boolean(part));
	if (parts.length === 0) return undefined;
	const turn = typeof event.turn === "number" ? `t${event.turn}  ` : "";
	return `${turn}${parts.join("  ")}`;
}

export default function (pi: ExtensionAPI) {
	// The setup process has no table to report on: it registers nothing and subscribes to nothing
	// (contract §14.4). Setup's own progress line lives in the onboarding extension.
	if (cocMode() === "setup") return;

	let ctx: ExtensionContext | undefined;
	let payload: TableOpenEvent | undefined;
	let announced = false;
	let session: string | undefined;
	let director: string | undefined;
	let mechanics: string | undefined;
	const handoutsSeen = new Set<string>();

	function announce(): void {
		if (announced || !payload || !ctx) return;
		announced = true;
		const line = describe(payload);
		if (ctx.hasUI) {
			ctx.ui.notify(line, "info");
			return;
		}
		pi.appendEntry("coc-welcome", { campaign: payload.campaign, text: line });
	}

	function paintSession(): void {
		if (!ctx?.hasUI) return;
		ctx.ui.setStatus("coc-session", session);
	}

	function paintDirector(): void {
		if (!ctx?.hasUI) return;
		ctx.ui.setStatus("coc-director", director);
	}

	function paintMechanics(): void {
		if (!ctx?.hasUI) return;
		ctx.ui.setStatus("coc-mechanics", mechanics);
	}

	/**
	 * A handout the Keeper showed this turn carries a file path the host cannot attach
	 * (`docs/pi-host-contract.md` §3.3: Pi has no outbound attachment channel). The path is not
	 * player-facing prose, so it never enters the delivery; it is announced here once per handout
	 * so whoever sits at the terminal can open the file. A front end renders the same row instead.
	 */
	function announceHandouts(event: MechanicsEvent): void {
		const turn = typeof event.turn === "number" ? event.turn : "?";
		for (const row of Array.isArray(event.mechanics) ? event.mechanics : []) {
			if (!row || typeof row !== "object") continue;
			const entry = row as Record<string, unknown>;
			if (text(entry.kind) !== "handout") continue;
			const path = text(entry.path);
			if (!path) continue;
			const name = text(entry.name) ?? "handout";
			const key = `${turn}:${name}:${path}`;
			if (handoutsSeen.has(key)) continue;
			handoutsSeen.add(key);
			const line = `handout ${name}: ${path}`;
			if (ctx?.hasUI) ctx.ui.notify(line, "info");
			else pi.appendEntry("coc-handout", { turn: event.turn, name, path });
		}
	}

	// A bus event may arrive before this extension's session_start (the kernel extension loads first): both orders must be caught.
	pi.events.on("coc:table-open", (data) => {
		payload = (data ?? {}) as TableOpenEvent;
		announce();
	});

	// The capsule is delivered by the kernel extension in `before_agent_start`; the same copy goes on the bus verbatim (contract §13.9).
	pi.events.on("coc:capsule", (data) => {
		const next = directorLine(((data ?? {}) as CapsuleEvent).capsule?.director);
		if (next === director) return;
		director = next;
		paintDirector();
	});

	pi.events.on("coc:resolve", (data) => {
		const next = sessionLine(((data ?? {}) as ResolveEvent).result?.session);
		if (next === session) return;
		session = next;
		paintSession();
	});

	// The mechanics projection of a closed turn (contract §16.2): a compact status line only. The
	// numbers the player reads are the ones the Keeper wrote into the prose; nothing is injected here.
	pi.events.on("coc:mechanics", (data) => {
		const event = (data ?? {}) as MechanicsEvent;
		announceHandouts(event);
		const next = mechanicsLine(event);
		if (next === mechanics) return;
		mechanics = next;
		paintMechanics();
	});

	pi.on("session_start", async (_event, sessionCtx) => {
		ctx = sessionCtx;
		announce();
	});

	pi.on("session_shutdown", async () => {
		if (session !== undefined) {
			session = undefined;
			paintSession();
		}
		if (director !== undefined) {
			director = undefined;
			paintDirector();
		}
		if (mechanics !== undefined) {
			mechanics = undefined;
			paintMechanics();
		}
		ctx = undefined;
		payload = undefined;
		announced = false;
	});
}
