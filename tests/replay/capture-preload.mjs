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
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import diagnostics from 'node:diagnostics_channel';

const CAPTURE = process.env.PI_COC_REPLAY_CAPTURE, TAPE = process.env.PI_COC_REPLAY_TAPE;
const SECRET_HEADER = /authorization|api[-_]?key|token|secret|cookie|session|signature|credential/i;
const LOCAL = /^(localhost|127\.|\[?::1\]?$|0\.0\.0\.0)/;
const sha = (data) => createHash('sha256').update(data).digest('hex');
/**
 * What a tape is matched on: the body with the fields listed here replaced, and nothing else. Each is an identity of
 * the execution, never of the game: this run's physical root, and the per-session prompt cache key.
 */
const RUN_ROOT = CAPTURE ? dirname(CAPTURE) : null;
export const TAPE_NORMALIZATION = ['run root path -> <run>', 'prompt_cache_key -> <session>', 'lane working directory in <cwd> -> <cwd>', 'host run ids run-<uuid> -> run-<id>', 'world_revision digests (they cover receipt wall-clock times) -> <revision>', 'mkdtemp scratch names attempt-XXXXXX -> attempt-<tmp>'];
function normalizedBody(body, root) {
  if (body == null) return null;
  // A lane child's working directory is a fresh scratch path named by the clock (".../batch-1-<ms>").
  let text = body.replace(/<cwd>[^<]*<\/cwd>/g, '<cwd></cwd>');
  if (root) text = text.split(root).join('<run>');
  text = text.replace(/"prompt_cache_key":"[^"]*"/g, '"prompt_cache_key":"<session>"');
  text = text.replace(/run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'run-<id>');
  // `world_revision` digests world, party and this turn's receipts, whose `at` is the wall clock; the state itself
  // is still in the prompt and still compared.
  text = text.replace(/(world_revision\\?":\\?")[0-9a-f]{64}/g, '$1<revision>');
  // A lane's scratch directory made by mkdtemp ("…/attempt-7WZaBU/draft.json"), quoted back in tool errors.
  text = text.replace(/\/attempt-[A-Za-z0-9]{6}(?=\/)/g, '/attempt-<tmp>');
  return text;
}
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
  const normalized = form === 'utf8' ? normalizedBody(body, RUN_ROOT) : body;
  return { url, method, headers, body: body ?? null, form, body_sha256: body == null ? null : sha(body), match_sha256: normalized == null ? null : sha(normalized) };
}
const isLocal = (url) => { try { const u = new URL(url); return u.protocol === 'file:' || u.protocol === 'data:' || LOCAL.test(u.hostname); } catch { return true; } };

