/** Local PDF page access. Source bytes and physical pages are the evidence; no OCR path. */
import { createHash, randomUUID } from "node:crypto";
import { appendFile, copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { getDocument, version } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas, loadImage, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";

const require = createRequire(import.meta.url);
const pdfRoot = dirname(require.resolve("pdfjs-dist/package.json"));
export const sourceRenderVersion = `pdfjs-${version}:canvas-${require("@napi-rs/canvas/package.json").version}:page-v2`;
export const sourceOverviewVersion = `${sourceRenderVersion}:overview-v1`;
export type Box = [number, number, number, number];
type PdfCanvas = {canvas: Canvas; context: SKRSContext2D};
interface PdfCanvasFactory {create(width: number, height: number): PdfCanvas; destroy(target: PdfCanvas): void}

export function validateBox(value?: number[]): Box {
	const box = value ?? [0, 0, 1, 1];
	if (box.length !== 4 || box.some((v) => !Number.isFinite(v)) || box[0] < 0 || box[1] < 0 ||
		box[2] > 1 || box[3] > 1 || box[0] >= box[2] || box[1] >= box[3]) {
		throw new Error("box must be x0,y0,x1,y1 in the rotated page, with 0 <= start < end <= 1");
	}
	return box as Box;
}

async function loadPdf(path: string) {
	const bytes = await readFile(path);
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	const options = {
		data: new Uint8Array(bytes),
		cMapUrl: join(pdfRoot, "cmaps") + "/", cMapPacked: true,
		standardFontDataUrl: join(pdfRoot, "standard_fonts") + "/",
		wasmUrl: join(pdfRoot, "wasm") + "/",
		isEvalSupported: false, useSystemFonts: true, verbosity: 0,
	};
	const task = getDocument(options);
	try {
		return { document: await task.promise, sha256, textPages: new Map<number, Promise<string>>(), close: () => task.destroy() };
	} catch (error) {
		await task.destroy();
		throw error;
	}
}

type LoadedPdf = Awaited<ReturnType<typeof loadPdf>>;
type DocumentEntry = {path:string; stamp:string; bytes:number; users:number; lastUsed:number;
	loaded:Promise<LoadedPdf>; timer?:ReturnType<typeof setTimeout>; disposed?:Promise<void>};
const documents = new Map<string,DocumentEntry>();
const documentLimit = 2, documentBytesLimit = 128 * 1024 * 1024;
const identity = (info: Awaited<ReturnType<typeof sourceStat>>) => [info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':');
const sourceStat = (path:string) => stat(path,{bigint:true});
function disposeDocument(entry: DocumentEntry): Promise<void> {
	if (entry.timer) clearTimeout(entry.timer);
	if (documents.get(entry.path) === entry) documents.delete(entry.path);
	return entry.disposed ??= entry.loaded.then(value=>value.close(),()=>undefined);
}
async function trimDocuments() {
	let bytes = [...documents.values()].reduce((total,entry)=>total+entry.bytes,0);
	for (const entry of [...documents.values()].sort((a,b)=>a.lastUsed-b.lastUsed)) {
		if (documents.size <= documentLimit && bytes <= documentBytesLimit) break;
		if (entry.users) continue;
		bytes -= entry.bytes; await disposeDocument(entry);
	}
}
async function openPdf(path: string) {
	path = resolve(path);
	const info = await sourceStat(path), stamp = identity(info);
	let entry = documents.get(path);
	if (entry && entry.stamp !== stamp) {
		documents.delete(path);
		if (!entry.users) await disposeDocument(entry);
		entry = undefined;
	}
	if (!entry) {
		const loaded = loadPdf(path).then(async value=>{
			try {
				if (identity(await sourceStat(path)) !== stamp) throw new Error('Source PDF changed while opening; retry its current bytes');
				return value;
			} catch(error) { await value.close(); throw error; }
		});
		entry = {path,stamp,bytes:Number(info.size),users:0,lastUsed:Date.now(),loaded};
		documents.set(path,entry);
	}
	const owned = entry;
	if (owned.timer) clearTimeout(owned.timer);
	owned.users++;
	let released = false;
	const close = async () => {
		if (released) return; released = true;
		owned.users--; owned.lastUsed = Date.now();
		if (!owned.users) {
			if (documents.get(path) !== owned) await disposeDocument(owned);
			else {
				owned.timer = setTimeout(()=>{if(!owned.users)void disposeDocument(owned).catch(()=>undefined);},30_000);
				owned.timer.unref();
			}
		}
		await trimDocuments();
	};
	try {
		const value = await owned.loaded;
		return {document:value.document,sha256:value.sha256,textPages:value.textPages,close};
	} catch (error) {
		if (documents.get(path) === owned) documents.delete(path);
		await close(); throw error;
	}
}

/** Shutdown drops idle documents now; in-flight leases destroy theirs after rendering. */
export async function closeSourceDocuments(): Promise<void> {
	const pending:Promise<void>[] = [];
	for (const entry of documents.values()) {
		documents.delete(entry.path);
		if (!entry.users) pending.push(disposeDocument(entry));
	}
	await Promise.all(pending);
}

const pageRequests = new Map<string,Promise<Record<string,unknown>>>();
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

export interface SourceSearchOptions { query: string; first_page?: number; last_page?: number; limit?: number; cursor?: string }
const searchPageLimit = 50, searchSnippetLimit = 240;
const normalizeSearch = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();

/** Map a normalized match back to a bounded slice of the original extracted text. */
function searchSnippet(original: string, offset: number): string {
	let low = 0, high = original.length;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if (normalizeSearch(original.slice(0, middle)).length <= offset) low = middle + 1;
		else high = middle;
	}
	const start = Math.max(0, low - 1 - 60);
	return original.slice(start, start + searchSnippetLimit);
}

