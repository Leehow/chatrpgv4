import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import { validateExtensionManifest } from "../src/extension-manifest.js";
import firecrawlPdf, {
  DEFAULT_TIMEOUT_MS,
  EXTENSION_SECRET_ENV,
  FIRECRAWL_PDF_TOOL,
  MAX_PAGES,
  MAX_PDF_BYTES,
  MAX_PDF_MB_LABEL,
  MAX_TIMEOUT_MS,
  MIN_PAGES,
  OCR_MODE_NEEDS_KEY,
  OCR_SKIPPED_NOTE,
  PADDLEOCR_TOKEN_FIELD,
  PDF_EXTENSION_ID,
  SETTINGS_SECRET_KEY,
  downloadPdfBytes,
  executeFirecrawlPdf,
  loadPaddleocrToken,
  normalizeMaxPages,
  normalizeTimeoutMs,
  readLocalPdfBytes,
  resolvePaddleocrToken,
  resolvePdfSource,
  sanitizePublicError,
} from "../../../packs/pdf-extension/agent/index.ts";
import {
  inspectPdfWithOfficial,
  ownedPdfInspectorNodeModules,
} from "../../../packs/pdf-extension/agent/pdf-inspector-local.ts";
import {
  PADDLEOCR_MCP_ARGS,
  PADDLEOCR_MCP_COMMAND,
  PADDLEOCR_VL_TOOL,
  callPaddleocrVl,
  extractMcpText,
  paddleocrMcpEnv,
} from "../../../packs/pdf-extension/agent/paddleocr-mcp-client.ts";

const packsSource = new URL("../../../packs", import.meta.url).pathname;
const packageRoot = join(packsSource, "pdf-extension");

