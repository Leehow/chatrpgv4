/** Receipt-to-JSON projection. It neither changes receipts nor evaluates story text. */
import { array, row, number, integer, truth, chars, length, type Row } from "./values.js";
/**
 * A roll receipt's visibility tier (§16.5). Three, not two.
 *
 * - `public` — the player watched the die; the card draws it in full.
 * - `concealed` — the player declared the action and knows a check happened, but the rules keep the
 *   die from them (CoC 7e Psychology: a player who sees the failure knows the read is unreliable,
 *   which is the one thing the rule withholds). The card names the check and prints no figure.
 * - `keeper` — the player was never told a check happened (a secret Spot Hidden). The card draws
 *   nothing: a row here leaks what the prose withheld.
 *
 * `concealed` was split out of `keeper` on 2026-09-12. Collapsed into one tier, a player's own
 * declared Psychology attempt rendered exactly like a turn with no mechanics at all, so from the
 * player's chair a check they asked for was indistinguishable from the Keeper simply talking.
 */
export const ROLL_VISIBILITY = ['public', 'concealed', 'keeper'] as const;
/** True when the die itself must not reach the player — both hidden tiers, whatever the card draws. */
export const dieHidden = (visibility: any): boolean => visibility === 'keeper' || visibility === 'concealed';
/**
 * Whether a card hands the player something to open, as three states rather than a boolean (§59).
 *
 * - `ready` — bytes exist and travel with the row; the card opens.
 * - `none` — the producer asked and there is nothing: the module registered the card with no
 *   document, or the render refused. The delivery still happened; only the page is missing.
 * - `unresolved` — this producer cannot answer, and a later one owes the answer. A row that reaches
 *   a player still saying this is a defect, and a *different* defect from `none`.
 *
 * A row carrying no `document` at all hands the player nothing to open, so nothing is said about
 * it. That is the whole judgment: no consumer reads `kind` to decide whether the question applies.
 *
 * The boolean this replaced could not tell `none` from `unresolved`, and the kernel's map rows
 * never wrote it: a live delivery was answered downstream by the host's rendered attachment, but
 * the row the campaign *records* carries no answer at all, so the history card and the live card
 * were two different objects and only one of them had been wired (campaign `game-1c0faba5`,
 * turns 33 and 35). Any path where that attachment does not merge reads as an answered "no".
 */
