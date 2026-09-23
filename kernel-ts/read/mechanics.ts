/** Receipt-to-JSON projection. It neither changes receipts nor evaluates story text. */
import { array, row, number, integer, truth, chars, length, type Row } from "./values.js";
import { publicDefinition } from "../mods/public-definition.js";
import { queuedDefinition } from "../mods/queue.js";
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
                // A bonus or penalty die changes which d100 was kept, so the card that shows the
                // roll has to say one was there; without these two the single bonus die that did
                // fire across nine tables was invisible to everyone but the kernel (§95, §16.2).
                bonus: Math.trunc(number(receipt.bonus ?? 0)),
                penalty: Math.trunc(number(receipt.penalty ?? 0)),
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
        // NPC bodies use the same condition receipt but never expose their runtime handle. The
        // player-facing label is still owed so a condition card says who changed.
        if (!out.subject_is_investigator)
            labeled(out, "subject_label", receipt.subject_label);
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
        // §80: the card opens into the account the Keeper filed for this table, not the source's
        // own sentence. `receipt.summary` is the module graph's text (or, for an echo, the kernel's
        // own) and it is written for the Keeper: it carries staging, intentions and agendas the
        // player has not earned. It stays on the receipt, which is the Keeper's record, and it does
        // not cross into the §16.2 projection a player reads.
        labeled(out, "how", receipt.how);
        if (out.how === out.label) delete out.how;
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
        // Contract §88. A card that showed only "who has it now" could not tell a delivery from an offer
        // nobody took, and could not say what a move stood on. These are the receipt's own words: the
        // disposition, who it is held out to, the ground, and the roll that ground named.
        for (const key of ["from", "weapon", "offer", "offered_to", "offered_to_label", "handover", "check"])
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
        for (const key of ["subject_label", "currency", "with", "with_label", "source", "settlement", "price_id", "price_name", "source_display"])
            labeled(out, key, receipt[key]);
        for (const key of ["source_amount", "purchase_amount", "spending_level"])
            if (receipt[key] != null)
                out[key] = receipt[key];
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
/**
 * Contract §129: an object a card names opens into what it is, and the card never waits for that.
 * `definition` is three states in the manner of `document` (§59): `ready` carries `object`, the
 * definition's player view; `pending` says its parameters are still being prepared beside the
 * delivery and names the definition they will arrive under; absent says nothing.
 */
export const DEFINITION_READY = 'ready', DEFINITION_PENDING = 'pending', DEFINITION_NONE = 'none';
function objectDetails(out: Row, world: Row | undefined, instanceId: any): void {
    const objects = row(row(world).objects), instance = row(row(objects.instances)[typeof instanceId === "string" ? instanceId : ""]);
    const definition = row(objects.definitions)[typeof instance.definition === "string" ? instance.definition : ""];
    if (!definition)
        return;
    // §129.4: an instance placed against a placeholder waits on the registration still queued under that
    // name; a placeholder whose registration was dropped will never open, and the row says so.
    if (row(definition).placeholder === true) {
        const name = row(definition).name;
        if (queuedDefinition(world ?? {}, name)) {
            out.definition = DEFINITION_PENDING;
            labeled(out, "definition_name", name);
        }
        else
            out.definition = DEFINITION_NONE;
        return;
    }
    out.definition = DEFINITION_READY;
    out.object = publicDefinition(definition);
}
/**
 * An adoption enriches gear the investigator already carries (§26), so its receipt is bookkeeping and
 * stays out of `mechanicsOf` -- the Keeper-facing readers never see it as something to tell. The card
 * is another matter: it is where the belonging's parameters become readable, so the adoption is drawn
 * as an item row with nobody handing it over. The adoption the next turn's resume replays is the same
 * belonging a second time and is not drawn again; the card that named it pending is the one that opens.
 */
function adoptionRow(receipt: Row, world: Row | undefined): Row | null {
    if (typeof receipt.adopted !== "string" || !receipt.adopted || receipt.resumed === true)
        return null;
    const out: Row = { kind: "item", receipt: receipt.id ?? null, name: receipt.name ?? null, adopted: receipt.adopted };
    if (receipt.queued === true) {
        out.definition = DEFINITION_PENDING;
        labeled(out, "definition_name", receipt.definition_name);
    }
    else
        objectDetails(out, world, receipt.instance);
    return out;
}
export function mechanics(receipts: Row[], placed: Row = {}, texts: ReadonlyMap<string, string> = new Map(), world?: Row): Row[] {
    const byReceipt = new Map(Object.entries(placed).map(([marker, id]) => [id, marker]));
    return receipts.flatMap(receipt => {
        const out = receipt.kind === "definition" ? adoptionRow(receipt, world) : mechanicsOf(receipt, texts);
        if (!out)
            return [];
        if (receipt.kind === "item")
            objectDetails(out, world, receipt.instance);
        for (const [from, to] of [["call_id", "call"], ["family", "family"]])
            if (typeof receipt[from] === "string" && receipt[from])
                out[to] = receipt[from];
        if (byReceipt.has(receipt.id))
            out.marker = byReceipt.get(receipt.id);
        return [out];
    });
}
