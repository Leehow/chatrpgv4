/**
 * The turn-illustration lane (contract §35): a host control beside Copy and Create branch that
 * illustrates one Keeper narration row, from that row's own text.
 *
 * It is the portrait mount's sibling, not a kernel feature: no RPC method, no turn, no receipt,
 * no Keeper involvement, nothing enters the offer ledger, and the kernel never reads, writes or
 * validates the image. `table.view` is read-only context for the prompt; a failed read never
 * fails the job.
 *
 * The invoke answers early and pushes late (§35.2): the host's ext-invoke ceiling cannot hold a
 * two-stage image run, so `illustration.generate` answers `{status: "generating"}` at once and
 * the job's end arrives as the `illustration-changed` push `{messageId, status, code?, reference?}`.
 * One job per message row: a click while it runs re-answers `generating`; a click after it lands
 * regenerates and overwrites.
 *
 * The image prompt is written by a tool-enabled lane (§35.3, the text-work ruling), never by the
 * renderer and never inline: a `mod` runtime task reads `scene.json` and writes `prompt.json`,
 * up to two rounds against deterministic validation, the attempts kept as evidence.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateImage } from "../extensions/image-gen/agent/index.js";
import type { ReaderOutcome, ReaderRequest } from "../extensions/module/reader.ts";
import type { HostRuntime } from "../runtime/host.ts";
import { emitToPanel, registerInvokeHandlers } from "./host-bridge.ts";
import { PACK_ID, readStoredPortrait } from "./sheet.ts";

type KernelCall = (method: string, params: Record<string, unknown>) => Promise<unknown>;

interface KernelBridgeEvent {
	campaign?: string;
	call?: KernelCall;
	/** The composed runtime: the home the illustrations are stored under, the content root the lane instruction is read from. */
	runtime?: HostRuntime;
}

/** A refusal in the timeline-style envelope the panel reads; a refusal is returned, never thrown. */
export interface IllustrationFailure {
	ok: false;
	error: { code: string; message: string };
}

/** The image-gen dispatch shape (§35.4); the reference portrait rides as `refs` on an edit. */
export interface IllustrationImageRequest {
	kind: "gen" | "edit";
	prompt: string;
	refs?: string[];
	aspectRatio?: string;
}
export interface IllustrationImage {
	bytes: Uint8Array;
	mime?: string;
}

/**
 * Test seams. Production defaults: the statically imported image-gen dispatch (inlined by the
 * bundler, like the sheet's) and the owner runtime's `mod` task runner.
 */
export interface IllustrationDeps {
	generateImage?: (context: ExtensionContext | undefined, request: IllustrationImageRequest) => Promise<IllustrationImage>;
	runner?: (request: ReaderRequest) => Promise<ReaderOutcome>;
}

/** What the registration returns: tests settle the fire-and-forget jobs through it. */
export interface IllustrationPanel {
	settled(): Promise<void>;
}

/** The lane's instruction, beside the other content-bundle instructions. */
const INSTRUCTION = "setup/illustration-prompt.md";
/** Reference portraits larger than this are dropped (§35.4); the call degrades to a plain generation. */
const REFERENCE_LIMIT_BYTES = 400 * 1024;
/** The mime/extension closed set the stored files share with the portrait mount. */
const IMAGE_FILES: ReadonlyArray<readonly [string, string]> = [
	["png", "image/png"], ["jpg", "image/jpeg"], ["webp", "image/webp"],
];

async function defaultImageGenerator(context: ExtensionContext | undefined, request: IllustrationImageRequest): Promise<IllustrationImage> {
	const result = await generateImage(context, request);
	return { bytes: result.bytes ?? Buffer.from(result.b64, "base64"), mime: result.mime };
}

/** The campaign's illustration folder: `<coc-home>/campaigns/<id>/illustrations`. */
function illustrationsDir(home: string, campaign: string): string {
	return join(home, ".coc", "campaigns", campaign, "illustrations");
}

/** One file per illustrated row; the message id is hashed because it is not a safe file name. */
function illustrationBase(messageId: string): string {
	return `ill-${createHash("sha256").update(messageId).digest("hex").slice(0, 16)}`;
}

async function readIndex(dir: string): Promise<Record<string, string>> {
	try {
		const value = JSON.parse(await readFile(join(dir, "index.json"), "utf8"));
		return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, string> : {};
	} catch {
		return {};
	}
}

/** Atomic-ish index write: a tmp file renamed over the old one, never a half-written index. */
async function writeIndex(dir: string, index: Record<string, string>): Promise<void> {
	await mkdir(dir, { recursive: true });
	const temporary = join(dir, `.index-${randomUUID()}.tmp`);
	await writeFile(temporary, JSON.stringify(index, null, 2));
	await rename(temporary, join(dir, "index.json"));
}

