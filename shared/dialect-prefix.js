/** Shared closed argument-label grammar; source and display use the same transport repair. */
const EMBEDDED_ARGUMENTS = Object.freeze({
  apply: Object.freeze({ narrate: "text" })
});
const TAG = /[A-Za-z][A-Za-z0-9_-]*/y;
const LETTERS = /^\p{L}[\p{L}\p{M}]*/u;
const DELIMITERS = ["::", "|"];
const delimiterAt = (value, at) => DELIMITERS.find((delimiter) => value.startsWith(delimiter, at));
function dialectPrefix(value, parameter) {
  if (parameter && value.startsWith(parameter)) {
    let end = parameter.length;
    if (value[end] === " ") {
      TAG.lastIndex = end + 1;
      if (TAG.test(value)) end = TAG.lastIndex;
    }
    if (end === value.length) return value;
    const delimiter = delimiterAt(value, end);
    if (delimiter) return value.slice(0, end + delimiter.length);
    if (value.startsWith("{{", end) || value.charCodeAt(end) > 127) return value.slice(0, end);
  }
  const letters = LETTERS.exec(value);
  if (letters) {
    const delimiter = delimiterAt(value, letters[0].length);
    if (delimiter) return value.slice(0, letters[0].length + delimiter.length);
  }
  return void 0;
}
function stripDialectPrefixes(tool, args) {
  const carried = EMBEDDED_ARGUMENTS[tool];
  if (!carried || !args || typeof args !== "object" || Array.isArray(args)) return { args, strips: [] };
  const input = args;
  let output;
  const strips = [];
  for (const [field, parameter] of Object.entries(carried)) {
    const value = input[field];
    if (typeof value !== "string") continue;
    const label = dialectPrefix(value, parameter);
    if (label === void 0) continue;
    const rest = value.slice(label.length).trimStart();
    (output ??= { ...input })[field] = rest;
    strips.push({ field, prefix: value.slice(0, value.length - rest.length) });
  }
  return { args: output ?? args, strips };
}
function omitEmptyEmbeddedArguments(tool, args) {
  const carried = EMBEDDED_ARGUMENTS[tool];
  if (!carried || !args || typeof args !== "object" || Array.isArray(args)) return { args, fields: [] };
  const input = args, fields = Object.keys(carried).filter((field) => typeof input[field] === "string" && !String(input[field]).trim());
  if (!fields.length) return { args, fields };
  const output = { ...input };
  for (const field of fields) delete output[field];
  return { args: output, fields };
}
export {
  EMBEDDED_ARGUMENTS,
  dialectPrefix,
  omitEmptyEmbeddedArguments,
  stripDialectPrefixes
};
