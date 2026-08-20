import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Normalize LLM-drifted markdown tables so remarkGfm can parse them as GFM tables.
 * Pure function — non-table content passes through unchanged.
 *
 * Repairs:
 * 1. Fullwidth ｜ (U+FF5C) → halfwidth | in table-context lines
 * 2. Missing separator row (| --- |) inserted after header
 * 3. Column count alignment (short rows padded)
 */
export function normalizeMarkdownTables(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const fixed = fixFullwidthPipes(lines[i]);

    if (isTableRow(fixed)) {
      // Collect consecutive table rows
      const block: string[] = [fixed];
      let j = i + 1;
      while (j < lines.length) {
        const next = fixFullwidthPipes(lines[j]);
        if (!isTableRow(next)) break;
        block.push(next);
        j++;
      }

      if (block.length >= 2) {
        const withSep = ensureSeparatorRow(block);
        result.push(...alignColumns(withSep));
      } else {
        result.push(...block);
      }
      i = j;
    } else {
      result.push(fixed);
      i++;
    }
  }

  return result.join("\n");
}

/** Replace fullwidth ｜ with | only in table-context lines (2+ ｜ or leading ｜). */
function fixFullwidthPipes(line: string): string {
  const count = (line.match(/｜/g) || []).length;
  const trimmed = line.trimStart();
  if (count >= 2 || trimmed.startsWith("｜")) {
    return line.replace(/｜/g, "|");
  }
  return line;
}

/** A GFM table row: starts with | and has at least 2 pipe chars. */
function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && (t.match(/\|/g) || []).length >= 2;
}

/** Separator row: only pipes, dashes, colons, spaces between outer pipes. */
function isSeparatorRow(line: string): boolean {
  return /^\|[\s:|-]+\|$/.test(line.trim());
}

/** Count columns in a table row (pipes - 1). */
function colCount(line: string): number {
  return (line.trim().match(/\|/g) || []).length - 1;
}

/** If block[1] is not a separator, insert one after block[0]. */
function ensureSeparatorRow(block: string[]): string[] {
  if (block.length < 2) return block;
  if (isSeparatorRow(block[1])) return block;
  const cols = colCount(block[0]);
  const sep = "| " + Array(cols).fill("---").join(" | ") + " |";
  return [block[0], sep, ...block.slice(1)];
}

/** Pad all rows to the max column count in the block. */
function alignColumns(block: string[]): string[] {
  const maxCols = Math.max(...block.map(colCount));
  return block.map((line) => {
    const cols = colCount(line);
    if (cols >= maxCols) return line;
    const t = line.trim();
    const lastPipe = t.lastIndexOf("|");
    const n = maxCols - cols;
    const cell = isSeparatorRow(line) ? "| --- " : "|  ";
    return t.slice(0, lastPipe) + cell.repeat(n) + t.slice(lastPipe);
  });
}

export function Markdown({ text }: { text: string }) {
  const source = typeof text === "string" ? text : "";
  return (
    <div className="prose prose-sm max-w-none prose-headings:font-display prose-headings:text-foreground prose-p:leading-relaxed prose-a:text-primary prose-strong:text-foreground prose-code:rounded prose-code:bg-secondary prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:font-normal prose-code:before:content-none prose-code:after:content-none prose-pre:bg-secondary prose-pre:text-foreground prose-blockquote:border-primary/40 prose-blockquote:text-muted-foreground prose-th:text-foreground prose-td:text-foreground/90">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{normalizeMarkdownTables(source)}</ReactMarkdown>
    </div>
  );
}
