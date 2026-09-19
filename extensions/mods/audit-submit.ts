/** Private checked audit submission; it neither opens a kernel nor publishes narration. */
import {readFileSync, writeFileSync, renameSync} from 'node:fs';
import {join, basename} from 'node:path';
import {Type} from 'typebox';
import {continuityArtifactErrors, normalizeContinuityArtifact} from '../../kernel-ts/mods/audit-result.ts';
import {auditEvidenceView} from './audit-evidence.ts';

export default function auditSubmit(pi: any) {
    const controlPath = process.env.PI_COC_AUDIT_CONTROL;
    if (!controlPath) throw new Error('Audit submission needs a host control file');
    const control = JSON.parse(readFileSync(controlPath, 'utf8')), cwd = process.cwd();
    const request = JSON.parse(readFileSync(join(cwd, 'request.json'), 'utf8'));
    const evidenceFiles = () => Object.fromEntries(request.continuity_review.files.map((name: string) => {
        if (!['context.json', 'original.json', 'effective.json', 'world.json', 'current.json', 'history.json', 'handouts.json', 'notes.json', 'memory.json'].includes(name)) throw new Error('Invalid evidence file index');
        return [name, JSON.parse(readFileSync(join(cwd, name), 'utf8'))];
    }));
    let requests = 0, repairs = 0, submissionReminder = false;
    const status = {requests: 0, artifact_repairs: 0, submitted: false, unavailable: ''};
    const save = () => {
        status.requests = requests; status.artifact_repairs = repairs;
        const path = join(cwd, basename(control.status_file)), tmp = path + '.tmp';
        writeFileSync(tmp, JSON.stringify(status)); renameSync(tmp, path);
    };
    const unavailable = (reason: string) => {
        status.unavailable = reason; save();
        return {content: [{type: 'text', text: reason}], isError: true,
            details: {kind: 'audit_unavailable', ...status}, terminate: true};
    };
    pi.on('before_provider_request', (_event: any, ctx: any) => {
        if (requests >= control.max_requests) {
            status.unavailable = 'The private audit reached its model-call limit without a checked submission'; save();
            // Pi reports hook errors but otherwise continues. Abort the actual request signal too.
            ctx?.abort();
            throw new Error(status.unavailable);
        }
        requests++; save();
    });
    pi.on('tool_result', (event: any) => {
        if (event.toolName === 'submit_audit' && ['audit_artifact_error', 'audit_unavailable'].includes(event.details?.kind))
            return {isError: true};
    });
    pi.on('agent_end', () => {
        if (status.submitted || status.unavailable || submissionReminder) return;
        if (requests >= control.max_requests) { status.unavailable = 'No checked submission within the audit allowance'; save(); return; }
        submissionReminder = true;
        pi.sendMessage({customType: 'audit-submit-required', display: false,
            content: 'The audit has not been submitted. Reuse the conclusion you just reached and call submit_audit now, passing the review object as result. Do not repeat searches or output ordinary text. If evidence is insufficient, submit an unavailable verdict.'},
            {triggerTurn: true, deliverAs: 'followUp'});
    });
    pi.registerTool({
        name: 'read_audit_evidence', label: 'Read pinned review evidence', executionMode: 'sequential',
        description: 'Read a focused view without writing JSON query scripts. Choose objects for complete object/weapon lookup, history for specific turn numbers (or the latest six), memory for attributed records and corrections, or source for exact named graph entries. Use names copied from the context; no opaque IDs. Full evidence remains available when the view is truncated.',
        parameters: Type.Object({kind: Type.Union(['objects', 'history', 'memory', 'source'].map(v => Type.Literal(v))),
            names: Type.Optional(Type.Array(Type.String(), {maxItems: 12})), turns: Type.Optional(Type.Array(Type.Integer(), {maxItems: 12}))}),
        async execute(_id: string, params: any) {
            const result = auditEvidenceView(params.kind, evidenceFiles(), params.names, params.turns);
            return {content: [{type: 'text', text: JSON.stringify(result)}], details: {kind: 'audit_evidence', ...result}};
        }
    });
    pi.registerTool({
        name: 'submit_audit', label: 'Submit continuity review', executionMode: 'sequential',
        description: 'Submit the review directly as result, or omit it to validate result.json. Successful validation ends this audit immediately. Invalid fields are returned together for one targeted repair; do not rewrite the Keeper candidate or recheck unrelated evidence.',
        parameters: Type.Object({result: Type.Optional(Type.Any({description: 'Review object: {missing:[], findings:[], continuity_review:{verdict:"pass"|"revise"|"unavailable",summary:string,conflicts:[]}} plus the exact required intelligibility_review, player_address_review and conditional locus_review, outcome_review and reentry_review objects from context.json. Only material conflicts need {claim,reason,evidence:[{file,quote}]}. Pass needs empty issue lists.'}))}),
        async execute(_id: string, params: any) {
            let result: any, files: Record<string, unknown> = {};
            try {
                files = evidenceFiles();
                result = normalizeContinuityArtifact(params.result ?? JSON.parse(readFileSync(join(cwd, 'result.json'), 'utf8')), files);
                if (Buffer.byteLength(JSON.stringify(result)) > 512000) return unavailable('The audit artifact exceeds its size bound');
            } catch (error) { return unavailable(`The retained audit input or artifact could not be read: ${error instanceof Error ? error.message : String(error)}`); }
            const errors = continuityArtifactErrors(result, request.input.text, files);
            if (errors.length) {
                writeFileSync(join(cwd, `rejected-artifact-${basename(control.status_file)}-${repairs}.json`), JSON.stringify(result));
                if (repairs >= control.max_artifact_repairs) return unavailable('The audit artifact still has invalid fields after its targeted repair');
                repairs++; save();
                return {content: [{type: 'text', text: JSON.stringify({reason: 'audit_artifact_invalid', errors})}],
                    isError: true, details: {kind: 'audit_artifact_error', errors, artifact_repairs: repairs}};
            }
            const path = join(cwd, 'result.json'); writeFileSync(path + '.tmp', JSON.stringify(result) + '\n'); renameSync(path + '.tmp', path);
            status.submitted = true; save();
            return {content: [{type: 'text', text: 'Review artifact checked; the host will recheck live evidence freshness.'}],
                details: {kind: 'audit_submission', ...status}, terminate: true};
        }
    });
}
