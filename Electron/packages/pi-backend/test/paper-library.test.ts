import { basename } from "node:path";
import { checkAgainstManifest } from "../../../packs/paper-library/agent/check.ts";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

import { resolveInitAction, readCanonical } from "../../../packs/paper-library/agent/canonical.ts";
import { diffManifest, parseManifest } from "../../../packs/paper-library/agent/check.ts";
import { extractPdfPreview, extractPdfPreviewFast, isMostlyReadable } from "../../../packs/paper-library/agent/pdf-preview.ts";
import paperLibrary from "../../../packs/paper-library/agent/index.ts";
import { allowedWritePath, skeletonIndex, writeCanonicalScaffold, writePointerScaffold } from "../../../packs/paper-library/agent/scaffold.ts";
import { catalogToMarkdown, parseCatalogFile, parseIndex } from "../../../packs/paper-library/agent/parse-index.ts";
import { groupFilesByDir, scanPdfs, isExcludedPath } from "../../../packs/paper-library/agent/scan.ts";
import { shouldSkipDir, shouldSkipRoot } from "../../../packs/paper-library/agent/skip.ts";
import { executePaperLibrary, handleListCatalogCommand } from "../../../packs/paper-library/agent/tools.ts";
import { validateExtensionManifest } from "../src/extension-manifest.js";

const packsSource = new URL("../../../packs", import.meta.url).pathname;

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  root = "";
});

async function temp(): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "paper-library-"));
  return root;
}

