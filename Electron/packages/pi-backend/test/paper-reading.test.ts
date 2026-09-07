import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildProjection,
  detectOutline,
  pageForLine,
} from "../../../packs/paper-library/agent/projection.ts";
import {
  inspectorNativePackage,
  linesFromItems,
  orderPageItems,
  ownedInspectorNodeModules,
  pagesWithoutText,
  type ExtractedLine,
  type PositionedItem,
} from "../../../packs/paper-library/agent/pdf-text.ts";
import {
  buildSearchBuffer,
  matchLines,
  queryPattern,
  searchPapers,
} from "../../../packs/paper-library/agent/paper-search.ts";
import {
  imagePageFor,
  linesForPages,
  parseRange,
  readPaper,
  resolveRecord,
  MAX_READ_LINES,
  OVERVIEW_LINES,
} from "../../../packs/paper-library/agent/paper-read.ts";
import {
  isBlankRender,
  loadCanvas,
  normalizeImageWidth,
  ownedCanvasNodeModules,
  DEFAULT_IMAGE_WIDTH,
  MAX_IMAGE_WIDTH,
  MIN_IMAGE_WIDTH,
  NO_RENDER_ENGINE,
} from "../../../packs/paper-library/agent/page-image.ts";
import {
  coverage,
  isStale,
  parseStore,
  PROJECTION_ENGINE,
  slugForPaper,
  uniquePaperId,
  type ProjectionRecord,
  type ProjectionStore,
} from "../../../packs/paper-library/agent/projection-store.ts";
import {
  decide,
  newGate,
  noteInput,
  OUTSIDE_TOOLS,
  SURVEY_MARKER,
  WORKER_REPORT_TOOLS,
} from "../../../packs/paper-library/agent/library-first.ts";
import {
  checkCitations,
  extractCitations,
  looksLikeCitedReport,
  newLedger as newReadLedger,
  recordRead,
  INHERITED_NOTE,
} from "../../../packs/paper-library/agent/read-ledger.ts";
import type { CatalogPaper } from "../../../packs/paper-library/agent/parse-index.ts";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

async function temp(): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "paper-reading-"));
  return root;
}

function item(over: Partial<PositionedItem> & { text: string }): PositionedItem {
  return {
    x: 40, y: 700, width: 200, page: 1, fontSize: 8, font: "body",
    isBold: false, itemType: "Text", ...over,
  };
}

/** A projection line, defaulting to body typography. */
function line(text: string, over: Partial<ExtractedLine> = {}): ExtractedLine {
  return { text, page: 1, fontSize: 8, font: "body", bold: false, ...over };
}

/** Pages from "a | b" shorthand: one line per entry, page numbers ascending. */
function pages(...specs: string[]): ExtractedLine[] {
  return specs.flatMap((spec, index) =>
    spec.split("|").map((text) => line(text.trim(), { page: index + 1 })),
  );
}

describe("line reconstruction", () => {
  it("cuts a line when the baseline moves, not on every item", () => {
    const rebuilt = linesFromItems([
      item({ text: "Mind the gap:", x: 40, y: 700 }),
      item({ text: " micro-expansion joints", x: 120, y: 700 }),
      item({ text: "Georg Wolff", x: 40, y: 688 }),
    ]);
    expect(rebuilt.map((l) => l.text)).toEqual(["Mind the gap: micro-expansion joints", "Georg Wolff"]);
  });

  it("tolerates a baseline shift within one visual line", () => {
    const rebuilt = linesFromItems([
      item({ text: "resolution of 6.9", x: 40, y: 700, fontSize: 8 }),
      item({ text: "A", x: 120, y: 702, fontSize: 5 }),
    ]);
    expect(rebuilt).toHaveLength(1);
  });

  it("ignores non-text items", () => {
    expect(linesFromItems([item({ text: "figure", itemType: "Image" })])).toEqual([]);
  });

  it("reads a two-column page column by column, not across the gutter", () => {
    // Content-stream order interleaves the columns row by row, as the engine emits it.
    const raw = [
      item({ text: "left one", x: 40, y: 700, width: 250 }),
      item({ text: "right one", x: 306, y: 700, width: 250 }),
      item({ text: "left two", x: 40, y: 688, width: 250 }),
      item({ text: "right two", x: 306, y: 688, width: 250 }),
    ];
    expect(linesFromItems(raw).map((l) => l.text)).toEqual(["left one", "left two", "right one", "right two"]);
  });

  it("keeps a full-width line in place between the column blocks", () => {
    const raw = [
      item({ text: "A TITLE ACROSS THE PAGE", x: 40, y: 720, width: 520 }),
      item({ text: "left one", x: 40, y: 700, width: 250 }),
      item({ text: "right one", x: 306, y: 700, width: 250 }),
    ];
    expect(linesFromItems(raw).map((l) => l.text)).toEqual(["A TITLE ACROSS THE PAGE", "left one", "right one"]);
  });

  it("leaves a single-column page in plain reading order", () => {
    const raw = [
      item({ text: "second", x: 40, y: 688, width: 500 }),
      item({ text: "first", x: 40, y: 700, width: 500 }),
    ];
    expect(orderPageItems(raw).map((i) => i.text)).toEqual(["first", "second"]);
  });

  it("flags pages whose text layer is too thin to be real", () => {
    const thin = [line("ok ".repeat(30), { page: 1 }), line("x", { page: 2 })];
    expect(pagesWithoutText(thin, 3)).toEqual([2, 3]);
  });
});

