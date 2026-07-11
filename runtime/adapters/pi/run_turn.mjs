#!/usr/bin/env node
/**
 * Legacy Pi entrypoint, now narrator-only.
 *
 * It deliberately imports the bounded narrator bridge. Rules are resolved
 * before this process is called; there is no tool or subprocess path from Pi
 * back to a rule-execution entrypoint.
 */
import { createInterface } from "node:readline";
import { runNarration } from "../narrator/run_narration.mjs";

function writeResult(value) {
  process.stdout.write(JSON.stringify(value) + "\n");
}

function readStdinJson() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(chunks.join("")));
      } catch (err) {
        reject(new Error(`invalid JSON on stdin: ${err.message}`));
      }
    });
    process.stdin.on("error", reject);
  });
}

async function oneShot() {
  try {
    writeResult(await runNarration(await readStdinJson()));
  } catch (err) {
    writeResult({ ok: false, error: err && err.message ? err.message : String(err) });
    process.exitCode = 1;
  }
}

async function serveJsonl() {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    let envelope;
    try {
      envelope = JSON.parse(line);
      if (!envelope || typeof envelope !== "object" || typeof envelope.request_id !== "string") {
        throw new Error("server request requires request_id");
      }
      writeResult({ request_id: envelope.request_id, ...(await runNarration(envelope.payload)) });
    } catch (err) {
      writeResult({ request_id: envelope && envelope.request_id, ok: false,
        error: err && err.message ? err.message : String(err) });
    }
  }
}

if (process.argv.includes("--server")) {
  serveJsonl().catch((err) => {
    process.stderr.write(`${err && err.message ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
} else {
  oneShot();
}
