/**
 * The one file format a handed-over text handout lives in: `<campaign>/handouts/<handle>.md`,
 * written by `apply handout` as `# <display>\n\n<body>\n` (contract §14.8).
 *
 * Three parties read or write it and they must agree to the byte: the writer, the mechanics
 * projection that puts the body on the card's `text` (§16.2), and the handouts presentation lane
 * that projects that body into the play language. The lane's answer is looked up by the exact
 * string the card shows, so a lane that asked for the whole file -- heading included -- produced
 * a translation keyed on a string no card ever carries, and every handout stayed in the book's
 * language beside a translated title.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ModuleGraph } from "./module-graph.js";

/** Longest body the card carries (§16.2); longer is cut with ` …`. Counted in code points. */
const BODY_LIMIT = 8000;

export function handoutFile(display: string, text: string): string {
    return `# ${display}\n\n${text.trim()}\n`;
}

/** The `# ` heading the writer put above the body -- the graph's display name -- or null. */
export function handoutHeading(file: string): string | null {
    const heading = /^#[ \t]+(.+?)[ \t]*(?:\r?\n|$)/.exec(file);
    return heading ? heading[1] : null;
}

/** Exactly the body the mechanics row carries as `text`; empty when there is nothing to open. */
export function handoutBody(file: string): string {
    let body = file;
    const lines = body.split("\n");
    if (lines[0]?.startsWith("# "))
        body = lines.slice(1).join("\n").trim();
    const points = Array.from(body);
    if (points.length > BODY_LIMIT)
        body = points.slice(0, BODY_LIMIT).join("").trimEnd() + " …";
    return body;
}

/**
 * The handouts this table holds, in the order they were handed over, for `table.view`.
 *
 * Membership is `world.handouts_shown` -- the world, not the folder: a worldline rewound past a
 * delivery keeps the file on disk but no longer holds the document. Image descriptors come
 * from actual delivered receipts; their bytes are read only by the scoped player host.
 * A card without a document is not listed. `name` is the heading and `text` the card's body, byte for byte, so the handouts
 * lane's saved answer is found under the same two strings on the panel as on the delivery card.
 *
 * With the module `graph`, membership is read through survivors (contract §152.4): a handout shown under the handle of a
 * printed visual the reviewer found to be the same print as another counts as shown for its survivor, and the two are
 * one entry under the survivor's handle -- its own document when it was handed over itself, else the variant's.
 */
export async function heldHandouts(campaignDir: string, shown: unknown[], receipts:Record<string,any>[]=[], graph?: Pick<ModuleGraph,'survivorHandle'>): Promise<Array<{ handout: string; name: string | null; text: string; path?:string;media_type?:string;document?:string }>> {
    const held: Array<{ handout: string; name: string | null; text: string;path?:string;media_type?:string;document?:string }> = [];
    const through = (handle: string): string => graph ? graph.survivorHandle(handle) : handle;
    const images=new Map<string,Record<string,any>>();
    for(const receipt of receipts)if(receipt&&receipt.kind==='handout'&&typeof receipt.handout==='string'&&receipt.attachment?.available===true
        &&['player-safe','revealable'].includes(receipt.visibility)
        &&['image/png','image/jpeg','image/webp','image/gif'].includes(receipt.attachment.image_media_type||receipt.attachment.media_type)
        &&typeof (receipt.attachment.image_path||receipt.attachment.path)==='string')images.set(through(receipt.handout),receipt);
    const members = new Map<string, string[]>();
    for (const value of shown) {
        if (typeof value !== "string" || !value || value.includes("/") || value.includes("\\"))
            continue;
        const survivor = through(value);
        members.set(survivor, [...(members.get(survivor) ?? []), value]);
    }
    for (const [handle, under] of members) {
        let file: string='';
        for (const candidate of [...under.filter(value => value === handle), ...under.filter(value => value !== handle)]) {
            try {
                file = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(join(campaignDir, "handouts", `${candidate}.md`)));
                break;
            }
            catch {
                // Missing or unreadable: the list is a place to reread what was handed over, and one
                // file it cannot open is not a reason to take the whole table view down with it.
            }
        }
        const text = handoutBody(file);
        if(images.has(handle)){
            const image=images.get(handle)!;
            held.push({handout:handle,name:image.label||image.name||handle,text,path:image.attachment.image_path||image.attachment.path,media_type:image.attachment.image_media_type||image.attachment.media_type,document:'ready'});
        }
        else if(text)held.push({ handout: handle, name: handoutHeading(file), text });
    }
    return held;
}