describe("projection", () => {
  it("maps every line to its page", () => {
    const projection = buildProjection(pages("a | b | c", "d | e", "f"), 3);
    expect(projection.lines).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(projection.pageStarts).toEqual([1, 4, 6]);
    expect([1, 3, 4, 5, 6].map((n) => pageForLine(projection.pageStarts, n))).toEqual([1, 1, 2, 2, 3]);
  });

  it("keeps page starts aligned when a page contributes no text", () => {
    const projection = buildProjection([line("a", { page: 1 }), line("b", { page: 3 })], 3);
    expect(projection.pageStarts).toEqual([1, 2, 2]);
    expect(pageForLine(projection.pageStarts, 2)).toBe(3);
  });

  it("detects headings by typography, not by a heading vocabulary", () => {
    const outline = detectOutline([
      line("Results", { fontSize: 12 }),
      line("the body text runs on and on for a while here", { fontSize: 8 }),
      line("Discussion", { fontSize: 12, page: 2 }),
    ]);
    expect(outline).toEqual([
      { text: "Results", line: 1, page: 1 },
      { text: "Discussion", line: 3, page: 2 },
    ]);
  });

  it("accepts a bold heading set at body size", () => {
    const outline = detectOutline([
      line("Methods", { bold: true }),
      line("the body text runs on and on for a while here"),
    ]);
    expect(outline.map((entry) => entry.text)).toEqual(["Methods"]);
  });

  it("suppresses running headers and bare scale bars", () => {
    const body = "body text that carries the bulk of the characters on this page";
    const outline = detectOutline([
      line("J. Struct. Biol. 208", { fontSize: 12, page: 1 }),
      line(body, { page: 1 }),
      line(body, { page: 1 }),
      line("J. Struct. Biol. 208", { fontSize: 12, page: 2 }),
      line(body, { page: 2 }),
      line("10 μm", { fontSize: 12, page: 2 }),
    ]);
    expect(outline).toEqual([]);
  });

  it("offers no outline for an empty document", () => {
    expect(detectOutline([])).toEqual([]);
  });
});

