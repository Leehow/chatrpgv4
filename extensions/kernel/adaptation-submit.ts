/** Private checked submission for one tool-enabled adaptation creator or reviewer. */
import {readFileSync, writeFileSync, renameSync} from 'node:fs';
import {join} from 'node:path';
import {Type} from 'typebox';
import {Check} from 'typebox/value';
import {ADAPTATION_FIELDS} from '../../shared/adaptation-fields.ts';

const text=()=>Type.String({minLength:1});
const verdict=()=>Type.Union(['supported','contradicted','unclear'].map(value=>Type.Literal(value)));
const creator=Type.Object({explanation:text(),changes:Type.Array(Type.Union(Object.entries(ADAPTATION_FIELDS).map(([kind,fields])=>Type.Object({
    kind:Type.Literal(kind),reason:text(),sources:Type.Array(text(),{minItems:1,maxItems:12}),
    ...Object.fromEntries(fields.map(field=>[field,kind==='scene'&&field==='name'?Type.Optional(text()):text()]))
},{additionalProperties:false}))),{maxItems:24})},{additionalProperties:false});
const reviewer=Type.Object({verdict:verdict(),summary:text(),issues:Type.Array(Type.String()),checked:Type.Array(Type.Object({
    index:Type.Integer({minimum:0}),verdict:verdict(),reason:text()
},{additionalProperties:false}))},{additionalProperties:false});

export default function adaptationSubmit(pi: any) {
    const role = process.env.PI_COC_ADAPTATION_SUBMIT_ROLE;
    if (!['create', 'review'].includes(role ?? '')) throw new Error('Adaptation submission needs a creator or reviewer role');
    const cwd = process.env.PI_COC_ADAPTATION_SUBMIT_DIR ?? process.cwd();
    const parameters=Type.Object({result:role==='create'?creator:reviewer},{additionalProperties:false});
    let submitted = false, reminded = false;
    pi.on('tool_result', (event: any) => {
        if (event.toolName === 'submit_adaptation' && event.details?.kind === 'adaptation_submission_error') return {isError: true};
    });
    pi.on('agent_end', () => {
        if (submitted || reminded) return;
        reminded = true;
        pi.sendMessage({customType: 'adaptation-submit-required', display: false,
            content: 'Call submit_adaptation now with the result object you already reached. Do not reread files, repeat analysis, or output the JSON as ordinary text.'},
            {triggerTurn: true, deliverAs: 'followUp'});
    });
    pi.registerTool({name: 'submit_adaptation', label: 'Submit adaptation artifact', executionMode: 'sequential',
        description: `Submit the final ${role} object directly. A checked submission writes result.json and immediately ends this private task.`,
        parameters,
        async execute(_id: string, params: any) {
            if (!Check(parameters,params)||!String(params.result.explanation??params.result.summary).trim()) return {content: [{type: 'text', text: `Invalid ${role} result shape. Use the declared object and array fields; changes, sources, issues and checked are arrays, never item wrapper objects.`}],
                isError: true, details: {kind: 'adaptation_submission_error', role}};
            const path = join(cwd, 'result.json'), temp = path + '.tmp';
            writeFileSync(temp, JSON.stringify(params.result) + '\n'); renameSync(temp, path);
            submitted = true;
            return {content: [{type: 'text', text: 'Adaptation artifact submitted.'}],
                details: {kind: 'adaptation_submission', role}, terminate: true};
        }});
}
