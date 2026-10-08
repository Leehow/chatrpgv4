/**
 * Contract §199.2: a fixture review answers a person's statements -- each drafted `npc` node's summary and first-meeting
 * appearance -- as their own pointers, beside the pointers it lists, as a real reviewer must (the gate refuses a review that
 * answers only the record's root, `review_incomplete`).
 */
import {PERSON_STATEMENTS, personStatementPath} from '../../kernel-ts/modules/review-verdicts.ts';

export function withPersonStatements(draft, paths) {
	const owed = (Array.isArray(draft?.nodes) ? draft.nodes : []).flatMap((node, index) => PERSON_STATEMENTS.map(tail => `/nodes/${index}${tail}`)
		.filter(path => personStatementPath(draft, path) && (path.endsWith('/summary') ? !!node.summary : !!node.properties?.appearance)));
	return [...new Set([...paths, ...owed])];
}