/** Native text locates candidate pages only; it never records image observations. */
export async function sourceSearch(pdf: string, options: SourceSearchOptions, signal?: AbortSignal) {
	if (!options || typeof options !== "object" || Array.isArray(options) ||
		Object.keys(options).some(key => !["query", "first_page", "last_page", "limit", "cursor"].includes(key)))
		throw new Error("search needs query and optional first_page, last_page, limit, cursor");
	if (typeof options.query !== "string" || options.query.length > 256 || !normalizeSearch(options.query))
		throw new Error("search query must contain 1-256 characters of literal text");
	const query = normalizeSearch(options.query), limit = options.limit ?? 8;
	if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("search limit must be an integer from 1 to 20");
	const cancelled = () => { if (signal?.aborted) throw new Error("Source search cancelled"); };
	cancelled();
	const { document, sha256, textPages, close } = await openPdf(pdf);
	try {
		cancelled();
		const first = options.first_page ?? 1, last = options.last_page ?? document.numPages;
		if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first || last > document.numPages)
			throw new Error(`search needs an ordered physical-page range within 1-${document.numPages}`);
		const binding = createHash("sha256").update(JSON.stringify(["native-search-v1", sha256, query, first, last])).digest("hex");
		let next = first;
		if (options.cursor !== undefined) {
			try {
				if (typeof options.cursor !== "string" || options.cursor.length > 256) throw new Error();
				const cursor = JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8"));
				if (cursor.binding !== binding || !Number.isInteger(cursor.next) || cursor.next < first || cursor.next > last) throw new Error();
				next = cursor.next;
			} catch { throw new Error("search cursor does not match this source, query or range; restart the search"); }
		}
		const labels = await document.getPageLabels(), searchedFirst = next;
		const matches: Array<{page: number; pdf_label: string | null; snippet: string}> = [];
		const withText: number[] = [], empty: number[] = [], errors: Array<{page: number; error: string}> = [];
		for (; next <= last && next - searchedFirst < searchPageLimit && matches.length < limit; next++) {
			cancelled();
			let pending = textPages.get(next);
			if (!pending) {
				const page = next;
				pending = (async () => {
					const content = await (await document.getPage(page)).getTextContent();
					return content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : "") : "").join("");
				})();
				textPages.set(page, pending);
				void pending.catch(() => { if (textPages.get(page) === pending) textPages.delete(page); });
			}
			try {
				const original = await pending;
				cancelled();
				const text = normalizeSearch(original);
				if (text) {
					withText.push(next);
					const offset = text.indexOf(query);
					if (offset >= 0) matches.push({ page: next, pdf_label: labels?.[next - 1] ?? null, snippet: searchSnippet(original, offset) });
				} else empty.push(next);
			} catch (error) {
				cancelled();
				errors.push({page: next, error: String(error).slice(0, 240)});
			}
			// Let cancellation run even when all page text is already cached. A shared
			// extraction retains this document lease until it settles, never destroys a peer.
			await new Promise<void>(resolve => setImmediate(resolve));
		}
		cancelled();
		const truncated = next <= last;
		return { navigation_only: true, matches,
			scope: { first_page: first, last_page: last, searched_first_page: searchedFirst, searched_last_page: next - 1,
				complete: searchedFirst === first && !truncated && errors.length === 0 },
			truncated, next_cursor: truncated ? Buffer.from(JSON.stringify({binding, next})).toString("base64url") : null,
			text_availability: { scope: "searched_pages", pages_with_text: withText, empty_pages: empty, extraction_errors: errors },
			guidance: "Navigation only, not source evidence. Open candidate original pages before using facts. No match does not mean no text layer or no fact in the book. For empty, failed or garbled text use info, overview and original pages." };
	} finally { await close(); }
}