function pdfWithTitle(title: string, text = "Hello"): Buffer {
  const inner = Buffer.from(`BT (${text}) Tj ET`, "latin1");
  const deflated = deflateSync(inner);
  const head = Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Title (${title}) /Filter /FlateDecode /Length ${deflated.length} >>\nstream\n`,
    "latin1",
  );
  const tail = Buffer.from("\nendstream\nendobj\n", "latin1");
  return Buffer.concat([head, deflated, tail]);
}

describe("paper-library pack contract", () => {
  it("validates the manifest and is required by paper-workbench", async () => {
    const library = JSON.parse(await readFile(join(packsSource, "paper-library", "pipiui-extension.json"), "utf8"));
    const form = JSON.parse(await readFile(join(packsSource, "paper-workbench", "pipiui-extension.json"), "utf8"));
    expect(validateExtensionManifest(library).ok).toBe(true);
    const requiredIds = form.dependencies.required.map((item: { id: string }) => item.id);
    expect(requiredIds).toContain("paper-library");
    // Versions move together: a pack bump must be reflected in the form pack's range.
    const range = (id: string) => form.dependencies.required.find((item: { id: string }) => item.id === id).version;
    expect(range("paper-library")).toBe(`^${library.version}`);
    expect(requiredIds).toContain("agent-orchestration");
    expect(requiredIds).toContain("workbench-panels");
    const commands = Object.fromEntries(
      library.app.ui.slashCommands.map((command: { name: string }) => [command.name, command]),
    );
    expect(Object.keys(commands)).toEqual(["ini", "survey"]);
    expect(commands.survey.prompt).toContain("skill_load('survey')");
    expect(commands.survey.prompt).toContain("coverage");
    expect(commands.survey.prompt).toContain("会被直接拦截");
    expect(commands.survey.prompt).toContain("paper_cite_check");
    expect(library.app.ui.slashCommands[0].name).toBe("ini");
    expect(library.app.ui.slashCommands[0].prompt).toContain("action=ini");
    expect(library.app.ui.slashCommands[0].prompt).toContain("subagent");
    expect(library.app.ui.slashCommands[0].prompt).toContain("fresh:true");
    expect(library.agent.tools).toEqual(["paper_library", "paper_search", "paper_read", "paper_cite_check", "paper_cite_meta"]);
    expect(library.agent.agentPatches).toEqual([
      { target: "general-purpose", addTools: ["paper_library", "paper_search", "paper_read", "paper_cite_check", "paper_cite_meta"] },
    ]);
  });
});

describe("scan skip policy", () => {
  it("honors exclude substrings and stores them", async () => {
    const dir = await temp();
    const papers = join(dir, "papers");
    const trpg = join(dir, "trpg");
    await mkdir(papers, { recursive: true });
    await mkdir(trpg, { recursive: true });
    await writeFile(join(papers, "paper.pdf"), pdfWithTitle("Paper"));
    await writeFile(join(trpg, "module.pdf"), pdfWithTitle("Module"));
    const scanned = await scanPdfs({ roots: [dir], exclude: ["trpg"] });
    expect(scanned.files.length).toBe(1);
    expect(scanned.files[0]!.path).toContain("papers");
    expect(scanned.skippedExcluded).toBe(1);
  });

  it("groups scan results by directory for the triage list", async () => {
    const dir = await temp();
    const papers = join(dir, "papers");
    const trpg = join(dir, "trpg");
    await mkdir(papers, { recursive: true });
    await mkdir(trpg, { recursive: true });
    await writeFile(join(papers, "a.pdf"), pdfWithTitle("A"));
    await writeFile(join(papers, "b.pdf"), pdfWithTitle("B"));
    await writeFile(join(trpg, "m.pdf"), pdfWithTitle("M"));
    const scanned = await scanPdfs({ roots: [dir] });
    const { groups, groupCount, otherCount } = groupFilesByDir(scanned.files);
    expect(groupCount).toBe(2);
    expect(otherCount).toBe(0);
    expect(groups[0]).toMatchObject({ dir: papers, count: 2 });
    expect(groups[1]).toMatchObject({ dir: trpg, count: 1 });
  });

  it("skips unreadable directories and excluded names, keeping readable PDFs", async () => {
    const dir = await temp();
    const papers = join(dir, "papers");
    const hidden = join(dir, "node_modules", "pkg");
    const denied = join(dir, "secret");
    const nestedLib = join(dir, "Library", "Caches");
    const icloud = join(dir, "Library", "Mobile Documents", "com~apple~CloudDocs");
    await mkdir(papers, { recursive: true });
    await mkdir(hidden, { recursive: true });
    await mkdir(denied, { recursive: true });
    await mkdir(nestedLib, { recursive: true });
    await mkdir(icloud, { recursive: true });
    await writeFile(join(papers, "keep.pdf"), pdfWithTitle("Keep"));
    await writeFile(join(papers, "notes.txt"), "no");
    await writeFile(join(hidden, "dep.pdf"), pdfWithTitle("Dep"));
    await writeFile(join(denied, "hidden.pdf"), pdfWithTitle("Hidden"));
    await writeFile(join(nestedLib, "cache.pdf"), pdfWithTitle("Cache"));
    await writeFile(join(icloud, "cloud.pdf"), pdfWithTitle("Cloud"));
    await chmod(denied, 0o000);
    try {
      const scanned = await scanPdfs({ roots: [dir] });
      const names = scanned.files.map((file) => file.path.slice(dir.length));
      expect(names.some((name) => name.endsWith("keep.pdf"))).toBe(true);
      expect(names.some((name) => name.endsWith("cloud.pdf"))).toBe(true);
      expect(names.some((name) => name.endsWith("dep.pdf"))).toBe(false);
      expect(names.some((name) => name.endsWith("hidden.pdf"))).toBe(false);
      expect(names.some((name) => name.endsWith("cache.pdf"))).toBe(false);
      expect(scanned.skippedDenied).toBeGreaterThanOrEqual(1);
      expect(scanned.skippedExcluded).toBeGreaterThanOrEqual(1);
    } finally {
      await chmod(denied, 0o755);
    }
  });

  it("skips system roots and Library clutter", () => {
    expect(shouldSkipRoot("/usr/local")).toBe(true);
    expect(shouldSkipRoot("/var/folders/tmp")).toBe(false);
    expect(shouldSkipDir(join("/tmp", "node_modules"))).toBe(true);
    expect(shouldSkipDir(join("/tmp", "Library", "Caches"))).toBe(true);
    expect(shouldSkipDir(join("/tmp", "Library", "Mobile Documents"))).toBe(false);
  });

  it("skips oversized PDFs", async () => {
    const dir = await temp();
    await writeFile(join(dir, "tiny.pdf"), pdfWithTitle("Tiny"));
    await writeFile(join(dir, "huge.pdf"), Buffer.alloc(2000, 37));
    const scanned = await scanPdfs({ roots: [dir], maxFileBytes: 500 });
    expect(scanned.files).toHaveLength(1);
    expect(scanned.files[0].path.endsWith("tiny.pdf")).toBe(true);
    expect(scanned.skippedHuge).toBe(1);
  });
});

describe("incremental diff", () => {
  it("reports added, changed, and removed files", () => {
    const diff = diffManifest(
      [
        { path: "/a.pdf", size: 10, mtimeMs: 1 },
        { path: "/b.pdf", size: 20, mtimeMs: 2 },
      ],
      [
        { path: "/b.pdf", size: 21, mtimeMs: 2 },
        { path: "/c.pdf", size: 3, mtimeMs: 3 },
      ],
    );
    expect(diff.added.map((file) => file.path)).toEqual(["/c.pdf"]);
    expect(diff.changed.map((file) => file.path)).toEqual(["/b.pdf"]);
    expect(diff.removed.map((file) => file.path)).toEqual(["/a.pdf"]);
    expect(diff.unchanged).toBe(0);
  });
});

describe("init strategy", () => {
  it("creates on first project, attaches later, recreates when the pointer is dead", () => {
    expect(resolveInitAction({
      canonicalPath: undefined,
      currentProject: "/proj-a",
      canonicalLibraryExists: false,
    })).toBe("create");
    expect(resolveInitAction({
      canonicalPath: "/proj-a",
      currentProject: "/proj-a",
      canonicalLibraryExists: true,
    })).toBe("create");
    expect(resolveInitAction({
      canonicalPath: "/proj-a",
      currentProject: "/proj-b",
      canonicalLibraryExists: true,
    })).toBe("attach");
    expect(resolveInitAction({
      canonicalPath: "/proj-a",
      currentProject: "/proj-b",
      canonicalLibraryExists: false,
    })).toBe("recreate");
  });
});

describe("scaffold write set", () => {
  it("writes only AGENTS.md and library/ for a canonical project", async () => {
    const dir = await temp();
    const manifest = {
      version: 1 as const,
      roots: [dir],
      files: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    await writeCanonicalScaffold(dir, manifest);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(dir, "library", "index.md"))).toBe(true);
    expect(parseManifest(JSON.parse(await readFile(join(dir, "library", "manifest.json"), "utf8")))?.version).toBe(1);
    expect(allowedWritePath(dir, join(dir, "secret.txt"))).toBe(false);
  });

  it("pointer projects do not copy library/", async () => {
    const dir = await temp();
    await writePointerScaffold(dir, "/other/project");
    expect(await readFile(join(dir, "AGENTS.md"), "utf8")).toContain("/other/project");
    expect(existsSync(join(dir, "library"))).toBe(false);
  });
});

describe("pdf preview", () => {
  it("reads title and inflated Tj text", () => {
    const preview = extractPdfPreview(pdfWithTitle("Sample Title", "Abstract body"));
    expect(preview.encrypted).toBe(false);
    expect(preview.title).toBe("Sample Title");
    expect(preview.text).toContain("Abstract body");
  });

  it("fast preview reads metadata title and page text", async () => {
    const preview = await extractPdfPreviewFast(pdfWithTitle("Fast Title", "Neural networks beat baselines"));
    expect(preview.encrypted).toBe(false);
    expect(preview.title).toBe("Fast Title");
    expect(preview.text).toContain("Neural networks");
  });

  it("fast preview falls back to the regex parser on invalid bytes", async () => {
    const preview = await extractPdfPreviewFast(Buffer.from("definitely not a pdf"));
    expect(preview.encrypted).toBe(false);
    expect(preview.title).toBeUndefined();
  });

  it("marks scanned-PDF mojibake as garbled instead of returning garbage text", async () => {
    expect(isMostlyReadable("Attention Is All You Need 提出 Transformer 架构。")).toBe(true);
    expect(isMostlyReadable("Æ¯6¾Hi¥ú!»;:l=ÔCR P¾GK”=ïlRÄø{YrHòÆHçˆ×:W4F,`ø¦VâôR²ÓßË_”ÇÅÈâôR²æZ¸êµøò|¶\\XV¦¥*ü\"ÝßÛ#ÂN4¡¾â=ï5¤¦­¯¾¿×ÞÇÅÈâôR²¤¦­¯¾¿×ÞæZ¸êµøò|¶")).toBe(false);
    const bytes = pdfWithTitle("Mojibake", "Æ¯6¾¥ú»¦×Þ¿­¯Æ¾¥ú»¦×Þ¿­¯Æ¾¥ú»¦×Þ¿­¯");
    const preview = await extractPdfPreviewFast(bytes);
    expect(preview.text).toBe("");
    expect(preview.garbled).toBe(true);
  });
});

