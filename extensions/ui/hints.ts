/**
 * Beginner hints: what a first-time player is told at the moments that need it, once (docs/specs/
 * opening-guidance.md §4). Two facts decide whether a hint's fold opens by itself: the product
 * setting `ext.coc-keeper.beginnerHints` the host keeps in its settings document (default on), and
 * whether this home has shown that moment before (`<home>/.coc/ui-hints.json`). Both are the host's
 * files, never the browser's storage (user ruling 2026-09-16), and never the campaign's: a hint is
 * about the player at this desk, not about a table.
 *
 * The decision is made where the message is written -- the onboarding extension for the setup
 * opening, the kernel extension for the Keeper's opening -- and recorded at once, so a fold opens
 * once by construction and the renderers stay stateless: they draw `open` as they are told.
 */
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";

/** The moments a hint exists for; a moment not named here is not a hint. */
export type HintMoment = "setup-opening" | "play-opening";
export type OpeningHelp = { moment: HintMoment; title: string; lines: string[]; open: boolean };

const SETTINGS_FILE = "pipiui-settings.json";
const EXTENSION = "coc-keeper";
export const SETTING_KEY = "ext.coc-keeper.beginnerHints";
const SEEN_FILE = join(".coc", "ui-hints.json");

/** The product setting: on unless the host's document says `{enabled: false}` under the pack's slot. */
export async function hintsEnabled(agentHome: string): Promise<boolean> {
	try {
		const settings = JSON.parse(await readFile(join(agentHome, SETTINGS_FILE), "utf8"));
		const value = settings?.extensions?.[EXTENSION]?.settings?.[SETTING_KEY];
		return !(value && typeof value === "object" && (value as { enabled?: unknown }).enabled === false);
	} catch {
		return true;
	}
}

async function readSeen(home: string): Promise<Record<string, string>> {
	try {
		const raw = JSON.parse(await readFile(join(home, SEEN_FILE), "utf8"));
		const seen = raw && typeof raw === "object" ? (raw as { seen?: unknown }).seen : undefined;
		return seen && typeof seen === "object" ? { ...(seen as Record<string, string>) } : {};
	} catch {
		return {};
	}
}

/** Whether this home has shown the moment before. */
export async function hintSeen(home: string, moment: HintMoment): Promise<boolean> {
	return typeof (await readSeen(home))[moment] === "string";
}

/** Record the moment as shown; a write that fails leaves the next table to show it again, which is the safe way round. */
export async function markHintSeen(home: string, moment: HintMoment): Promise<void> {
	const seen = await readSeen(home);
	seen[moment] = new Date().toISOString();
	const path = join(home, SEEN_FILE), pending = `${path}.${process.pid}.tmp`;
	await mkdir(join(home, ".coc"), { recursive: true });
	await writeFile(pending, JSON.stringify({ seen }, null, 2) + "\n", "utf8");
	await rename(pending, path);
}

/**
 * The help fold for a moment, with `open` decided here and recorded here: open when hints are on and
 * this home has not shown the moment yet. The words are the caller's, already in the play language.
 */
export async function openingHelp(moment: HintMoment, title: string, lines: string[], where: { home: string; agentHome: string }): Promise<OpeningHelp> {
	const open = (await hintsEnabled(where.agentHome)) && !(await hintSeen(where.home, moment));
	if (open) {
		try { await markHintSeen(where.home, moment); } catch { /* shown again next time, never lost */ }
	}
	return { moment, title, lines: lines.filter(line => line.trim()), open };
}

/** The host's agent home, where its settings document lives: the same rule the runtime uses. */
export function agentHomeOf(cwd: string): string {
	const configured = process.env.PI_CODING_AGENT_DIR?.trim();
	return configured || join(cwd, ".pi", "coc-agent");
}