export async function sourcePage(pdf: string, cache: string, page: number, options: { box?: number[]; pixels?: number; format?: "png" | "jpeg" } = {}) {
	const stamp = identity(await sourceStat(resolve(pdf)));
	const key = JSON.stringify([resolve(pdf),stamp,resolve(cache),page,options.box ?? [0,0,1,1],options.pixels ?? 2000,options.format ?? 'png']);
	const existing = pageRequests.get(key);
	if (existing) return {...await existing, reused:true};
	const work = renderSourcePage(pdf,cache,page,options).finally(()=>{if(pageRequests.get(key)===work)pageRequests.delete(key);});
	pageRequests.set(key,work);
	return work;
}

export async function sourceOverview(pdf: string, cache: string, firstPage: number, lastPage: number, signal?: AbortSignal) {
	if (!Number.isInteger(firstPage) || !Number.isInteger(lastPage) || firstPage < 1 || lastPage < firstPage)
		throw new Error("overview needs an ordered positive integer physical-page range");
	if (lastPage - firstPage + 1 > 20) throw new Error("overview accepts at most 20 contiguous physical pages");
	if (signal?.aborted) throw new Error("Source overview cancelled");
	const { document, sha256, close } = await openPdf(pdf);
	try {
		if (lastPage > document.numPages) throw new Error(`overview range ${firstPage}-${lastPage} is outside this PDF (1-${document.numPages})`);
		const key = createHash("sha256").update(JSON.stringify({ sha256, first_page:firstPage, last_page:lastPage, version:sourceOverviewVersion })).digest("hex");
		await mkdir(cache, {recursive:true});
		const path = join(resolve(cache), `overview-${key}.jpg`), metaPath = join(resolve(cache), `overview-${key}.json`);
		let result: Record<string, unknown> | undefined;
		try {
			const meta = JSON.parse(await readFile(metaPath,"utf8")), bytes = await readFile(path);
			if (meta.key === key && meta.image_sha256 === createHash("sha256").update(bytes).digest("hex")) result = {...meta,path,reused:true};
		} catch { /* a missing or damaged overview is rendered again */ }
		if (!result) {
			const labels = await document.getPageLabels(), count = lastPage-firstPage+1;
			const columns=4,margin=24,gap=16,sheetWidth=1600,tileWidth=Math.floor((sheetWidth-margin*2-gap*(columns-1))/columns);
			const imageHeight=232,labelHeight=60,tileHeight=imageHeight+labelHeight,rows=Math.ceil(count/columns);
			const sheetHeight=margin*2+rows*tileHeight+(rows-1)*gap;
			const sheet=createCanvas(sheetWidth,sheetHeight), context=sheet.getContext("2d");
			context.fillStyle="#e8ebef";context.fillRect(0,0,sheetWidth,sheetHeight);
			const tiles:Record<string,unknown>[]=[];
			const fit=(value:string,width:number)=>{
				if(context.measureText(value).width<=width)return value;
				let text=value;while(text.length&&context.measureText(text+"...").width>width)text=text.slice(0,-1);
				return text+"...";
			};
			for(let index=0;index<count;index++) {
				if(signal?.aborted)throw new Error("Source overview cancelled");
				const page=firstPage+index,row=Math.floor(index/columns),column=index%columns;
				const x=margin+column*(tileWidth+gap),y=margin+row*(tileHeight+gap);
				context.fillStyle="#ffffff";context.fillRect(x,y,tileWidth,tileHeight);
				context.strokeStyle="#aeb4bc";context.lineWidth=2;context.strokeRect(x+1,y+1,tileWidth-2,tileHeight-2);
				const pdfPage=await document.getPage(page),base=pdfPage.getViewport({scale:1});
				const scale=Math.min((tileWidth-12)/base.width,(imageHeight-12)/base.height),viewport=pdfPage.getViewport({scale});
				const factory=document.canvasFactory as PdfCanvasFactory;
				const tile=factory.create(Math.max(1,Math.ceil(viewport.width)),Math.max(1,Math.ceil(viewport.height)));
				try {
					await pdfPage.render({canvas:tile.canvas as unknown as HTMLCanvasElement,canvasContext:tile.context as unknown as CanvasRenderingContext2D,viewport}).promise;
					context.drawImage(tile.canvas,x+(tileWidth-tile.canvas.width)/2,y+(imageHeight-tile.canvas.height)/2);
				} finally {factory.destroy(tile);pdfPage.cleanup();}
				const pdfLabel=typeof labels?.[page-1]==="string"?labels[page-1]:null;
				context.fillStyle="#111827";context.font="bold 20px sans-serif";context.textBaseline="middle";
				context.fillText(`Physical page ${page}`,x+10,y+imageHeight+18);
				if(pdfLabel&&pdfLabel!==String(page)) {
					context.fillStyle="#4b5563";context.font="16px sans-serif";
					context.fillText(fit(`PDF label ${pdfLabel}`,tileWidth-20),x+10,y+imageHeight+43);
				}
				tiles.push({page,pdf_label:pdfLabel,row,column,tile:[x,y,tileWidth,tileHeight]});
			}
			const bytes=sheet.toBuffer("image/jpeg",88),image_sha256=createHash("sha256").update(bytes).digest("hex");
			const meta={key,version:sourceOverviewVersion,file_sha256:sha256,first_page:firstPage,last_page:lastPage,
				width:sheetWidth,height:sheetHeight,media_type:"image/jpeg",image_sha256,tiles};
			const imageTemporary=`${path}.${process.pid}.${randomUUID()}.tmp`,metaTemporary=`${metaPath}.${randomUUID()}.tmp`;
			await writeFile(imageTemporary,bytes);await rename(imageTemporary,path);
			await writeFile(metaTemporary,JSON.stringify(meta)+"\n");await rename(metaTemporary,metaPath);
			result={...meta,path,reused:false};
		}
		await appendFile(join(resolve(cache),"overviews.jsonl"),JSON.stringify({at:new Date().toISOString(),...result})+"\n");
		return result;
	} finally {await close();}
}

