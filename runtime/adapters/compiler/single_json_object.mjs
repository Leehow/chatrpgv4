/**
 * Parse one JSON object from a model/tool string without accepting ambiguous
 * multi-document output.
 *
 * The object may be surrounded by ordinary prose or a Markdown code fence.
 * Any second root container, malformed root container, or truncated container
 * makes the whole response invalid. Schema validation remains the caller's job.
 */
export function parseSingleJsonObject(input) {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("JSON response must be a non-empty string");
  }

  const value = input.trim();
  try {
    return requireObject(JSON.parse(value));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }

  const roots = findRootContainers(value);
  if (roots.length !== 1) {
    throw new Error(
      roots.length === 0
        ? "JSON response does not contain one complete object"
        : "JSON response contains multiple root containers",
    );
  }

  const [{ start, end, opener }] = roots;
  if (opener !== "{") throw new Error("JSON response root must be an object");
  let parsed;
  try {
    parsed = JSON.parse(value.slice(start, end));
  } catch (error) {
    throw new Error(`JSON response object is invalid: ${error.message}`);
  }
  return requireObject(parsed);
}

function requireObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("JSON response root must be an object");
  }
  return value;
}

function findRootContainers(value) {
  const roots = [];
  let index = 0;
  while (index < value.length) {
    const char = value[index];
    if (char === "}" || char === "]") {
      throw new Error("JSON response contains an unmatched closing delimiter");
    }
    if (char !== "{" && char !== "[") {
      index += 1;
      continue;
    }

    const start = index;
    const opener = char;
    const stack = [char];
    let inString = false;
    let escaped = false;
    index += 1;
    for (; index < value.length && stack.length; index += 1) {
      const current = value[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (current === "\\") escaped = true;
        else if (current === '"') inString = false;
        continue;
      }
      if (current === '"') {
        inString = true;
      } else if (current === "{" || current === "[") {
        stack.push(current);
      } else if (current === "}" || current === "]") {
        const expected = current === "}" ? "{" : "[";
        if (stack.at(-1) !== expected) {
          throw new Error("JSON response contains mismatched delimiters");
        }
        stack.pop();
      }
    }
    if (stack.length || inString) {
      throw new Error("JSON response contains a truncated root container");
    }
    roots.push({ start, end: index, opener });
  }
  return roots;
}
