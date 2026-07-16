/**
 * Parse exactly one JSON object from a model/tool response.
 *
 * Wrapper prose is allowed. Ambiguity is checked at the standalone-document
 * level, never by promoting JSON-looking words or numbers inside sentences.
 */
export function parseSingleJsonObject(input, diagnostics = null) {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("JSON response must be a non-empty string");
  }
  if (diagnostics && typeof diagnostics === "object") diagnostics.scan_steps = 0;

  const source = input.trim();
  try {
    return requireObject(JSON.parse(source));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }

  const fences = findMarkdownFences(source, diagnostics);
  const explicitJsonFences = fences.filter((fence) => fence.info === "json");
  if (explicitJsonFences.length > 1) {
    throw new Error("JSON response contains multiple JSON fences");
  }
  if (explicitJsonFences.length === 1) {
    return parseFencedObject(source, explicitJsonFences[0], diagnostics);
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
    return parseFencedObject(source, genericJsonFences[0], diagnostics);
  }

  const containers = findContainerCandidates(source, diagnostics);
  if (containers.length !== 1) {
    throw new Error(
      containers.length === 0
        ? "JSON response does not contain one complete object"
        : "JSON response contains multiple JSON containers",
    );
  }
  const [candidate] = containers;
  assertNoStandaloneJsonDocument(source.slice(0, candidate.start), diagnostics);
  assertNoStandaloneJsonDocument(source.slice(candidate.end), diagnostics);
  return requireObject(candidate.value);
}

function parseFencedObject(source, fence, diagnostics) {
  let parsed;
  try {
    parsed = requireObject(JSON.parse(fence.content.trim()));
  } catch (error) {
    throw new Error(`JSON fence does not contain one valid object: ${error.message}`);
  }
  assertNoStandaloneJsonDocument(source.slice(0, fence.start), diagnostics);
  assertNoStandaloneJsonDocument(source.slice(fence.end), diagnostics);
  return parsed;
}

function requireObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("JSON response root must be an object");
  }
  return value;
}

function assertNoStandaloneJsonDocument(wrapper, diagnostics) {
  const whole = wrapper.trim();
  if (!whole) return;
  if (findContainerCandidates(whole, diagnostics).length) {
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
  if (buildMarkdownLinkEnds(segment, null).has(0)) return false;
  if (segment.startsWith('"')) return isStandaloneStringShaped(segment);
  if (segment.startsWith("{")) return looksLikeJsonContainer(segment, 0);
  if (segment.startsWith("[")) return looksLikeJsonContainer(segment, 0);
  return /^(?:[+-]?(?:NaN|Infinity)|[+-]?(?:0[xX][0-9a-zA-Z]*|0[oO][0-9a-zA-Z]*|0[bB][0-9a-zA-Z]*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d*)?))$/.test(segment);
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

function findContainerCandidates(source, diagnostics) {
  const containers = [];
  const markdownLinkEnds = buildMarkdownLinkEnds(source, diagnostics);
  const nextNonWhitespace = buildNextNonWhitespace(source, diagnostics);
  let index = 0;
  while (index < source.length) {
    countStep(diagnostics);
    const linkEnd = markdownLinkEnds.get(index);
    if (linkEnd !== undefined) {
      index = linkEnd;
      continue;
    }
    if (source[index] !== "{" && source[index] !== "[") {
      index += 1;
      continue;
    }
    if (!looksLikeJsonContainer(source, index, nextNonWhitespace)) {
      index += 1;
      continue;
    }
    const container = scanJsonContainer(source, index, diagnostics);
    containers.push(container);
    index = container.end;
  }
  return containers;
}

function scanJsonContainer(source, start, diagnostics) {
  const stack = [source[start]];
  let inString = false;
  let escaped = false;
  let index = start + 1;
  for (; index < source.length && stack.length; index += 1) {
    countStep(diagnostics);
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char);
    } else if (char === "}" || char === "]") {
      const expected = char === "}" ? "{" : "[";
      if (stack.at(-1) !== expected) {
        throw new Error("JSON response contains mismatched delimiters");
      }
      stack.pop();
    }
  }
  if (stack.length || inString) {
    throw new Error("JSON response contains a truncated JSON value");
  }
  const token = source.slice(start, index);
  try {
    return { start, end: index, value: JSON.parse(token) };
  } catch (error) {
    throw new Error(`JSON response contains invalid JSON: ${error.message}`);
  }
}

