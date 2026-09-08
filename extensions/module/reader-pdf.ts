/** Private selected-page access for source readers, never a player-facing attachment. */
import { createHash } from "node:crypto";
import { Type } from "typebox";
import { readFile } from "node:fs/promises";
import { sourceInfo, sourcePage } from "./source.ts";

export default function readerPdf(pi: any) {
	pi.registerTool({ name: "pdf", label: "Read original PDF pages",
		description: "Inspect native bookmarks and page labels when pages is omitted, or view selected physical page images. Choose pages from source references instead of scanning the book. Physical pages start at 1; box optionally zooms a normalized region.",
		parameters: Type.Object({ pages: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1, maxItems: 12 })),
			box: Type.Optional(Type.Array(Type.Number({ minimum: 0, maximum: 1 }), { minItems: 4, maxItems: 4 })) }),
		async execute(_id: string, params: any, signal: AbortSignal) {
			const config = JSON.parse(process.env.PI_COC_READER_SOURCE ?? "null");
			if (!config) throw new Error("This reader has no bound PDF");
			if (signal.aborted) throw new Error("Source reading cancelled");
			if (!params.pages) {
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
