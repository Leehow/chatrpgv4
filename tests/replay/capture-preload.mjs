/**
 * Replay evaluation (R1): what each process actually sent to a provider, and what came back.
 *
 * Loaded into every Node process of a replay run with `NODE_OPTIONS=--import <this file>`, so the Pi host, the
 * kernel and every lane child are covered alike. It wraps `globalThis.fetch` through an accessor, so the fetch Pi
 * installs later (`undici.install()` in `configureHttpDispatcher`) is wrapped as well. A request is recorded when it
 * leaves fetch: after prompt assembly, every `before_provider_request` hook, trimming and schema conversion -- the
 * body the provider receives, not an early capsule. Auth headers are never written.
 *
 *   PI_COC_REPLAY_CAPTURE=<dir>  write `requests-<pid>.jsonl` there (request, response head, response body).
 *   PI_COC_REPLAY_TAPE=<dir>     answer from a capture written earlier instead of the network. A request whose body
 *                                matches no unclaimed recording is a divergence: it is written down and refused with a
 *                                400 (never retried by Pi), and no later recording is forced onto the run.
 *
 * Undici's diagnostics channels see every request whichever fetch or client sent it; each one is logged as a
 * `transport` row, so a request that went around fetch shows up as uncovered instead of silently missing.
 */
import { appendFileSync, mkdirSync, openSync, closeSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import diagnostics from 'node:diagnostics_channel';

const CAPTURE = process.env.PI_COC_REPLAY_CAPTURE, TAPE = process.env.PI_COC_REPLAY_TAPE;
const SECRET_HEADER = /authorization|api[-_]?key|token|secret|cookie|session|signature|credential/i;
const LOCAL = /^(localhost|127\.|\[?::1\]?$|0\.0\.0\.0)/;
const sha = (data) => createHash('sha256').update(data).digest('hex');
let sequence = 0;

function write(row) {
  if (!CAPTURE) return;
  try { appendFileSync(join(CAPTURE, `requests-${process.pid}.jsonl`), JSON.stringify({ pid: process.pid, ppid: process.ppid, ...row }) + '\n'); }
  catch { /* evidence is best-effort; the run itself must not fail on it */ }
}
function headerRows(headers) {
  const rows = {};
  try { for (const [k, v] of new Headers(headers ?? {})) rows[k] = SECRET_HEADER.test(k) ? '[redacted]' : v; } catch { }
  return rows;
}
async function requestOf(input, init) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String(input?.url ?? input);
  const method = (init?.method ?? input?.method ?? 'GET').toUpperCase();
  const headers = headerRows(init?.headers ?? input?.headers);
  let body = init?.body, form = 'none';
  if (body == null && input && typeof input === 'object' && typeof input.clone === 'function' && input.body) {
    try { body = await input.clone().text(); } catch { body = undefined; form = 'unreadable'; }
  }
  if (typeof body === 'string') form = 'utf8';
  else if (body instanceof URLSearchParams) { body = body.toString(); form = 'utf8'; }
  else if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) { body = Buffer.from(body instanceof ArrayBuffer ? body : body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)).toString('base64'); form = 'base64'; }
  else if (body != null) { form = 'unsupported:' + (body?.constructor?.name ?? typeof body); body = undefined; }
  return { url, method, headers, body: body ?? null, form, body_sha256: body == null ? null : sha(body) };
}
const isLocal = (url) => { try { const u = new URL(url); return u.protocol === 'file:' || u.protocol === 'data:' || LOCAL.test(u.hostname); } catch { return true; } };

/** The recorded exchanges of a tape, keyed by method, URL without query and body digest. */
function loadTape(dir) {
  const requests = new Map(), responses = new Map(), ends = new Map();
  for (const name of readdirSync(dir).filter(n => /^requests-\d+\.jsonl$/.test(n)))
    for (const line of readFileSync(join(dir, name), 'utf8').split('\n')) {
      if (!line) continue; let row; try { row = JSON.parse(line); } catch { continue; }
      if (row.kind === 'request' && !row.local) requests.set(row.id, row);
      else if (row.kind === 'response') responses.set(row.id, row);
      else if (row.kind === 'response_end') ends.set(row.id, row);
    }
  const byKey = new Map();
  for (const row of [...requests.values()].sort((a, b) => a.t.localeCompare(b.t))) {
    if (!responses.has(row.id) || !ends.get(row.id)?.complete) continue;
    const key = tapeKey(row.method, row.url, row.body_sha256);
    byKey.set(key, [...(byKey.get(key) ?? []), { request: row, response: responses.get(row.id), end: ends.get(row.id) }]);
  }
  return { byKey, requests: [...requests.values()] };
}
const tapeKey = (method, url, digest) => { let path = url; try { const u = new URL(url); path = u.origin + u.pathname; } catch { } return method + ' ' + path + ' ' + digest; };
function claim(id) {
  const directory = join(CAPTURE ?? TAPE, 'tape-claims'); mkdirSync(directory, { recursive: true });
  try { closeSync(openSync(join(directory, id), 'wx')); return true; } catch { return false; }
}
function nearest(tape, request) {
  let best = null;
  for (const row of tape.requests) {
    if (tapeKey(row.method, row.url, '') !== tapeKey(request.method, request.url, '') || row.body == null || request.body == null) continue;
    let i = 0; const a = row.body, b = request.body, n = Math.min(a.length, b.length);
    while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
    if (!best || i > best.common_prefix) best = { id: row.id, common_prefix: i, recorded_length: a.length, sent_length: b.length };
  }
  return best;
}