function buildMinimalPdf(text = "Hello Inspector") {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`,
    `4 0 obj\n<< /Length ${text.length + 20} >>\nstream\nBT /F1 24 Tf 100 700 Td (${text}) Tj ET\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body));
    body += object;
  }
  const xrefStart = Buffer.byteLength(body);
  let xref = "xref\n0 6\n0000000000 65535 f \n";
  for (let index = 1; index <= 5; index += 1) xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  body += `${xref}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body);
}
const TEXT_PDF = buildMinimalPdf();
const STUB_PDF = Buffer.from("%PDF-1.4\n%%EOF\n");

describe("pdf-extension pack contract", () => {
  it("validates the manifest and is required by paper-workbench", async () => {
    const pdf = JSON.parse(await readFile(join(packsSource, "pdf-extension", "pipiui-extension.json"), "utf8"));
    const form = JSON.parse(await readFile(join(packsSource, "paper-workbench", "pipiui-extension.json"), "utf8"));
    const validated = validateExtensionManifest(pdf);
    expect(validated.ok).toBe(true);
    const requiredIds = form.dependencies.required.map((item: { id: string }) => item.id);
    expect(requiredIds).toContain("pdf-extension");
    expect(pdf.id).toBe("pdf-extension");
    expect(pdf.name).toBe("PipiUI PDF / OCR");
    expect(pdf.agent.extension).toBe("agent/index.ts");
    expect(pdf.agent.tools).toEqual(["pipiui_firecrawl_pdf"]);
    expect(pdf.runtimeAssets).toBeUndefined();
    expect(pdf.defaultEnabled).toBeUndefined();

    const settings = pdf.app.settings;
    expect(settings.scope).toBe("project");
    expect(settings.settingsVersion).toBeGreaterThanOrEqual(1);
    expect(Object.keys(settings.schema?.properties ?? {})).toEqual(["ext.pdf-extension.aistudioAccessToken"]);
    expect(settings.schema?.properties?.["ext.pdf-extension.aistudioAccessToken"]).toMatchObject({
      type: "string",
      format: "secret",
    });
  });

  it("declares the vendored Firecrawl inspector as its update component, in lockstep with the vendor pin", () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, "pipiui-extension.json"), "utf8")) as {
      updateComponents?: Array<{ name: string; version: string } & Record<string, unknown>>;
    };
    expect(manifest.updateComponents).toEqual([
      {
        id: "firecrawl-pdf-inspector",
        name: "@firecrawl/pdf-inspector",
        version: "1.17.0",
        source: { type: "npm", packageName: "@firecrawl/pdf-inspector" },
        upstream: "https://github.com/firecrawl/pdf-inspector",
        license: "MIT",
      },
    ]);
    const declared = manifest.updateComponents?.find((component) => component.name === "@firecrawl/pdf-inspector");
    expect(declared).toBeDefined();
    const vendorManifest = JSON.parse(readFileSync(join(packageRoot, "vendor/pdf-inspector/package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(vendorManifest.dependencies["@firecrawl/pdf-inspector"]).toBe(declared!.version);
    expect(vendorManifest.dependencies["@firecrawl/pdf-inspector-wasm"]).toBe(declared!.version);
    const lock = JSON.parse(readFileSync(join(packageRoot, "vendor/pdf-inspector/package-lock.json"), "utf8")) as {
      packages: Record<string, { version: string }>;
    };
    const pinnedVersions = Object.entries(lock.packages)
      .filter(([key]) => key.includes("node_modules/@firecrawl/pdf-inspector"))
      .map(([, entry]) => entry.version);
    expect(pinnedVersions.length).toBeGreaterThan(0);
    for (const version of pinnedVersions) expect(version).toBe(declared!.version);
    expect(JSON.parse(readFileSync(join(packageRoot, "vendor/pdf-inspector/node_modules/@firecrawl/pdf-inspector/package.json"), "utf8")).version).toBe("1.17.0");
    expect(existsSync(join(packageRoot, "vendor/pdf-inspector/node_modules/@firecrawl/pdf-inspector-darwin-arm64"))).toBe(true);
    expect(readFileSync(join(packageRoot, "agent/pdf-inspector-local.ts"), "utf8")).not.toContain("PDF_INSPECTOR_VERSION");
  });

  it("resolves the vendored inspector next to the agent half, not dist/", () => {
    const nm = ownedPdfInspectorNodeModules();
    expect(nm.replaceAll("\\", "/")).toMatch(/packs\/pdf-extension\/vendor\/pdf-inspector\/node_modules$/);
  });
});

describe("parameter and size bounds", () => {
  it("clamps timeout into [1s, 300s] and defaults invalid input to 30s", () => {
    expect(normalizeTimeoutMs(undefined)).toBe(DEFAULT_TIMEOUT_MS);
    expect(normalizeTimeoutMs(Number.NaN)).toBe(DEFAULT_TIMEOUT_MS);
    expect(normalizeTimeoutMs(Number.POSITIVE_INFINITY)).toBe(DEFAULT_TIMEOUT_MS);
    expect(normalizeTimeoutMs(0)).toBe(1000);
    expect(normalizeTimeoutMs(-99)).toBe(1000);
    expect(normalizeTimeoutMs(MAX_TIMEOUT_MS + 1)).toBe(MAX_TIMEOUT_MS);
    expect(normalizeTimeoutMs(45_678)).toBe(45_678);
  });

  it("accepts whole maxPages within [1, 10000] and rejects junk and out-of-range values", () => {
    expect(normalizeMaxPages(undefined)).toBeUndefined();
    expect(normalizeMaxPages(null)).toBeUndefined();
    expect(normalizeMaxPages(2.9)).toBe(2);
    expect(normalizeMaxPages(MAX_PAGES)).toBe(MAX_PAGES);
    for (const bad of ["5", 0, -1, MAX_PAGES + 1]) {
      const verdict = normalizeMaxPages(bad);
      expect(verdict && typeof verdict === "object" && "error" in verdict, `${String(bad)} must error`).toBe(true);
      if (typeof verdict === "object" && verdict && "error" in verdict) {
        expect(verdict.error).toContain(`maxPages 必须是 ${MIN_PAGES} 到 ${MAX_PAGES} 的整数`);
      }
    }
  });

  it("rejects an oversized local PDF before reading it and refuses non-file paths", async () => {
    const huge = (async () => ({ isFile: () => true, size: MAX_PDF_BYTES + 1 })) as never;
    expect(await readLocalPdfBytes("/somewhere/big.pdf", { stat: huge }))
      .toMatchObject({ ok: false, error: expect.stringContaining(`${MAX_PDF_MB_LABEL} 上限`) });

    const directory = (async () => ({ isFile: () => false, size: 12 })) as never;
    expect(await readLocalPdfBytes("/somewhere/dir", { stat: directory }))
      .toMatchObject({ ok: false, error: expect.stringContaining("普通 PDF 文件") });
  });

  it("rejects a local growth race across successive bounded reads and closes the handle", async () => {
    const limit = 32;
    const requested: number[] = [];
    const reads: number[] = [];
    let closed = 0;
    const grown = Buffer.alloc(limit + 16, 0x61);
    const small = (async () => ({ isFile: () => true, size: 20 })) as never;
    const handle = {
      read: async (buf: Buffer, offset = 0, length = buf.length, position = 0) => {
        requested.push(length);
        const n = Math.min(length, buf.length - offset, grown.length - position, 16);
        const bytesRead = Math.max(0, n);
        if (bytesRead > 0) grown.copy(buf, offset, position, position + bytesRead);
        reads.push(bytesRead);
        return { bytesRead };
      },
      close: async () => {
        closed += 1;
      },
    };
    const result = await readLocalPdfBytes("/somewhere/grew.pdf", {
      stat: small,
      open: (async () => handle) as never,
      maxBytes: limit,
    });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining(`${MAX_PDF_MB_LABEL} 上限`) });
    if (!result.ok) expect(result.error).toMatch(/读取后 \d+ 字节/);
    expect(reads.length).toBeGreaterThanOrEqual(2);
    expect(reads.every((n, i) => n <= requested[i]!)).toBe(true);
    expect(reads.reduce((a, b) => a + b, 0)).toBeGreaterThan(limit);
    expect(requested.every((n) => n > 0 && n <= limit + 1)).toBe(true);
    expect(closed).toBe(1);
  });
});

let roots: string[] = [];
afterEach(async () => {
  for (const dir of roots.splice(0)) {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }).catch(() => undefined);
  }
});

async function scratch(prefix = "pdf-engine-") {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

/** Fake owned-dependency tree: a controllable native binding plus optional real wasm. */
async function makeFakeInspectorNodeModules(native: "succeed" | "throw", withWasm: boolean) {
  const nm = join(await scratch(), "node_modules");
  const scoped = join(nm, "@firecrawl");
  await mkdir(join(scoped, "pdf-inspector"), { recursive: true });
  await mkdir(join(scoped, "pdf-inspector-darwin-arm64"), { recursive: true });
  await writeFile(
    join(scoped, "pdf-inspector", "package.json"),
    JSON.stringify({ name: "@firecrawl/pdf-inspector", version: "1.17.0", main: "index.js" }),
  );
  const body =
    native === "throw"
      ? "module.exports = { processPdf() { throw new Error('dlopen: symbol not found'); } };"
      : "module.exports = { processPdf() { return { markdown: 'native extract', pdfType: 'TextBased', pageCount: 2, pagesNeedingOcr: [] }; } };";
  await writeFile(join(scoped, "pdf-inspector", "index.js"), body);
  if (withWasm) {
    const realWasm = new URL("../../../packs/pdf-extension/vendor/pdf-inspector/node_modules/@firecrawl/pdf-inspector-wasm/", import.meta.url)
      .pathname;
    await symlink(realWasm, join(scoped, "pdf-inspector-wasm"), "dir");
  }
  return nm;
}

describe("native/wasm engine selection", () => {
  it("uses the native binding when it loads and answers", async () => {
    const nm = await makeFakeInspectorNodeModules("succeed", false);
    const result = await inspectPdfWithOfficial(new Uint8Array(TEXT_PDF), { nodeModules: nm });
    expect(result.engine).toBe("native");
    expect(result.markdown).toBe("native extract");
    expect(result.pageCount).toBe(2);
  });

  it("falls back to the real wasm engine when the native binding fails to load", async () => {
    const nm = await makeFakeInspectorNodeModules("throw", true);
    const result = await inspectPdfWithOfficial(new Uint8Array(TEXT_PDF), { nodeModules: nm });
    expect(result.engine).toBe("wasm");
    expect(typeof result.markdown).toBe("string");
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
  });

  it("fails loud instead of pretending when neither engine is usable", async () => {
    const emptyNm = join(await scratch(), "empty-node_modules");
    await mkdir(emptyNm, { recursive: true });
    const bytes = new Uint8Array(TEXT_PDF);
    await expect(inspectPdfWithOfficial(bytes, { nodeModules: emptyNm, platform: "win32", arch: "x64" }))
      .rejects.toThrow(/no usable engine/);
    await expect(inspectPdfWithOfficial(bytes, { nodeModules: emptyNm, platform: "sunos", arch: "x64" }))
      .rejects.toThrow(/no usable engine/);
    const realPdf = join(await scratch("pdf-engine-loud-"), "scan.pdf");
    await writeFile(realPdf, TEXT_PDF);
    const surfaced = await executeFirecrawlPdf(
      { source: realPdf },
      {
        apiKey: null,
        inspect: () => Promise.reject(new Error("pdf-inspector has no usable engine")),
      },
    );
    expect(surfaced.isError).toBe(true);
    expect(surfaced.content[0].text).toContain("本地 PDF 提取失败");
    expect(surfaced.content[0].text).toContain("no usable engine");
  });
});

describe("temporary remote-file cleanup during OCR", () => {
  it("removes the downloaded PDF's scratch file after OCR succeeds and after it fails", async () => {
    const fetchImpl = (async () =>
      new Response(TEXT_PDF, { status: 200, headers: { "content-type": "application/pdf" } })) as never;
    const scanned = (async () => ({
      engine: "native",
      pdfType: "Scanned",
      markdown: "",
      pageCount: 1,
      pagesNeedingOcr: [0],
    })) as never;

    const failurePaths: string[] = [];
    const failed = await executeFirecrawlPdf(
      { source: "https://example.com/report.pdf", mode: "auto" },
      {
        apiKey: "ast-cleanup-token",
        fetchImpl,
        inspect: scanned,
        ocrFn: async (filePath) => {
          failurePaths.push(filePath);
          return { ok: false as const, error: `quota exhausted for ${filePath}` };
        },
      },
    );
    expect(failed.isError).toBe(true);
    expect(failurePaths).toHaveLength(1);
    expect(dirname(failurePaths[0]!)).toMatch(/pipiui-paddleocr-/);

    const successPaths: string[] = [];
    const okResult = await executeFirecrawlPdf(
      { source: "https://example.com/report.pdf", mode: "auto" },
      {
        apiKey: "ast-cleanup-token",
        fetchImpl,
        inspect: scanned,
        ocrFn: async (filePath) => {
          successPaths.push(filePath);
          expect(existsSync(filePath)).toBe(true);
          return { ok: true as const, text: "ocr done" };
        },
      },
    );
    expect(okResult.isError).toBeUndefined();
    expect(okResult.content[0].text).toBe("ocr done");
    expect(successPaths).toHaveLength(1);
    expect(successPaths[0]!.split("/").pop()).toMatch(/\.pdf$/);

    for (const path of [...failurePaths, ...successPaths]) {
      expect(existsSync(path), `scratch file ${path} must be cleaned`).toBe(false);
      expect(existsSync(dirname(path)), `scratch dir ${dirname(path)} must be cleaned`).toBe(false);
    }
  });
});

describe("pipiui_firecrawl_pdf tool contract", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
    delete process.env.PI_CODING_AGENT_DIR;
  });

  function loadTool() {
    let tool: { name: string; execute: Function } | undefined;
    firecrawlPdf({ registerTool: (definition: { name: string; execute: Function }) => { tool = definition; } } as never);
    return tool!;
  }

  it("registers a single focused tool and keeps the public name stable", () => {
    expect(loadTool().name).toBe(FIRECRAWL_PDF_TOOL);
    expect(FIRECRAWL_PDF_TOOL).toBe("pipiui_firecrawl_pdf");
  });

  it("extracts a local text PDF without any API key", async () => {
    root = await mkdtemp(join(tmpdir(), "fc-local-"));
    const pdf = join(root, "hello.pdf");
    await writeFile(pdf, TEXT_PDF);
    const inspect = vi.fn(async () => ({
      engine: "native" as const,
      pdfType: "TextBased",
      markdown: "# Hello Inspector",
      pageCount: 1,
      pagesNeedingOcr: [],
    }));
    const ocrFn = vi.fn(async () => ({ ok: true as const, text: "should not run" }));
    const result = await executeFirecrawlPdf({ source: pdf }, { apiKey: null, inspect, ocrFn });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Hello Inspector");
    expect(inspect).toHaveBeenCalledOnce();
    expect(ocrFn).not.toHaveBeenCalled();
  });

  it("downloads a URL PDF and extracts it locally without a key", async () => {
    const fetchImpl = vi.fn(async () => new Response(TEXT_PDF, { status: 200, headers: { "content-type": "application/pdf" } }));
    const inspect = vi.fn(async () => ({
      engine: "wasm" as const,
      pdfType: "TextBased",
      markdown: "from url",
      pageCount: 1,
      pagesNeedingOcr: [],
    }));
    const result = await executeFirecrawlPdf(
      { source: "https://example.com/doc" },
      { apiKey: null, inspect, fetchImpl: fetchImpl as never },
    );
    expect(result.content[0].text).toContain("from url");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(JSON.stringify(fetchImpl.mock.calls[0]?.[1] ?? {})).not.toMatch(/Authorization/i);
  });

  it("without a key, a scanned PDF reports OCR as optional and still treats local parse as available", async () => {
    root = await mkdtemp(join(tmpdir(), "fc-scan-"));
    const pdf = join(root, "scan.pdf");
    await writeFile(pdf, TEXT_PDF);
    const scanned = await executeFirecrawlPdf(
      { source: pdf },
      {
        apiKey: null,
        inspect: async () => ({ engine: "native", pdfType: "Scanned", markdown: "", pageCount: 3, pagesNeedingOcr: [0, 1, 2] }),
      },
    );
    expect(scanned.isError).toBeUndefined();
    expect(scanned.content[0].text).toContain(OCR_SKIPPED_NOTE);
    expect(scanned.content[0].text).toContain("OCR 未执行");

    const mixed = await executeFirecrawlPdf(
      { source: pdf },
      {
        apiKey: null,
        inspect: async () => ({ engine: "native", pdfType: "Mixed", markdown: "visible text", pageCount: 4, pagesNeedingOcr: [3] }),
      },
    );
    expect(mixed.isError).toBeUndefined();
    expect(mixed.content[0].text).toContain("visible text");
    expect(mixed.content[0].text).toContain("OCR 未执行");
  });

  it("auto with a token calls PaddleOCR only when OCR is indicated", async () => {
    root = await mkdtemp(join(tmpdir(), "fc-auto-"));
    const pdf = join(root, "a.pdf");
    await writeFile(pdf, TEXT_PDF);
    const ocrFn = vi.fn(async (filePath: string) => {
      expect(filePath).toBe(pdf);
      return { ok: true as const, text: "ocr paddle" };
    });
    const ocr = await executeFirecrawlPdf(
      { source: pdf, mode: "auto" },
      {
        apiKey: "ast-secret",
        ocrFn,
        inspect: async () => ({ engine: "native", pdfType: "Scanned", markdown: "", pageCount: 2, pagesNeedingOcr: [0, 1] }),
      },
    );
    expect(ocr.content[0].text).toBe("ocr paddle");
    expect(ocrFn).toHaveBeenCalledOnce();

    ocrFn.mockClear();
    const text = await executeFirecrawlPdf(
      { source: pdf, mode: "auto" },
      {
        apiKey: "ast-secret",
        ocrFn,
        inspect: async () => ({ engine: "native", pdfType: "TextBased", markdown: "local only", pageCount: 1, pagesNeedingOcr: [] }),
      },
    );
    expect(text.content[0].text).toContain("local only");
    expect(ocrFn).not.toHaveBeenCalled();
  });

  it("fast never calls OCR even with a token; ocr without a token errors clearly", async () => {
    root = await mkdtemp(join(tmpdir(), "fc-fast-"));
    const pdf = join(root, "a.pdf");
    await writeFile(pdf, TEXT_PDF);
    const ocrFn = vi.fn(async () => ({ ok: true as const, text: "nope" }));
    const fast = await executeFirecrawlPdf(
      { source: pdf, mode: "fast" },
      {
        apiKey: "ast-secret",
        ocrFn,
        inspect: async () => ({ engine: "native", pdfType: "Scanned", markdown: "fast text", pageCount: 1, pagesNeedingOcr: [0] }),
      },
    );
    expect(fast.content[0].text).toContain("fast text");
    expect(fast.content[0].text).toContain("fast 模式永不调用 OCR");
    expect(ocrFn).not.toHaveBeenCalled();

    const ocr = await executeFirecrawlPdf({ source: pdf, mode: "ocr" }, { apiKey: null, ocrFn });
    expect(ocr.content[0].text).toBe(OCR_MODE_NEEDS_KEY);
    expect(ocr.content[0].text).toContain("缺少 PaddleOCR Token");
    expect(ocrFn).not.toHaveBeenCalled();
  });

  it("rejects oversize downloads, non-PDF bodies, and bad URLs", async () => {
    expect(resolvePdfSource("ftp://x")).toMatchObject({ error: expect.stringContaining("http/https") });
    const tooBig = await downloadPdfBytes({
      url: "https://example.com/huge.pdf",
      timeout: 1000,
      fetchImpl: (async () => new Response("x", { status: 200, headers: { "content-length": String(MAX_PDF_BYTES + 1) } })) as never,
    });
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.error).toContain(MAX_PDF_MB_LABEL);

    const notPdf = await downloadPdfBytes({
      url: "https://example.com/page",
      timeout: 1000,
      fetchImpl: (async () => new Response("<html></html>", { status: 200 })) as never,
    });
    expect(notPdf.ok).toBe(false);
    if (!notPdf.ok) expect(notPdf.error).toContain("%PDF-");

    const badStatus = await downloadPdfBytes({
      url: "https://example.com/missing.pdf",
      timeout: 1000,
      fetchImpl: (async () => new Response("nope", { status: 404 })) as never,
    });
    expect(badStatus.ok).toBe(false);
    if (!badStatus.ok) expect(badStatus.error).toContain("404");
  });

  it("cancels a remote stream when successive chunks cross a lying Content-Length", async () => {
    const limit = 32;
    let cancelled = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(20).fill(0x61));
        controller.enqueue(new Uint8Array(20).fill(0x62));
        controller.enqueue(new Uint8Array(20).fill(0x63));
      },
      cancel() {
        cancelled += 1;
      },
    });
    const result = await downloadPdfBytes({
      url: "https://example.com/grew.pdf",
      timeout: 1000,
      maxBytes: limit,
      fetchImpl: (async () =>
        new Response(stream, {
          status: 200,
          headers: { "content-length": "12" },
        })) as never,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(MAX_PDF_MB_LABEL);
      expect(result.error).toMatch(/下载中 \d+ 字节/);
    }
    expect(cancelled).toBe(1);
  });

  it("validates local sources before touching them", async () => {
    expect(resolvePdfSource("")).toMatchObject({ error: expect.stringContaining("不能为空") });
    expect(resolvePdfSource("relative/path.pdf")).toMatchObject({ error: expect.stringContaining("绝对路径") });
    expect(resolvePdfSource("file:///tmp/x.pdf")).toMatchObject({ kind: "local", path: "/tmp/x.pdf" });
    expect(resolvePdfSource("/tmp/x.PDF?q=1")).toMatchObject({ kind: "local", path: "/tmp/x.PDF?q=1" });

    const missing = await executeFirecrawlPdf({ source: "/definitely/not/here.pdf" }, { apiKey: null });
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toContain("找不到本地 PDF");

    root = await mkdtemp(join(tmpdir(), "fc-badmagic-"));
    const notPdfPath = join(root, "fake.pdf");
    await writeFile(notPdfPath, "NOT A PDF");
    const fake = await executeFirecrawlPdf({ source: notPdfPath }, { apiKey: null });
    expect(fake.isError).toBe(true);
    expect(fake.content[0].text).toContain("%PDF-");
  });

  it("redacts tokens from surfaced OCR failures and caps error length", async () => {
    root = await mkdtemp(join(tmpdir(), "fc-redact-"));
    const pdf = join(root, "a.pdf");
    await writeFile(pdf, TEXT_PDF);
    const failed = await executeFirecrawlPdf(
      { source: pdf, mode: "ocr" },
      {
        apiKey: "ast-leak-token",
        ocrFn: async () => ({ ok: false as const, error: "boom ast-leak-token fc-abcdef123456 traceback" }),
      },
    );
    expect(failed.isError).toBe(true);
    expect(failed.content[0].text).not.toContain("ast-leak-token");
    expect(failed.content[0].text).not.toContain("fc-abcdef123456");
    expect(failed.content[0].text).toContain("[redacted]");
  });
});

function parseNewlineJson(raw: string): Array<Record<string, unknown>> {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function line(payload: unknown): string {
  return `${JSON.stringify(payload)}\n`;
}

function fakeChild(onStdinData?: (written: string[], stdout: PassThrough) => void) {
  const written: string[] = [];
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  stdin.on("data", (chunk: Buffer | string) => {
    written.push(String(chunk));
    onStdinData?.(written, stdout);
  });
  const child = Object.assign(new EventEmitter(), {
    stdin,
    stdout,
    stderr: new PassThrough(),
    exitCode: null as number | null,
    signalCode: null,
    kill() {
      this.exitCode = 0;
      this.emit("close");
    },
  });
  return { child, written };
}

describe("paddleocr newline-delimited MCP client", () => {
  it("spawns uvx paddleocr_mcp, writes NDJSON initialize/initialized/paddleocr_vl, token only in env", async () => {
    let captured: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
    const result = await callPaddleocrVl({
      filePath: "/tmp/scan.pdf",
      token: "ast-secret-token",
      spawnFn: (command, args, options) => {
        captured.push({ command, args, env: (options.env ?? {}) as NodeJS.ProcessEnv });
        const { child } = fakeChild((messages, stdout) => {
          const last = parseNewlineJson(messages.join("")).at(-1);
          if (!last) return;
          if (last.method === "initialize") {
            stdout.write(line({ jsonrpc: "2.0", id: last.id, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "paddleocr" } } }));
          }
          if (last.method === "tools/call") {
            expect(last.params).toMatchObject({ name: PADDLEOCR_VL_TOOL });
            const argsObj = (last.params as { arguments?: Record<string, unknown> }).arguments;
            expect(argsObj?.file_path ?? argsObj?.file).toBe("/tmp/scan.pdf");
            stdout.write("noise before\n");
            stdout.write(line({
              jsonrpc: "2.0",
              id: last.id,
              result: { content: [{ type: "text", text: "recognized page" }] },
            }));
          }
        });
        return child as never;
      },
    });
    expect(result).toEqual({ ok: true, text: "recognized page" });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.command).toBe(PADDLEOCR_MCP_COMMAND);
    expect(captured[0]?.args).toEqual([...PADDLEOCR_MCP_ARGS]);
    expect(captured[0]?.env.PADDLEOCR_MCP_MODEL).toBe("PaddleOCR-VL-1.6");
    expect(captured[0]?.env.PADDLEOCR_MCP_PPOCR_SOURCE).toBe("aistudio");
    expect(captured[0]?.env.PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN).toBe("ast-secret-token");
    expect(paddleocrMcpEnv("t2").PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN).toBe("t2");
  });

  it("keeps the secret off the wire and out of results", async () => {
    let wire = "";
    const result = await callPaddleocrVl({
      filePath: "/tmp/scan.pdf",
      token: "ast-wire-secret",
      spawnFn: (() => {
        const { child } = fakeChild((messages, stdout) => {
          const last = parseNewlineJson(messages.join("")).at(-1);
          if (!last) return;
          if (last.method === "initialize") {
            stdout.write(line({ jsonrpc: "2.0", id: last.id, result: {} }));
          }
          if (last.method === "tools/call") {
            wire = messages.join("");
            stdout.write(line({ jsonrpc: "2.0", id: last.id, result: { content: [{ type: "resource", resource: { text: "ok" } }] } }));
          }
        });
        return child as never;
      }) as never,
    });
    expect(result).toEqual({ ok: true, text: "ok" });
    expect(wire).not.toContain("ast-wire-secret");
    expect(wire).not.toMatch(/Content-Length/i);
    const methods = parseNewlineJson(wire).map((msg) => msg.method);
    expect(methods).toContain("initialize");
    expect(methods).toContain("notifications/initialized");
    expect(methods).toContain("tools/call");
    expect(extractMcpText({ content: [{ type: "text", text: "x" }] })).toBe("x");
  });

  it("redacts the token from MCP errors and omits token from env when unset", async () => {
    expect(paddleocrMcpEnv()).not.toHaveProperty("PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN");
    const failed = await callPaddleocrVl({
      filePath: "/tmp/scan.pdf",
      token: "ast-leak-me",
      spawnFn: () => {
        const { child } = fakeChild((messages, stdout) => {
          const last = parseNewlineJson(messages.join("")).at(-1);
          if (last?.method === "initialize") {
            stdout.write(line({ jsonrpc: "2.0", id: last.id, error: { message: "unauthorized ast-leak-me" } }));
          }
        });
        return child as never;
      },
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error).toContain("[redacted]");
      expect(failed.error).not.toContain("ast-leak-me");
    }
  });
});

describe("extension-secret env with legacy paddleocr.json fallback", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    root = "";
    delete process.env.PI_CODING_AGENT_DIR;
    delete process.env[EXTENSION_SECRET_ENV];
  });

  it("names the project-scoped secret setting after this extension", () => {
    expect(PDF_EXTENSION_ID).toBe("pdf-extension");
    expect(SETTINGS_SECRET_KEY).toBe("ext.pdf-extension.aistudioAccessToken");
    const derived = SETTINGS_SECRET_KEY
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toUpperCase();
    expect(EXTENSION_SECRET_ENV).toBe(derived);
    expect(EXTENSION_SECRET_ENV).toBe("EXT_PDF_EXTENSION_AISTUDIOACCESSTOKEN");
  });

  it("prefers the injected extension-secret env over the legacy config file", async () => {
    root = await mkdtemp(join(tmpdir(), "pdf-tok-"));
    await writeFile(
      join(root, "paddleocr.json"),
      JSON.stringify({ [PADDLEOCR_TOKEN_FIELD]: "legacy-token" }),
      "utf8",
    );
    process.env.PI_CODING_AGENT_DIR = root;

    expect(await resolvePaddleocrToken({ [EXTENSION_SECRET_ENV]: "  host-injected  ", PATH: "/usr/bin" } as NodeJS.ProcessEnv)).toBe("host-injected");
    expect(await resolvePaddleocrToken({ PATH: "/usr/bin" } as NodeJS.ProcessEnv)).toBe("legacy-token");
    delete process.env.PI_CODING_AGENT_DIR;
    expect(await resolvePaddleocrToken({} as NodeJS.ProcessEnv)).toBeUndefined();
    process.env.PI_CODING_AGENT_DIR = root;
    expect(await resolvePaddleocrToken({ [EXTENSION_SECRET_ENV]: "" } as NodeJS.ProcessEnv)).toBe("legacy-token");
  });

  it("reads only the aistudioAccessToken field from the legacy file and tolerates junk", async () => {
    root = await mkdtemp(join(tmpdir(), "pdf-tok2-"));
    process.env.PI_CODING_AGENT_DIR = root;
    await writeFile(join(root, "paddleocr.json"), JSON.stringify({ firecrawlApiKey: "web-search-key", unrelated: true }), "utf8");
    expect(await loadPaddleocrToken()).toBeUndefined();

    await writeFile(join(root, "paddleocr.json"), "{ not json", "utf8");
    expect(await loadPaddleocrToken()).toBeUndefined();

    delete process.env.PI_CODING_AGENT_DIR;
    expect(await loadPaddleocrToken()).toBeUndefined();
  });

  it("uses the resolved token for routing without echoing it in results", async () => {
    root = await mkdtemp(join(tmpdir(), "pdf-tok3-"));
    await writeFile(
      join(root, "paddleocr.json"),
      JSON.stringify({ [PADDLEOCR_TOKEN_FIELD]: "ast-file-token" }),
      "utf8",
    );
    process.env.PI_CODING_AGENT_DIR = root;
    const pdf = join(root, "any.pdf");
    await writeFile(pdf, STUB_PDF);
    const seen: string[] = [];
    const failed = await executeFirecrawlPdf({ source: pdf, mode: "ocr" }, {
      ocrFn: async (_filePath, token) => {
        seen.push(token);
        return { ok: false, error: `denied ${token}` };
      },
    });
    expect(seen).toEqual(["ast-file-token"]);
    expect(failed.isError).toBe(true);
    expect(failed.content[0].text).not.toContain("ast-file-token");

    process.env[EXTENSION_SECRET_ENV] = "ast-env-token";
    try {
      const envSeen: string[] = [];
      await executeFirecrawlPdf({ source: pdf, mode: "ocr" }, {
        ocrFn: async (_filePath, token) => {
          envSeen.push(token);
          return { ok: true, text: "fine" };
        },
      });
      expect(envSeen).toEqual(["ast-env-token"]);
    } finally {
      delete process.env[EXTENSION_SECRET_ENV];
    }
  });

  it("sanitizePublicError redacts both the token and firecrawl-style key prefixes", () => {
    const out = sanitizePublicError("HTTP 401 fc-abcdef123456 near ast-plain-token end", "ast-plain-token");
    expect(out).not.toContain("ast-plain-token");
    expect(out).not.toContain("fc-abcdef123456");
    expect(out.match(/\[redacted\]/g)?.length).toBe(2);
  });
});