describe("search normalization", () => {
  it("joins words broken across lines by a hyphen", () => {
    const buffer = buildSearchBuffer(["a rather time-con-", "suming technique"]);
    expect(buffer.text).toContain("time-consuming technique");
  });

  it("does not join a hyphen that ends a line before a capitalized word", () => {
    const buffer = buildSearchBuffer(["cryo-FIB-", "Milling overview"]);
    expect(buffer.text).toContain("cryo-fib- milling");
  });

  it("keeps line starts pointing at the right line after a join", () => {
    const lines = ["a rather time-con-", "suming technique", "next line"];
    const buffer = buildSearchBuffer(lines);
    const hit = buffer.text.indexOf("suming");
    const record = { pageStarts: [1] };
    const { matches } = matchLines(buffer, /suming/gu, record, lines, 5);
    expect(hit).toBeGreaterThan(0);
    expect(matches[0]?.line).toBe(2);
  });

  it("treats hyphen, space and no separator as the same query", () => {
    const buffer = buildSearchBuffer(["improving lowthroughput milling", "a low-throughput step", "low throughput again"]);
    const pattern = queryPattern("low-throughput");
    const found = [...buffer.text.matchAll(pattern)];
    expect(found).toHaveLength(3);
  });

  it("respects word boundaries so FIB does not match fibroblast", () => {
    const buffer = buildSearchBuffer(["fibroblast cultures", "cryo-FIB milling"]);
    const matched = [...buffer.text.matchAll(queryPattern("FIB"))];
    expect(matched).toHaveLength(1);
    expect(buffer.text.slice(matched[0]!.index!, matched[0]!.index! + 3)).toBe("fib");
  });

  it("rejects an empty query instead of matching everything", () => {
    expect(() => queryPattern("   ")).toThrow();
  });

  it("counts every matching line but returns only the requested number", () => {
    const lines = Array.from({ length: 10 }, () => "lamella thickness measured");
    const buffer = buildSearchBuffer(lines);
    const { total, matches } = matchLines(buffer, queryPattern("lamella thickness"), { pageStarts: [1, 6] }, lines, 3);
    expect(total).toBe(10);
    expect(matches).toHaveLength(3);
    expect(matches.map((match) => match.page)).toEqual([1, 1, 1]);
  });
});

