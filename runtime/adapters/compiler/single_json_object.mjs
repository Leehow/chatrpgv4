/**
 * Parse exactly one JSON object from a model/tool response.
 *
 * Wrapper prose is allowed. Ambiguity is checked at the standalone-document
 * level, never by promoting JSON-looking words or numbers inside sentences.
 */
export function parseSingleJsonObject(input) {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("JSON response must be a non-empty string");
  }

  const source = input.trim();
  try {
    return requireObject(JSON.parse(source));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }

  const fences = findMarkdownFences(source);
  const explicitJsonFences = fences.filter((fence) => fence.info === "json");
  if (explicitJsonFences.length > 1) {
    throw new Error("JSON response contains multiple JSON fences");
  }
  if (explicitJsonFences.length === 1) {
    return parseFencedObject(source, explicitJsonFences[0]);
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
    return parseFencedObject(source, genericJsonFences[0]);
  }

  const containers = findContainerCandidates(source);
  if (containers.length !== 1) {
    throw new Error(
      containers.length === 0
        ? "JSON response does not contain one complete object"
        : "JSON response contains multiple JSON containers",
    );
  }
  const [candidate] = containers;
  assertNoStandaloneJsonDocument(source.slice(0, candidate.start));
  assertNoStandaloneJsonDocument(source.slice(candidate.end));
  return requireObject(candidate.value);
}

function parseFencedObject(source, fence) {
  let parsed;
  try {
    parsed = requireObject(JSON.parse(fence.content.trim()));
  } catch (error) {
    throw new Error(`JSON fence does not contain one valid object: ${error.message}`);
  }
  assertNoStandaloneJsonDocument(source.slice(0, fence.start));
  assertNoStandaloneJsonDocument(source.slice(fence.end));
  return parsed;
}

function requireObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("JSON response root must be an object");
  }
  return value;
}

function assertNoStandaloneJsonDocument(wrapper) {
  const whole = wrapper.trim();
  if (!whole) return;
  if (findContainerCandidates(whole).length) {
    throw new Error("JSON response contains a standalone JSON value outside its object");
  }
  const segments = [whole, ...whole.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)];
  const uniqueSegments = [...new Set(segments)];
  for (const segment of uniqueSegments) {
    try {
      JSON.parse(segment);
      throw new Error("JSON response contains a standalone JSON value outside its object");
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    if (looksLikeMalformedStandaloneJson(segment)) {
      throw new Error("JSON response contains a malformed standalone JSON document");
    }
  }
}

function looksLikeMalformedStandaloneJson(segment) {
  if (isMarkdownLinkAt(segment, 0)) return false;
  if (segment.startsWith('"')) return isStandaloneStringShaped(segment);
  if (segment.startsWith("{")) return looksLikeJsonContainer(segment, 0);
  if (segment.startsWith("[")) return looksLikeJsonContainer(segment, 0);
  return /^(?:[+-]?(?:NaN|Infinity)|[+-]?(?:0[xX][0-9a-fA-F]*|0[oO][0-9]*|0[bB][0-9]*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d*)?))$/.test(segment);
}

function isStandaloneStringShaped(segment) {
  let escaped = false;
  for (let index = 1; index < segment.length; index += 1) {
    const char = segment[index];
    if (escaped) escaped = false;
    else if (char === "\\") escaped = true;
    else if (char === '"') return !segment.slice(index + 1).trim();
  }
  return true;
}

function findContainerCandidates(source) {
  const containers = [];
  let index = 0;
  while (index < source.length) {
    if (source[index] === "[" && isMarkdownLinkAt(source, index)) {
      index = endOfMarkdownLink(source, index);
      continue;
    }
    if (source[index] !== "{" && source[index] !== "[") {
      index += 1;
      continue;
    }
    const container = scanContainer(source, index);
    if (container.kind === "invalid_json") throw new Error(container.error);
    if (container.kind === "valid") containers.push(container);
    index = container.end;
  }
  return containers;
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
        return looksLikeJsonContainer(source, start)
          ? { kind: "invalid_json", end: index + 1, error: "JSON response contains mismatched delimiters" }
          : { kind: "prose", end: index + 1 };
      }
      stack.pop();
    }
  }
  if (stack.length || inString) {
    return looksLikeJsonContainer(source, start)
      ? { kind: "invalid_json", end: source.length, error: "JSON response contains a truncated JSON value" }
      : { kind: "prose", end: start + 1 };
  }
  const token = source.slice(start, index);
  try {
    return { kind: "valid", start, end: index, value: JSON.parse(token) };
  } catch (error) {
    return looksLikeJsonContainer(source, start)
      ? { kind: "invalid_json", end: index, error: `JSON response contains invalid JSON: ${error.message}` }
      : { kind: "prose", end: index };
  }
}

function looksLikeJsonContainer(source, start) {
  const opener = source[start];
  const rest = source.slice(start + 1).trimStart();
  if (!rest) return false;
  if (opener === "{") return rest.startsWith('"') || rest.startsWith("}");
  return /^(?:[\[{"]|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?\b|true\b|false\b|null\b|\])/.test(rest);
}

function isMarkdownLinkAt(source, start) {
  if (source[start] !== "[") return false;
  const labelEnd = source.indexOf("]", start + 1);
  if (labelEnd < 0 || source[labelEnd + 1] !== "(") return false;
  const targetEnd = source.indexOf(")", labelEnd + 2);
  return targetEnd >= 0;
}

function endOfMarkdownLink(source, start) {
  const labelEnd = source.indexOf("]", start + 1);
  return source.indexOf(")", labelEnd + 2) + 1;
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
