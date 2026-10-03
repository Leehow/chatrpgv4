#!/usr/bin/env node
// One-shot probe: does chatgpt.com/backend-api/codex/images/generations accept
// a Pi-held openai-codex OAuth credential, the way Codex CLI's image_gen
// extension calls it (codex-rs/ext/image-generation/src/tool.rs)?
//
// Never prints the token. Never refreshes (a refresh rotates the refresh token
// that several local auth.json copies share). Writes the image next to itself.
//
// Usage:
//   NODE_USE_ENV_PROXY=1 node probe.mjs [--auth <auth.json>] [--originator pi|codex_cli_rs]
//                                       [--size auto|1024x1536|...] [--quality auto|low|medium|high]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const authPath = flag(
	"--auth",
	path.join(os.homedir(), "Library/Application Support/Pipi/pipicoc/pi-agent/auth.json"),
);
const originator = flag("--originator", "pi");
const size = flag("--size", "auto");
const quality = flag("--quality", "auto");
const prompt = flag("--prompt", "A small brass key lying on an old leather-bound journal, candlelight, 1920s");

const store = JSON.parse(fs.readFileSync(authPath, "utf8"));
const cred = store["openai-codex"];
if (!cred?.access) {
	console.error(`no openai-codex credential in ${authPath}`);
	process.exit(2);
}
const claims = JSON.parse(Buffer.from(cred.access.split(".")[1], "base64url").toString());
const auth = claims["https://api.openai.com/auth"] ?? {};
const accountId = cred.accountId ?? auth.chatgpt_account_id;
const expMs = claims.exp * 1000;
console.log(`credential: ${authPath}`);
console.log(`plan=${auth.chatgpt_plan_type} account_id=${accountId ? "present" : "MISSING"} expires=${new Date(expMs).toISOString()}`);
if (expMs <= Date.now() + 60_000) {
	console.error("access token is expired or about to expire; open PipiCOC (or run pi) once so Pi refreshes it, then retry");
	process.exit(2);
}

const url = "https://chatgpt.com/backend-api/codex/images/generations";
const body = { prompt, background: "auto", model: "gpt-image-2", quality, size };
const headers = {
	Authorization: `Bearer ${cred.access}`,
	"ChatGPT-Account-ID": accountId,
	originator,
	"User-Agent": `${originator} (${os.platform()} ${os.release()}; ${os.arch()})`,
	"x-codex-image-turn-id": randomUUID(),
	"Content-Type": "application/json",
	Accept: "application/json",
};
console.log(`POST ${url} originator=${originator} body=${JSON.stringify(body)}`);

const started = Date.now();
const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`HTTP ${res.status} ${res.statusText} in ${seconds}s`);
for (const [k, v] of res.headers) {
	if (/^(x-codex|x-image-gen|x-request-id|openai-|content-type|cf-ray)/i.test(k)) console.log(`  ${k}: ${v}`);
}
const text = await res.text();
if (!res.ok) {
	console.log(text.slice(0, 2000));
	process.exit(1);
}
const json = JSON.parse(text);
const b64 = json.data?.[0]?.b64_json;
const { data, ...meta } = json;
console.log("meta:", JSON.stringify(meta));
if (!b64) {
	console.log("no data[0].b64_json in response");
	process.exit(1);
}
const outDir = path.join(path.dirname(new URL(import.meta.url).pathname), "out");
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `probe-${originator}-${quality}-${size}-${Date.now()}.${meta.output_format ?? "png"}`);
fs.writeFileSync(out, Buffer.from(b64, "base64"));
console.log(`saved ${out} (${fs.statSync(out).size} bytes)`);
