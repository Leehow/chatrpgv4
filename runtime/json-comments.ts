/**
 * Strip `//` and `/* *\/` comments outside strings from JSON text: the agent home's `models.json` may
 * carry an operator's comments, and before §135.27.1.1 the product's own `//` corrections header. Both
 * readers of that file, the launch-time merge in `runtime/host.ts` and the lane child catalog in
 * `runtime/tasks.ts`, must parse it the same way. Not Pi's grammar (§135.27.1.1): Pi strips `//` and
 * trailing commas only, so this accepts `/* *\/`, which Pi rejects, and rejects trailing commas, which Pi accepts.
 */
export function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "\\") { out += text[i + 1] ?? ""; i++; continue; }
      if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = true; quote = ch; out += ch; continue; }
    if (ch === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") i++; out += "\n"; continue; }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++; continue;
    }
    out += ch;
  }
  return out;
}
