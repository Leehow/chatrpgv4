/** Read-only host checks use publication validators without constructing a kernel. */
import { dirname, join } from 'node:path';
import { snapshots } from './snapshots.js';
import { RpcError, internalError } from './errors.js';
import { loadModuleContract } from './modules/contract.js';
import { checkDraft, checkOpeningBatch, requiredViewPages } from './modules/visual.js';
import { array, number, row, type Row } from './read/values.js';
import { ANSWER_REVIEW_PATHS, checkSourceAnswer } from './modules/source-answer.js';
import { validateDefinition } from './mods/definition.js';
import {validateUsage} from './mods/usages.js';
import {gatePreset, presetOf} from './mods/preset.js';
export { pythonJsonDumps as serializeCheckResult } from './json.js';
export { parsePythonJson as parseCheckResult } from './json.js';
export const checkModDefinition = (path: string) => checkObjectParameters(path,validateDefinition);
export const checkObjectUsage = (path: string) => checkObjectParameters(path,validateUsage);
/**
 * Contract §138.7: a draft in a job directory whose packet carries a weapon preset passes the same preset gate the
 * kernel runs at acceptance, so the child's repair round hears the same findings; any other draft is checked as before.
 */
async function packetPreset(path: string): Promise<Row | null> {
    const request = join(dirname(path), 'request.json');
    return await snapshots.pathExists(request) ? presetOf(row(await snapshots.readJson(request))) : null;
}
async function checkObjectParameters(path: string, validate: typeof validateUsage): Promise<{ok: boolean; [key: string]: unknown}> {
    try {
        const {value}=await gatePreset(await snapshots.readJson(path),await packetPreset(path),draft=>validate(draft));
        return {ok:true,name:value.name};
    } catch(error) {
        if(typeof (error as NodeJS.ErrnoException)?.code==='string' && !(error instanceof RpcError)){
            const message=internalError(error).message;
            return {ok:false,error:message.slice(message.indexOf(': ')+2)};
        }
        // The repair the child is about to attempt is only as good as what reaches it: this result is the
        // whole of what `coc-read-check` prints, so a fix left on the RpcError never leaves the kernel.
        return {ok:false,error:error instanceof Error?error.message:String(error),
            ...(error instanceof RpcError && error.fix ? {fix:error.fix} : {})};
    }
}
export async function checkSourceDraft(content: string, packetPath: string, draftPath: string): Promise<{
    ok: boolean;
    [key: string]: unknown;
}> {
    try {
        const draft = await snapshots.readJson(draftPath), packet = row(await snapshots.readJson(packetPath));
        if (packet.purpose === 'answer') {
            const answer = checkSourceAnswer(draft, packet);
            return { ok: true, required_review: ANSWER_REVIEW_PATHS, required_view_pages: [...new Set(answer.source_refs.map((ref: any) => ref.page))] };
        }
        const filled = checkDraft(draft, packet, await loadModuleContract({ content, snapshots }));
        if (packet.opening_batch === true && packet.purpose === 'opening') checkOpeningBatch(row(draft),packet.focus,packet.known_nodes,packet.opening_scope==='first_interaction',packet.known_claims);
        const path = join(dirname(packetPath), 'baseline.json');
        const baseline = await snapshots.pathExists(path) ? row(await snapshots.readJson(path)) : null;
        return { ok: true, required_review: filled.required_review, required_view_pages: [...new Set([...requiredViewPages(row(draft), baseline),...(packet.source_unit||packet.map_scope?array(packet.pages).map(number):[])])] };
    }
    catch (error) {
        if (error instanceof RpcError)
            return { ok: false, error: error.toJson() };
        if (error instanceof SyntaxError)
            return { ok: false, error: error.message };
        if (typeof (error as NodeJS.ErrnoException)?.code === 'string') {
            const message = internalError(error).message;
            return { ok: false, error: message.slice(message.indexOf(': ') + 2) };
        }
        throw error;
    }
}
