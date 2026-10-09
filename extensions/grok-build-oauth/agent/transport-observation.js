/** Opt-in Grok HTTP/SSE evidence. Response payloads require a second explicit flag; credentials never persist. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { getGlobalDispatcher, setGlobalDispatcher } from 'undici';

const SHARED = Symbol.for('pipicoc.grok.transport-observation.v1');
const now = () => ({receiptTime: new Date().toISOString(), receiptMonoMs: performance.now()});
const hash = value => createHash('sha256').update(value).digest('hex');
const limits = {queuedBytes: 256 * 1024, frameBytes: 1024 * 1024, decodedBytes: 16 * 1024 * 1024, records: 12000, logBytes: 2 * 1024 * 1024};
function typeMeta(value) {
  if (typeof value !== 'string') return {type: 'missing'};
  if (value.length <= 96 && /^(?:response(?:\.[a-z][a-z0-9_]*)+|[a-z][a-z0-9_]{0,40})$/.test(value)) return {type: value};
  return {type: 'redacted', typeHash: hash(value.slice(0, 1024)), typeLength: value.length};
}
function header(headers, name) {
  if (typeof headers?.get === 'function') return headers.get(name);
  if (Array.isArray(headers)) {
    for (let n = 0; n + 1 < headers.length; n += 2) if (String(headers[n]).toLowerCase() === name) return String(headers[n + 1]);
  } else for (const key of Object.keys(headers ?? {})) if (key.toLowerCase() === name) return String(headers[key]);
  return undefined;
}
function errorMeta(error, rawResponse = false) {
  const names = new Set(['Error', 'AbortError', 'TimeoutError', 'TypeError']);
  const code = typeof error?.code === 'string' && /^UND_ERR_[A-Z_]+$/.test(error.code) ? error.code : undefined;
  return {errorName: names.has(error?.name) ? error.name : 'other', ...(code ? {code} : {}),
    ...(rawResponse ? {_responsePayload: {name: error?.name, message: error?.message, code: error?.code,
      cause: error?.cause ? {name: error.cause.name, message: error.cause.message, code: error.cause.code} : undefined}} : {})};
}

class Trace {
  constructor(options) {
    this.id = randomUUID(); this.options = options; this.pending = []; this.bytes = 0; this.count = 0;
    this.reasons = new Set(); this.wires = []; this.normalizedCount = 0; this.rawCount = 0; this.hookOrdinal = 0; this.iterated = false; this.iterationEnded = false;
    this.progress = {}; this.credentials = new Set();
    if (typeof options.apiKey === 'string' && options.apiKey) this.credentials.add(options.apiKey);
    this.record('attempt_start', {version: 2, captureMode: options.rawResponse ? 'raw_response' : 'metadata_only', pid: process.pid, ...options.requested});
  }
  credentialsFrom(headers) {
    if (!this.options.rawResponse) return;
    try {
    for (const name of ['authorization', 'cookie', 'set-cookie', 'x-api-key']) {
      const value = header(headers, name); if (typeof value !== 'string' || !value) continue;
      this.credentials.add(value);
      if (name === 'authorization') this.credentials.add(value.replace(/^(?:Bearer|Basic)\s+/i, ''));
      if (name.includes('cookie')) for (const part of name === 'set-cookie' ? value.split(';').slice(0, 1) : value.split(';')) {
        const at = part.indexOf('='); if (at >= 0 && part.slice(at + 1).trim()) this.credentials.add(part.slice(at + 1).trim());
      }
    }
    if (this.credentials.size > 32) {this.rawBlocked = true; this.incomplete('credential_limit');}
    } catch {this.rawBlocked = true; this.incomplete('credential_observation_error');}
  }
  payload(value) {
    if (!this.options.rawResponse) return {};
    if (this.rawBlocked) return {payload_unavailable: true};
    try {
      let text = typeof value === 'string' ? value : JSON.stringify(value);
      // Mask closed credential fields without round-tripping original SSE numbers, spacing or malformed JSON.
      text = text.replace(/("(?:authorization|cookie|set-cookie|apikey|api_key|access_token|refresh_token|id_token)"\s*:\s*)"(?:\\[\s\S]|[^"\\])*"/gi,
        '$1"[REDACTED_CREDENTIAL]"');
      for (const secret of [...this.credentials].sort((a, b) => b.length - a.length))
        for (const literal of new Set([secret, JSON.stringify(secret).slice(1, -1)])) text = text.replaceAll(literal, '[REDACTED_CREDENTIAL]');
      return {payload_utf8: text, payloadFormat: typeof value === 'string' ? 'sse_utf8' : 'sdk_json'};
    } catch { this.incomplete('raw_payload_serialization'); return {payload_unavailable: true}; }
  }
  observe(kind, receipt) {
    const item = this.progress[kind] ??= {count: 0, firstAt: receipt.receiptTime, lastAt: receipt.receiptTime, maxGapMs: 0};
    if (item.lastMonoMs !== undefined) item.maxGapMs = Math.max(item.maxGapMs, receipt.receiptMonoMs - item.lastMonoMs);
    item.count++; item.lastAt = receipt.receiptTime; item.lastMonoMs = receipt.receiptMonoMs;
  }
  record(event, fields = {}, receipt = now(), final = false) {
    const {_responsePayload, ...metadata} = fields;
    const row = {attempt: this.id, event, ...receipt, observerProcessingTime: new Date().toISOString(), ...metadata,
      ...(_responsePayload === undefined ? {} : this.payload(_responsePayload))};
    const encoded = JSON.stringify(row) + '\n';
    if (!final && (this.count >= (this.options.limits?.records ?? (this.options.rawResponse ? 100000 : limits.records)) || this.bytes + Buffer.byteLength(encoded) > (this.options.limits?.logBytes ?? (this.options.rawResponse ? 32 * 1024 * 1024 : limits.logBytes)))) {
      this.reasons.add('metadata_limit'); return;
    }
    if (this.failed) return;
    this.count++; this.bytes += Buffer.byteLength(encoded); this.pending.push(row); this.schedule();
  }
  incomplete(reason) { this.reasons.add(reason); }
  schedule() {
    if (this.flushing) return;
    this.flushing = true;
    this.flushPromise = new Promise(resolve => setImmediate(resolve)).then(async () => {
      try {
        while (this.pending.length) {
          const rows = this.pending.splice(0, 128);
          if (this.options.sink) { for (const row of rows) await this.options.sink(row); }
          else {
            if (!this.file) {
              const dir = join(this.options.directory, `process-${process.pid}`);
              await mkdir(dir, {recursive: true, mode: 0o700});
              this.file = await open(join(dir, `${this.id}.jsonl`), 'wx', 0o600);
            }
            await this.file.writeFile(rows.map(row => JSON.stringify(row) + '\n').join(''));
          }
        }
      } catch { this.failed = true; this.reasons.add('sink_error'); this.pending.length = 0; }
      finally { this.flushing = false; }
    });
  }
  wire() { const wire = new Wire(this); this.wires.push(wire); return wire; }
  async close() {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      if (!this.wires.length) this.incomplete('transport_not_observed');
      if (!this.iterationEnded) this.incomplete('normalized_not_fully_consumed');
      for (const wire of this.wires) if (!wire.terminalReceipt && !wire.done) wire.finishUnobserved();
      await Promise.all(this.wires.map(wire => wire.finished));
      this.record('attempt_summary', {complete: this.reasons.size === 0, incomplete: [...this.reasons], normalizedCount: this.normalizedCount,
        transportAttempts: this.wires.length, progress: Object.fromEntries(Object.entries(this.progress).map(([kind, {lastMonoMs, ...item}]) => [kind, item]))}, now(), true);
      await this.flush(); await this.file?.close().catch(() => {});
    })(); return this.closing;
  }
  async flush() { while (this.flushing || this.pending.length) { if (!this.flushing) this.schedule(); await this.flushPromise; } }
}

/** Independent SSE parser. Payloads leave its transient buffer only in explicitly requested raw mode. */
export class SseMetadataParser {
  constructor(record, markIncomplete, maxFrameBytes = limits.frameBytes, rawResponse = false) {
    this.record = record; this.markIncomplete = markIncomplete; this.max = maxFrameBytes;
    this.rawResponse = rawResponse;
    this.decoder = new TextDecoder('utf-8', {fatal: true}); this.buffer = ''; this.data = []; this.frameBytes = 0; this.ordinal = 0;
  }
  feed(chunk, receipt) {
    if (this.stopped) return;
    try { this.buffer += this.decoder.decode(chunk, {stream: true}); this.lines(receipt, false); }
    catch { this.stopped = true; this.markIncomplete('invalid_utf8'); this.buffer = ''; this.data = []; }
  }
  lines(receipt, end) {
    while (!this.stopped) {
      const match = /\r\n|\r|\n/.exec(this.buffer);
      if (!match || !end && match[0] === '\r' && match.index === this.buffer.length - 1) break;
      const line = this.buffer.slice(0, match.index); this.buffer = this.buffer.slice(match.index + match[0].length);
      this.frameBytes += Buffer.byteLength(line + match[0]);
      if (this.frameBytes > this.max) { this.stopped = true; this.markIncomplete('sse_frame_limit'); this.buffer = ''; this.data = []; break; }
      if (!line) {
        this.record('sse_boundary', {frameBytes: this.frameBytes}, receipt);
        if (this.data.length) {
          const text = this.data.join('\n'); let meta;
          if (text === '[DONE]') meta = {type: 'done'};
          else try { meta = typeMeta(JSON.parse(text)?.type); } catch { meta = {type: 'invalid_json'}; this.markIncomplete('invalid_sse_json'); }
          this.record('sse_event', {ordinal: ++this.ordinal, ...meta, dataBytes: Buffer.byteLength(text), frameBytes: this.frameBytes,
            ...(this.rawResponse ? {_responsePayload: text} : {})}, receipt);
        }
        this.data = []; this.frameBytes = 0;
      } else if (line.startsWith(':')) this.record('sse_comment', {bytes: Buffer.byteLength(line), ...(this.rawResponse ? {_responsePayload: line} : {})}, receipt);
      else if (line === 'data' || line.startsWith('data:')) this.data.push(line.slice(5).replace(/^ /, ''));
      else if (line === 'event' || line.startsWith('event:')) this.record('sse_event_field', typeMeta(line.slice(6).replace(/^ /, '')), receipt);
    }
    if (Buffer.byteLength(this.buffer) + this.frameBytes > this.max) { this.stopped = true; this.markIncomplete('sse_frame_limit'); this.buffer = ''; this.data = []; }
  }
  end(receipt) {
    if (this.stopped) return;
    try { this.buffer += this.decoder.decode(); this.lines(receipt, true); }
    catch { this.markIncomplete('invalid_utf8'); }
    if (this.buffer.length || this.data.length) this.markIncomplete('unterminated_sse_frame');
    this.buffer = ''; this.data = [];
  }
}