async function renderSourcePage(pdf: string, cache: string, page: number, options: { box?: number[]; pixels?: number; format?: "png" | "jpeg" }) {
	if (!Number.isInteger(page) || page < 1) throw new Error("page must be a positive physical page number");
	const box = validateBox(options.box);
	const pixels = options.pixels ?? 2000;
	const format = options.format ?? "png", suffix = format === "jpeg" ? "jpg" : "png";
	if (!["png", "jpeg"].includes(format)) throw new Error("unsupported image format");
	if (!Number.isInteger(pixels) || pixels < 256 || pixels > 3000) throw new Error("pixels must be an integer from 256 to 3000");
	const { document, sha256, close } = await openPdf(pdf);
	try {
		if (page > document.numPages) throw new Error(`page ${page} is outside this PDF (1-${document.numPages})`);
		const key = createHash("sha256").update(JSON.stringify({ sha256, page, box, pixels, format, quality: format === "jpeg" ? 92 : undefined, version:sourceRenderVersion })).digest("hex");
		await mkdir(cache, { recursive: true });
		const path = join(resolve(cache), `${key}.${suffix}`);
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
			const factory = document.canvasFactory as PdfCanvasFactory;
			const canvas = factory.create(Math.max(1, Math.ceil(width * scale)), Math.max(1, Math.ceil(height * scale)));
			try {
				await pdfPage.render({ canvas: canvas.canvas as unknown as HTMLCanvasElement,
					canvasContext: canvas.context as unknown as CanvasRenderingContext2D, viewport,
					transform: [1, 0, 0, 1, -base.width * box[0] * scale, -base.height * box[1] * scale] }).promise;
				const bytes = format === "jpeg" ? canvas.canvas.toBuffer("image/jpeg", 92) : canvas.canvas.toBuffer("image/png");
				result = { path, page, box, width: canvas.canvas.width, height: canvas.canvas.height,
					file_sha256: sha256, image_sha256: createHash("sha256").update(bytes).digest("hex"), reused: false };
				const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
				await writeFile(temporary, bytes);
				await rename(temporary, path);
				const metaTemporary = `${metaPath}.${randomUUID()}.tmp`;
				await writeFile(metaTemporary, JSON.stringify(result) + "\n");
				await rename(metaTemporary, metaPath);
			} finally { factory.destroy(canvas); pdfPage.cleanup(); }
		}
		const viewPath = join(resolve(cache), `page-${page}-region-${box.join("-")}-${pixels}.${suffix}`);
		const viewTemporary = `${viewPath}.${randomUUID()}.tmp`;
		await copyFile(path, viewTemporary);
		await rename(viewTemporary, viewPath);
		result = { ...result, path: viewPath };
		await appendFile(join(resolve(cache), "requests.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...result }) + "\n");
		return result;
	} finally { await close(); }
}

export async function sourceAsset(pdf: string, cache: string, regions: Array<{ page: number; box?: number[]; redactions?: number[][] }>, destination: string) {
	if (!regions.length) throw new Error("an image asset needs an explicit source region");
	const parts = [];
	let measuredWidth = 0, measuredHeight = 0;
	for (const region of regions) {
		const rendered = await sourcePage(pdf, cache, region.page, { box: region.box });
		const part = await loadImage(rendered.path as string);
		// Redactions use the same normalized rotated-page frame as the crop. Paint them
		// before the derivative crosses the player asset boundary.
		if (Array.isArray(region.redactions) && region.redactions.length) {
			const crop = validateBox(region.box), masked = createCanvas(part.width, part.height), maskContext = masked.getContext("2d");
			maskContext.drawImage(part, 0, 0);
			maskContext.fillStyle = "#ffffff";
			for (const raw of region.redactions) {
				const mask = validateBox(raw);
				const x0 = Math.max(0, (mask[0] - crop[0]) / (crop[2] - crop[0]) * part.width);
				const y0 = Math.max(0, (mask[1] - crop[1]) / (crop[3] - crop[1]) * part.height);
				const x1 = Math.min(part.width, (mask[2] - crop[0]) / (crop[2] - crop[0]) * part.width);
				const y1 = Math.min(part.height, (mask[3] - crop[1]) / (crop[3] - crop[1]) * part.height);
				if (x1 > x0 && y1 > y0) maskContext.fillRect(x0, y0, x1 - x0, y1 - y0);
			}
			measuredWidth = Math.max(measuredWidth, masked.width); measuredHeight += masked.height;
			if (measuredWidth * measuredHeight > 20_000_000) throw new Error("this image asset is too large; represent its authored parts separately");
			parts.push(masked);
			continue;
		}
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

export async function sourceCli(args: string[]) {
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
