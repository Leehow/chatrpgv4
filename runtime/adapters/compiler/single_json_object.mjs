/**
 * Parse exactly one JSON object from a model/tool response.
 *
 * A unique JSON Markdown fence or ordinary prose wrapper is tolerated, but a
 * second complete JSON value of any type remains ambiguous and is rejected.
 * Schema validation remains the caller's job.
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

  const fences = findMarkdownFences(value);
  const explicitJsonFences = fences.filter((fence) => fence.info === "json");
  if (explicitJsonFences.length > 1) {
    throw new Error("JSON response contains multiple JSON fences");
  }
  if (explicitJsonFences.length === 1) {
    return parseFencedObject(value, explicitJsonFences[0]);
  }

  const genericJsonFences = fences.filter((fence) => {
    if (fence.info) return false;
    try {
      requireObject(JSON.parse(fence.content.trim()));
      return true;
    } catch {
      return false;
    }
  });
  if (genericJsonFences.length > 1) {
    throw new Error("JSON response contains multiple JSON fences");
  }
  if (genericJsonFences.length === 1) {
    return parseFencedObject(value, genericJsonFences[0]);
  }

  const candidates = scanJsonValues(value);
  if (candidates.length !== 1) {
    throw new Error(
      candidates.length === 0
        ? "JSON response does not contain one complete object"
        : "JSON response contains multiple JSON values",
    );
  }
  return requireObject(candidates[0].value);
}

function parseFencedObject(source, fence) {
  let parsed;
  try {
    parsed = requireObject(JSON.parse(fence.content.trim()));
  } catch (error) {
    throw new Error(`JSON fence does not contain one valid object: ${error.message}`);
  }
  const outside = `${source.slice(0, fence.start)}\n${source.slice(fence.end)}`;
  const externalValues = scanJsonValues(outside);
  if (externalValues.length) {
    throw new Error("JSON response contains a JSON value outside its fence");
  }
  return parsed;
}

function requireObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("JSON response root must be an object");
  }
  return value;
}

function findMarkdownFences(source) {
  const lines = [];
  const linePattern = /.*(?:\r?\n|$)/g;
  for (const match of source.matchAll(linePattern)) {
    if (!match[0]) continue;
    lines.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }

  const fences = [];
  for (let index = 0; index < lines.length; index += 1) {
    const opening = lines[index].text.match(/^[ \t]*(`{3,}|~{3,})[ \t]*([^\r\n]*?)[ \t]*(?:\r?\n)?$/);
    if (!opening) continue;
    const marker = opening[1][0];
    const minimumLength = opening[1].length;
    const info = opening[2].trim().toLowerCase();
    let closingIndex = index + 1;
    for (; closingIndex < lines.length; closingIndex += 1) {
      const closing = lines[closingIndex].text.match(/^[ \t]*(`{3,}|~{3,})[ \t]*(?:\r?\n)?$/);
      if (closing && closing[1][0] === marker && closing[1].length >= minimumLength) break;
    }
    if (closingIndex >= lines.length) {
      if (info === "json") throw new Error("JSON response contains an unclosed JSON fence");
      continue;
    }
    fences.push({
      start: lines[index].start,
      end: lines[closingIndex].end,
      info,
      content: source.slice(lines[index].end, lines[closingIndex].start),
    });
    index = closingIndex;
  }
  return fences;
}

function scanJsonValues(source) {
  const candidates = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === "{" || char === "[") {
      const container = scanContainer(source, index);
      if (container.kind === "valid") candidates.push(container);
      else if (container.kind === "invalid_json") throw new Error(container.error);
      index = container.end;
      continue;
    }
    if (char === '"') {
      const stringToken = scanStringToken(source, index);
      if (stringToken) {
        if (stringToken.kind === "invalid_json") throw new Error(stringToken.error);
        candidates.push(stringToken);
        index = stringToken.end;
        continue;
      }
    }
    const scalar = scanScalarToken(source, index);
    if (scalar) {
      candidates.push(scalar);
      index = scalar.end;
      continue;
    }
    index += 1;
  }
  return candidates;
}

function scanContainer(source, start) {
  const stack = [source[start]];
  let inString = false;
  let escaped = false;
  let index = start + 1;
  for (; index < source.length && stack.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{" || char === "[") stack.push(char);
    else if (char === "}" || char === "]") {
      const expected = char === "}" ? "{" : "[";
      if (stack.at(-1) !== expected) {
        if (looksLikeJsonContainer(source, start)) {
          return { kind: "invalid_json", end: index + 1, error: "JSON response contains mismatched delimiters" };
        }
        return { kind: "prose", end: index + 1 };
      }
      stack.pop();
    }
  }
  if (stack.length || inString) {
    if (looksLikeJsonContainer(source, start)) {
      return { kind: "invalid_json", end: source.length, error: "JSON response contains a truncated JSON value" };
    }
    return { kind: "prose", end: start + 1 };
  }

  const token = source.slice(start, index);
  try {
    return { kind: "valid", start, end: index, value: JSON.parse(token) };
  } catch (error) {
    if (looksLikeJsonContainer(source, start)) {
      return { kind: "invalid_json", end: index, error: `JSON response contains invalid JSON: ${error.message}` };
    }
    return { kind: "prose", end: index };
  }
}

function looksLikeJsonContainer(source, start) {
  const opener = source[start];
  const rest = source.slice(start + 1).trimStart();
  if (!rest) return false;
  if (opener === "{") return rest.startsWith('"') || rest.startsWith("}");
  return /^(?:[\[{"]|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?\b|true\b|false\b|null\b|\])/.test(rest);
}

function scanStringToken(source, start) {
  const startsAtBoundary = isBoundary(source[start - 1]);
  let escaped = false;
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) escaped = false;
    else if (char === "\\") escaped = true;
    else if (char === '"') {
      const end = index + 1;
      if (!hasTokenBoundaries(source, start, end)) {
        if (startsAtBoundary) continue;
        return null;
      }
      try {
        return { kind: "valid", start, end, value: JSON.parse(source.slice(start, end)) };
      } catch (error) {
        return startsAtBoundary
          ? { kind: "invalid_json", end, error: `JSON response contains invalid JSON string: ${error.message}` }
          : null;
      }
    }
  }
  return startsAtBoundary
    ? { kind: "invalid_json", end: source.length, error: "JSON response contains a truncated JSON string" }
    : null;
}

function scanScalarToken(source, start) {
  if (!isBoundary(source[start - 1])) return null;
  const rest = source.slice(start);
  const match = rest.match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
  if (!match) return null;
  const end = start + match[0].length;
  if (!isBoundary(source[end])) {
    if (/[-+\.\dEe]/.test(source[end])) {
      throw new Error("JSON response contains a truncated or invalid JSON number");
    }
    return null;
  }
  return { kind: "valid", start, end, value: JSON.parse(match[0]) };
}

function hasTokenBoundaries(source, start, end) {
  return isBoundary(source[start - 1]) && isBoundary(source[end]);
}

function isBoundary(char) {
  return char === undefined || /[\s,:;()[\]{}.!?`~]/.test(char);
}
