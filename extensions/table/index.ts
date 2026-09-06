/**
 * The table display. When the kernel extension has opened a table it puts `coc:table-open` on
 * the bus and one line about the table is reported here; every `resolve` sends `coc:resolve`, and
 * when it carries a session (combat, chase, sanity bout) the summary is hung on a status line and
 * taken down again when the session ends; each turn's capsule arrives on `coc:capsule` and the
 * Director's suggested beat goes on another line (contract §13.9: displayed only, never
 * interpreted, never acted on); each turn's mechanics projection arrives on `coc:mechanics` and a
 * compact status line is drawn from it (contract §16.2 — a status line, never an injection into
 * the Keeper's prose). No rule is ever explained here.
 *
 * Two more duties from contract §19 live here, both of them about the long game:
 * - the `/coc` command surface (§19.1, in `./commands.ts`): status, model, thinking level, lanes
 *   and evidence, all of it through `ctx.ui`, none of it in the Keeper's context;
 * - the COC-shaped context fold (§19.2, in `./fold.ts`): `session_before_compact` hands Pi a cut
 *   point and a summary this extension wrote itself, and `before_agent_start` compacts early
 *   enough that it never lands in the middle of a tool round trip.
 */

import type { CompactionResult, ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appendJsonl, cocMode } from "../lanes/host.ts";
import { type CommandDeps, registerCocCommand } from "./commands.ts";
import { compactAt, FOLD_NOTE_KIND, foldContext } from "./fold.ts";

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
	capsule?: ({ director?: DirectorSection | null } & Record<string, unknown>) | null;
}

/** The kernel RPC closure the kernel extension puts on `coc:kernel-bridge`; `call: undefined` revokes it. */
interface KernelBridgeEvent {
	campaign?: string;
	call?: (method: string, params: Record<string, unknown>) => Promise<unknown>;
}

interface MechanicsEvent {
	turn?: number;
	mechanics?: Array<Record<string, unknown>>;
}