class Wire {
  constructor(trace) {
    this.trace = trace; this.id = randomUUID(); this.queue = []; this.queued = 0; this.decoded = 0; this.encoded = 0;
    this.first = undefined; this.last = undefined; this.maxGap = 0; this.parser = new SseMetadataParser((e, f, at) => this.record(e, f, at), r => trace.incomplete(r), trace.options.limits?.frameBytes, trace.options.rawResponse);
    this.finished = new Promise(resolve => { this.resolve = resolve; });
    this.record('transport_start', {byteDomain: 'http_entity_encoded_not_tcp_tls'});
    // Observation only: never delays or cancels the request if a transport omits its terminal callback.
    this.expiry = setTimeout(() => this.finishUnobserved(), trace.options.observerLifetimeMs ?? 30 * 60 * 1000); this.expiry.unref?.();
  }
  record(event, fields = {}, receipt = now(), final = false) {
    if (event === 'sse_event') this.trace.observe('sse', receipt);
    this.trace.record(event, {wire: this.id, ...fields}, receipt, final);
  }
  headers(status, headers, receipt) {
    this.headersReceipt = receipt;
    this.trace.credentialsFrom(headers);
    const encoding = (header(headers, 'content-encoding') ?? 'identity').trim().toLowerCase();
    const requestId = header(headers, 'x-request-id') ?? header(headers, 'request-id');
    this.requestIdHash = requestId ? hash(requestId) : undefined;
    const supported = ['identity', 'gzip', 'deflate', 'br'].includes(encoding);
    this.record('response_headers', {status, encoding: supported ? encoding : 'unsupported', ...(this.requestIdHash ? {requestIdHash: this.requestIdHash} : {})}, receipt);
    if (!supported) { this.trace.incomplete('unsupported_content_encoding'); this.parseStopped = true; return; }
    if (!/^text\/event-stream(?:;|$)/i.test(header(headers, 'content-type') ?? '')) { this.trace.incomplete('unsupported_content_type'); this.parseStopped = true; return; }
    if (encoding !== 'identity') {
      this.decoder = encoding === 'gzip' ? createGunzip() : encoding === 'br' ? createBrotliDecompress() : createInflate();
      this.decoder.on('data', chunk => this.decodedChunk(chunk, this.processingReceipt));
      this.decoder.on('error', () => { this.trace.incomplete('decompression_error'); this.finalize(); });
      this.decoder.on('end', () => { this.parser.end(this.terminalReceipt ?? now()); this.finalize(); });
    }
  }
  data(chunk, receipt) {
    const length = chunk.byteLength;
    if (this.last) this.maxGap = Math.max(this.maxGap, receipt.receiptMonoMs - this.last.receiptMonoMs);
    this.first ??= receipt; this.last = receipt; this.encoded += length;
    this.trace.observe('encoded', receipt);
    this.record('response_chunk', {bytes: length, byteDomain: 'http_entity_encoded_not_tcp_tls'}, receipt);
    if (this.parseStopped || this.done) return;
    if (this.queued + length > (this.trace.options.limits?.queuedBytes ?? limits.queuedBytes)) {
      this.trace.incomplete('observer_queue_limit'); this.parseStopped = true; this.queue.length = 0; this.queued = 0; return;
    }
    this.queue.push({chunk: Buffer.from(chunk), receipt}); this.queued += length; this.schedule();
  }
  decodedChunk(chunk, receipt) {
    if (this.parseStopped) return;
    this.decoded += chunk.length;
    if (this.decoded > (this.trace.options.limits?.decodedBytes ?? limits.decodedBytes)) { this.parseStopped = true; this.trace.incomplete('decoded_limit'); return; }
    this.record('decoded_chunk', {bytes: chunk.length, byteDomain: 'http_entity_decoded', receiptBasis: 'last_contributing_encoded_chunk'}, receipt);
    this.parser.feed(chunk, receipt);
  }
  schedule() {
    if (this.processing || this.done) return;
    this.processing = true; setImmediate(() => this.drain());
  }
  drain() {
    if (this.done) return;
    const item = this.queue.shift();
    if (item) {
      this.queued -= item.chunk.length; this.processingReceipt = item.receipt;
      if (this.decoder && !this.parseStopped) this.decoder.write(item.chunk, () => setImmediate(() => this.drain()));
      else { this.decodedChunk(item.chunk, item.receipt); setImmediate(() => this.drain()); }
      return;
    }
    this.processing = false;
    if (this.terminalReceipt) {
      if (this.decoder && !this.parseStopped) this.decoder.end();
      else { this.parser.end(this.terminalReceipt); this.finalize(); }
    }
  }
  end(event, error) {
    if (this.terminalReceipt || this.done) return;
    this.terminalReceipt = now(); this.terminalEvent = event;
    this.record(event, error ? errorMeta(error, this.trace.options.rawResponse) : {}, this.terminalReceipt);
    if (error) this.trace.incomplete('transport_error');
    this.schedule();
  }
  finishUnobserved() { if (!this.done) { this.trace.incomplete('transport_terminal_not_observed'); this.finalize(); } }
  finalize() {
    if (this.done) return; this.done = true; clearTimeout(this.expiry); this.decoder?.destroy(); this.queue.length = 0;
    this.record('transport_summary', {encodedBytes: this.encoded, decodedBytes: this.decoded, maxEncodedGapMs: this.maxGap,
      firstEncodedAt: this.first?.receiptTime ?? null, lastEncodedAt: this.last?.receiptTime ?? null,
      firstByteAfterHeadersMs: this.first && this.headersReceipt ? this.first.receiptMonoMs - this.headersReceipt.receiptMonoMs : null,
      terminalGapMs: this.last && this.terminalReceipt ? this.terminalReceipt.receiptMonoMs - this.last.receiptMonoMs : null, eofObserved: this.terminalEvent === 'transport_eof'}, now(), true);
    this.resolve();
  }
}

