import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, rename, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pythonJsonDumps, storedJson, utf8Bytes, type ReadonlyJson } from "./json.js";

/** Same-directory temp + fsync + rename; only the temporary file is cleaned up. */
export async function writeTextAtomic(path: string, text: string): Promise<void> {
  const bytes = utf8Bytes(text);
  await mkdir(dirname(path), { recursive: true });
  let temporary: string | undefined;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    while (!handle) {
      const candidate = join(dirname(path), `.tmp-${randomBytes(12).toString("hex")}`);
      try {
        handle = await open(candidate, "wx", 0o600);
        temporary = candidate;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary!, path);
    temporary = undefined;
  } finally {
    try { await handle?.close(); }
    finally {
      if (temporary !== undefined) {
        try { await unlink(temporary); } catch { /* Preserve the original write failure. */ }
      }
    }
  }
}

export async function writeJsonAtomic(path: string, value: ReadonlyJson): Promise<void> {
  await writeTextAtomic(path, storedJson(value));
}

export async function appendJsonl(path: string, record: ReadonlyJson): Promise<void> {
  const bytes = utf8Bytes(pythonJsonDumps(record) + "\n");
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "a");
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
}

export async function truncateFile(path: string, size: number): Promise<void> {
  if (!Number.isSafeInteger(size) || size < 0) throw new TypeError("size must be a non-negative safe integer");
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(path, "r+"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  try { await handle.truncate(size); await handle.sync(); }
  finally { await handle.close(); }
}

export async function fileSize(path: string): Promise<number> {
  try { return (await stat(path)).size; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

export async function sha256File(path: string): Promise<string> {
  const handle = await open(path, "r");
  const digest = createHash("sha256");
  try {
    const buffer = Buffer.alloc(1 << 16);
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      digest.update(buffer.subarray(0, bytesRead));
    }
    return digest.digest("hex");
  } finally { await handle.close(); }
}
