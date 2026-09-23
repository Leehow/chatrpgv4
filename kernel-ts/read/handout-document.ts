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
 * The text handouts this table holds, in the order they were handed over, for `table.view`.
 *
 * Membership is `world.handouts_shown` -- the world, not the folder: a worldline rewound past a
 * delivery keeps the file on disk but no longer holds the document. A handout with no file (an
 * image, or a card the module registered without a document) is not a document to reopen and is
 * not listed. `name` is the heading and `text` the card's body, byte for byte, so the handouts
 * lane's saved answer is found under the same two strings on the panel as on the delivery card.
 */
export async function heldHandouts(campaignDir: string, shown: unknown[]): Promise<Array<{ handout: string; name: string | null; text: string }>> {
    const held: Array<{ handout: string; name: string | null; text: string }> = [];
    for (const handle of shown) {
        if (typeof handle !== "string" || !handle || handle.includes("/") || handle.includes("\\"))
            continue;
        let file: string;
        try {
            file = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(join(campaignDir, "handouts", `${handle}.md`)));
        }
        catch {
            // Missing or unreadable: the list is a place to reread what was handed over, and one
            // file it cannot open is not a reason to take the whole table view down with it.
            continue;
        }
        const text = handoutBody(file);
        if (text)
            held.push({ handout: handle, name: handoutHeading(file), text });
    }
    return held;
}
