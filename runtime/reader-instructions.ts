/**
 * Contract §187.5.3: a reader child's instructions, assembled per purpose. The source reader's instructions are the
 * directory `content/setup/visual-reader/`: `common.md` for every child, then the phase's own files -- `index.md` for the
 * index author, `read.md` and the purpose's file (`skeleton.md`, `opening.md`, `detail.md`) for a reading author, then a
 * detail material's own file (`pregens.md`, §207.3), and `review.md` for a reviewer. Visual, guidance, answer and reference jobs keep their own single files.
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
	if (phase === "index") return ["common.md", "index.md"];
	if (phase === "verify") return ["common.md", "review.md"];
	const own = purpose && READ_PURPOSES.includes(purpose) ? [purpose] : READ_PURPOSES;
	return ["common.md", "read.md", ...own.map(name => `${name}.md`), ...(material && READ_MATERIALS.includes(material) ? [`${material}.md`] : [])];
}

/** The instruction text of one reader child. */
export async function readerInstructionText(contentRoot: string, prompt: ReaderPrompt): Promise<string> {
	const { phase, guidance, answer, reference, visual } = prompt;
	if (!["index", "read", "verify"].includes(phase)) throw new Error("Unknown reader instruction phase");
	const setup = join(contentRoot, "setup");
	if (visual && phase === "read") return readFile(join(setup, visual === "asset" ? "visual-assets.md" : visual === "scope" ? "visual-map-scope.md" : "visual-discovery.md"), "utf8");
	if (reference) return readFile(join(setup, "source-reference-guidance.md"), "utf8");
	if (answer) return readFile(join(setup, "source-answer.md"), "utf8");
	if (guidance) return readFile(join(setup, "visual-guidance.md"), "utf8");
	const parts = await Promise.all(visualReaderFiles(phase, prompt.purpose, prompt.material).map(name => readFile(join(setup, VISUAL_READER_DIR, name), "utf8")));
	return parts.map(part => part.endsWith("\n") ? part : part + "\n").join("\n") + "\nComplete only this phase and then stop.\n";
}