function shared() {
  return globalThis[SHARED] ??= {scope: new AsyncLocalStorage(), installed: new WeakSet(), active: new Set()};
}
/** Preserve the original handler interface, context, return value and exceptions. */
export function transportInterceptor(scope) {
  return dispatch => function (options, handler) {
    const call = scope.getStore();
    let matches = false;
    try { matches = call && new URL(String(options.origin)).origin === call.origin && String(options.path).split('?')[0] === call.path && options.method === 'POST'; } catch { /* an unrecognized transport remains unobserved */ }
    if (!matches) return dispatch(options, handler);
    call.trace.credentialsFrom?.(options.headers);
    let wire = call.trace.wire(), starts = 0;
    const modern = typeof handler.onRequestStart === 'function' || typeof handler.onResponseStart === 'function';
    const names = modern ? {start: 'onRequestStart', headers: 'onResponseStart', data: 'onResponseData', end: 'onResponseEnd', error: 'onResponseError'}
      : {start: 'onConnect', headers: 'onHeaders', data: 'onData', end: 'onComplete', error: 'onError'};
    const methods = new Set(Object.values(names));
    const observed = new Proxy(handler, {get(target, key) {
      const original = Reflect.get(target, key, target);
      if (typeof original !== 'function') return original;
      if (!methods.has(key)) return original.bind(target);
      return function (...args) {
        const receipt = now(), began = performance.now();
        // The original callback always runs first. Its value (including false) and thrown error are preserved.
        try { return Reflect.apply(original, target, args); }
        finally {
          const delegateEnded = performance.now();
          try {
            if (key === names.start) { if (starts++) { wire.end('transport_restarted'); wire = call.trace.wire(); } wire.record('request_started', {}, receipt); }
            else if (key === names.headers) wire.headers(args[modern ? 1 : 0], args[modern ? 2 : 1], receipt);
            else if (key === names.data) wire.data(args[modern ? 1 : 0], receipt);
            else if (key === names.end) wire.end('transport_eof');
            else if (key === names.error) wire.end('transport_error', args[modern ? 1 : 0]);
            wire.record('handler_exit', {callback: String(key), delegateDurationMs: delegateEnded - began, observerDurationMs: performance.now() - delegateEnded}, receipt);
          } catch { call.trace.incomplete('observer_callback_error'); }
        }
      };
    }});
    try { return dispatch(options, observed); }
    catch (error) { wire.end('transport_error', error); throw error; }
  };
}
function install(state, undici) {
  const current = undici.getGlobalDispatcher();
  if (state.installed.has(current)) return;
  if (typeof current.compose !== 'function') throw new Error('unsupported dispatcher');
  const composed = current.compose(transportInterceptor(state.scope)); state.installed.add(composed);
  undici.setGlobalDispatcher(composed);
}