function wrap(real, tape) {
  if (typeof real !== 'function') return real;
  const wrapped = async function replayFetch(input, init) {
    let request;
    try { request = await requestOf(input, init); } catch { return real(input, init); }
    const id = randomUUID(), local = isLocal(request.url), seq = sequence++;
    write({ kind: 'request', id, seq, t: new Date().toISOString(), local, source: tape && !local ? 'tape' : 'network', ...request });
    if (tape && !local) {
      const candidates = tape.byKey.get(tapeKey(request.method, request.url, request.body_sha256)) ?? [];
      const hit = candidates.find(c => claim(c.request.id));
      if (!hit) {
        const near = nearest(tape, request);
        write({ kind: 'divergence', id, t: new Date().toISOString(), url: request.url, body_sha256: request.body_sha256, nearest: near });
        const body = JSON.stringify({ error: { type: 'replay_tape_divergence', message: 'Replay tape divergence: no recorded exchange matches this request.' } });
        write({ kind: 'response', id, t: new Date().toISOString(), status: 400, headers: { 'content-type': 'application/json' }, tape: null });
        write({ kind: 'response_end', id, t: new Date().toISOString(), complete: true, form: 'utf8', body, bytes: body.length });
        return new Response(body, { status: 400, headers: { 'content-type': 'application/json' } });
      }
      const headers = { ...hit.response.headers }; delete headers['content-encoding']; delete headers['content-length']; delete headers['transfer-encoding'];
      write({ kind: 'response', id, t: new Date().toISOString(), status: hit.response.status, headers, tape: hit.request.id });
      const chunks = (hit.end.chunks ?? []).map(c => Buffer.from(c, 'base64'));
      write({ kind: 'response_end', id, t: new Date().toISOString(), complete: true, tape: hit.request.id, bytes: chunks.reduce((n, c) => n + c.length, 0) });
      const stream = new ReadableStream({ start(controller) { for (const c of chunks) controller.enqueue(new Uint8Array(c)); controller.close(); } });
      return new Response(stream, { status: hit.response.status, statusText: hit.response.status_text ?? '', headers });
    }
    let response;
    try { response = await real(input, init); }
    catch (error) { write({ kind: 'response_end', id, t: new Date().toISOString(), complete: false, error: String(error?.message ?? error) }); throw error; }
    write({ kind: 'response', id, t: new Date().toISOString(), status: response.status, status_text: response.statusText, headers: headerRows(response.headers) });
    if (!response.body || local) { write({ kind: 'response_end', id, t: new Date().toISOString(), complete: true, chunks: [], bytes: 0, body_unrecorded: local && !!response.body }); return response; }
    const chunks = []; let done = false;
    const finish = (complete, error) => { if (done) return; done = true; const all = Buffer.concat(chunks); write({ kind: 'response_end', id, t: new Date().toISOString(), complete, error, bytes: all.length, body_sha256: sha(all), chunks: chunks.map(c => c.toString('base64')) }); };
    const body = response.body.pipeThrough(new TransformStream({
      transform(chunk, controller) { chunks.push(Buffer.from(chunk)); controller.enqueue(chunk); },
      flush() { finish(true); },
    }));
    pending.add(finish);
    const copy = new response.constructor(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    for (const key of ['url', 'redirected', 'type']) try { Object.defineProperty(copy, key, { value: response[key] }); } catch { }
    return copy;
  };
  return wrapped;
}

const pending = new Set();
if (CAPTURE || TAPE) {
  if (CAPTURE) mkdirSync(CAPTURE, { recursive: true });
  const tape = TAPE ? loadTape(TAPE) : null;
  let current = globalThis.fetch, wrapped = wrap(current, tape);
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true, enumerable: true,
    get() { return wrapped; },
    set(value) { if (value === wrapped) return; current = value; wrapped = wrap(value, tape); },
  });
  diagnostics.subscribe('undici:request:create', ({ request }) => {
    const origin = String(request?.origin ?? ''); if (!origin || isLocal(origin)) return;
    write({ kind: 'transport', t: new Date().toISOString(), method: request.method, origin, path: String(request.path ?? '').split('?')[0] });
  });
  process.on('exit', () => { for (const finish of pending) finish(false, 'process exited before the response body ended'); });
}
