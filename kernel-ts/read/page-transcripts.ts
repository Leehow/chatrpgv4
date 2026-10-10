/**
 * Contract §191.4 (read side, kernel): the page transcript the host stored for a page of a bound file, by the file's digest.
 *
 * The host makes and stores transcripts (`extensions/module/transcript-store.ts`) under `<home>/.coc/source-transcripts/`,
 * and the kernel's workspace is that home, so the kernel reads its SQL records at `<stateRoot>/source-transcripts/` (shipped
 * seeds under `<content>/source-transcripts/` first, as the host reads them). The kernel reads no PDF (§22.1): a record is
 * text the host already wrote.
 *
 * Two readers (§194): the epithet lane's entry for an unread person is cut from the page's reading text, the record's `text`
 * (§194.4); and a pictured handout's printed words are the record's `image_text` (§194.3).
 *
 * A record is read when it is the v1 schema of this file and page with an intact `text` (its digest). The kernel does not
 * know the host's current native extraction version (`native.extraction_version`), so it does not check it: a record of an
 * older extraction still holds the book's own lines (§191.3's invariant), which is all these readers need from it.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { KernelContext } from '../context.js';
import { isJsonObject } from '../json.js';
import {homePageRecords} from '../../runtime/transcript-records.ts';

const SCHEMA = 'coc.source-transcript.page.v1';
const VERSION = 'transcript-v1';
const DIGEST = /^[a-f0-9]{64}$/;

export interface PageTranscript { text: string; image_text: string[] }

const pageName = (page: number): string => `page-${String(page).padStart(4, '0')}.json`;
const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

/** The record of `page` (1-based physical) of the file `fileSha256`, seed first, then home; null when neither is readable. */
export async function pageTranscript(context: Pick<KernelContext, 'content' | 'stateRoot' | 'snapshots'>, fileSha256: string, page: number): Promise<PageTranscript | null> {
    if (!DIGEST.test(fileSha256) || !Number.isSafeInteger(page) || page < 1) return null;
    const validate = (value: unknown): PageTranscript | null => {
        if (!isJsonObject(value) || value.schema !== SCHEMA || value.transcript_version !== VERSION || value.file_sha256 !== fileSha256 || value.page !== page)
            return null;
        if (typeof value.text !== 'string' || value.text_sha256 !== sha256(value.text)) return null;
        const images = Array.isArray(value.image_text) ? value.image_text.filter((item): item is string => typeof item === 'string') : [];
        return {text:value.text,image_text:images};
    };
    const home = join(context.stateRoot, 'source-transcripts');
    for (const [index,root] of [join(context.content, 'source-transcripts'), home].entries()) {
        if (index === 1) {
            try {
                const records = homePageRecords(home, fileSha256, page);
                if (records !== undefined) {for (const value of records) {const found=validate(value);if(found)return found;}return null;}
            } catch {return null;}
        }
        const path = join(root, fileSha256, pageName(page));
        let value: unknown;
        try {
            if (!await context.snapshots.pathExists(path)) continue;
            value = await context.snapshots.readJson(path);
        } catch { continue; }
        const found=validate(value);if(found)return found;
    }
    return null;
}
