#!/usr/bin/env node
// SL-97c: extract the thresholds the ticket asked for (0.8, 0.85, 0.87, 0.9, 0.95) per revision and class from
// sl97b-analyze.mjs's own analysis.json output -- no new computation, just a narrower table than the full
// threshold sweep analysis.md already prints. Reads stored analysis output only, no live call.
//
//   node experiments/admission-jev-bank/sl97c-key-thresholds.mjs --dir <results/sl97c> --out <results/sl97c>
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const argv = process.argv.slice(2), arg = name => argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined;
const dir = arg('--dir'), outDir = arg('--out') ?? dir;
if (!dir) throw new Error('--dir is required');

const THRESHOLDS = [0.8, 0.85, 0.87, 0.9, 0.95];
const CLASSES = ['time', 'move', 'clue', 'resolve', 'other'];
const ARMS = {'v1-rerun': 'v1', 'it1-2a.1': '2a.1', 'it2-2a.2': '2a.2', 'it3-2a.3': '2a.3', 'holdout-2a.3': '2a.3'};
const COMBOS = [['main', 'both-refuse'], ['main', 'either-refuse'], ['holdout', 'both-refuse'], ['holdout', 'either-refuse']];
const pct = value => value === null || value === undefined ? '-' : `${(100 * value).toFixed(1)}%`;

const rows = [];
for (const [sample, def] of COMBOS) {
  const report = JSON.parse(readFileSync(join(dir, `analysis-${sample}-${def}`, 'analysis.json'), 'utf8'));
  for (const [armKey, label] of Object.entries(ARMS)) {
    const arm = report.arms[armKey];
    if (!arm) continue;
    for (const cls of CLASSES) for (const threshold of THRESHOLDS) {
      const row = arm.by_threshold.find(entry => entry.threshold === threshold).per_class[cls];
      rows.push({sample, def, revision: label, cls, threshold, settled_admits: row.settled_admits, false_admits: row.false_admits,
        false_admit_share_class_natural: row.false_admit_share_class_natural, false_admit_share_class_natural_upper: row.false_admit_share_class_natural_upper});
    }
  }
}
writeFileSync(join(outDir, 'key-thresholds.json'), JSON.stringify(rows, null, 2) + '\n');

const lines = ['# SL-97c key thresholds: settled admits / false admits, per revision and class', '',
  'Re-scored from phase 2a\'s stored typed answers against today\'s lane (this folder, `relabel.jsonl` + `sl97c-labels.mjs`). ' +
  'FA share is the class-natural share (bank refusal rate weighting) with its Wilson upper bound.', ''];
for (const [sample, def] of COMBOS) {
  lines.push(`## ${sample}, ${def} definition`, '');
  const revisions = sample === 'holdout' ? [['holdout-2a.3', '2a.3']] : [['v1-rerun', 'v1'], ['it1-2a.1', '2a.1'], ['it2-2a.2', '2a.2'], ['it3-2a.3', '2a.3']];
  for (const [armKey, label] of revisions) {
    lines.push(`### ${label}`, '', `| class | ${THRESHOLDS.map(t => `T=${t}`).join(' | ')} |`, `| --- | ${THRESHOLDS.map(() => '---').join(' | ')} |`);
    for (const cls of CLASSES) {
      const cells = THRESHOLDS.map(threshold => {
        const row = rows.find(value => value.sample === sample && value.def === def && value.revision === label && value.cls === cls && value.threshold === threshold);
        return `${row.settled_admits}/${row.false_admits}, ${pct(row.false_admit_share_class_natural)} (<= ${pct(row.false_admit_share_class_natural_upper)})`;
      });
      lines.push(`| ${cls} | ${cells.join(' | ')} |`);
    }
    lines.push('');
  }
}
writeFileSync(join(outDir, 'key-thresholds.md'), lines.join('\n') + '\n');
process.stdout.write(`wrote ${rows.length} rows\n`);
