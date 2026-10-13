/** Standalone tools for a benchmark judge; records only findings cited in retained turns. */
import { readFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
type Row = Record<string, any>;
export const HERE = dirname(fileURLToPath(import.meta.url)), PACKET = join(HERE, 'judge-packet.json'), FINDINGS = join(HERE, 'judgement.jsonl'), REFUSALS = join(HERE, 'judge-refusals.jsonl'), VERDICTS = ['ok', 'violation'];
export const packet = () => JSON.parse(readFileSync(PACKET, 'utf8'));
export const normalise = (text: string) => text.normalize('NFKC').replace(/\s/g, '');
export const turn_text = (turn: Row) => ['keeper_text', 'player_message'].map(field => String(turn[field] || '')).join(' ');
const pyrepr = (text: string) => { const quote = text.includes("'") && !text.includes('"') ? '"' : "'"; return quote + text.replaceAll('\\', '\\\\').replaceAll(quote, '\\' + quote).replaceAll('\n', '\\n').replaceAll('\r', '\\r').replaceAll('\t', '\\t') + quote; };
const pyjson = (v: any) => JSON.stringify(v).replace(/([,:])(?=(?:[^"\\]|\\.)*(?:"(?:[^"\\]|\\.)*"(?:[^"\\]|\\.)*)*$)/g, '$1 ');
export function cmd_questions(_args: Row, data: Row) { for (const q of data.questions)
    console.log(`[${q.id}]\n${q.question}\n${q.good_answer}\n`); return 0; }
export function cmd_turns(_args: Row, data: Row) { for (const turn of data.turns) {
    const player = (turn.player_message || '(opening: no player input)').replaceAll('\n', ' '), keeper = (turn.keeper_text || '').replaceAll('\n', ' ');
    console.log(`turn ${turn.turn}: player=${pyrepr([...player].slice(0, 90).join(''))} keeper=${pyrepr([...keeper].slice(0, 110).join(''))} receipts=${(turn.receipts || []).length}`);
} return 0; }
export function cmd_turn(args: Row, data: Row) { for (const turn of data.turns)
    if (turn.turn === args.n) {
        console.log(JSON.stringify(turn, null, 1));
        return 0;
    } console.error('no turn ' + args.n + ' in this run'); return 1; }
export function cmd_truth(args: Row, data: Row) { for (const row of data.module_truth.filter((r: Row) => !args.kind || r.kind === args.kind))
    console.log(['kind', 'visibility', 'name', 'summary'].map(k => row[k] == null ? 'None' : String(row[k])).join('\t')); return 0; }
export function cmd_record(args: Row, data: Row) { const allowed = new Set(data.questions.map((q: Row) => q.id)), turns = new Map(data.turns.map((t: Row) => [t.turn, t])), quote = (args.quote || '').trim(); const refuse = (reason: string) => { appendFileSync(REFUSALS, pyjson({ metric: args.metric, turn: args.turn, verdict: args.verdict, quote, reason }) + '\n'); console.error('refused: ' + reason); return 2; }; if (!allowed.has(args.metric))
    return refuse(pyrepr(args.metric) + " is not one of this run's questions: [" + [...allowed].sort().map(x => pyrepr(String(x))).join(', ') + ']'); if (!turns.has(args.turn))
    return refuse('turn ' + args.turn + ' is not in this run'); if (!VERDICTS.includes(args.verdict))
    return refuse("verdict must be one of ('ok', 'violation')"); if (!quote)
    return refuse('a finding without a quote is not a finding'); if (!normalise(turn_text(turns.get(args.turn) as Row)).includes(normalise(quote)))
    return refuse('that sentence does not occur in turn ' + args.turn); appendFileSync(FINDINGS, pyjson({ metric: args.metric, turn: args.turn, verdict: args.verdict, quote, why: args.why || '' }) + '\n'); console.log(`recorded ${args.verdict} for ${args.metric} at turn ${args.turn}`); return 0; }
export function main(argv = process.argv.slice(2)) { const args: Row = { command: argv[0], kind: null, why: '' }; if (!['questions', 'turns', 'turn', 'truth', 'record'].includes(args.command)) {
    console.error('usage: judge-tools.ts questions|turns|turn|truth|record');
    return 2;
} for (let i = 1; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
        const k = argv[i].slice(2);
        args[k] = k === 'turn' ? Number(argv[++i]) : argv[++i];
    }
    else
        args.n = Number(argv[i]);
} if (args.command === 'record' && ['metric', 'turn', 'verdict', 'quote'].some(k => !Object.hasOwn(args, k)) || args.command === 'turn' && !Number.isInteger(args.n)) {
    console.error('required command arguments are missing');
    return 2;
} return ({ questions: cmd_questions, turns: cmd_turns, turn: cmd_turn, truth: cmd_truth, record: cmd_record } as Row)[args.command](args, packet()); }
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
    process.exitCode = main();
