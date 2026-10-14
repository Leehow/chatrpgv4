/**
 * Contract §187.5.3: a reader child's instructions, assembled per purpose. The source reader's instructions are the
 * directory `content/setup/visual-reader/`: the phase's own files first, then `common.md` -- `index.md` for the
 * index author, `read.md` and the purpose's file (`skeleton.md`, `opening.md`, `detail.md`) for a reading author, then a
 * detail material's own file (`pregens.md`, §207.3), and `review.md` for a reviewer. Single-file jobs share only the common capability paragraph.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type ReaderPrompt = { phase: "index" | "read" | "verify"; purpose?: string; guidance?: boolean; answer?: boolean;
	visual?: "scan" | "asset" | "scope"; reference?: "guidance" | "lookup";
	/** §207.3: a detail reading's material; `pregens` adds its own file to the reading author's phase files. */
	material?: string };

export const VISUAL_READER_DIR = "visual-reader";
/** The reading purposes with a phase file of their own under `visual-reader/`. */
const READ_PURPOSES = ["skeleton", "opening", "detail"];

/** §207.3: the detail materials with a file of their own under `visual-reader/`, read after the purpose's file. */
const READ_MATERIALS = ["pregens"];

/** The `visual-reader/` files one source-reader child receives, in order. A read without a known purpose gets every purpose file. */
export function visualReaderFiles(phase: ReaderPrompt["phase"], purpose?: string, material?: string): string[] {
	if (phase === "index") return ["index.md", "common.md"];
	if (phase === "verify") return ["review.md", "common.md"];
	const own = purpose && READ_PURPOSES.includes(purpose) ? [purpose] : READ_PURPOSES;
	return ["read.md", ...own.map(name => `${name}.md`), ...(material && READ_MATERIALS.includes(material) ? [`${material}.md`] : []), "common.md"];
}

/** The instruction text of one reader child. */
export async function readerInstructionText(contentRoot: string, prompt: ReaderPrompt): Promise<string> {
	const { phase, guidance, answer, reference, visual } = prompt;
	if (!["index", "read", "verify"].includes(phase)) throw new Error("Unknown reader instruction phase");
	const setup = join(contentRoot, "setup");
	const single = visual && phase === "read" ? visual === "asset" ? "visual-assets.md" : visual === "scope" ? "visual-map-scope.md" : "visual-discovery.md"
		: reference ? "source-reference-guidance.md" : answer ? "source-answer.md" : guidance ? "visual-guidance.md" : null;
	if (single) {
		const [common, own] = await Promise.all([readFile(join(setup, VISUAL_READER_DIR, "common.md"), "utf8"), readFile(join(setup, single), "utf8")]);
		return common.split('\n## Source access\n')[0] + '\n\n' + own;
	}
	const parts = await Promise.all(visualReaderFiles(phase, prompt.purpose, prompt.material).map(async name => {
		const text = await readFile(join(setup, VISUAL_READER_DIR, name), "utf8");
		return phase === 'index' && name === 'common.md' ? text.split('\n## Module reference policy: logic and campaign continuity\n')[0] : text;
	}));
	return parts.map(part => part.endsWith("\n") ? part : part + "\n").join("\n") + "\nComplete only this phase and then stop.\n";
}
