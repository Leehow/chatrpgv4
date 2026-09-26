/**
 * Contract §139: finding an excerpt a model copied out of delivered text.
 *
 * The verifier lane answers in JSON and quotes the prose it flags. A prose line in ASCII double quotes has to be
 * escaped inside a JSON string, and the model retypes the marks as curly ones instead, so an exact substring check
 * lost 44% of the findings on turns whose prose used ASCII quotes (5 of 16 such turns lost every finding), against
 * 0-4% on turns with curly quotes, corner brackets or none. Quotation marks are therefore one class when an excerpt
 * is located: Unicode's own `Quotation_Mark` property decides which characters those are, so no mark is listed here
 * and no language is named. Everything else must match exactly. The excerpt that lands on a record is always the
 * delivered text's own characters, never the model's retyping.
 */
const QUOTATION_MARK = /\p{Quotation_Mark}/gu;

/** Every quotation mark becomes the same one; each is a single UTF-16 unit, so offsets survive the fold. */
const fold = (text: string): string => text.replace(QUOTATION_MARK, '"');

/**
 * The delivered text's own span that `excerpt` quotes, or null when it quotes nothing there. An exact substring is
 * returned as given; otherwise the first span that differs from the excerpt only in which quotation marks it uses.
 */
export function locateExcerpt(text: string, excerpt: unknown): string | null {
    if (typeof excerpt !== 'string' || !excerpt.trim()) return null;
    if (text.includes(excerpt)) return excerpt;
    const at = fold(text).indexOf(fold(excerpt));
    return at < 0 ? null : text.slice(at, at + excerpt.length);
}
