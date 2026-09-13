/** Private selected-page access for source readers, never a player-facing attachment. */
import { createHash } from "node:crypto";
import { Type } from "typebox";
import { readFile } from "node:fs/promises";
import { sourceInfo, sourceOverview, sourcePage, closeSourceDocuments } from "./source.ts";

export default function readerPdf(pi: any) {
	pi.on("session_shutdown", () => closeSourceDocuments());
	pi.registerTool({ name: "pdf", label: "Read original PDF pages",
		description: "Inspect native bookmarks/page labels with no arguments; use overview for one navigation-only contact sheet of at most 20 contiguous physical pages; or view exact physical pages as source evidence. Reopen overview candidates with pages before using facts. Physical pages start at 1; box optionally zooms exact pages.",
		parameters: Type.Object({
			pages:Type.Optional(Type.Array(Type.Integer({minimum:1}),{minItems:1,maxItems:12})),
			box:Type.Optional(Type.Array(Type.Number({minimum:0,maximum:1}),{minItems:4,maxItems:4})),
			overview:Type.Optional(Type.Object({first_page:Type.Integer({minimum:1}),last_page:Type.Integer({minimum:1})},{additionalProperties:false})),
		},{additionalProperties:false}),
		async execute(_id: string, params: any, signal: AbortSignal) {
			const config = JSON.parse(process.env.PI_COC_READER_SOURCE ?? "null");
			if (!config) throw new Error("This reader has no bound PDF");
			if (signal.aborted) throw new Error("Source reading cancelled");
			if(Object.keys(params).some(key=>!["pages","box","overview"].includes(key)))throw new Error("Unknown PDF mode parameter");
			const hasPages=Object.hasOwn(params,"pages"),hasOverview=Object.hasOwn(params,"overview"),hasBox=Object.hasOwn(params,"box");
			if(Number(hasPages)+Number(hasOverview)>1||hasBox&&!hasPages)throw new Error("Choose exactly one PDF mode: info, overview, or exact pages");
			if(hasOverview) {
				const overview=params.overview;
				if(!overview||typeof overview!=="object"||Array.isArray(overview))throw new Error("overview needs first_page and last_page");
				const sheet=await sourceOverview(config.pdf,config.cache,overview.first_page,overview.last_page,signal);
				if(signal.aborted)throw new Error("Source overview cancelled");
				const bytes=await readFile(sheet.path as string);
				if(createHash("sha256").update(bytes).digest("hex")!==sheet.image_sha256)throw new Error("Source overview changed before delivery; retry this range");
				const manifest={first_page:sheet.first_page,last_page:sheet.last_page,tiles:sheet.tiles};
				return {content:[{type:"text",text:`Navigation overview only; it is not source evidence. ${JSON.stringify(manifest)} Reopen nominated physical pages with pages before writing or reviewing facts.`},
					{type:"image",mimeType:"image/jpeg",data:bytes.toString("base64")}],
					details:{kind:"source_overview",manifest,reused:sheet.reused}};
			}
			if (!hasPages) {
				const { page_count, labels, bookmarks } = await sourceInfo(config.pdf);
				return { content: [{ type: "text", text: JSON.stringify({ page_count, labels, bookmarks }) }], details: { kind: "source_info" } };
			}
			const rows = await Promise.all([...new Set<number>(params.pages)].map(page =>
				sourcePage(config.pdf, config.cache, page, { box: params.box, format: "jpeg" })));
			const content: any[] = [];
			for (const row of rows) {
				const bytes = await readFile(row.path as string);
				if (createHash("sha256").update(bytes).digest("hex") !== row.image_sha256) throw new Error("Source image changed before delivery; retry this page");
				content.push({ type: "text", text: `Original physical page ${row.page}; region ${JSON.stringify(row.box)}.` },
				{ type: "image", mimeType: "image/jpeg", data: bytes.toString("base64") });
			}
			return { content, details: { kind: "source_pages", observations: rows } };
		},
	});
}
