import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {readVaultSecret} from '../../experiments/single-loop-routing/vault.mjs';
import {createDecisionAdapter} from '../../runtime/jev/decision-adapter.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
import {claimFields, claimSupportBindings, runClaimSupport} from '../../runtime/jev/source-claim-support.ts';
const home = process.argv[2];
const key = readVaultSecret('EXT_JEV_APIKEY');
if (!key) throw new Error('no Jev key in the vault');
const env = {EXT_JEV_APIKEY: key};
const cast = JSON.parse(readFileSync(`${home}/.coc/modules/book-2/cast-source.json`, 'utf8'));
const pageText = n => cast.pages.find(p => p.page === n).text;
const sha = t => createHash('sha256').update(t, 'utf8').digest('hex');
const pages = new Map([34, 8].map(n => [n, {page: n, text: pageText(n), text_sha256: sha(pageText(n))}]));
const budget = {mode: 'on', supportedMin: 0.93, contradictedMax: 0.2, timeoutMs: 60000, pageTextMaxBytes: 12000, recordMaxBytes: 6000, maxPagesPerRequest: 4};
const statements = {F1: '嘉琳娜已故的丈夫。', F2: '瓦西里已经去世。', T1: '嘉琳娜的丈夫；嘉琳娜死后他愈发沮丧。', T2: '嘉琳娜的前夫'};
const page = Number(process.argv[3] ?? 34);
const nodes = Object.entries(statements).map(([k, summary]) => ({node_id: `npc-vasili-${k}`, node_kind: 'npc', name: '瓦西里·维克托罗维奇·斯莫斯基', summary, source_refs: [{page}]}));
const draft = {nodes, claims: []};
const candidates = nodes.map((node, i) => ({root: `/nodes/${i}`, paths: [`/nodes/${i}`], pages: [page], statement: {}, fields: claimFields(draft, `/nodes/${i}`, {}).filter(f => f.field.startsWith('summary'))}));
const input = {module: 'book-2', job: 'probe', sourceSha256: 'e4832eec', extractionVersion: 'probe', candidates, pages, budget};
const out = [];
for (let r = 0; r < Number(process.argv[4] ?? 3); r++) {
  const b = claimSupportBindings(input);
  const lease = new TaskLease({owner: 'source-claim-support', goal: 'probe', scope: b.scope, capabilities: ['decision'], readSet: b.readSet,
    budget: {deadlineAt: Date.now() + 60000, remainingInputTokens: 200000, remainingOutputTokens: 200000, remainingCostUsd: 1, remainingActions: 20}});
  const decision = createDecisionAdapter({env, maxConcurrency: 4});
  const res = await runClaimSupport(input, decision, lease); lease.close();
  for (const [i, v] of res.verdicts.entries()) out.push({repeat: r, statement: Object.keys(statements)[Number(v.root.split('/')[2])], answers: v.answers});
}
for (const row of out) console.log(row.repeat, row.statement, JSON.stringify(row.answers));
writeFileSync(join(home, 'jev-vasili-out.json'), JSON.stringify(out, null, 1));