describe("paper ids", () => {
  it("builds a readable slug from the title", () => {
    expect(slugForPaper("Mind the gap: Micro-expansion joints!", "/x/y.pdf")).toBe("mind-the-gap-micro-expansion-joints");
  });

  it("keeps CJK titles rather than producing an empty slug", () => {
    expect(slugForPaper("冷冻电镜制样", "/x/y.pdf")).toBe("冷冻电镜制样");
  });

  it("falls back to the filename when the title has no usable characters", () => {
    expect(slugForPaper("!!!", "/x/Waffle_Kelley2022.pdf")).toBe("waffle-kelley2022");
  });

  it("truncates on a word boundary", () => {
    const slug = slugForPaper("a".repeat(20) + " " + "b".repeat(70), "/x/y.pdf");
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("disambiguates collisions", () => {
    expect(uniquePaperId("waffle", new Set(["waffle", "waffle-2"]))).toBe("waffle-3");
  });
});

describe("store bookkeeping", () => {
  const record = (over: Partial<ProjectionRecord>): ProjectionRecord => ({
    paperId: "p",
    title: "P",
    source: "/a.pdf",
    size: 10,
    mtimeMs: 1,
    pages: 2,
    lines: 20,
    pageStarts: [1, 10],
    outline: [],
    pagesWithoutText: [],
    textLayer: "ok",
    projectedAt: "",
    engine: PROJECTION_ENGINE,
    ...over,
  });

  it("treats a resized or touched source as stale", () => {
    const current = record({});
    expect(isStale(current, 10, 1)).toBe(false);
    expect(isStale(current, 11, 1)).toBe(true);
    expect(isStale(current, 10, 2)).toBe(true);
    expect(isStale(undefined, 10, 1)).toBe(true);
  });

  it("reports what was searchable separately from what merely holds figures", () => {
    const store: ProjectionStore = {
      version: 1,
      updatedAt: "",
      papers: {
        a: record({ paperId: "a", source: "/a.pdf" }),
        b: record({ paperId: "b", source: "/b.pdf", pagesWithoutText: [3] }),
        c: record({ paperId: "c", source: "/c.pdf", lines: 0, textLayer: "none" }),
      },
    };
    expect(coverage(store, ["/a.pdf", "/b.pdf", "/c.pdf", "/d.pdf"])).toEqual({
      papersInCatalog: 4,
      projected: 2,
      missing: 2,
      noTextLayer: 1,
      withImagePages: 1,
      failed: 0,
    });
  });

  it("ignores malformed store entries instead of throwing", () => {
    const parsed = parseStore({ version: 1, papers: { a: { paperId: "a", source: "/a.pdf" }, b: { title: "no source" } } });
    expect(Object.keys(parsed!.papers)).toEqual(["a"]);
    expect(parseStore({ version: 2, papers: {} })).toBeUndefined();
  });
});

describe("read windows", () => {
  it("parses page and line ranges", () => {
    expect(parseRange("4-6")).toEqual({ from: 4, to: 6 });
    expect(parseRange("12")).toEqual({ from: 12, to: 12 });
    expect(parseRange("9-3")).toEqual({ from: 3, to: 9 });
    expect(parseRange("abc")).toBeUndefined();
    expect(parseRange(undefined)).toBeUndefined();
  });

  it("turns a page range into the lines of those pages", () => {
    const record = { pageStarts: [1, 21, 40], lines: 55 };
    expect(linesForPages(record, 1, 1)).toEqual({ from: 1, to: 20 });
    expect(linesForPages(record, 2, 3)).toEqual({ from: 21, to: 55 });
    expect(linesForPages(record, 3, 3)).toEqual({ from: 40, to: 55 });
  });

  it("suggests candidates when the paperId is unknown", () => {
    const store: ProjectionStore = {
      version: 1,
      updatedAt: "",
      papers: {
        "waffle-method": {
          paperId: "waffle-method",
          title: "Waffle Method",
          source: "/w.pdf",
          size: 1,
          mtimeMs: 1,
          pages: 1,
          lines: 3,
          pageStarts: [1],
          outline: [],
          pagesWithoutText: [],
          textLayer: "ok",
          projectedAt: "",
        },
      },
    };
    const missing = resolveRecord(store, { paperId: "waffle" });
    expect(missing.ok).toBe(false);
    expect(!missing.ok && missing.error.candidates?.[0]?.paperId).toBe("waffle-method");
    const found = resolveRecord(store, { path: "/w.pdf" });
    expect(found.ok && found.record.paperId).toBe("waffle-method");
  });
});

describe("reading a projected library", () => {
  const catalog: CatalogPaper[] = [
    { title: "Waffle Method", path: "/w.pdf", category: "冷冻FIB 制样", summary: "waffle milling" },
    { title: "Scanned Book", path: "/s.pdf", category: "待OCR", summary: "" },
  ];

  async function library(): Promise<string> {
    const dir = await temp();
    await mkdir(join(dir, "library", "text"), { recursive: true });
    const lines = [
      "Waffle Method",
      "We reduce lamella thickness to 150 nm.",
      "Milling proceeds at a shallow angle.",
      "Throughput improves for low-",
      "throughput specimens.",
      "Discussion",
      "Lamella thickness dominates resolution.",
    ];
    await writeFile(join(dir, "library", "text", "waffle-method.txt"), lines.join("\n"), "utf8");
    const store: ProjectionStore = {
      version: 1,
      updatedAt: "",
      papers: {
        "waffle-method": {
          paperId: "waffle-method",
          title: "Waffle Method",
          source: "/w.pdf",
          size: 1,
          mtimeMs: 1,
          pages: 2,
          lines: lines.length,
          pageStarts: [1, 6],
          outline: [{ text: "Discussion", line: 6, page: 2 }],
          pagesWithoutText: [],
          textLayer: "ok",
          projectedAt: "",
        },
        "scanned-book": {
          paperId: "scanned-book",
          title: "Scanned Book",
          source: "/s.pdf",
          size: 1,
          mtimeMs: 1,
          pages: 4,
          lines: 0,
          pageStarts: [],
          outline: [],
          pagesWithoutText: [1, 2, 3, 4],
          textLayer: "none",
          projectedAt: "",
        },
      },
    };
    await writeFile(join(dir, "library", "text", "projections.json"), JSON.stringify(store), "utf8");
    return dir;
  }

  it("finds a phrase and hands back a page and line to read", async () => {
    const dir = await library();
    const found = await searchPapers(dir, catalog, { query: "lamella thickness" });
    expect(found.papers).toHaveLength(1);
    const hit = found.papers[0]!;
    expect(hit.paperId).toBe("waffle-method");
    expect(hit.category).toBe("冷冻FIB 制样");
    expect(hit.total).toBe(2);
    expect(hit.matches.map((match) => [match.page, match.line])).toEqual([[1, 2], [2, 7]]);
  });

  it("matches across a line-broken hyphen", async () => {
    const dir = await library();
    const found = await searchPapers(dir, catalog, { query: "low throughput" });
    expect(found.papers[0]?.matches[0]?.line).toBe(4);
  });

  it("says how much of the catalog it could not search", async () => {
    const dir = await library();
    const found = await searchPapers(dir, catalog, { query: "lamella" });
    expect(found.coverage.missing).toBe(1);
    expect(found.coverage.noTextLayer).toBe(1);
    expect(found.note).toContain("未投影");
  });

  it("drops the coverage warning when the scope itself is fully projected", async () => {
    const dir = await library();
    const found = await searchPapers(dir, catalog, { query: "lamella", category: "冷冻FIB" });
    expect(found.scanned).toBe(1);
    expect(found.coverage.missing).toBe(0);
    expect(found.note).toBeUndefined();
  });

  it("matches titles without touching the projections", async () => {
    const dir = await library();
    const found = await searchPapers(dir, catalog, { query: "Scanned Book", titlesOnly: true });
    expect(found.mode).toBe("titles");
    expect(found.papers).toEqual([]);
    expect(found.titleHits.map((entry) => entry.title)).toContain("Scanned Book");
  });

  it("reads a window around a hit with page markers and line numbers", async () => {
    const dir = await library();
    const window = await readPaper(dir, { paperId: "waffle-method", around: 7, context: 1 });
    expect("error" in window).toBe(false);
    if ("error" in window) return;
    expect(window.from).toBe(6);
    expect(window.to).toBe(7);
    expect(window.firstPage).toBe(2);
    expect(window.text).toContain("--- p2 ---");
    expect(window.text).toContain("    7  Lamella thickness dominates resolution.");
  });

  it("reads a page range", async () => {
    const dir = await library();
    const window = await readPaper(dir, { paperId: "waffle-method", page: 1 });
    if ("error" in window) throw new Error(window.error);
    expect([window.from, window.to]).toEqual([1, 5]);
    expect(window.text).not.toContain("Discussion");
  });

  it("returns the opening and the outline when no window is asked for", async () => {
    const dir = await library();
    const window = await readPaper(dir, { paperId: "waffle-method" });
    if ("error" in window) throw new Error(window.error);
    expect(window.from).toBe(1);
    expect(window.to).toBeLessThanOrEqual(OVERVIEW_LINES);
    expect(window.outline).toEqual([{ text: "Discussion", line: 6, page: 2 }]);
  });

  it("never returns more than the read cap in one call", async () => {
    const dir = await library();
    const window = await readPaper(dir, { paperId: "waffle-method", offset: 1, limit: 5000 });
    if ("error" in window) throw new Error(window.error);
    expect(window.to - window.from + 1).toBeLessThanOrEqual(MAX_READ_LINES);
  });

  it("points at the next offset instead of silently truncating", async () => {
    const dir = await library();
    const window = await readPaper(dir, { paperId: "waffle-method", offset: 1, limit: 2 });
    if ("error" in window) throw new Error(window.error);
    expect(window.truncated).toBe(true);
    expect(window.footer).toContain("offset=3");
  });

  it("refuses a scan instead of returning an empty read", async () => {
    const dir = await library();
    const window = await readPaper(dir, { paperId: "scanned-book" });
    expect("error" in window && window.error).toContain("没有文本层");
  });
});

describe("page images", () => {
  it("clamps the render width into a sane band", () => {
    expect(normalizeImageWidth(undefined)).toBe(DEFAULT_IMAGE_WIDTH);
    expect(normalizeImageWidth("wide")).toBe(DEFAULT_IMAGE_WIDTH);
    expect(normalizeImageWidth(50)).toBe(MIN_IMAGE_WIDTH);
    expect(normalizeImageWidth(99999)).toBe(MAX_IMAGE_WIDTH);
    expect(normalizeImageWidth(1200)).toBe(1200);
  });

  it("resolves the image page the caller meant", () => {
    const record = { pageStarts: [1, 21, 40], pages: 3 };
    expect(imagePageFor(record, { page: 2 })).toBe(2);
    expect(imagePageFor(record, { pages: "3-3" })).toBe(3);
    expect(imagePageFor(record, { around: 25 })).toBe(2);
    expect(imagePageFor(record, { lines: "41-50" })).toBe(3);
    expect(imagePageFor(record, {})).toBe(1);
  });

  it("passes an out-of-range page through so the renderer can report it", () => {
    expect(imagePageFor({ pageStarts: [1], pages: 3 }, { page: 99 })).toBe(99);
  });

  it("calls a uniform canvas blank and a drawn one not", () => {
    const uniform = new Uint8ClampedArray(4 * 4000).fill(255);
    expect(isBlankRender(uniform)).toBe(true);
    const drawn = new Uint8ClampedArray(4 * 4000).fill(255);
    for (let i = 0; i < drawn.length; i += 4 * 10) drawn[i] = 0;
    expect(isBlankRender(drawn)).toBe(false);
    expect(isBlankRender(new Uint8ClampedArray(0))).toBe(true);
  });

  it("looks for the render engine only inside this pack", () => {
    const dir = ownedCanvasNodeModules("file:///packs/paper-library/agent/page-image.ts");
    expect(dir).toBe(join("/packs", "paper-library", "vendor", "canvas", "node_modules"));
  });

  it("reports a missing engine as guidance instead of throwing", async () => {
    const absent = await loadCanvas(join(await temp(), "no-such-canvas"));
    expect(absent).toBeUndefined();
    expect(NO_RENDER_ENGINE).toContain("pipiui_firecrawl_pdf mode=ocr");
  });
});

describe("survey skill", () => {
  const skill = join(
    new URL("../../../packs", import.meta.url).pathname,
    "paper-library", "agent", "skills", "survey", "SKILL.md",
  );

  it("is model-invocable so a literature question reaches it without a slash command", async () => {
    const text = await readFile(skill, "utf8");
    expect(text.startsWith("---\n")).toBe(true);
    expect(text).toContain("name: survey");
    expect(text).not.toContain("disable-model-invocation");
  });

  it("pins the loop to the reading tools and forbids the shortcuts", async () => {
    const text = await readFile(skill, "utf8");
    for (const required of ["paper_search", "paper_read", "action=project", "coverage", "subagent", "view=image"]) {
      expect(text).toContain(required);
    }
    for (const forbidden of ["grep", "bash", "整篇"]) {
      expect(text).toContain(forbidden);
    }
  });
});

describe("phrase vs terms search", () => {
  const catalog: CatalogPaper[] = [
    { title: "Mind the gap", path: "/gap.pdf", category: "冷冻FIB 制样", summary: "" },
    { title: "Big Handbook", path: "/book.pdf", category: "其它主题", summary: "" },
  ];

  async function library(): Promise<string> {
    const dir = await temp();
    await mkdir(join(dir, "library", "text"), { recursive: true });
    // The paper: all terms land on one page, close together.
    const gap = [
      "Micro-expansion joints drastically decrease lamella bending.",
      "We milled joints beside each lamella.",
      "Bending dropped from 40% to 5%.",
    ];
    // The handbook: every term appears, but scattered across different pages.
    const book = [
      "chapter one mentions joints in passing",
      "unrelated page filler",
      "chapter nine mentions bending of specimens",
      "more filler about lamella preparation",
    ];
    await writeFile(join(dir, "library", "text", "gap.txt"), gap.join("\n"), "utf8");
    await writeFile(join(dir, "library", "text", "book.txt"), book.join("\n"), "utf8");
    const record = (id: string, source: string, lines: number, pageStarts: number[]) => ({
      paperId: id, title: id, source, size: 1, mtimeMs: 1,
      pages: pageStarts.length, lines, pageStarts, outline: [], pagesWithoutText: [],
      textLayer: "ok" as const, projectedAt: "",
    });
    const store: ProjectionStore = {
      version: 1, updatedAt: "",
      papers: {
        gap: record("gap", "/gap.pdf", gap.length, [1]),
        book: record("book", "/book.pdf", book.length, [1, 2, 3, 4]),
      },
    };
    await writeFile(join(dir, "library", "text", "projections.json"), JSON.stringify(store), "utf8");
    return dir;
  }

  it("treats a multi-word query as a phrase first", async () => {
    const dir = await library();
    const found = await searchPapers(dir, catalog, { query: "lamella bending" });
    expect(found.mode).toBe("phrase");
    expect(found.papers.map((paper) => paper.paperId)).toEqual(["gap"]);
  });

  it("falls back to all-terms when the phrase is absent, and says so", async () => {
    const dir = await library();
    const found = await searchPapers(dir, catalog, { query: "joints lamella bending" });
    expect(found.mode).toBe("terms");
    expect(found.note).toContain("没有原样出现");
    expect(found.papers.length).toBeGreaterThan(0);
  });

  it("ranks same-page co-occurrence above a long document that merely contains every word", async () => {
    const dir = await library();
    const found = await searchPapers(dir, catalog, { query: "joints lamella bending" });
    expect(found.papers[0]?.paperId).toBe("gap");
    expect(found.papers[0]?.sharedPages).toBeGreaterThan(0);
    const book = found.papers.find((paper) => paper.paperId === "book");
    expect(book?.sharedPages).toBe(0);
  });

  it("requires every term, not any of them", async () => {
    const dir = await library();
    const found = await searchPapers(dir, catalog, { query: "joints lamella unobtainium" });
    expect(found.papers).toEqual([]);
    expect(found.note).toContain("不要据此断定");
  });

  it("does not fall back for a single-word query that simply is not there", async () => {
    const dir = await library();
    const found = await searchPapers(dir, catalog, { query: "unobtainium" });
    expect(found.mode).toBe("phrase");
    expect(found.papers).toEqual([]);
  });
});

describe("citations are handed over, not asked for", () => {
  it("gives every search hit a ready-to-paste cite", async () => {
    const dir = await temp();
    await mkdir(join(dir, "library", "text"), { recursive: true });
    const lines = ["page one text", "lamella thickness here", "page two text"];
    await writeFile(join(dir, "library", "text", "w.txt"), lines.join("\n"), "utf8");
    const store: ProjectionStore = {
      version: 1, updatedAt: "",
      papers: {
        w: {
          paperId: "w", title: "W", source: "/w.pdf", size: 1, mtimeMs: 1,
          pages: 2, lines: 3, pageStarts: [1, 3], outline: [], pagesWithoutText: [],
          textLayer: "ok", projectedAt: "",
        },
      },
    };
    await writeFile(join(dir, "library", "text", "projections.json"), JSON.stringify(store), "utf8");
    const catalog: CatalogPaper[] = [{ title: "W", path: "/w.pdf", category: "c", summary: "" }];

    const found = await searchPapers(dir, catalog, { query: "lamella thickness" });
    expect(found.papers[0]?.matches[0]?.cite).toBe("w p1");

    const window = await readPaper(dir, { paperId: "w", page: 1 });
    if ("error" in window) throw new Error(window.error);
    expect(window.cite).toBe("w p1");

    const spanning = await readPaper(dir, { paperId: "w", lines: "1-3" });
    if ("error" in spanning) throw new Error(spanning.error);
    expect(spanning.cite).toBe("w p1-2");
  });
});

describe("pdf engine wiring", () => {
  it("resolves the inspector only inside this pack", () => {
    const dir = ownedInspectorNodeModules("file:///packs/paper-library/agent/pdf-text.ts");
    expect(dir).toBe(join("/packs", "paper-library", "vendor", "pdf-inspector", "node_modules"));
  });

  it("names a native package per platform and nothing for the rest", () => {
    expect(inspectorNativePackage("darwin", "arm64")).toBe("@firecrawl/pdf-inspector-darwin-arm64");
    expect(inspectorNativePackage("linux", "x64")).toBe("@firecrawl/pdf-inspector-linux-x64-gnu");
    expect(inspectorNativePackage("freebsd" as NodeJS.Platform, "x64")).toBeUndefined();
  });

  it("declares the vendored engines it actually ships", async () => {
    const manifest = JSON.parse(
      await readFile(join(new URL("../../../packs", import.meta.url).pathname, "paper-library", "pipiui-extension.json"), "utf8"),
    );
    const ids = manifest.updateComponents.map((component: { id: string }) => component.id);
    expect(ids).toContain("firecrawl-pdf-inspector");
    expect(ids).toContain("napi-rs-canvas");
  });
});

describe("engine migration", () => {
  it("treats a projection from another engine as stale", () => {
    const base = {
      paperId: "p", title: "P", source: "/a.pdf", size: 10, mtimeMs: 1, pages: 2, lines: 20,
      pageStarts: [1, 10], outline: [], pagesWithoutText: [], textLayer: "ok" as const, projectedAt: "",
    };
    expect(isStale({ ...base, engine: PROJECTION_ENGINE }, 10, 1)).toBe(false);
    expect(isStale({ ...base, engine: "pdfjs-0" }, 10, 1)).toBe(true);
    // A store written before engines were stamped must be rebuilt, not trusted.
    expect(isStale(base, 10, 1)).toBe(true);
  });
});

describe("library-first gate", () => {
  it("stays open until the user asks for a survey", () => {
    expect(decide(newGate(), "web_search").block).toBe(false);
  });

  it("arms on the user's own words, not on the model declaring a mode", () => {
    expect(noteInput(newGate(), "/survey 比较几种制样方法").armed).toBe(true);
    expect(noteInput(newGate(), `${SURVEY_MARKER} 先 skill_load…`).armed).toBe(true);
    expect(noteInput(newGate(), "帮我看看这个").armed).toBe(false);
  });

  it("blocks the web while the library is still unsearched", () => {
    for (const tool of OUTSIDE_TOOLS) {
      const gate = noteInput(newGate(), "/survey 比较几种制样方法");
      const decision = decide(gate, tool);
      expect(decision.block).toBe(true);
      expect(decision.block && decision.reason).toContain("paper_search");
    }
  });

  it("never blocks the library's own tools", () => {
    const gate = noteInput(newGate(), "/survey x");
    for (const tool of ["paper_search", "paper_read", "paper_library", "subagent", "skill_load"]) {
      expect(decide(gate, tool).block).toBe(false);
    }
  });

  it("opens once a real library search has happened", () => {
    const gate = noteInput(newGate(), "/survey x");
    expect(decide(gate, "web_search").block).toBe(true);
    expect(decide(gate, "paper_search").block).toBe(false);
    // Ordering rule, not a ban: checking a DOI online afterwards is legitimate.
    expect(decide(gate, "web_search").block).toBe(false);
  });

  it("re-arms for the next survey in the same session", () => {
    let gate = noteInput(newGate(), "/survey one");
    decide(gate, "paper_search");
    gate = noteInput(gate, "/survey two");
    expect(decide(gate, "web_search").block).toBe(true);
  });
});

describe("citation provenance", () => {
  it("reads the citation format the tools emit", () => {
    const found = extractCitations("见 `waffle-method-a-general p3` 与 mind-the-gap-micro p6-7 的记载");
    expect(found.map((c) => [c.paperId, c.pages])).toEqual([
      ["waffle-method-a-general", [3]],
      ["mind-the-gap-micro", [6, 7]],
    ]);
  });

  it("ignores prose that merely mentions a paper", () => {
    expect(extractCitations("Wolff et al. 2019 报告了 78% 的成功率")).toEqual([]);
  });

  it("passes a citation whose page this session actually read", () => {
    const ledger = newReadLedger();
    recordRead(ledger, "waffle-method", 3, 3);
    const check = checkCitations(ledger, "缺口宽 200 nm（`waffle-method p3`）");
    expect(check.verdict).toBe("clean");
    expect(check.unverified).toEqual([]);
  });

  it("flags a citation inherited rather than read — the failure seen in a real run", () => {
    const ledger = newReadLedger();
    recordRead(ledger, "serial-lift-out", 5, 5);
    const check = checkCitations(ledger, "notch 宽 200–300 nm（`waffle-method p3`），而 `serial-lift-out p5` 另有记载");
    expect(check.verdict).toBe("unverified-citations");
    expect(check.unverified.map((c) => c.paperId)).toEqual(["waffle-method"]);
    expect(check.verified.map((c) => c.paperId)).toEqual(["serial-lift-out"]);
    expect(check.note).toContain("转述");
  });

  it("requires every page of a range to have been read", () => {
    const ledger = newReadLedger();
    recordRead(ledger, "mind-the-corner-fillets", 6, 6);
    expect(checkCitations(ledger, "`mind-the-corner-fillets p6-7`").verdict).toBe("unverified-citations");
    recordRead(ledger, "mind-the-corner-fillets", 7, 7);
    expect(checkCitations(ledger, "`mind-the-corner-fillets p6-7`").verdict).toBe("clean");
  });

  it("does not treat a short word before a page number as a paper id", () => {
    expect(extractCitations("见表 p3 和 fig p7")).toEqual([]);
  });

  it("says so when a draft cites nothing at all", () => {
    expect(checkCitations(newReadLedger(), "结论：微膨胀缝更好。").verdict).toBe("nothing-cited");
  });

  it("marks worker reports as second-hand where they enter the context", () => {
    expect(WORKER_REPORT_TOOLS.has("subagent_status")).toBe(true);
    expect(looksLikeCitedReport("result=notch 见 `waffle-method p3`")).toBe(true);
    expect(looksLikeCitedReport("state=ok; 6 turns")).toBe(false);
    expect(INHERITED_NOTE).toContain("不是本轮的一手阅读");
  });
});