describe("paper_library tool", () => {
  it("write_canonical then attach via init_plan", async () => {
    const dir = await temp();
    const state = join(dir, "state");
    const first = join(dir, "first");
    const second = join(dir, "second");
    const papers = join(dir, "pdfs");
    await mkdir(first, { recursive: true });
    await mkdir(second, { recursive: true });
    await mkdir(papers, { recursive: true });
    await writeFile(join(papers, "one.pdf"), pdfWithTitle("One"));
    const env = { PAPER_LIBRARY_STATE_DIR: state, PIPIUI_PROJECT_ROOT: first, PI_CODING_AGENT_DIR: join(dir, "agent") };
    const created = await executePaperLibrary({ action: "write_canonical", roots: [papers] }, env);
    expect(created.isError).toBeUndefined();
    expect(existsSync(join(first, "library", "manifest.json"))).toBe(true);
    const skeleton = await readFile(join(first, "library", "index.md"), "utf8");
    expect(skeleton).toContain("待解析");
    expect(skeleton).toContain("one");
    const stored = await readCanonical(env);
    expect(stored?.path).toBe(first);

    const plan = await executePaperLibrary({ action: "init_plan", projectRoot: second }, env);
    const planData = JSON.parse(plan.content[0].text) as { plan: string };
    expect(planData.plan).toBe("attach");
    const pointer = await executePaperLibrary({ action: "write_pointer", projectRoot: second }, env);
    expect(pointer.isError).toBeUndefined();
    expect(existsSync(join(second, "library"))).toBe(false);
    expect(await readFile(join(second, "AGENTS.md"), "utf8")).toContain(first);
  });

  it("action=ini writes a skeleton and returns parse batches", async () => {
    const dir = await temp();
    const project = join(dir, "proj");
    const papers = join(dir, "pdfs");
    await mkdir(project, { recursive: true });
    await mkdir(papers, { recursive: true });
    await writeFile(join(papers, "alpha.pdf"), pdfWithTitle("Alpha"));
    await writeFile(join(papers, "beta.pdf"), pdfWithTitle("Beta"));
    const env = { PAPER_LIBRARY_STATE_DIR: join(dir, "state"), PIPIUI_PROJECT_ROOT: project };
    const blank = await executePaperLibrary({ projectRoot: project, roots: [papers] }, env);
    expect(blank.isError).toBeUndefined();
    const body = JSON.parse(blank.content[0].text) as {
      plan: string;
      next: string;
      count: number;
      parseBatches: string[][];
      remaining: number;
    };
    expect(body.plan).toBe("create");
    expect(body.next).toBe("dispatch_parse_batches");
    expect(body.count).toBe(2);
    expect(body.remaining).toBe(0);
    expect(body.parseBatches.flat().some((path) => path.endsWith("alpha.pdf"))).toBe(true);
    expect(await readFile(join(project, "library", "index.md"), "utf8")).toContain("待解析");
  });

  it("action=ini attach does not copy library into the topic project", async () => {
    const dir = await temp();
    const first = join(dir, "first");
    const second = join(dir, "second");
    const papers = join(dir, "pdfs");
    await mkdir(first, { recursive: true });
    await mkdir(second, { recursive: true });
    await mkdir(papers, { recursive: true });
    await writeFile(join(papers, "one.pdf"), pdfWithTitle("One"));
    const env = { PAPER_LIBRARY_STATE_DIR: join(dir, "state"), PIPIUI_PROJECT_ROOT: first };
    await executePaperLibrary({ action: "ini", roots: [papers] }, env);
    const attached = await executePaperLibrary({ action: "ini", projectRoot: second }, env);
    const body = JSON.parse(attached.content[0].text) as { plan: string; next: string };
    expect(body.plan).toBe("attach");
    expect(existsSync(join(second, "library"))).toBe(false);
    expect(await readFile(join(second, "AGENTS.md"), "utf8")).toContain(first);
  });

  it("check reports a newly added pdf", async () => {
    const dir = await temp();
    const state = join(dir, "state");
    const project = join(dir, "proj");
    const papers = join(dir, "pdfs");
    await mkdir(project, { recursive: true });
    await mkdir(papers, { recursive: true });
    await writeFile(join(papers, "one.pdf"), pdfWithTitle("One"));
    const env = { PAPER_LIBRARY_STATE_DIR: state, PIPIUI_PROJECT_ROOT: project };
    await executePaperLibrary({ action: "write_canonical", roots: [papers], projectRoot: project }, env);
    await writeFile(join(papers, "two.pdf"), pdfWithTitle("Two"));
    const checked = await executePaperLibrary({ action: "check", libraryRoot: project, roots: [papers] }, env);
    const body = JSON.parse(checked.content[0].text) as { added: { total: number; sample: string[] } };
    expect(body.added.total).toBe(1);
    expect(body.added.sample[0].endsWith("two.pdf")).toBe(true);
  });

  it("write_canonical stores exclude in the manifest", async () => {
    const dir = await temp();
    const project = join(dir, "proj");
    const papers = join(dir, "papers");
    const trpg = join(dir, "trpg");
    await mkdir(project, { recursive: true });
    await mkdir(papers, { recursive: true });
    await mkdir(trpg, { recursive: true });
    await writeFile(join(papers, "keep.pdf"), pdfWithTitle("Keep"));
    await writeFile(join(trpg, "skip.pdf"), pdfWithTitle("Skip"));
    const env = { PAPER_LIBRARY_STATE_DIR: join(dir, "state"), PIPIUI_PROJECT_ROOT: project };
    const created = await executePaperLibrary({ action: "write_canonical", roots: [dir], exclude: ["trpg"] }, env);
    expect(created.isError).toBeUndefined();
    const manifest = parseManifest(JSON.parse(await readFile(join(project, "library", "manifest.json"), "utf8")));
    expect(manifest?.excludes).toEqual(["trpg"]);
    expect(manifest?.files.map((file) => file.path)).toHaveLength(1);
  });

  it("extract returns previews, not an ini plan", async () => {
    const dir = await temp();
    const pdf = join(dir, "one.pdf");
    await writeFile(pdf, pdfWithTitle("Hello Title", "body"));
    const env = { PAPER_LIBRARY_STATE_DIR: join(dir, "state"), PIPIUI_PROJECT_ROOT: dir };
    const extracted = await executePaperLibrary({ action: "extract", paths: [pdf] }, env);
    const body = JSON.parse(extracted.content[0].text) as { previews?: Array<{ title?: string }>; plan?: string };
    expect(body.plan).toBeUndefined();
    expect(body.previews?.[0]?.title).toBe("Hello Title");
  });

  it("registerTool execute uses Pi (toolCallId, params) arity", async () => {
    const dir = await temp();
    const pdf = join(dir, "one.pdf");
    await writeFile(pdf, pdfWithTitle("Hello Title", "body"));
    type Execute = (id: string, params: unknown) => Promise<{ content: Array<{ text: string }> }>;
    const tools = new Map<string, Execute>();
    paperLibrary({
      registerTool: (tool: { name: string; execute?: Execute }) => {
        tools.set(tool.name, tool.execute as Execute);
      },
      registerCommand: () => undefined,
      on: () => undefined,
    } as never);
    expect([...tools.keys()]).toEqual(["paper_library", "paper_search", "paper_read", "paper_cite_check", "paper_cite_meta"]);
    const execute = tools.get("paper_library");
    const prevRoot = process.env.PIPIUI_PROJECT_ROOT;
    const prevState = process.env.PAPER_LIBRARY_STATE_DIR;
    process.env.PIPIUI_PROJECT_ROOT = dir;
    process.env.PAPER_LIBRARY_STATE_DIR = join(dir, "state");
    try {
      const out = await execute!("call_1", { action: "extract", paths: [pdf] });
      const body = JSON.parse(out.content[0].text) as { previews?: unknown[]; plan?: string };
      expect(body.plan).toBeUndefined();
      expect(Array.isArray(body.previews)).toBe(true);
    } finally {
      if (prevRoot === undefined) delete process.env.PIPIUI_PROJECT_ROOT;
      else process.env.PIPIUI_PROJECT_ROOT = prevRoot;
      if (prevState === undefined) delete process.env.PAPER_LIBRARY_STATE_DIR;
      else process.env.PAPER_LIBRARY_STATE_DIR = prevState;
    }
  });
});

