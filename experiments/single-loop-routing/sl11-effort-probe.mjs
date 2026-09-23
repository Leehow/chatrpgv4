// SL-11 scope 3: which `reasoning.effort` values the Grok Build Responses API accepts for the Keeper model.
//   node experiments/single-loop-routing/sl11-effort-probe.mjs [model]   (default grok-4.7-build-fast)
// Reads the App's grok-build access token in-process (never printed, never written); refuses to run when the
// token has less than 30 minutes left, so no refresh (and no refresh-token rotation) can be triggered.
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

const auth = JSON.parse(readFileSync(join(homedir(), 'Library/Application Support/Pipi/pipicoc/pi-coc/agent/auth.json'), 'utf8'))['grok-build'];
if (!auth || typeof auth.access !== 'string' || auth.expires - Date.now() < 30 * 60_000) { console.log('token missing or near expiry: not probing'); process.exit(2); }
const model = process.argv[2] ?? 'grok-4.7-build-fast';
const prompt = 'A shop sells pens at 3 for $2. How many dollars do 27 pens cost? Answer with the number only.';
const variants = [
  ['omitted', undefined], ['none', {effort: 'none'}], ['off', {effort: 'off'}], ['minimal', {effort: 'minimal'}], ['low', {effort: 'low'}],
  ['medium', {effort: 'medium'}], ['high', {effort: 'high'}], ['xhigh', {effort: 'xhigh'}], ['max', {effort: 'max'}],
];
const redact = text => String(text).split(auth.access).join('<token>').slice(0, 300);
const rows = [];
for (const rep of [1, 2]) for (const [name, reasoning] of variants) {
  const began = Date.now();
  let status = 0, body = {};
  try {
    const response = await fetch('https://api.x.ai/v1/responses', {method: 'POST',
      headers: {authorization: `Bearer ${auth.access}`, 'content-type': 'application/json'},
      body: JSON.stringify({model, stream: false, input: [{role: 'user', content: prompt}], ...(reasoning ? {reasoning} : {})}), signal: AbortSignal.timeout(90_000)});
    status = response.status;
    body = await response.json().catch(() => ({}));
  } catch (error) { body = {error: {message: String(error)}}; }
  const usage = body.usage ?? {};
  const text = (body.output ?? []).flatMap(item => item.content ?? []).map(part => part.text ?? '').join('').trim();
  rows.push({rep, effort: name, status, ms: Date.now() - began, accepted: status === 200,
    echoed_effort: body.reasoning?.effort ?? null, output_tokens: usage.output_tokens ?? null,
    reasoning_tokens: usage.output_tokens_details?.reasoning_tokens ?? null, answer: text.slice(0, 40),
    error: status === 200 ? null : redact(body.error?.message ?? body.error ?? JSON.stringify(body).slice(0, 300))});
  console.log(JSON.stringify(rows.at(-1)));
}
