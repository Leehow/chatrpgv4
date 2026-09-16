/** The transaction's Git verbs use only its captured shared Git capability. */
import type { KernelContext } from '../context.js';
import { CommitFailed, type GitResult } from '../git.js';
export { CommitFailed } from '../git.js';
export function checked(result: GitResult, what: string): GitResult {
    if (result.code !== 0) {
        // Contract §38.11. The verb, the exit code and whatever Git printed travel as fields as well
        // as in the sentence: a repeated failure is a service condition, and the host's operator
        // notice has to be able to say *what* failed -- `xcode-select` pointing at an unlicensed
        // Xcode made /usr/bin/git exit 69 on 2026-09-15 and every turn of a live table failed with
        // it, read by the Keeper as an ordinary retryable move.
        const output = (result.stderr || result.stdout || '').trim();
        throw new CommitFailed(`git ${what} failed (${result.code})${output ? `: ${output}` : ''}`,
            { step: what, code: result.code, output: output.slice(0, 400) });
    }
    return result;
}
export async function commit(context: KernelContext, campaign: string, message: string): Promise<string> {
    checked(await context.git.run(campaign, ['add', '-A', '.']), 'add');
    checked(await context.git.run(campaign, ['commit', '--quiet', '--allow-empty', '-m', message]), 'commit');
    return checked(await context.git.run(campaign, ['rev-parse', '--short', 'HEAD']), 'rev-parse').stdout.trim();
}
export async function head(context: KernelContext, campaign: string): Promise<{
    sha: string | null;
    turn: number | null;
}> {
    const sha = await context.git.run(campaign, ['rev-parse', '--short', 'HEAD']);
    const subject = await context.git.run(campaign, ['log', '-1', '--format=%s']);
    const line = subject.code === 0 ? subject.stdout.trim() : '';
    const match = /^turn (\d+)\s*:/.exec(line);
    return {
        sha: sha.code === 0 ? sha.stdout.trim() : null,
        turn: match ? Number(match[1]) : null
    };
}
