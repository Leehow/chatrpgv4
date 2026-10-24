/**
 * Contract §266.11: mechanics cards. A book person met at the table gets the numbers the book prints for them from one
 * tool-free call over the host's own blocks; the host keeps a number only when its cited block prints it, and the kernel
 * keeps the card beside the book's cast (`cast.card`).
 */
import { normalName } from "./lean-skeleton.ts";
import { roughTokens } from "./source-blocks.ts";

type Row = Record<string, any>;
type Block = { id: string; page: number; text: string };

/** §266.11: the most block text one card call reads. */
export const CARD_BOUNDS = { tokens: 6000, numbers: 3 } as const;

/**
 * §266.11: the blocks a card reads: those on pages that print one of the person's names, holding at least three numbers
 * (a stat block or a line of skills), the person's own evidence blocks first; reading order, about 6K tokens.
 */
export function cardBlocks(blocks: Block[], names: string[], evidence: string[] = []): Block[] {
	const forms = names.map(normalName).filter(form => [...form].length >= 2);
	const pages = new Set(blocks.filter(block => forms.some(form => normalName(block.text).includes(form))).map(block => block.page));
	const numeric = (block: Block) => (block.text.match(/\d+/g) ?? []).length >= CARD_BOUNDS.numbers;
	const own = new Set(evidence);
	const picked = blocks.filter(block => pages.has(block.page) && numeric(block))
		.sort((a, b) => Number(!own.has(a.id)) - Number(!own.has(b.id)));
	const out: Block[] = [];
	let spent = 0;
	for (const block of picked) {
		const cost = roughTokens(block.text);
		if (spent + cost > CARD_BOUNDS.tokens) continue;
		out.push(block); spent += cost;
	}
	const order = new Map(blocks.map((block, i) => [block.id, i]));
	return out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** Whether a block's text prints this number as a number of its own (not inside a longer one). */
const prints = (text: string, value: string | number): boolean => {
	const wanted = String(value).replace(/\s+/g, "");
	if (!wanted) return false;
	const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`(^|[^0-9])${escaped}([^0-9]|$)`, "i").test(text.replace(/\s+/g, ""));
};

/**
 * §266.11: the card the answer's cited blocks support: each number kept only when its block (one of the call's) prints it;
 * the rest are named in `dropped`. The pages are the cited blocks' pages.
 */
export function checkedCard(answer: Row | undefined, blocks: Map<string, Block>): { profile: Row; pages: number[]; dropped: string[] } {
	const dropped: string[] = [], pages = new Set<number>();
	const keep = (key: string, item: Row | undefined): number | string | undefined => {
		const block = typeof item?.block === "string" ? blocks.get(item.block) : undefined;
		const value = item?.value;
		if (!block || (typeof value !== "number" && typeof value !== "string") || !prints(block.text, value)) { if (item) dropped.push(key); return undefined; }
		pages.add(block.page);
		return typeof value === "number" ? value : /^-?\d+$/.test(value.trim()) ? Number(value.trim()) : value.trim();
	};
	const section = (value: unknown, prefix: string) => Object.fromEntries(Object.entries(value && typeof value === "object" && !Array.isArray(value) ? value as Row : {})
		.flatMap(([key, item]) => { const kept = keep(`${prefix}.${key}`, item as Row); return kept === undefined ? [] : [[key, kept]]; }));
	const characteristics = section(answer?.characteristics, "characteristics"), derived = section(answer?.derived, "derived");
	const skills = Object.fromEntries((Array.isArray(answer?.skills) ? answer!.skills : []).flatMap((item: Row) => {
		const name = typeof item?.name === "string" ? item.name.trim() : "";
		const kept = name ? keep(`skills.${name}`, item) : undefined;
		return kept === undefined || typeof kept !== "number" ? [] : [[name, kept]];
	}));
	return { profile: { characteristics, derived, skills }, pages: [...pages].sort((a, b) => a - b), dropped };
}