const CLASSIFIED_INDEX = `# 文献索引

分类法：

- 机器学习
- NLP

## 机器学习

- **Attention Is All You Need**
  - 路径：\`/abs/attention.pdf\`
  - 简介：提出 Transformer。

## NLP

- **BERT** — 双向编码器。
  - 路径：\`/abs/bert.pdf\`

- **GPT-2**
  - 路径：\`/abs/gpt2.pdf\`
`;

describe("parseIndex", () => {
  it("parses skeletonIndex pending entries", () => {
    const catalog = parseIndex(
      skeletonIndex({
        version: 1,
        roots: ["/papers"],
        files: [
          { path: "/abs/attention.pdf", size: 10, mtimeMs: 1 },
          { path: "/abs/bert.pdf", size: 11, mtimeMs: 2 },
        ],
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    expect(catalog.categories).toEqual(["待解析"]);
    expect(catalog.papers).toEqual([
      { title: "attention", summary: "", category: "待解析", path: "/abs/attention.pdf", pending: true },
      { title: "bert", summary: "", category: "待解析", path: "/abs/bert.pdf", pending: true },
    ]);
  });

  it("parses classified taxonomy, nested fields, and em-dash one-liners", () => {
    const catalog = parseIndex(CLASSIFIED_INDEX);
    expect(catalog.categories).toEqual(["机器学习", "NLP"]);
    expect(catalog.papers).toEqual([
      {
        title: "Attention Is All You Need",
        summary: "提出 Transformer。",
        category: "机器学习",
        path: "/abs/attention.pdf",
        pending: false,
      },
      {
        title: "BERT",
        summary: "双向编码器。",
        category: "NLP",
        path: "/abs/bert.pdf",
        pending: false,
      },
      {
        title: "GPT-2",
        summary: "",
        category: "NLP",
        path: "/abs/gpt2.pdf",
        pending: false,
      },
    ]);
  });

  it("treats missing 简介 as empty summary", () => {
    const catalog = parseIndex(`## 系统

- **Solo**
  - 路径：\`/solo.pdf\`
`);
    expect(catalog.papers).toHaveLength(1);
    expect(catalog.papers[0]?.summary).toBe("");
    expect(catalog.papers[0]?.path).toBe("/solo.pdf");
    expect(catalog.categories).toEqual(["系统"]);
  });

  it("yields arrays for garbage markdown", () => {
    const catalog = parseIndex("not an index\n* italic\nrandom");
    expect(Array.isArray(catalog.categories)).toBe(true);
    expect(Array.isArray(catalog.papers)).toBe(true);
    expect(catalog.papers).toEqual([]);
    expect(catalog.categories).toEqual([]);
  });

  it("skips taxonomy placeholders", () => {
    const catalog = parseIndex(`# 文献索引

分类法（待解析完成后归纳）：

- （解析中）

## 待解析

（尚未收录）
`);
    expect(catalog.categories).toEqual(["待解析"]);
    expect(catalog.papers).toEqual([]);
  });
});

const CLASSIFIED_CATALOG = {
  version: 1,
  categories: [
    {
      name: "机器学习",
      papers: [
        { path: "/abs/attention.pdf", title: "Attention Is All You Need", type: "论文", tags: ["transformer"], oneLiner: "提出 Transformer 架构。" },
      ],
    },
    {
      name: "待OCR",
      papers: [
        { path: "/abs/scan.pdf", title: "扫描版合集", type: "待OCR", tags: [], oneLiner: "扫描版文本层不可读", garbled: true },
      ],
    },
  ],
};

describe("write_index catalog", () => {
  it("writes catalog.json as canonical and generates index.md", async () => {
    const dir = await temp();
    const project = join(dir, "proj");
    await mkdir(project, { recursive: true });
    const env = { PAPER_LIBRARY_STATE_DIR: join(dir, "state"), PIPIUI_PROJECT_ROOT: project };
    const out = await executePaperLibrary({ action: "write_index", catalog: CLASSIFIED_CATALOG }, env);
    expect(out.isError).toBeUndefined();
    const body = JSON.parse(out.content[0].text) as { catalog: string; index: string; count: number };
    expect(body.count).toBe(2);
    const stored = JSON.parse(await readFile(join(project, "library", "catalog.json"), "utf8"));
    expect(stored.version).toBe(1);
    expect(stored.categories[0].papers[0].path).toBe("/abs/attention.pdf");
    const markdown = await readFile(join(project, "library", "index.md"), "utf8");
    expect(markdown).toContain("## 机器学习");
    expect(markdown).toContain("- **Attention Is All You Need**");
    expect(markdown).toContain("  - 简介：提出 Transformer 架构。");
    expect(markdown).toContain("## 待OCR");
  });

  it("rejects malformed catalog with a repair hint", async () => {
    const dir = await temp();
    const project = join(dir, "proj");
    await mkdir(project, { recursive: true });
    const env = { PAPER_LIBRARY_STATE_DIR: join(dir, "state"), PIPIUI_PROJECT_ROOT: project };
    const out = await executePaperLibrary({ action: "write_index", catalog: { version: 1, categories: [{ name: "x", papers: [{ title: "no path" }] }] } }, env);
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain("不合法");
  });

  it("list_catalog prefers catalog.json over legacy index.md", async () => {
    const dir = await temp();
    const state = join(dir, "state");
    const canonical = join(dir, "lib");
    await mkdir(join(canonical, "library"), { recursive: true });
    await writeFile(join(canonical, "library", "index.md"), CLASSIFIED_INDEX);
    await writeFile(join(canonical, "library", "catalog.json"), JSON.stringify(CLASSIFIED_CATALOG));
    const env = { PAPER_LIBRARY_STATE_DIR: state, PIPIUI_PROJECT_ROOT: canonical };
    await executePaperLibrary({ action: "set_canonical", path: canonical }, env);
    const listed = await executePaperLibrary({ action: "list_catalog" }, env);
    const body = JSON.parse(listed.content[0].text) as { papers: Array<{ title: string; summary: string }> };
    expect(body.papers.map((paper) => paper.title)).toEqual(["Attention Is All You Need", "扫描版合集"]);
    expect(body.papers[0]!.summary).toBe("提出 Transformer 架构。");
  });

  it("generated markdown round-trips through parseIndex", async () => {
    const file = parseCatalogFile(CLASSIFIED_CATALOG)!;
    const round = parseIndex(catalogToMarkdown(file));
    expect(round.categories).toEqual(["机器学习", "待OCR"]);
    expect(round.papers.map((paper) => paper.title)).toEqual(["Attention Is All You Need", "扫描版合集"]);
    expect(round.papers[1]!.category).toBe("待OCR");
  });

  it("dedupes same-paper copies at write_index and keeps altPaths", async () => {
    const dir = await temp();
    const project = join(dir, "proj");
    const lib = join(project, "library");
    await mkdir(lib, { recursive: true });
    await writeFile(join(project, "library", "manifest.json"), JSON.stringify({
      version: 1,
      roots: [dir],
      updatedAt: "2026-01-01T00:00:00.000Z",
      files: [
        { path: "/a/same.pdf", size: 100, mtimeMs: 1 },
        { path: "/b/same.pdf", size: 100, mtimeMs: 2 },
        { path: "/c/other-version.pdf", size: 222, mtimeMs: 3 },
        { path: "/d/same-title-unknown-size.pdf", size: 0, mtimeMs: 4 },
      ],
    }));
    const env = { PAPER_LIBRARY_STATE_DIR: join(dir, "state"), PIPIUI_PROJECT_ROOT: project };
    const out = await executePaperLibrary({
      action: "write_index",
      catalog: {
        version: 1,
        categories: [
          { name: "分类A", papers: [
            { path: "/a/same.pdf", title: "Same Paper", type: "文献", tags: [], oneLiner: "一" },
            { path: "/b/same.pdf", title: "Same Paper", type: "文献", tags: [], oneLiner: "一" },
          ] },
          { name: "分类B", papers: [
            { path: "/c/other-version.pdf", title: "Same Paper", type: "文献", tags: [], oneLiner: "版本" },
            { path: "/d/same-title-unknown-size.pdf", title: "Same  Paper!", type: "文献", tags: [], oneLiner: "未知" },
          ] },
        ],
      },
    }, env);
    const body = JSON.parse(out.content[0].text) as { count: number; droppedDuplicates: number };
    expect(body.count).toBe(1);
    expect(body.droppedDuplicates).toBe(3);
    const stored = JSON.parse(await readFile(join(project, "library", "catalog.json"), "utf8"));
    const merged = stored.categories[0].papers[0];
    expect(merged.path).toBe("/a/same.pdf");
    expect(merged.altPaths).toEqual([
      "/b/same.pdf",
      "/c/other-version.pdf",
      "/d/same-title-unknown-size.pdf",
    ]);
    expect(stored.categories[1].papers).toEqual([]);
  });

  it("ini skips byte-identical copies before dispatching the swarm", async () => {
    const dir = await temp();
    const project = join(dir, "proj");
    const papers = join(dir, "pdfs");
    await mkdir(project, { recursive: true });
    await mkdir(papers, { recursive: true });
    const bytes = pdfWithTitle("Alpha");
    await writeFile(join(papers, "alpha.pdf"), bytes);
    await writeFile(join(papers, "alpha copy.pdf"), bytes);
    await writeFile(join(papers, "beta.pdf"), pdfWithTitle("Beta", "a distinctly longer body so the byte size differs from Alpha"));
    const env = { PAPER_LIBRARY_STATE_DIR: join(dir, "state"), PIPIUI_PROJECT_ROOT: project };
    const out = await executePaperLibrary({ action: "ini", roots: [papers] }, env);
    const body = JSON.parse(out.content[0].text) as {
      count: number;
      duplicateCopiesSkipped: number;
      parseBatches: string[][];
    };
    expect(body.count).toBe(3);
    expect(body.duplicateCopiesSkipped).toBe(1);
    const queued = body.parseBatches.flat();
    expect(queued).toHaveLength(2);
    expect(queued.some((p) => p.endsWith("beta.pdf"))).toBe(true);
    expect(queued.filter((p) => p.includes("alpha")).length).toBe(1);
    const stored = JSON.parse(await readFile(join(project, "library", "catalog.json"), "utf8"));
    const alphaEntry = stored.categories[0].papers.find((p: { altPaths?: string[] }) => Array.isArray(p.altPaths) && p.altPaths.length > 0);
    expect(alphaEntry).toBeTruthy();
    expect(alphaEntry.path.endsWith(".pdf")).toBe(true);
    expect(alphaEntry.altPaths[0].includes("alpha")).toBe(true);
  });

  it("write_index accepts a v2 tree and generates nested markdown", async () => {
    const dir = await temp();
    const project = join(dir, "proj");
    await mkdir(project, { recursive: true });
    const env = { PAPER_LIBRARY_STATE_DIR: join(dir, "state"), PIPIUI_PROJECT_ROOT: project };
    const tree = {
      version: 2,
      categories: [
        {
          name: "冷冻电镜",
          papers: [],
          children: [
            {
              name: "综述",
              papers: [{ path: "/abs/attention.pdf", title: "Attention", type: "综述", tags: ["cryo"], oneLiner: "综述。" }],
            },
            { name: "方法", papers: [{ path: "/abs/attention-copy.pdf", title: "Attention", type: "综述", tags: [], oneLiner: "副本。" }] },
          ],
        },
        { name: "待OCR", papers: [{ path: "/abs/scan.pdf", title: "扫描", type: "待OCR", tags: [], oneLiner: "扫描版", garbled: true }] },
      ],
    };
    const out = await executePaperLibrary({ action: "write_index", catalog: tree }, env);
    expect(out.isError).toBeUndefined();
    const body = JSON.parse(out.content[0].text) as { count: number; droppedDuplicates: number };
    expect(body.count).toBe(2);
    expect(body.droppedDuplicates).toBe(1);
    const stored = JSON.parse(await readFile(join(project, "library", "catalog.json"), "utf8"));
    expect(stored.version).toBe(2);
    expect(stored.categories[0].children[0].name).toBe("综述");
    expect(stored.categories[0].children[0].papers[0].altPaths).toEqual(["/abs/attention-copy.pdf"]);
    const markdown = await readFile(join(project, "library", "index.md"), "utf8");
    expect(markdown).toContain("## 冷冻电镜");
    expect(markdown).toContain("### 综述");
    expect(markdown).toContain("## 待OCR");
    const round = parseIndex(markdown);
    expect(round.papers[0]!.category).toBe("冷冻电镜 / 综述");
  });

  it("parseCatalogFile accepts legacy v1 flat catalogs", () => {
    const v1 = {
      version: 1,
      categories: [{ name: "机器学习", papers: [{ path: "/a.pdf", title: "A", type: "论文", tags: [], oneLiner: "x" }] }],
    };
    const parsed = parseCatalogFile(v1);
    expect(parsed).toBeTruthy();
    expect(parsed!.categories[0].papers[0].title).toBe("A");
    expect(parsed!.categories[0].children).toBeUndefined();
  });

  it("write_canonical lands a catalog.json skeleton", async () => {
    const dir = await temp();
    const project = join(dir, "proj");
    const papers = join(dir, "pdfs");
    await mkdir(project, { recursive: true });
    await mkdir(papers, { recursive: true });
    await writeFile(join(papers, "alpha.pdf"), pdfWithTitle("Alpha"));
    const env = { PAPER_LIBRARY_STATE_DIR: join(dir, "state"), PIPIUI_PROJECT_ROOT: project };
    await executePaperLibrary({ action: "write_canonical", roots: [papers] }, env);
    const stored = JSON.parse(await readFile(join(project, "library", "catalog.json"), "utf8"));
    expect(stored.categories[0].name).toBe("待解析");
    expect(stored.categories[0].papers[0].title).toBe("alpha");
  });
});

describe("list_catalog", () => {
  it("reads the canonical library index", async () => {
    const dir = await temp();
    const state = join(dir, "state");
    const canonical = join(dir, "lib");
    const topic = join(dir, "topic");
    await mkdir(join(canonical, "library"), { recursive: true });
    await mkdir(topic, { recursive: true });
    await writeFile(join(canonical, "library", "index.md"), CLASSIFIED_INDEX);
    const env = { PAPER_LIBRARY_STATE_DIR: state, PIPIUI_PROJECT_ROOT: topic };
    await executePaperLibrary({ action: "set_canonical", path: canonical }, env);
    const listed = await executePaperLibrary({ action: "list_catalog" }, env);
    expect(listed.isError).toBeUndefined();
    const body = JSON.parse(listed.content[0].text) as {
      libraryRoot: string;
      categories: string[];
      papers: Array<{ title: string; path: string }>;
    };
    expect(body.libraryRoot).toBe(canonical);
    expect(body.categories).toEqual(["机器学习", "NLP"]);
    expect(body.papers.map((paper) => paper.title)).toEqual([
      "Attention Is All You Need",
      "BERT",
      "GPT-2",
    ]);
    expect(listed.details).toMatchObject({ libraryRoot: canonical });
  });

  it("returns empty papers when index.md is missing", async () => {
    const dir = await temp();
    const state = join(dir, "state");
    const canonical = join(dir, "lib");
    await mkdir(canonical, { recursive: true });
    const env = { PAPER_LIBRARY_STATE_DIR: state, PIPIUI_PROJECT_ROOT: canonical };
    await executePaperLibrary({ action: "set_canonical", path: canonical }, env);
    const listed = await executePaperLibrary({ action: "list_catalog" }, env);
    expect(listed.isError).toBeUndefined();
    const body = JSON.parse(listed.content[0].text) as {
      libraryRoot: string;
      categories: string[];
      papers: unknown[];
    };
    expect(body.libraryRoot).toBe(canonical);
    expect(body.papers).toEqual([]);
    expect(body.categories).toEqual([]);
  });

  it("invoke handler returns { ok, data } envelope", async () => {
    const dir = await temp();
    const state = join(dir, "state");
    const canonical = join(dir, "lib");
    await mkdir(join(canonical, "library"), { recursive: true });
    await writeFile(join(canonical, "library", "index.md"), CLASSIFIED_INDEX);
    const env = { PAPER_LIBRARY_STATE_DIR: state, PIPIUI_PROJECT_ROOT: canonical };
    await executePaperLibrary({ action: "set_canonical", path: canonical }, env);
    const invoked = await handleListCatalogCommand({}, env);
    expect(invoked).toMatchObject({
      ok: true,
      data: { libraryRoot: canonical, categories: ["机器学习", "NLP"] },
    });
  });

  it("answers the catalog panel over the kernel invoke channel, not a pi command", () => {
    // pi types a command handler as returning void, so a command can never carry
    // the catalog back to the panel. The handler has to land in the registry the
    // kernel's ext-invoke mount polls.
    const registered: Array<[string, string]> = [];
    const host: Record<symbol, unknown> = {};
    host[Symbol.for("pipiui.ext-invoke.registry")] = {
      version: 1,
      register: (extensionId: string, method: string) => {
        registered.push([extensionId, method]);
        return () => undefined;
      },
    };
    const previous = (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("pipiui.ext-invoke.registry")];
    (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("pipiui.ext-invoke.registry")] = host[Symbol.for("pipiui.ext-invoke.registry")];
    try {
      paperLibrary({ registerTool: () => {}, registerCommand: () => {}, on: () => undefined } as never);
    } finally {
      (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("pipiui.ext-invoke.registry")] = previous;
    }
    expect(registered).toContainEqual(["paper-library", "list_catalog"]);
  });
});

describe("a home-wide scan is bounded", () => {
  it("stops at its budget and reports how far it got", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pipi-scan-budget-"));
    try {
      await mkdir(join(dir, "a", "b", "c"), { recursive: true });
      await writeFile(join(dir, "a", "one.pdf"), "%PDF");
      await writeFile(join(dir, "a", "b", "two.pdf"), "%PDF");
      let clock = 0;
      // Every directory costs 100ms of the 150ms budget: the walk cannot finish.
      const scanned = await scanPdfs({ roots: [dir], budgetMs: 150, now: () => (clock += 100) });
      expect(scanned.timedOut).toBe(true);
      expect(scanned.scannedDirs).toBeGreaterThan(0);

      const whole = await scanPdfs({ roots: [dir], budgetMs: 0 });
      expect(whole.timedOut).toBeUndefined();
      expect(whole.files.map((f) => basename(f.path)).sort()).toEqual(["one.pdf", "two.pdf"]);
      expect(whole.scannedDirs).toBeGreaterThanOrEqual(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("never reports deletions from a truncated walk, and leaves the manifest alone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pipi-scan-partial-"));
    try {
      await writeFile(join(dir, "kept.pdf"), "%PDF");
      const manifest = {
        version: 1 as const,
        roots: [dir],
        files: [
          { path: join(dir, "kept.pdf"), size: 4, mtimeMs: 1 },
          { path: join(dir, "gone.pdf"), size: 4, mtimeMs: 1 },
        ],
        updatedAt: "",
      };
      let clock = 0;
      // The clock advances 100ms per read, so a 50ms budget is spent before the first directory.
      const partial = await checkAgainstManifest(manifest, [], [], { budgetMs: 50, now: () => (clock += 100) });
      expect(partial.partial).toBe(true);
      expect(partial.diff.removed).toEqual([]);
      // The stored manifest is handed back unchanged, so nothing downstream rewrites it.
      expect(partial.current.files).toHaveLength(2);

      const full = await checkAgainstManifest(manifest, [], [], { budgetMs: 0 });
      expect(full.partial).toBe(false);
      expect(full.diff.removed.map((f) => basename(f.path))).toEqual(["gone.pdf"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps the user's own manuscripts out of the library", () => {
    expect(isExcludedPath("/home/paper/manuscripts/draft/main.pdf")).toBe(true);
    expect(isExcludedPath("/home/paper/pdfs/real-paper.pdf")).toBe(false);
  });
});