function buildNextNonWhitespace(source, diagnostics) {
  const nextNonWhitespace = new Int32Array(source.length + 1);
  let next = source.length;
  nextNonWhitespace[source.length] = next;
  for (let index = source.length - 1; index >= 0; index -= 1) {
    countStep(diagnostics);
    if (!/\s/.test(source[index])) next = index;
    nextNonWhitespace[index] = next;
  }
  return nextNonWhitespace;
}

function buildMarkdownLinkEnds(source, diagnostics) {
  const bracketEnds = buildBalancedDelimiterEnds(source, "[", "]", diagnostics);
  const parenEnds = buildBalancedDelimiterEnds(source, "(", ")", diagnostics);
  const linkEnds = new Map();
  for (const [start, bracketEnd] of bracketEnds) {
    countStep(diagnostics);
    const destinationEnd = parenEnds.get(bracketEnd);
    if (source[bracketEnd] === "(" && destinationEnd !== undefined) {
      linkEnds.set(start, destinationEnd);
    }
  }
  return linkEnds;
}

function buildBalancedDelimiterEnds(source, opener, closer, diagnostics) {
  const ends = new Map();
  const stack = [];
  let backslashRun = 0;
  for (let index = 0; index < source.length; index += 1) {
    countStep(diagnostics);
    const char = source[index];
    if (char === "\\") {
      backslashRun += 1;
      continue;
    }
    const escaped = backslashRun % 2 === 1;
    backslashRun = 0;
    if (escaped) {
      continue;
    }
    if (char === opener) {
      stack.push(index);
    } else if (char === closer && stack.length) {
      ends.set(stack.pop(), index + 1);
    }
  }
  return ends;
}

function looksLikeJsonContainer(source, start, nextNonWhitespace = null) {
  const opener = source[start];
  let contentStart = nextNonWhitespace ? nextNonWhitespace[start + 1] : start + 1;
  if (!nextNonWhitespace) {
    while (contentStart < source.length && /\s/.test(source[contentStart])) contentStart += 1;
  }
  if (contentStart >= source.length) return false;
  const first = source[contentStart];
  if (opener === "{") return first === '"' || first === "}";
  if ('[{"'.includes(first) || first === "]") return true;
  if (/\d/.test(first) || (first === "-" && /\d/.test(source[contentStart + 1] || ""))) return true;
  return ["true", "false", "null"].some((word) => (
    source.startsWith(word, contentStart)
    && !/[a-zA-Z0-9_]/.test(source[contentStart + word.length] || "")
  ));
}

function countStep(diagnostics) {
  if (diagnostics && typeof diagnostics === "object") diagnostics.scan_steps += 1;
}

function countSteps(diagnostics, count) {
  if (diagnostics && typeof diagnostics === "object") diagnostics.scan_steps += count;
}

function findMarkdownFences(source, diagnostics) {
  const lines = [];
  const linePattern = /.*(?:\r?\n|$)/g;
  for (const match of source.matchAll(linePattern)) {
    if (!match[0]) continue;
    countSteps(diagnostics, match[0].length);
    const opening = match[0].match(/^[ \t]*(`{3,}|~{3,})[ \t]*([^\r\n]*?)[ \t]*(?:\r?\n)?$/);
    lines.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
      opening: opening ? {
        marker: opening[1][0],
        length: opening[1].length,
        info: opening[2].trim().toLowerCase(),
      } : null,
    });
  }

  const nextClosing = new Array(lines.length).fill(-1);
  const nextByMinimum = { "`": [], "~": [] };
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    countStep(diagnostics);
    const opening = lines[index].opening;
    if (!opening) continue;
    nextClosing[index] = nextByMinimum[opening.marker][opening.length] ?? -1;
    if (!opening.info) {
      for (let minimum = 3; minimum <= opening.length; minimum += 1) {
        countStep(diagnostics);
        nextByMinimum[opening.marker][minimum] = index;
      }
    }
  }

  const fences = [];
  for (let index = 0; index < lines.length; index += 1) {
    countStep(diagnostics);
    const opening = lines[index].opening;
    if (!opening) continue;
    const closingIndex = nextClosing[index];
    if (closingIndex < 0) {
      if (opening.info === "json") throw new Error("JSON response contains an unclosed JSON fence");
      continue;
    }
    fences.push({
      start: lines[index].start,
      end: lines[closingIndex].end,
      info: opening.info,
      content: source.slice(lines[index].end, lines[closingIndex].start),
    });
    index = closingIndex;
  }
  return fences;
}
