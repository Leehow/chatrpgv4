// The product's own batch (runtime/jev/untold-name-spans.ts: nameSpanBatch, markSpan) over the probe cases.
import {readFileSync} from 'node:fs';
import {readVaultSecret} from '../single-loop-routing/vault.mjs';
import {nameSpanBatch, markSpan, NAME_SPAN_AT} from '../../runtime/jev/untold-name-spans.ts';
const key = process.env.EXT_JEV_APIKEY || readVaultSecret('EXT_JEV_APIKEY');
if (!key) { console.log('no key'); process.exit(2); }
let wrong = 0, lowName = 1, highOther = 0;
for (const file of ['./cases-round1.json', './cases-round2.json']) {
  const cases = JSON.parse(readFileSync(new URL(file, import.meta.url)));
  const spans = cases.map(c => { const at = c.text.indexOf(c.name); return {name: c.name, text: markSpan(c.text, at, at + c.name.length)}; });
  const batch = nameSpanBatch(spans, 'probe');
  const body = {model: batch.model, state: batch.state, questions: Object.fromEntries(batch.questions.map(q => [q.key, {type: q.type, instructions: q.instructions}]))};
  const began = Date.now();
  const res = await fetch('https://api.typesafe.ai/v1/systemone', {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${key}`}, body: JSON.stringify(body)});
  const json = await res.json();
  if (!res.ok) { console.log('status', res.status); process.exit(1); }
  cases.forEach((c, i) => {
    const p = json.answers[`names_s${i + 1}`]?.noul, verdict = p >= NAME_SPAN_AT ? 'yes' : 'no';
    if (c.expect === 'yes') lowName = Math.min(lowName, p); if (c.expect === 'no') highOther = Math.max(highOther, p);
    const ok = c.expect === 'any' || verdict === c.expect; if (!ok) wrong++;
    console.log(c.id.padEnd(4), c.expect.padEnd(3), p?.toFixed(2), ok ? '' : '<-- WRONG');
  });
  console.log(file, Date.now() - began, 'ms');
}
console.log('wrong', wrong, 'lowest name', lowName, 'highest other word', highOther);