interface TableOpenEvent {
	campaign?: string;
	open?: {
		campaign?: { title?: string; module_id?: string };
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
	/** This turn's capsule, verbatim off the bus: the panel and the post-fold note read it, nothing rewrites it. */
	let capsule: Record<string, unknown> | undefined;
	/** The kernel RPC closure (docs/pi-host-contract.md §3.1); undefined before the table opens and after it closes. */
	let bridge: ((method: string, params: Record<string, unknown>) => Promise<unknown>) | undefined;

	/** The campaign directory of the open table, or undefined before `coc:table-open`. */
	function campaignDir(): string | undefined {
		const campaign = payload?.campaign;
		if (!campaign || !ctx) return undefined;
		return join(ctx.cwd, ".coc", "campaigns", campaign);
	}

	/**
	 * One telemetry row, the same shape and the same file the kernel and memory extensions write
	 * (contract §8): a session entry that never enters the model context, plus one JSONL line.
	 */
	function record(row: Record<string, unknown>): void {
		try {
			pi.appendEntry("coc-telemetry", row);
		} catch {
			/* telemetry must never break a turn */
		}
		const dir = campaignDir();
		if (dir) void appendJsonl(join(dir, "telemetry.jsonl"), row);
	}

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
		const event = (data ?? {}) as CapsuleEvent;
		capsule = event.capsule ?? undefined;
		const next = directorLine(event.capsule?.director);
		if (next === director) return;
		director = next;
		paintDirector();
	});

	// The kernel RPC closure (docs/pi-host-contract.md §5: extensions share nothing but this bus).
	// `/coc` reads `table.status` and `module.status` over it; a revoked bridge just leaves those rows out.
	pi.events.on("coc:kernel-bridge", (data) => {
		bridge = ((data ?? {}) as KernelBridgeEvent).call;
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

	// ---- The command surface (contract §19.1) -----------------------------

	const deps: CommandDeps = {
		campaign: () => payload?.campaign,
		open: () => payload?.open as Record<string, unknown> | undefined,
		capsule: () => capsule,
		call: () => bridge,
		record,
		telemetryTail: (limit) => {
			const dir = campaignDir();
			if (!dir) return [];
			try {
				return readFileSync(join(dir, "telemetry.jsonl"), "utf8")
					.split("\n")
					.slice(-limit)
					.flatMap((line) => {
						if (!line.trim()) return [];
						try {
							const row = JSON.parse(line);
							return row && typeof row === "object" && !Array.isArray(row) ? [row as Record<string, unknown>] : [];
						} catch {
							return [];
						}
					});
			} catch {
				// No file yet, or it cannot be read: the lanes view says there is nothing rather than failing.
				return [];
			}
		},
		paths: () => {
			const dir = campaignDir();
			if (!dir || !ctx) return [];
			const moduleId = payload?.open?.campaign?.module_id;
			return [
				{ label: "campaign", path: dir },
				{ label: "telemetry", path: join(dir, "telemetry.jsonl") },
				{ label: "transcript", path: join(dir, "transcript.jsonl") },
				{ label: "events", path: join(dir, "events.jsonl") },
				{ label: "turns", path: join(dir, "turns") },
				...(moduleId ? [{ label: "module", path: join(ctx.cwd, ".coc", "modules", moduleId) }] : []),
				{ label: "playtests", path: join(ctx.cwd, ".coc", "playtests") },
			];
		},
	};
	registerCocCommand(pi, deps);

	// ---- The COC context fold (contract §19.2) ----------------------------

	/**
	 * The one host message that follows a fold. It says where the table state is — in the next
	 * turn's capsule, as it is every turn — and what this turn still owes, taken from the capsule's
	 * own structural fields. It never restates the story: that is what the fold's summary keeps.
	 */
	function foldNote(byThisTable: boolean): string {
		const turn = (capsule?.turn ?? {}) as Record<string, unknown>;
		const pending = (turn.pending_choice ?? null) as { name?: string; prompt?: string } | null;
		const obligations = Array.isArray(capsule?.obligations) ? (capsule.obligations as unknown[]).length : 0;
		const owed = pending
			? `This turn owes the player an answer to: ${pending.name ?? pending.prompt ?? "the pending choice"}.`
			: obligations > 0
				? `${obligations} obligation(s) are open; the capsule lists them.`
				: "Nothing is pending on your side right now.";
		// Pi can compact on its own if this table's fold could name no cut point; then the first
		// sentence would not be true, so it is only said when the fold was in fact this table's.
		const what = byThisTable
			? "The table's context was folded. Older turn capsules, mechanics projections and tool round trips were dropped whole; " +
				"every player line and every delivered narration was kept word for word. "
			: "The context was compacted. ";
		return (
			`${what}Do not try to remember the table state from what is left: the next turn's capsule carries the scene, the clock, ` +
			`who is present, the pressures and the obligations, exactly as it does every turn, and recall brings back anything older. ${owed}`
		);
	}

	pi.on("session_before_compact", async (event) => {
		const fold = foldContext({
			entries: event.branchEntries as SessionEntry[],
			fallbackFirstKeptEntryId: event.preparation.firstKeptEntryId,
		});
		if (!fold) {
			// No cut point can be named at all: leave the compaction to Pi rather than guess.
			record({ lane: "fold", ok: false, reason: "no_cut_point", trigger: event.reason });
			return;
		}
		record({
			lane: "fold",
			ok: true,
			trigger: event.reason,
			folded_entries: fold.folded,
			kept_lines: fold.lines.length,
			dropped: fold.dropped,
			tokens_before: event.preparation.tokensBefore,
		});
		const compaction: CompactionResult = {
			summary: fold.summary,
			firstKeptEntryId: fold.firstKeptEntryId,
			tokensBefore: event.preparation.tokensBefore,
			details: fold.details,
		};
		return { compaction };
	});

	pi.on("session_compact", async (event) => {
		try {
			pi.sendMessage(
				{
					customType: "coc-host",
					content: foldNote(event.fromExtension === true),
					display: false,
					details: { coc_host: true, kind: FOLD_NOTE_KIND },
				},
				{ triggerTurn: false },
			);
		} catch {
			/* the note is a courtesy; a session that will not take it must not break the turn */
		}
	});

	/**
	 * Compact before the turn rather than inside it (contract §19.2). Pi's own threshold fires on
	 * an assistant message, which in a COC turn is usually in the middle of a tool round trip; the
	 * table would rather pay the fold now, with the turn state machine untouched. `ctx.compact` is
	 * fire-and-forget, so it is awaited through its own callbacks — the turn starts on the folded
	 * context, not beside it.
	 */
	pi.on("before_agent_start", async (_event, turnCtx) => {
		const usage = turnCtx.getContextUsage();
		const percent = usage?.percent;
		if (typeof percent !== "number") return;
		const threshold = compactAt() * 100;
		if (percent < threshold) return;
		const began = Date.now();
		await new Promise<void>((done) => {
			try {
				turnCtx.compact({
					onComplete: () => {
						record({ lane: "fold", event: "pre-emptive", ok: true, percent, threshold, ms: Date.now() - began });
						done();
					},
					onError: (error) => {
						// "Nothing to compact" lands here too: the turn goes ahead either way.
						record({
							lane: "fold",
							event: "pre-emptive",
							ok: false,
							percent,
							threshold,
							ms: Date.now() - began,
							reason: "compact_failed",
							detail: error.message.slice(0, 200),
						});
						done();
					},
				});
			} catch (error) {
				record({
					lane: "fold",
					event: "pre-emptive",
					ok: false,
					percent,
					threshold,
					reason: "compact_unavailable",
					detail: (error instanceof Error ? error.message : String(error)).slice(0, 200),
				});
				done();
			}
		});
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
		capsule = undefined;
		bridge = undefined;
		announced = false;
	});
}