/** The recorded exchanges of a tape, keyed by method, URL without query and body digest. */
function loadTape(dir) {
  const requests = new Map(), responses = new Map(), ends = new Map();
  for (const name of readdirSync(dir).filter(n => /^requests-\d+\.jsonl$/.test(n)))
    for (const line of readFileSync(join(dir, name), 'utf8').split('\n')) {
      if (!line) continue; let row; try { row = JSON.parse(line); } catch { continue; }
      if (row.kind === 'request' && !row.local) { if (row.form === 'utf8' && row.body != null) { row.normalized = normalizedBody(row.body, dirname(dir)); row.match_sha256 = sha(row.normalized); } requests.set(row.id, row); }
      else if (row.kind === 'response') responses.set(row.id, row);
      else if (row.kind === 'response_end') ends.set(row.id, row);
    }
  const byKey = new Map();
  for (const row of [...requests.values()].sort((a, b) => a.t.localeCompare(b.t))) {
    // A body the consumer stopped reading before its end (its process exited) is still exactly what was read.
    const end = ends.get(row.id);
    // A request its caller cancelled before any answer is replayed as the same wait, ended by the caller's abort.
    const cancelled = !responses.has(row.id) && end && !end.complete;
    if (!cancelled && (!responses.has(row.id) || !(end?.complete || end?.consumer_stopped))) continue;
    const key = tapeKey(row.method, row.url, row.match_sha256 ?? row.body_sha256);
    byKey.set(key, [...(byKey.get(key) ?? []), { request: row, response: responses.get(row.id) ?? null, end, cancelled: !!cancelled }]);
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
    let i = 0; const a = row.normalized ?? row.body, b = normalizedBody(request.body, RUN_ROOT), n = Math.min(a.length, b.length);
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
      const candidates = tape.byKey.get(tapeKey(request.method, request.url, request.match_sha256)) ?? [];
      const hit = candidates.find(c => claim(c.request.id));
      if (!hit) {
        const near = nearest(tape, request);
        // `repeat`: the recording exists but was already used -- this run asked the same thing more times than the original.
        write({ kind: 'divergence', id, t: new Date().toISOString(), url: request.url, body_sha256: request.body_sha256, reason: candidates.length ? 'repeat' : 'no_match', nearest: near });
        const body = JSON.stringify({ error: { type: 'replay_tape_divergence', message: 'Replay tape divergence: no recorded exchange matches this request.' } });
        write({ kind: 'response', id, t: new Date().toISOString(), status: 400, headers: { 'content-type': 'application/json' }, tape: null });
        write({ kind: 'response_end', id, t: new Date().toISOString(), complete: true, form: 'utf8', body, bytes: body.length });
        return new Response(body, { status: 400, headers: { 'content-type': 'application/json' } });
      }
      if (hit.cancelled) {
        write({ kind: 'response_end', id, t: new Date().toISOString(), complete: false, tape: hit.request.id, error: 'replayed cancellation: waiting for the caller to abort' });
        const signal = init?.signal ?? input?.signal;
        return new Promise((_, reject) => {
          const timer = setTimeout(() => reject(new TypeError('replay tape: a recorded cancellation was never cancelled')), 300000);
          signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason ?? new DOMException('aborted', 'AbortError')); }, { once: true });
        });
      }
      const headers = { ...hit.response.headers }; delete headers['content-encoding']; delete headers['content-length']; delete headers['transfer-encoding'];
      write({ kind: 'response', id, t: new Date().toISOString(), status: hit.response.status, headers, tape: hit.request.id });
      // A recorded answer can name the recording run's own files (a lane's tool call `cd`s into its workspace); it is
      // pointed at this run's root, or the replay would act on another run's workspace.
      let chunks = (hit.end.chunks ?? []).map(c => Buffer.from(c, 'base64'));
      const recordedRoot = dirname(TAPE), whole = Buffer.concat(chunks).toString('utf8');
      if (RUN_ROOT && whole.includes(recordedRoot)) {
        const moved = Buffer.from(whole.split(recordedRoot).join(RUN_ROOT)), n = Math.max(1, chunks.length), size = Math.ceil(moved.length / n);
        chunks = []; for (let at = 0; at < moved.length; at += size) chunks.push(moved.subarray(at, at + size));
        write({ kind: 'tape_rewrite', id, t: new Date().toISOString(), tape: hit.request.id, from: 'recorded run root', to: 'this run root' });
      }
      write({ kind: 'response_end', id, t: new Date().toISOString(), complete: true, tape: hit.request.id, bytes: chunks.reduce((n, c) => n + c.length, 0) });
      // The recorded latency is kept (PI_COC_REPLAY_TAPE_TIMING=0 drops it): the host races background work against the
      // Keeper's first request, so answering instantly would change which material is ready, not only how fast.
      const timed = process.env.PI_COC_REPLAY_TAPE_TIMING !== '0', since = Date.parse(hit.request.t);
      const head = timed ? Math.max(0, Date.parse(hit.response.t) - since) : 0, tail = timed ? Math.max(head, Date.parse(hit.end.t) - since) : 0;
      const signal = init?.signal ?? input?.signal, wait = (ms) => new Promise((done, fail) => { const timer = setTimeout(done, ms); signal?.addEventListener('abort', () => { clearTimeout(timer); fail(signal.reason ?? new DOMException('aborted', 'AbortError')); }, { once: true }); });
      await wait(head);
      const stream = new ReadableStream({ async start(controller) {
        try { for (const [i, c] of chunks.entries()) { if (tail > head && chunks.length > 1) await wait((tail - head) / chunks.length); controller.enqueue(new Uint8Array(c)); if (i === chunks.length - 1) controller.close(); } if (!chunks.length) controller.close(); }
        catch (error) { controller.error(error); }
      } });
      return new Response(stream, { status: hit.response.status, statusText: hit.response.status_text ?? '', headers });
    }
    let response;
    try { response = await real(input, init); }
    catch (error) { write({ kind: 'response_end', id, t: new Date().toISOString(), complete: false, error: String(error?.message ?? error) }); throw error; }
    write({ kind: 'response', id, t: new Date().toISOString(), status: response.status, status_text: response.statusText, headers: headerRows(response.headers) });
    if (!response.body || local) { write({ kind: 'response_end', id, t: new Date().toISOString(), complete: true, chunks: [], bytes: 0, body_unrecorded: local && !!response.body }); return response; }
    const chunks = []; let done = false;
    const finish = (complete, error, consumerStopped = false) => { if (done) return; done = true; pending.delete(finish); const all = Buffer.concat(chunks); write({ kind: 'response_end', id, t: new Date().toISOString(), complete, error, consumer_stopped: consumerStopped, bytes: all.length, body_sha256: sha(all), chunks: chunks.map(c => c.toString('base64')) }); };
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
  process.on('exit', () => { for (const finish of pending) finish(false, 'process exited before the response body ended', true); });
}
