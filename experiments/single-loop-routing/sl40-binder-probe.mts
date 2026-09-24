// SL-40 probe (run from the repo root: node experiments/single-loop-routing/sl40-binder-probe.mts; needs EXT_JEV_APIKEY): book A turn 5's bridge sentence through the single-loop binder with live Jev.
import {readFileSync} from 'node:fs';
import {prepareCheckPreflight} from '../../runtime/jev/check-preflight.ts';
import {createDecisionAdapter} from '../../runtime/jev/decision-adapter.ts';
import {TaskLease} from '../../runtime/jev/task-context.ts';
const camp = '/Users/haoli/leehow/code/chatrpgv4-wt-pdf-a/.coc/playtests/sl29-a-run2/home/.coc/campaigns/sl29a-xuese-1436';
const sheet = JSON.parse(readFileSync(`${camp}/party/investigator.json`, 'utf8'));
const t5 = readFileSync(`${camp}/telemetry.jsonl`, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).find(r => r.turn === 5 && r.purpose === 'bind-ordinary' && r.lane === 'route');
const CH = new Set(['STR','CON','SIZ','DEX','APP','INT','POW','EDU','LUCK']);
const skills = Object.keys(t5.skill.distribution).filter(s => s !== 'unknown');
const rows = skills.map((skill, i) => ({alias: `profile:${i}`, actor: sheet.name, skill, availability: 'bound', value: sheet.skills[skill] ?? sheet.characteristics[skill] ?? 1, held: Object.hasOwn(sheet.skills, skill) || CH.has(skill)}));
const input = '过那座旧木桥之前我先下车，看看桥板和桥桩结不结实。';
const options = {version: 1, profiles: rows, decisions: [{name: 'core-check:ordinary-check', family: 'core-check', description: 'Ordinary check', capability: 'check'}], revision: 'r', world_revision: 'w',
  context: {_binding: {campaign: 'c1', worldline: 'main', loop: 0, turn: 5}, scene: '序幕', pending_choice: null, session: null, conditions: [], current_receipts: [], declared_action: input}};
const scope = {owner: 'sl40-probe', campaign: 'c1', worldline: 'main', loop: 0, audience: 'keeper'}, readSet = [{kind: 'world', resource: 'c1', revision: 'w'}];
const decision = createDecisionAdapter({env: process.env});
for (const arm of ['held', 'legacy']) for (let run = 1; run <= 3; run++) {
  const lease = new TaskLease({owner: 'sl40', goal: input, scope, capabilities: ['decision'], readSet, budget: {deadlineAt: Date.now() + 30000, remainingInputTokens: 400000, remainingOutputTokens: 40000, remainingCostUsd: 2, remainingActions: 10}});
  const r = await prepareCheckPreflight({campaign: 'c1', turn: 5, rawInput: input, scope, readSet, lease, call: async () => structuredClone(options), decision, compiled: {intent: 'investigate'}, ...(arm === 'held' ? {defaults: {gate: 0.6}} : {})});
  lease.close();
  const top = (d: any) => d ? Object.entries(d).sort((a: any, b: any) => b[1] - a[1]).slice(0, 3).map(([k, v]: any) => `${k} ${v}`).join(', ') : null;
  console.log(JSON.stringify({arm, run, skill: r.advice.action?.skill ?? null, disposition: r.advice.disposition, profile: r.evidence?.profile && {choice: r.evidence.profile.choice, confidence: r.evidence.profile.confidence, held: r.evidence.profile.held, named: r.evidence.profile.named, top: top(r.evidence.profile.probabilities)},
    named: r.evidence?.named && {choice: r.evidence.named.choice, confidence: r.evidence.named.confidence, top: top(r.evidence.named.probabilities)}}));
}