function imageFor(dir: string, file: string): Promise<string | undefined> {
	const mime = IMAGE_FILES.find(([ext]) => file.endsWith(`.${ext}`))?.[1];
	if (!mime) return Promise.resolve(undefined);
	return readFile(join(dir, file)).then(bytes => `data:${mime};base64,${bytes.toString("base64")}`).catch(() => undefined);
}

export function registerIllustrationPanel(pi: ExtensionAPI, deps: IllustrationDeps = {}): IllustrationPanel {
	const imageGenerator = deps.generateImage ?? defaultImageGenerator;
	let bridge: KernelCall | undefined;
	let campaign: string | undefined;
	let runtime: HostRuntime | undefined;
	let context: ExtensionContext | undefined;
	let language: string | undefined;

	/** In-flight jobs, one per message row; a second click while one runs starts nothing. */
	const jobs = new Map<string, Promise<void>>();

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
	});
	pi.events.on("coc:session-bound", (data) => {
		const linked = data as { campaign?: string; play_language?: string };
		if (linked?.campaign) campaign = linked.campaign;
		if (linked?.play_language) language = linked.play_language;
	});

	function refuse(code: string, message: string): IllustrationFailure {
		return { ok: false, error: { code, message } };
	}

	/** The card's own words for the protagonist, when a table is bound; a failed read costs context, never the job. */
	async function protagonist(): Promise<{ description?: string; era?: string }> {
		if (!bridge || !campaign) return {};
		try {
			const view = await bridge("table.view", { campaign }) as { investigators?: unknown } | null;
			const investigators = Array.isArray(view?.investigators) ? view.investigators : [];
			const investigator = investigators[0] as { era?: unknown; backstory?: { personal_description?: unknown } } | undefined;
			const description = typeof investigator?.backstory?.personal_description === "string"
				&& investigator.backstory.personal_description.trim()
				? investigator.backstory.personal_description.trim() : undefined;
			const era = typeof investigator?.era === "string" && investigator.era.trim() ? investigator.era.trim() : undefined;
			return { description, era };
		} catch {
			return {};
		}
	}

	/**
	 * The prompt-writer rounds (§35.3): the tool-enabled child reads `scene.json` and writes
	 * `prompt.json`; what does not validate is named in `findings.json` and asked once more.
	 */
	async function writePrompt(request: ReaderRequest): Promise<string | undefined> {
		const runner = deps.runner ?? ((req: ReaderRequest) => {
			const { signal, ...rest } = req;
			return runtime!.runTask({ kind: "mod", request: rest }, signal);
		});
		for (let round = 1; round <= 2; round++) {
			const outcome = await runner({
				...request,
				eventLog: join(request.cwd, `events-${round}.jsonl`),
				brief: "Read scene.json and write the image prompt to prompt.json: exactly one JSON object {\"prompt\": \"...\"}, without Markdown or trailing text."
					+ (round > 1 ? " Read findings.json and correct the failure it names." : ""),
			});
			if (!outcome.ok || request.signal?.aborted) {
				await writeFile(join(request.cwd, "findings.json"), JSON.stringify({
					error: request.signal?.aborted ? "the run was cancelled" : `the prompt writer did not finish (exit ${outcome.code ?? "unknown"})`,
				}, null, 2));
				continue;
			}
			try {
				const value = JSON.parse(await readFile(join(request.cwd, "prompt.json"), "utf8"));
				const prompt = (value as { prompt?: unknown })?.prompt;
				if (typeof prompt === "string" && prompt.trim()) return prompt.trim();
				throw new Error("prompt.json does not carry a non-empty \"prompt\" string");
			} catch (error) {
				await writeFile(join(request.cwd, "findings.json"), JSON.stringify({
					error: error instanceof Error ? error.message : String(error),
				}, null, 2));
			}
		}
		return undefined;
	}

	/** The background half of `illustration.generate`; its end is the push, never the answer. */
	async function runJob(messageId: string, text: string): Promise<void> {
		const home = runtime!.home;
		const table = campaign!;
		const dir = illustrationsDir(home, table);
		// What became of the portrait reference, reported either way (§35.4).
		let reference: "used" | "dropped-oversize" | "none" = "none";
		const fail = async (code: string) => {
			await emitToPanel(PACK_ID, "illustration-changed", { messageId, status: "error", code, reference });
		};
		try {
			const [{ description, era }, portrait] = await Promise.all([protagonist(), readStoredPortrait(home, table)]);
			const referencePortrait = portrait && portrait.bytes.byteLength <= REFERENCE_LIMIT_BYTES ? portrait : undefined;
			reference = referencePortrait ? "used" : portrait ? "dropped-oversize" : "none";

			const attempt = join(dir, "attempts", randomUUID());
			await mkdir(attempt, { recursive: true });
			await writeFile(join(attempt, "scene.json"), JSON.stringify({
				...(language ? { play_language: language } : {}),
				scene: text,
				protagonist: {
					...(description ? { description } : {}),
					...(era ? { era } : {}),
					reference_photo: reference === "used",
				},
			}, null, 2));
			const prompt = await writePrompt({
				cwd: attempt,
				brief: "",
				systemPrompt: join(runtime!.contentRoot, INSTRUCTION),
				model: context?.model ? `${context.model.provider}/${context.model.id}` : undefined,
				thinking: context?.thinkingLevel,
				signal: runtime!.signal,
				timeoutMs: 180000,
			});
			if (!prompt) return fail("prompt_unavailable");

			let image: IllustrationImage;
			try {
				image = await imageGenerator(context, {
					kind: referencePortrait ? "edit" : "gen",
					prompt,
					refs: referencePortrait ? [referencePortrait.dataUrl] : undefined,
					aspectRatio: "3:4",
				});
			} catch {
				return fail("illustration_unavailable");
			}

			const ext = IMAGE_FILES.find(([, mime]) => mime === image.mime)?.[0] ?? "png";
			const base = illustrationBase(messageId);
			// Regenerating overwrites: one file per row, whatever format the last run left.
			await Promise.all(IMAGE_FILES.map(([name]) => name === ext
				? Promise.resolve()
				: rm(join(dir, `${base}.${name}`), { force: true })));
			const file = `${base}.${ext}`;
			await mkdir(dir, { recursive: true });
			await writeFile(join(dir, file), image.bytes);
			const index = await readIndex(dir);
			index[messageId] = file;
			await writeIndex(dir, index);
			await emitToPanel(PACK_ID, "illustration-changed", { messageId, status: "ready", reference });
		} catch {
			await fail("illustration_unavailable");
		}
	}

	async function generate(raw: unknown): Promise<{ status: "generating" } | IllustrationFailure> {
		if (raw === null || typeof raw !== "object" || Array.isArray(raw))
			return refuse("invalid_params", "Expected illustration.generate parameters to be an object");
		const params = raw as { messageId?: unknown; text?: unknown };
		if (typeof params.messageId !== "string" || !params.messageId.trim())
			return refuse("invalid_params", "illustration.generate needs the message id");
		if (typeof params.text !== "string" || !params.text.trim())
			return refuse("invalid_params", "illustration.generate needs the narration text");
		if (!runtime?.home || !runtime.contentRoot) return refuse("table_not_open", "the table is not open");
		if (!campaign) return refuse("campaign_not_open", "no campaign is open");
		const messageId = params.messageId;
		// One job per row: a click while it runs is already answered, and starts nothing.
		if (jobs.has(messageId)) return { status: "generating" };
		const job = runJob(messageId, params.text).finally(() => { jobs.delete(messageId); });
		jobs.set(messageId, job);
		return { status: "generating" };
	}

	async function get(raw: unknown): Promise<{ messageId: string; image: string } | IllustrationFailure> {
		if (raw === null || typeof raw !== "object" || Array.isArray(raw))
			return refuse("invalid_params", "Expected illustration.get parameters to be an object");
		const messageId = (raw as { messageId?: unknown }).messageId;
		if (typeof messageId !== "string" || !messageId.trim())
			return refuse("invalid_params", "illustration.get needs the message id");
		if (!runtime?.home) return refuse("table_not_open", "the table is not open");
		if (!campaign) return refuse("campaign_not_open", "no campaign is open");
		const dir = illustrationsDir(runtime.home, campaign);
		const file = (await readIndex(dir))[messageId];
		const image = file ? await imageFor(dir, file) : undefined;
		if (!image) return refuse("illustration_not_found", "this message has no illustration");
		return { messageId, image };
	}

	async function list(raw: unknown): Promise<{ images: Array<{ messageId: string; image: string }> } | IllustrationFailure> {
		if (raw !== undefined && (raw === null || typeof raw !== "object" || Array.isArray(raw)))
			return refuse("invalid_params", "Expected illustration.list parameters to be an object");
		// A session without a bound table has no illustrations; that is an empty answer, not a refusal.
		if (!runtime?.home || !campaign) return { images: [] };
		const dir = illustrationsDir(runtime.home, campaign);
		const index = await readIndex(dir);
		const images: Array<{ messageId: string; image: string }> = [];
		for (const [messageId, file] of Object.entries(index)) {
			const image = await imageFor(dir, file);
			if (image) images.push({ messageId, image });
		}
		return { images };
	}

	registerInvokeHandlers(PACK_ID, {
		"illustration.generate": generate,
		"illustration.get": get,
		"illustration.list": list,
	});

	return {
		async settled(): Promise<void> {
			while (jobs.size) await Promise.all([...jobs.values()]);
		},
	};
}
