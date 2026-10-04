/**
 * Pi's grammar for the agent home's `models.json` (contract §135.27.1.2), copied because Pi does not
 * export it. Pi's `ModelConfig.load` parses the file as `JSON.parse(stripJsonComments(stripBom(content)))`
 * (`@earendil-works/pi-coding-agent` `dist/core/model-config.js`, with `stripJsonComments` from
 * `dist/utils/json.js` and `stripBom` from `dist/utils/text.js`; the same in the 0.87.0 the installed
 * App vendors and the 1.0.0 this tree vendors, read 2026-10-03). A leading BOM, `//` line comments and
 * trailing commas go, and nothing else: a `/* *\/` comment fails the parse, and Pi then disables every
 * custom model and override.
 *
 * The Keeper and every lane child are Pi, so what Pi parses here is the file. Both product readers --
 * the launch-time merge in `runtime/host.ts` and the lane child catalog in `runtime/tasks.ts` -- read
 * it through `parseModelsJson`. `tests/extension/models-json-grammar.test.mjs` holds this copy to the
 * vendored Pi's own loader.
 */

// Pi's two patterns, verbatim from `dist/utils/json.js`.
const STRING_OR_LINE_COMMENT = /"(?:\\.|[^"\\])*"|\/\/[^\n]*/g;
const STRING_OR_TRAILING_COMMA = /"(?:\\.|[^"\\])*"|,(\s*[}\]])/g;

/**
 * Pi's first pass: drop `//` line comments outside strings. Text this changes carries comments, the
 * one thing in the file a strict-JSON rewrite cannot keep (a trailing comma or a BOM carries nothing).
 */
export function stripLineComments(text: string): string {
  return text.replace(STRING_OR_LINE_COMMENT, match => (match[0] === '"' ? match : ""));
}

/** Pi's `stripJsonComments`: `//` line comments, then trailing commas. */
export function stripJsonComments(text: string): string {
  return stripLineComments(text).replace(STRING_OR_TRAILING_COMMA, (match, tail) => tail ?? (match[0] === '"' ? match : ""));
}

/** Parse `models.json` text the way Pi's `ModelConfig.load` does; throws exactly where Pi reports `Failed to parse models.json`. */
export function parseModelsJson(text: string): unknown {
  return JSON.parse(stripJsonComments(text.startsWith("\uFEFF") ? text.slice(1) : text));
}