/** Return undefined when disabled; the default provider registration is then byte-for-byte unchanged. */
export function createObservedGrokStream(delegate, options = {}) {
  const env = options.env ?? process.env;
  if (!options.enabled && env.PI_COC_GROK_TRANSPORT_TRACE !== '1') return undefined;
  const directory = options.directory ?? env.PI_COC_GROK_TRANSPORT_TRACE_DIR;
  if (!options.sink && (!directory || !isAbsolute(directory))) return undefined;
  const state = shared(), undici = options.undici ?? {getGlobalDispatcher, setGlobalDispatcher};
  return function (model, context, originalOptions) {
    if (model.provider !== 'grok-build' || model.api !== 'openai-responses') return delegate(model, context, originalOptions);
    const trace = new Trace({...options, rawResponse: options.rawResponse ?? env.PI_COC_GROK_TRANSPORT_TRACE_RAW === '1', apiKey: originalOptions?.apiKey, directory, requested: {provider: 'grok-build', api: 'openai-responses',
      model: typeof model.id === 'string' && /^[a-zA-Z0-9._:/-]{1,128}$/.test(model.id) ? model.id : 'redacted'}});
    try { options.onTrace?.(trace); } catch { trace.incomplete('observer_callback_error'); }
    let url;
    try { url = new URL(model.baseUrl); install(state, undici); }
    catch { trace.incomplete('dispatcher_unavailable'); void trace.close(); return delegate(model, context, originalOptions); }
    if (state.active.size >= 64) {trace.incomplete('observer_active_limit'); void trace.close(); return delegate(model, context, originalOptions);}
    state.active.add(trace);
    const call = {trace, origin: url.origin, path: url.pathname.replace(/\/$/, '') + '/responses'};
    const wrapped = {...originalOptions};
    for (const name of ['onPayload', 'onResponse', 'onProviderStreamEvent']) {
      const original = originalOptions?.[name];
      wrapped[name] = async (...args) => {
        const at = now(), began = performance.now();
        const span = ++trace.hookOrdinal;
        trace.record('sdk_hook_entry', {hook: name, span, ...(trace.sdkWire ? {wire: trace.sdkWire.id} : {})}, at);
        if (name === 'onProviderStreamEvent') {
          trace.observe('sdkRaw', at);
          trace.record('sdk_raw_event', {ordinal: ++trace.rawCount, ...typeMeta(args[0]?.type), ...(trace.sdkWire ? {wire: trace.sdkWire.id} : {}),
            ...(trace.options.rawResponse ? {_responsePayload: args[0]} : {})}, at);
        }
        if (name === 'onResponse') {
          trace.sdkWire = undefined;
          const id = header(args[0]?.headers, 'x-request-id') ?? header(args[0]?.headers, 'request-id'), requestIdHash = id ? hash(id) : undefined;
          const candidates = trace.wires.filter(wire => !wire.sdkBound && (!requestIdHash || wire.requestIdHash === requestIdHash));
          if (candidates.length === 1) {trace.sdkWire = candidates[0]; trace.sdkWire.sdkBound = true;} else trace.incomplete('response_correlation_unavailable');
          trace.record('sdk_response', {...(requestIdHash ? {requestIdHash} : {}), ...(trace.sdkWire ? {wire: trace.sdkWire.id} : {})}, at);
        }
        try { return await original?.(...args); }
        finally { trace.record('sdk_hook_exit', {hook: name, span, durationMs: performance.now() - began, ...(trace.sdkWire ? {wire: trace.sdkWire.id} : {})}, at); }
      };
    }
    const abort = () => trace.record('local_abort', {origin: 'caller_signal', ...errorMeta(originalOptions?.signal?.reason, trace.options.rawResponse)});
    if (originalOptions?.signal?.aborted) abort();
    originalOptions?.signal?.addEventListener('abort', abort, {once: true});
    const finish = () => { originalOptions?.signal?.removeEventListener('abort', abort); void trace.close().finally(() => state.active.delete(trace)); };
    let stream;
    try { stream = state.scope.run(call, () => delegate(model, context, wrapped)); }
    catch (error) { trace.record('delegate_error', errorMeta(error, trace.options.rawResponse)); finish(); throw error; }
    return new Proxy(stream, {get(target, key) {
      if (key === Symbol.asyncIterator) return () => {
        trace.iterated = true;
        const iterator = target[Symbol.asyncIterator]();
        return {[Symbol.asyncIterator]() { return this; }, next(...args) {
          const result = iterator.next(...args);
          void Promise.resolve(result).then(value => {
            if (value.done) {trace.iterationEnded = true; finish();}
            else {const at = now(); trace.observe('normalized', at); trace.normalizedCount++; trace.record('normalized_consumed', {ordinal: trace.normalizedCount, ...typeMeta(value.value?.type), ...(trace.sdkWire ? {wire: trace.sdkWire.id} : {})}, at);}
          }, error => {trace.record('normalized_error', errorMeta(error, trace.options.rawResponse)); finish();});
          return result;
        }, return(...args) {trace.incomplete('consumer_return'); finish(); return iterator.return?.(...args) ?? Promise.resolve({done: true});},
        throw(...args) {trace.incomplete('consumer_throw'); finish(); return iterator.throw?.(...args) ?? Promise.reject(args[0]);}};
      };
      const value = Reflect.get(target, key, target);
      if (key === 'result' && typeof value === 'function') return (...args) => {
        const result = Reflect.apply(value, target, args); void Promise.resolve(result).then(finish, finish); return result;
      };
      return typeof value === 'function' ? value.bind(target) : value;
    }});
  };
}