export const DOCUMENT_READY = 'ready', DOCUMENT_NONE = 'none', DOCUMENT_UNRESOLVED = 'unresolved';
const labeled = (out: Row, key: string, value: any) => {
    if (typeof value === "string" && value.trim())
        out[key] = value;
};
function investigator(out: Row, receipt: Row, key: string) {
    out[`${key}_is_investigator`] = receipt[`${key}_is_investigator`] === true;
    if (out[`${key}_is_investigator`]) {
        out[key] = receipt[key] ?? null;
        labeled(out, `${key}_label`, receipt[`${key}_label`]);
    }
}
export function mechanicsOf(receipt: Row, texts: ReadonlyMap<string, string> = new Map()): Row | null {
    const id = receipt.id ?? null,
        kind = receipt.kind;
    if (kind === "roll") {
        const out: Row = receipt.form === "dice"
            ? {
                kind: "dice",
                receipt: id,
                label: receipt.skill ?? null,
                expression: receipt.expression ?? null,
                faces: [...array(receipt.faces)],
                total: receipt.total ?? null,
                visibility: receipt.visibility || "public"
            }
            : {
                kind: "roll",
                receipt: id,
                skill: receipt.skill ?? null,
                roll: receipt.roll ?? null,
                target: receipt.target ?? null,
                threshold: receipt.threshold ?? null,
                difficulty: receipt.difficulty ?? null,
                level: receipt.level ?? null,
                passed: truth(receipt.passed),
                pushed: truth(receipt.pushed),
                visibility: receipt.visibility || "public"
            };
        investigator(out, receipt, "actor");
        // The engine's stable name for a die it rolled itself (§23): the card looks the play-language
        // word up by this and keeps the English `label` as what it draws when there is none.
        if (receipt.form === "dice")
            labeled(out, "word", receipt.word);
        return out;
    }
    if (kind === "delta") {
        const out: Row = {
            kind: "change",
            receipt: id,
            resource: receipt.resource ?? null,
            before: receipt.before ?? null,
            after: receipt.after ?? null
        };
        investigator(out, receipt, "subject");
        labeled(out, "item", receipt.item);
        return out;
    }
    if (kind === "condition") {
        const out: Row = {
            kind: "condition",
            receipt: id,
            gained: array(receipt.gained).map(value => String(value)),
            lost: array(receipt.lost).map(value => String(value)),
            // The conditions standing after this change, so the card names the state the character
            // is now in rather than only the moment it changed. A player who joins the card at turn
            // 109 has to read what is true now, not diff two lists across three turns.
            standing: array(receipt.after).map(value => String(value)),
            // Which of those take the action away (§16.2). The rules engine decided it when the
            // receipt was minted (`INCAPACITATING_CONDITIONS`); nothing here re-reads a name.
            incapacitated: array(receipt.incapacitated).map(value => String(value)),
            visibility: receipt.visibility || "public"
        };
        investigator(out, receipt, "subject");
        return out;
    }
    if (kind === "move") {
        if (truth(receipt.renamed))
            return null;
        const out: Row = {
            kind: "scene",
            receipt: id,
            from: receipt.from ?? null,
            to: receipt.to ?? null,
            minutes: Math.trunc(number(receipt.minutes))
        };
        for (const key of ["from_label", "to_label"])
            labeled(out, key, receipt[key]);
        return out;
    }
    if (kind === "clue") {
        const out: Row = {
            kind: "clue",
            receipt: id,
            clue: receipt.clue ?? null
        };
        labeled(out, "label", receipt.label);
        if (typeof receipt.summary === "string" && receipt.summary.trim() && receipt.summary.trim() !== out.label)
            out.summary = receipt.summary.trim();
        return out;
    }
    if (kind === "time")
        return {
            kind,
            receipt: id,
            minutes: Math.trunc(number(receipt.minutes))
        };
    if (kind === "item") {
        const out: Row = {
            kind,
            receipt: id,
            name: receipt.name ?? null,
            quantity: Math.trunc(number(truth(receipt.quantity) ? receipt.quantity : 1)),
            to: receipt.subject ?? null
        };
        labeled(out, "label", receipt.label);
        labeled(out, "to_label", receipt.subject_label);
        for (const key of ["from", "weapon"])
            labeled(out, key, receipt[key]);
        return out;
    }
    if (kind === "cash") {
        const out: Row = {
            kind,
            receipt: id,
            subject: receipt.subject ?? null,
            before: receipt.before ?? null,
            after: receipt.after ?? null
        };
        // Contract §58: what the amount was based on travels with it, so a charge can be read back
        // against its source instead of being taken on trust.
        for (const key of ["subject_label", "currency", "with", "with_label", "source", "price_id", "price_name", "source_display"])
            labeled(out, key, receipt[key]);
        if (receipt.source_amount != null)
            out.source_amount = receipt.source_amount;
        return out;
    }
    if (kind === "session") {
        const out: Row = {
            kind,
            receipt: id,
            family: receipt.family ?? null,
            transition: receipt.transition ?? null
        };
        for (const key of ["round", "rounds"])
            if (integer(receipt[key]) || typeof receipt[key] === "boolean")
                out[key] = receipt[key];
        labeled(out, "outcome", receipt.outcome);
        return out;
    }
    if (kind === "choice")
        return {
            kind,
            receipt: id,
            option: receipt.option ?? null
        };
    if (kind === "worldline") {
        const out: Row = {
            kind,
            receipt: id,
            operation: receipt.operation ?? null,
            line: receipt.line ?? null,
            mode: receipt.mode ?? null,
            loop: Math.trunc(number(receipt.loop)),
            from_line: row(receipt.from).line ?? null,
            from_turn: row(receipt.from).turn ?? null
        };
        labeled(out, "label", receipt.label);
        return out;
    }
    if (kind === "handout") {
        const attachment = row(receipt.attachment),
            out: Row = {
            kind,
            receipt: id,
            name: receipt.name || receipt.handout || null,
            // `apply handout` settles this one itself: it either wrote the markdown or looked for
            // the registered bytes and found none, so a handout is never `unresolved` (§59). An
            // authored, player-safe card the module registered without a document is `none` -- the
            // Keeper was handed it and told the player what it says; there is simply no page.
            document: truth(attachment.available) ? DOCUMENT_READY : DOCUMENT_NONE
        };
        labeled(out, "label", receipt.label);
        labeled(out, "path", attachment.path);
        labeled(out, "media_type", attachment.media_type);
        let body = texts.get(attachment.path);
        if (body !== undefined) {
            const lines = body.split("\n");
            if (lines[0]?.startsWith("# "))
                body = lines.slice(1).join("\n").trim();
            if (length(body) > 8000)
                body = chars(body, 8000).trimEnd() + " …";
            if (body)
                out.text = body;
        }
        return out;
    }
    if (kind === "map") {
        const out: Row = {
            kind,
            receipt: id,
            map: receipt.map ?? null,
            name: receipt.name || receipt.map || null,
            regions: array(receipt.regions).map(region => ({
                id: row(region).id ?? null,
                label: row(region).label ?? row(region).id ?? null,
                level: row(region).level ?? null,
            })),
            source_revision: receipt.source_revision ?? null,
            // The kernel does not hold the pixels: only the host composes a map view, and only it
            // knows whether the authorized regions rendered. So this row leaves here owing an
            // answer, and the host's prepared attachment overwrites it on the way to the player
            // (§59). Saying so is what makes the two ends tellable apart: the row the turn record
            // keeps is this one, and until now it carried nothing, so a map card re-read out of
            // history was indistinguishable from a map that had been answered "no" -- and so was
            // a live card on any path where the attachment never merged.
            document: DOCUMENT_UNRESOLVED,
        };
        labeled(out, "label", receipt.label);
        // Which leg wrote the words above (contract §39.2). The host reads it to know whether this
        // card still owes a projection, and a delivered card that still says `source` is the record
        // that one shipped unprojected -- the only way that failure is visible after the fact.
        if (typeof receipt.words === "string" && receipt.words)
            out.words = receipt.words;
        return out;
    }
    return null;
}
export function mechanics(receipts: Row[], placed: Row = {}, texts: ReadonlyMap<string, string> = new Map()): Row[] {
    const byReceipt = new Map(Object.entries(placed).map(([marker, id]) => [id, marker]));
    return receipts.flatMap(receipt => {
        const out = mechanicsOf(receipt, texts);
        if (!out)
            return [];
        for (const [from, to] of [["call_id", "call"], ["family", "family"]])
            if (typeof receipt[from] === "string" && receipt[from])
                out[to] = receipt[from];
        if (byReceipt.has(receipt.id))
            out.marker = byReceipt.get(receipt.id);
        return [out];
    });
}
