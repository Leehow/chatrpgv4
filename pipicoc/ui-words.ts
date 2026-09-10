/**
 * The chrome's words for a panel, and the one background projection that fills them (contract §23).
 *
 * Every panel answer carries `ui = {tag, words, projected, source}`. A tag with a shipped seed or a
 * cached projection answers projected at once. A tag with neither answers with the authored words
 * and `projected: false` -- the panel draws immediately, in the system language, rather than showing
 * an ellipsis while a model round runs -- and this starts one lane run for that tag. When it lands
 * the panels are told to re-read (`sheet-changed`, `mods-changed`) and the extensions are told to
 * drop the authored words they were holding (`coc:ui-words {tag}`).
 *
 * One run per (home, tag), the way `documentPresentationStatus` keeps one reading per document: the
 * sheet is re-read on every commit, and a projection started per read would run the same lane a
 * dozen times a turn. A run that fails is not retried on its own -- the words that are showing are
 * correct English, not a broken panel -- so a retry is the player's, through the same
 * `retry_projection` the sheet lanes use.
 */
import { prepareUiWords } from "../extensions/module/ui-presentation.ts";
import { resolveUiWords, type UiWords } from "../runtime/ui-words.ts";
import type { HostRuntime } from "../runtime/host.ts";

/** What the lane needs from the session to run: the owner runtime, and the model the table is on. */
export interface UiWordsOwner {
	runtime: HostRuntime;
	model?: string;
	thinking?: string;
	signal?: AbortSignal;
}

type Job = { status: "pending" | "failed" };

/**
 * One panel's handle on the words. Held in the panel's own closure rather than in a module-level
 * cache, so two sessions in one process never inherit each other's language or each other's jobs.
 */
export interface UiWordsSurface {
	/** The words for `tag` under `runtime`, starting the projection when there is none. */
	words(tag: string | undefined, owner: UiWordsOwner | undefined): Promise<UiWords | undefined>;
	/** Forget the failed jobs, so the next read starts them again (the panel's `retry_projection`). */
	retry(): void;
}

export function uiWordsSurface(announce: (tag: string) => void): UiWordsSurface {
	const resolved = new Map<string, Promise<UiWords | undefined>>();
	const jobs = new Map<string, Job>();
	return {
		retry(): void {
			for (const [key, job] of jobs) if (job.status === "failed") jobs.delete(key);
		},
		async words(tag: string | undefined, owner: UiWordsOwner | undefined): Promise<UiWords | undefined> {
			const runtime = owner?.runtime;
			const contentRoot = runtime?.contentRoot;
			if (!contentRoot) return undefined;
			const home = runtime.home;
			const key = JSON.stringify([contentRoot, home, tag ?? null]);
			let pending = resolved.get(key);
			if (!pending) {
				pending = resolveUiWords({ contentRoot, home, tag })
					.catch(() => { resolved.delete(key); return undefined; });
				resolved.set(key, pending);
			}
			const words = await pending;
			if (!words || words.projected) return words;
			const jobKey = JSON.stringify([home, words.tag]);
			if (!jobs.has(jobKey)) {
				jobs.set(jobKey, { status: "pending" });
				void prepareUiWords({
					home, contentRoot, play_language: words.tag,
					model: owner?.model, thinking: owner?.thinking,
					signal: owner?.signal ?? runtime.signal,
					runner: request => runtime.runTask({ kind: "mod", request }, request.signal),
				}).then(() => {
					jobs.delete(jobKey);
					// The next read must see the cache the lane just wrote, not the answer that
					// said there was none.
					resolved.delete(key);
					announce(words.tag);
				}, () => { jobs.set(jobKey, { status: "failed" }); });
			}
			return words;
		},
	};
}
