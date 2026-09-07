/** Local PDF page access. Source bytes and physical pages are the evidence; no OCR path. */
import { createHash } from "node:crypto";
import { appendFile, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { getDocument, version } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const require = createRequire(import.meta.url);
const pdfRoot = dirname(require.resolve("pdfjs-dist/package.json"));
export type Box = [number, number, number, number];

export function validateBox(value?: number[]): Box {
	const box = value ?? [0, 0, 1, 1];
	if (box.length !== 4 || box.some((v) => !Number.isFinite(v)) || box[0] < 0 || box[1] < 0 ||
		box[2] > 1 || box[3] > 1 || box[0] >= box[2] || box[1] >= box[3]) {
		throw new Error("box must be x0,y0,x1,y1 in the rotated page, with 0 <= start < end <= 1");
	}
	return box as Box;
}

async function openPdf(path: string) {
	const bytes = await readFile(path);
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	const task = getDocument({
		data: new Uint8Array(bytes),
		cMapUrl: join(pdfRoot, "cmaps") + "/", cMapPacked: true,
		standardFontDataUrl: join(pdfRoot, "standard_fonts") + "/",
		wasmUrl: join(pdfRoot, "wasm") + "/",
		isEvalSupported: false, useSystemFonts: true, verbosity: 0,
	});
	try {
		return { document: await task.promise, sha256, close: () => task.destroy() };
	} catch (error) {
		await task.destroy();
		throw error;
	}
}

export async function sourceInfo(pdf: string) {
	const { document, sha256, close } = await openPdf(pdf);
	try {
		const outline = await document.getOutline();
		async function entries(rows: typeof outline): Promise<unknown[]> {
			return Promise.all((rows ?? []).map(async (row) => {
				const dest = typeof row.dest === "string" ? await document.getDestination(row.dest) : row.dest;
				let page: number | undefined;
				if (dest?.[0] !== undefined) {
					try { page = (typeof dest[0] === "number" ? dest[0] : await document.getPageIndex(dest[0])) + 1; }
					catch { /* a broken bookmark remains a named bookmark */ }
				}
				return { name: row.title, ...(page ? { page } : {}), children: await entries(row.items) };
			}));
		}
		return { path: resolve(pdf), file_sha256: sha256, page_count: document.numPages,
			labels: await document.getPageLabels(), bookmarks: await entries(outline) };
	} finally { await close(); }
}

export async function sourcePage(pdf: string, cache: string, page: number, options: { box?: number[]; pixels?: number } = {}) {
	if (!Number.isInteger(page) || page < 1) throw new Error("page must be a positive physical page number");
	const box = validateBox(options.box);
	const pixels = options.pixels ?? 2000;
	if (!Number.isInteger(pixels) || pixels < 256 || pixels > 3000) throw new Error("pixels must be an integer from 256 to 3000");
	const { document, sha256, close } = await openPdf(pdf);
	try {
		if (page > document.numPages) throw new Error(`page ${page} is outside this PDF (1-${document.numPages})`);
		const key = createHash("sha256").update(JSON.stringify({ sha256, page, box, pixels, version })).digest("hex");
		await mkdir(cache, { recursive: true });
		const path = join(resolve(cache), `${key}.png`);
		const metaPath = join(resolve(cache), `${key}.json`);
		let result: Record<string, unknown> | undefined;
		try {
			const meta = JSON.parse(await readFile(metaPath, "utf8"));
			const bytes = await readFile(path);
			if (meta.image_sha256 === createHash("sha256").update(bytes).digest("hex")) result = { ...meta, reused: true };
		} catch { /* a partial cache entry is rendered again */ }
		if (!result) {
			const pdfPage = await document.getPage(page);
			const base = pdfPage.getViewport({ scale: 1 });
			const width = base.width * (box[2] - box[0]);
			const height = base.height * (box[3] - box[1]);
			const scale = pixels / Math.max(width, height);
			const viewport = pdfPage.getViewport({ scale });
			const canvas = document.canvasFactory.create(Math.max(1, Math.ceil(width * scale)), Math.max(1, Math.ceil(height * scale)));
			try {
				await pdfPage.render({ canvasContext: canvas.context, viewport,
					transform: [1, 0, 0, 1, -base.width * box[0] * scale, -base.height * box[1] * scale] }).promise;
				const bytes = canvas.canvas.toBuffer("image/png");
				result = { path, page, box, width: canvas.canvas.width, height: canvas.canvas.height,
					file_sha256: sha256, image_sha256: createHash("sha256").update(bytes).digest("hex"), reused: false };
				const temporary = `${path}.${process.pid}.tmp`;
				await writeFile(temporary, bytes);
				await rename(temporary, path);
				await writeFile(metaPath, JSON.stringify(result) + "\n");
			} finally { document.canvasFactory.destroy(canvas); pdfPage.cleanup(); }
		}
		const viewPath = join(resolve(cache), `page-${page}-region-${box.join("-")}-${pixels}.png`);
		await copyFile(path, viewPath);
		result = { ...result, path: viewPath };
		await appendFile(join(resolve(cache), "requests.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...result }) + "\n");
		return result;
	} finally { await close(); }
}

export async function sourceAsset(pdf: string, cache: string, regions: Array<{ page: number; box?: number[] }>, destination: string) {
	if (!regions.length) throw new Error("an image asset needs an explicit source region");
	const parts = [];
	let measuredWidth = 0, measuredHeight = 0;
	for (const region of regions) {
		const rendered = await sourcePage(pdf, cache, region.page, { box: region.box });
		const part = await loadImage(rendered.path as string);
		measuredWidth = Math.max(measuredWidth, part.width); measuredHeight += part.height;
		if (measuredWidth * measuredHeight > 20_000_000) throw new Error("this image asset is too large; represent its authored parts separately");
		parts.push(part);
	}
	const width = Math.max(...parts.map(p => p.width));
	const height = parts.reduce((n, p) => n + p.height, 0);
	if (width * height > 20_000_000) throw new Error("this image asset is too large; represent its authored parts separately");
	const canvas = createCanvas(width, height), context = canvas.getContext("2d");
	context.fillStyle = "white"; context.fillRect(0, 0, width, height);
	let y = 0;
	for (const part of parts) { context.drawImage(part, 0, y); y += part.height; }
	const bytes = canvas.toBuffer("image/png");
	if (bytes.length > 20 * 1024 * 1024) throw new Error("the asset exceeds the existing 20 MiB image limit");
	await mkdir(dirname(destination), { recursive: true });
	await writeFile(destination, bytes);
	return { path: destination, sha256: createHash("sha256").update(bytes).digest("hex"), media_type: "image/png" };
}

async function main(args: string[]) {
	const take = (flag: string) => {
		const index = args.indexOf(flag);
		if (index < 0) return undefined;
		if (!args[index + 1]) throw new Error(`${flag} needs a value`);
		return args.splice(index, 2)[1];
	};
	const pdf = take("--pdf");
	const cache = take("--cache");
	const rawBox = take("--box");
	if (!pdf) throw new Error("use --pdf <file> info, or --pdf <file> --cache <directory> page <physical-page> [--box x0,y0,x1,y1]");
	if (args[0] === "info" && args.length === 1) {
		// The agent sees semantic page selectors, not source hashes.
		const info = await sourceInfo(pdf);
		console.log(JSON.stringify({ page_count: info.page_count, labels: info.labels, bookmarks: info.bookmarks }));
	} else if (args[0] === "page" && args.length === 2 && cache) {
		const result = await sourcePage(pdf, cache, Number(args[1]), { ...(rawBox ? { box: rawBox.split(",").map(Number) } : {}) });
		console.log(JSON.stringify({ page: result.page, box: result.box, image: result.path, width: result.width, height: result.height }));
	} else throw new Error("choose info or page <physical-page>; page also needs --cache <directory>");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main(process.argv.slice(2)).catch((error) => { console.error(JSON.stringify({ error: String(error.message ?? error) })); process.exitCode = 1; });
}
