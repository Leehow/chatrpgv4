/**
 * Contract §22.3.2 (SL-49): the words a graph review's verdict may use, and which draft pointers are classification
 * fields. One module for both ends, as `obligation-review.ts` is: the kernel's publication gate (`checkReview`) and the
 * host's review evidence check (`checkReviewEvidence`, `submit_reading`) read the same words, so this file has no imports.
 *
 * `supported`, `contested` and `unsupported` are the words; `contradicted` and `unclear` are the earlier protocol's and
 * read as `unsupported`, so a recorded review is judged as what it was. Which fields are classification fields is never
 * listed here: the graph contract declares them (`module-graph-contract-v3.json` `classification_fields`), and this file
 * only matches a pointer against the declared patterns.
 */

export const REVIEW_VERDICTS: readonly string[] = Object.freeze(["supported", "contested", "unsupported", "contradicted", "unclear"]);

/**
 * Whether a draft pointer (`/nodes/<i>/...`) is a classification field under the declared node patterns: its part below
 * its node matches one pattern token for token, `*` standing for any one token. A node's root and every claim pointer are
 * never classification fields.
 */
export function classificationMatcher(patterns: unknown): (path: string) => boolean {
    const declared = (Array.isArray(patterns) ? patterns : []).filter((pattern): pattern is string => typeof pattern === "string" && pattern !== "")
        .map(pattern => pattern.split("/"));
    return (path: string): boolean => {
        const tokens = typeof path === "string" ? path.split("/") : [];
        if (tokens.length < 4 || tokens[0] !== "" || tokens[1] !== "nodes") return false;
        const field = tokens.slice(3);
        return declared.some(pattern => pattern.length === field.length && pattern.every((token, index) => token === "*" || token === field[index]));
    };
}
