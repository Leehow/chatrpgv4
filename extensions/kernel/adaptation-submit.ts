/** Private checked submission for one tool-enabled adaptation creator or reviewer. */
import {readFileSync, writeFileSync, renameSync} from 'node:fs';
import {join} from 'node:path';
import {Type} from 'typebox';

const valid = (role: string, value: any): boolean => role === 'create'
    ? value && typeof value === 'object' && !Array.isArray(value) && typeof value.explanation === 'string' && value.explanation.trim() && Array.isArray(value.changes)
    : value && typeof value === 'object' && !Array.isArray(value) && ['supported', 'contradicted', 'unclear'].includes(value.verdict)
        && typeof value.summary === 'string' && value.summary.trim() && Array.isArray(value.issues) && Array.isArray(value.checked);

export default function adaptationSubmit(pi: any) {
    const role = process.env.PI_COC_ADAPTATION_SUBMIT_ROLE;
    if (!['create', 'review'].includes(role ?? '')) throw new Error('Adaptation submission needs a creator or reviewer role');
    const cwd = process.env.PI_COC_ADAPTATION_SUBMIT_DIR ?? process.cwd();
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
        parameters: Type.Object({result: Type.Any()}),
        async execute(_id: string, params: any) {
            if (!valid(role!, params.result)) return {content: [{type: 'text', text: `Invalid ${role} result shape`}],
                isError: true, details: {kind: 'adaptation_submission_error', role}};
            const path = join(cwd, 'result.json'), temp = path + '.tmp';
            writeFileSync(temp, JSON.stringify(params.result) + '\n'); renameSync(temp, path);
            submitted = true;
            return {content: [{type: 'text', text: 'Adaptation artifact submitted.'}],
                details: {kind: 'adaptation_submission', role}, terminate: true};
        }});
}
