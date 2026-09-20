/** Shared artifact validation; semantic judgment belongs to the private reviewer. */
export const CONTINUITY_AUDIT = 'audit.continuity.v1';
/**
 * A continuity review is a tool-enabled background task, so elapsed wall time is not a semantic budget.
 * These are hour-scale process safety ceilings (contract §110), while request/rewrite/repair counts remain
 * the actual review bounds. The shared ceiling holds the initial review plus its one permitted repair.
 */
const BACKGROUND_REVIEW_SAFETY_MS = 60 * 60 * 1000;
export const AUDIT_LIMITS = Object.freeze({per_review_ms: BACKGROUND_REVIEW_SAFETY_MS,
    time_ms: BACKGROUND_REVIEW_SAFETY_MS * 2, max_requests: 12, per_review: 6, max_rewrites: 1,
    max_artifact_repairs: 1});
export type AuditIssue = {path: string; message: string; file?: string; excerpt?: string};
const object = (v: any): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);
const row = (v: any): Record<string, any> => object(v) ? v : {};
const array = (v: any): any[] => Array.isArray(v) ? v : [];
const string = (v: any): string => typeof v === 'string' ? v : '';
const words = (v: any, max = 2000) => typeof v === 'string' && !!v.trim() && v.length <= max;
const strings = (v: any): string[] => typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];
const SAY = /\{\{say:([^}\n]{1,60})\}\}|\{\{\/say\}\}/g;
/** Exact spoken payloads under the product's closed say-token grammar. Shape repair remains delivery's job. */
function spokenTexts(text: string): string[] {
    const result: string[] = [];
    let start: number | null = null;
    const close = (end: number) => {
        if (start === null) return;
        const raw = text.slice(start, end), paragraph = /\n[ \t]*\n/.exec(raw);
        const spoken = raw.slice(0, paragraph?.index ?? raw.length).trim();
        if (spoken) result.push(spoken);
        start = null;
    };
    for (let match = SAY.exec(text); match; match = SAY.exec(text)) {
        if (match[1] === undefined) close(match.index);
        else { close(match.index); start = match.index + match[0].length; }
    }
    close(text.length);
    SAY.lastIndex = 0;
    return result;
}

/** A specific structured sub-review is more precise than a contradictory aggregate pass. */
export function normalizeContinuityArtifact(value: any, files: Record<string, unknown> = {}): any {
    if (!object(value) || !object(value.continuity_review)) return value;
    let review = value.continuity_review;
    const context = object(files['context.json']) ? files['context.json'] : {};
    // A targeted repair commonly nulls an inapplicable optional object. Canonicalize that exact
    // absence, while retaining a non-null extra object as an artifact error.
    if (!object(context.causal_reentry) && review.reentry_review === null) {
        const {reentry_review: _unused, ...rest} = review;
        review = rest;
    }
    const specific = [review.intelligibility_review?.verdict, review.player_address_review?.verdict, review.speech_review?.verdict, review.reentry_review?.verdict, review.locus_review?.verdict, review.location_review?.verdict,
        review.outcome_review?.verdict].find(verdict => verdict === 'revise');
    if (review.verdict === 'pass' && specific === 'revise') review = {...review, verdict: 'revise'};
    return review === value.continuity_review ? value : {...value, continuity_review: review};
}

export function continuityArtifactErrors(value: any, candidate: string, files: Record<string, unknown>): AuditIssue[] {
    const errors: AuditIssue[] = [];
    const add = (path: string, message: string, extra = {}) => { errors.push({path, message, ...extra}); };
    const keys = (v: any, names: string[], path: string) => {
        if (!object(v)) { add(path, 'Expected an object'); return false; }
        for (const name of names) if (!Object.hasOwn(v, name)) add(`${path}/${name}`, 'Required field is missing');
        for (const name of Object.keys(v)) if (!names.includes(name)) add(`${path}/${name.replaceAll('~', '~0').replaceAll('/', '~1')}`, 'Unexpected field');
        return true;
    };
    const list = (v: any, path: string, max: number): any[] => {
        if (!Array.isArray(v)) { add(path, 'Expected an array'); return []; }
        if (v.length > max) add(path, `At most ${max} entries are allowed`);
        return v.slice(0, max);
    };
    if (!keys(value, ['missing', 'findings', 'continuity_review'], '')) return errors;
    for (const [i, v] of list(value.missing, '/missing', 16).entries()) {
        const path = `/missing/${i}`;
        if (!keys(v, ['name', 'category', 'reason'], path)) continue;
        for (const name of ['name', 'reason']) if (!words(v[name])) add(`${path}/${name}`, 'Expected nonempty bounded text');
        if (!['weapon', 'spell', 'item'].includes(v.category)) add(`${path}/category`, 'Expected weapon, spell or item');
    }
    for (const [i, v] of list(value.findings, '/findings', 10).entries()) {
        const path = `/findings/${i}`;
        if (!keys(v, ['reason', 'fix'], path)) continue;
        for (const name of ['reason', 'fix']) if (!words(v[name])) add(`${path}/${name}`, 'Expected nonempty bounded text');
    }
    const context = object(files['context.json']) ? files['context.json'] : {};
    const locationAuthority = object(context.location_authority) && context.location_authority.requires_review === true ? context.location_authority : null;
    const sceneCommitment = object(context.scene_commitment) && context.scene_commitment.requires_review === true ? context.scene_commitment : null;
    const outcomeCommitments = object(context.outcome_commitments) && context.outcome_commitments.requires_review === true ? context.outcome_commitments : null;
    const causalReentry = object(context.causal_reentry) ? context.causal_reentry : null;
    const intelligibility = object(context.intelligibility_review) && context.intelligibility_review.requires_review === true;
    const playerAddress = object(context.player_address_review) && context.player_address_review.requires_review === true;
    const spokenLines = spokenTexts(candidate);
    const speechReview = spokenLines.length > 0;
    const review = value.continuity_review;
    if (!keys(review, ['verdict', 'summary', 'conflicts', ...(intelligibility && review?.verdict !== 'unavailable' ? ['intelligibility_review'] : []), ...(playerAddress && review?.verdict !== 'unavailable' ? ['player_address_review'] : []), ...(speechReview && review?.verdict !== 'unavailable' ? ['speech_review'] : []), ...(locationAuthority ? ['location_review'] : []), ...(sceneCommitment ? ['locus_review'] : []),
        ...(outcomeCommitments && review?.verdict !== 'unavailable' ? ['outcome_review'] : []), ...(causalReentry && review?.verdict !== 'unavailable' ? ['reentry_review'] : [])], '/continuity_review')) return errors;
    if (sceneCommitment && !object(review.locus_review))
        add('/continuity_review/locus_review', 'Required object: {verdict, mode, locus, claim, basis}; do not use location_review');
    if (causalReentry && review.verdict !== 'unavailable' && !object(review.reentry_review))
        add('/continuity_review/reentry_review', 'Required object: {verdict, basis, quote, clue, relation}');
    if (outcomeCommitments && review.verdict !== 'unavailable' && !object(review.outcome_review))
        add('/continuity_review/outcome_review', 'Required object: {verdict, basis, claims}');
    if (intelligibility && review.verdict !== 'unavailable' && !object(review.intelligibility_review))
        add('/continuity_review/intelligibility_review', 'Required object: {verdict, quote}');
    if (playerAddress && review.verdict !== 'unavailable' && !object(review.player_address_review))
        add('/continuity_review/player_address_review', 'Required object: {verdict, quote}');
    if (speechReview && review.verdict !== 'unavailable' && !object(review.speech_review))
        add('/continuity_review/speech_review', 'Required object: {verdict, lines:[{quote, verdict}]}');
    if (!['pass', 'revise', 'unavailable'].includes(review.verdict)) add('/continuity_review/verdict', 'Expected pass, revise or unavailable');
    if (!words(review.summary)) add('/continuity_review/summary', 'Expected nonempty bounded text');
    const evidenceStrings = new Map<string, string[]>(), conflicts = list(review.conflicts, '/continuity_review/conflicts', 10);
    for (const [i, v] of conflicts.entries()) {
        const path = `/continuity_review/conflicts/${i}`;
        if (!keys(v, ['claim', 'reason', 'evidence'], path)) continue;
        if (!words(v.claim) || !candidate.includes(v.claim)) add(`${path}/claim`, 'Copy an exact excerpt from the candidate', {excerpt: String(v.claim).slice(0, 2000)});
        if (!words(v.reason)) add(`${path}/reason`, 'Expected nonempty bounded text');
        const evidence = list(v.evidence, `${path}/evidence`, 3);
        if (!evidence.length) add(`${path}/evidence`, 'A conflict needs evidence of the conflicting established fact or choice');
        for (const [j, e] of evidence.entries()) {
            const at = `${path}/evidence/${j}`;
            if (!keys(e, ['file', 'quote'], at)) continue;
            if (typeof e.file !== 'string' || !Object.hasOwn(files, e.file)) {
                add(`${at}/file`, `Choose a supplied evidence file: ${Object.keys(files).join(', ')}`, {file: String(e.file)}); continue;
            }
            if (!words(e.quote, 1000)) { add(`${at}/quote`, 'Expected a nonempty excerpt of at most 1000 characters', {file: e.file}); continue; }
            if (!evidenceStrings.has(e.file)) evidenceStrings.set(e.file, strings(files[e.file]));
            if (!evidenceStrings.get(e.file)!.some(text => text.includes(e.quote)))
                add(`${at}/quote`, 'Copy an exact string-value excerpt, without JSON keys or punctuation', {file: e.file, excerpt: e.quote});
        }
    }
    if (intelligibility && object(review.intelligibility_review)) {
        const prose = review.intelligibility_review, path = '/continuity_review/intelligibility_review';
        if (keys(prose, ['verdict', 'quote'], path)) {
            if (!['pass', 'revise'].includes(prose.verdict)) add(`${path}/verdict`, 'Expected pass or revise');
            if (prose.verdict === 'pass') {
                if (prose.quote !== null) add(`${path}/quote`, 'A passing intelligibility review uses quote null');
            } else {
                if (!words(prose.quote, 1000) || !candidate.includes(prose.quote))
                    add(`${path}/quote`, 'Copy one exact candidate excerpt with omitted grammatical relations');
                if (!array(value.findings).length) add('/findings', 'An intelligibility revision needs an actionable whole-candidate rewrite finding');
                if (review.verdict !== 'revise') add('/continuity_review/verdict', 'An intelligibility revision requires overall revise');
            }
            if (review.verdict === 'pass' && prose.verdict !== 'pass') add(`${path}/verdict`, 'Overall pass requires a passing intelligibility review');
        }
    }
    if (playerAddress && object(review.player_address_review)) {
        const address = review.player_address_review, path = '/continuity_review/player_address_review';
        if (keys(address, ['verdict', 'quote'], path)) {
            if (!['pass', 'revise'].includes(address.verdict)) add(`${path}/verdict`, 'Expected pass or revise');
            if (address.verdict === 'pass') {
                if (address.quote !== null) add(`${path}/quote`, 'A passing player-address review uses quote null');
            } else {
                if (!words(address.quote, 1000) || !candidate.includes(address.quote))
                    add(`${path}/quote`, 'Copy one exact narrator excerpt that refers to a player-controlled investigator in third person');
                if (!array(value.findings).length) add('/findings', 'A player-address revision needs an actionable whole-candidate second-person rewrite finding');
                if (review.verdict !== 'revise') add('/continuity_review/verdict', 'A player-address revision requires overall revise');
            }
            if (review.verdict === 'pass' && address.verdict !== 'pass') add(`${path}/verdict`, 'Overall pass requires a passing player-address review');
        }
    }
    if (speechReview && object(review.speech_review)) {
        const speech = review.speech_review, path = '/continuity_review/speech_review';
        if (keys(speech, ['verdict', 'lines'], path)) {
            if (!['pass', 'revise'].includes(speech.verdict)) add(`${path}/verdict`, 'Expected pass or revise');
            const lines = list(speech.lines, `${path}/lines`, 32);
            if (lines.length !== spokenLines.length) add(`${path}/lines`, `Copy exactly ${spokenLines.length} spoken lines in candidate order`);
            for (const [i, line] of lines.entries()) {
                const at = `${path}/lines/${i}`;
                if (!keys(line, ['quote', 'verdict', 'reason'], at)) continue;
                if (!['pass', 'revise'].includes(line.verdict)) add(`${at}/verdict`, 'Expected pass or revise');
                if (line.quote !== spokenLines[i]) add(`${at}/quote`, 'Copy this complete say-token span text exactly and in order', {excerpt: spokenLines[i] ?? ''});
                if (!words(line.reason, 600)) add(`${at}/reason`, 'Explain briefly why the line is naturally clear, or which grammatical relation is missing');
            }
            const revised = lines.some(line => line?.verdict === 'revise');
            if (speech.verdict === 'pass' && revised) add(`${path}/verdict`, 'Speech pass requires every quoted line to pass');
            if (speech.verdict === 'revise' && !revised) add(`${path}/verdict`, 'Speech revise requires at least one quoted line to revise');
            if (speech.verdict === 'revise' && !array(value.findings).length) add('/findings', 'A speech revision needs an actionable whole-candidate natural-language rewrite finding');
            if (speech.verdict === 'revise' && review.verdict !== 'revise') add('/continuity_review/verdict', 'A speech revision requires overall revise');
            if (review.verdict === 'pass' && speech.verdict !== 'pass') add(`${path}/verdict`, 'Overall pass requires a passing speech review');
        }
    }
    if (outcomeCommitments && object(review.outcome_review)) {
        const outcome = review.outcome_review, path = '/continuity_review/outcome_review';
        if (keys(outcome, ['verdict', 'basis', 'claims'], path)) {
            if (!['pass', 'revise'].includes(outcome.verdict)) add(`${path}/verdict`, 'Expected pass or revise');
            if (!['failed_rolls_respected', 'unsupported_positive_result'].includes(outcome.basis))
                add(`${path}/basis`, 'Expected failed_rolls_respected or unsupported_positive_result');
            const claims = list(outcome.claims, `${path}/claims`, 8);
            for (const [i, claim] of claims.entries()) if (!words(claim, 1000) || !candidate.includes(claim))
                add(`${path}/claims/${i}`, 'Copy an exact candidate excerpt that grants the unsupported positive result');
            if (outcome.basis === 'failed_rolls_respected') {
                if (outcome.verdict !== 'pass') add(`${path}/verdict`, 'Failed rolls respected uses verdict pass');
                if (claims.length) add(`${path}/claims`, 'Failed rolls respected carries no unsupported claims');
            }
            if (outcome.basis === 'unsupported_positive_result') {
                if (outcome.verdict !== 'revise') add(`${path}/verdict`, 'An unsupported positive result must revise');
                if (!claims.length) add(`${path}/claims`, 'Name at least one exact unsupported positive-result excerpt');
                if (!array(value.findings).length) add('/findings', 'An unsupported positive result needs an actionable finding');
            }
            if (outcome.verdict === 'revise' && review.verdict !== 'revise') add('/continuity_review/verdict', 'An outcome revision requires overall revise');
            if (review.verdict === 'pass' && outcome.verdict !== 'pass') add(`${path}/verdict`, 'Overall pass requires a passing outcome review');
        }
    }
    if (locationAuthority) {
        const location = review.location_review, path = '/continuity_review/location_review';
        if (keys(location, ['verdict', 'current_scene', 'asserted_elsewhere', 'basis'], path)) {
            if (!['pass', 'revise'].includes(location.verdict)) add(`${path}/verdict`, 'Expected pass or revise');
            if (location.current_scene !== locationAuthority.current_scene) add(`${path}/current_scene`, 'Copy the exact current scene from context.json');
            if (!['current_scene', 'move_receipt', 'none'].includes(location.basis)) add(`${path}/basis`, 'Expected current_scene, move_receipt or none');
            const elsewhere = list(location.asserted_elsewhere, `${path}/asserted_elsewhere`, 8);
            for (const [i, quote] of elsewhere.entries()) if (!words(quote, 1000) || !candidate.includes(quote))
                add(`${path}/asserted_elsewhere/${i}`, 'Copy an exact candidate excerpt that asserts another location');
            const moves = Array.isArray(locationAuthority.move_receipts) ? locationAuthority.move_receipts : [];
            if (location.basis === 'move_receipt' && !moves.length) add(`${path}/basis`, 'No settled move receipt supports another location');
            if (elsewhere.length && !moves.length && (location.verdict !== 'revise' || location.basis !== 'none'))
                add(`${path}/verdict`, 'Arrival or residence elsewhere without a move receipt must revise with basis none');
            if (location.verdict === 'revise' && review.verdict !== 'revise') add('/continuity_review/verdict', 'A location revision requires overall revise');
            if (review.verdict === 'pass' && location.verdict !== 'pass') add(`${path}/verdict`, 'Overall pass requires a passing location review');
        }
    }
    if (sceneCommitment) {
        const locus = review.locus_review, path = '/continuity_review/locus_review';
        if (keys(locus, ['verdict', 'mode', 'locus', 'claim', 'basis'], path)) {
            if (!['pass', 'revise'].includes(locus.verdict)) add(`${path}/verdict`, 'Expected pass or revise');
            if (!['same_locus', 'transition', 'new_locus'].includes(locus.mode)) add(`${path}/mode`, 'Expected same_locus, transition or new_locus');
            if (!['active_scene', 'move_receipt', 'none'].includes(locus.basis)) add(`${path}/basis`, 'Expected active_scene, move_receipt or none');
            const moves = Array.isArray(sceneCommitment.moves) ? sceneCommitment.moves : [];
            if (locus.mode === 'new_locus') {
                if (!words(locus.locus, 300)) add(`${path}/locus`, 'Name the persistent gameplay locus');
                if (!words(locus.claim, 1000) || !candidate.includes(locus.claim)) add(`${path}/claim`, 'Copy an exact candidate excerpt establishing the new locus');
                if (locus.basis === 'move_receipt' && !moves.length) add(`${path}/basis`, 'No settled move receipt can support a new locus');
                if (locus.basis === 'none' && locus.verdict !== 'revise') add(`${path}/verdict`, 'An unsupported new locus must revise');
            } else {
                if (locus.locus != null) add(`${path}/locus`, 'same_locus and transition use null locus');
                if (locus.claim != null) add(`${path}/claim`, 'same_locus and transition use null claim');
                if (locus.basis !== 'active_scene') add(`${path}/basis`, 'same_locus and transition use active_scene');
            }
            if (locus.verdict === 'revise' && review.verdict !== 'revise') add('/continuity_review/verdict', 'A locus revision requires overall revise');
            if (review.verdict === 'pass' && locus.verdict !== 'pass') add(`${path}/verdict`, 'Overall pass requires a passing locus review');
        }
    }
    if (causalReentry && object(review.reentry_review)) {
        const reentry = review.reentry_review, path = '/continuity_review/reentry_review';
        if (keys(reentry, ['verdict', 'basis', 'quote', 'clue', 'relation'], path)) {
            if (!['pass', 'revise', 'defer'].includes(reentry.verdict)) add(`${path}/verdict`, 'Expected pass, revise or defer');
            if (!['bridge_receipt', 'bridge_offer', 'acquired_clarification', 'player_discharge', 'preparation_wait', 'authority_unavailable', 'chosen_action', 'none'].includes(reentry.basis))
                add(`${path}/basis`, 'Expected bridge_receipt, bridge_offer, acquired_clarification, player_discharge, preparation_wait, authority_unavailable, chosen_action or none');
            const bridge = row(causalReentry.bridge), bridgeClue = bridge.clue, known = array(causalReentry.known).map(value => row(value).name);
            const knownRow = array(causalReentry.known).map(row).find(value => value.name === reentry.clue);
            const mode = causalReentry.mode ?? (bridgeClue ? 'introduce_evidence' : 'clarify_known');
            if (!['clarify_known', 'introduce_evidence'].includes(mode)) add(`${path}/basis`, 'causal_reentry.mode is invalid');
            const receipts = array(context.receipts), handouts = array(bridge.source_handouts);
            const hasBridgeReceipt = receipts.some(receipt => receipt.kind === 'clue' && receipt.clue === bridgeClue
                || receipt.kind === 'handout' && [receipt.handout, receipt.name, receipt.label].some(name => handouts.includes(name)));
            // §37.3 (2026-09-15): the reentry steers, it does not gate. `chosen_action` is lawful in both
            // modes and needs no host-owned wait or refusal — an unrealized bridge on a turn the player spent
            // on their own legitimate line defers and is delivered.
            if (mode === 'clarify_known' && !['acquired_clarification', 'player_discharge', 'chosen_action', 'none'].includes(reentry.basis))
                add(`${path}/basis`, 'clarify_known permits acquired_clarification, player_discharge, chosen_action or none');
            if (mode === 'introduce_evidence' && !['bridge_receipt', 'bridge_offer', 'player_discharge', 'preparation_wait', 'authority_unavailable', 'chosen_action', 'none'].includes(reentry.basis))
                add(`${path}/basis`, 'introduce_evidence permits bridge_receipt, bridge_offer, player_discharge, preparation_wait, authority_unavailable, chosen_action or none');
            if (['bridge_receipt', 'bridge_offer', 'acquired_clarification'].includes(reentry.basis)) {
                if (!words(reentry.quote, 1000) || !candidate.includes(reentry.quote)) add(`${path}/quote`, 'Copy an exact candidate excerpt that states the causal relation and stakes');
            } else if (reentry.basis === 'player_discharge') {
                if (!words(reentry.quote, 1000) || !string(context.current_input).includes(reentry.quote)) add(`${path}/quote`, 'Copy an exact current_input excerpt demonstrating informed causal understanding');
            } else if (reentry.basis === 'preparation_wait') {
                if (!words(reentry.quote, 1000) || !candidate.includes(reentry.quote)) add(`${path}/quote`, 'Copy the exact candidate preparation-wait notice');
            } else if (['authority_unavailable', 'chosen_action'].includes(reentry.basis)) {
                if (!words(reentry.quote, 1000) || !candidate.includes(reentry.quote)) add(`${path}/quote`, 'Copy the exact candidate excerpt continuing the action the player chose, claiming no reentry evidence');
            } else if (reentry.quote !== null) add(`${path}/quote`, `basis ${reentry.basis} uses quote null`);
            if (reentry.basis === 'bridge_receipt') {
                if (!hasBridgeReceipt) add(`${path}/basis`, 'No current clue or handout receipt settles the supplied bridge');
                if (reentry.clue !== bridgeClue) add(`${path}/clue`, 'Copy causal_reentry.bridge.clue exactly');
                if (reentry.relation !== bridge.relation) add(`${path}/relation`, 'Copy causal_reentry.bridge.relation exactly');
                if (row(causalReentry.authority).clue_here !== true)
                    add(`${path}/basis`, 'The effective graph does not make this bridge clue discoverable at the current scene; accept source_rebinding first');
            } else if (reentry.basis === 'bridge_offer') {
                if (hasBridgeReceipt) add(`${path}/basis`, 'A settled bridge receipt uses bridge_receipt, not bridge_offer');
                if (row(causalReentry.authority).clue_here !== true)
                    add(`${path}/basis`, 'The bridge cannot be offered until the effective graph makes it discoverable at the current scene');
                if (reentry.clue !== bridgeClue) add(`${path}/clue`, 'Copy causal_reentry.bridge.clue exactly');
                if (reentry.relation !== bridge.relation) add(`${path}/relation`, 'Copy causal_reentry.bridge.relation exactly');
            } else if (reentry.basis === 'authority_unavailable') {
                // §37.6: only a refused placement makes this defer lawful, and it never claims the evidence.
                if (!object(context.rebinding_refused)) add(`${path}/basis`, 'No host-owned rebinding_refused records a refused placement for this bridge');
                if (row(causalReentry.authority).clue_here !== false)
                    add(`${path}/basis`, 'The effective graph already makes this bridge discoverable here; offer or deliver it');
                if (hasBridgeReceipt) add(`${path}/basis`, 'A settled bridge receipt uses bridge_receipt, not authority_unavailable');
                if (reentry.clue !== bridgeClue) add(`${path}/clue`, 'Copy causal_reentry.bridge.clue exactly');
                if (reentry.relation !== bridge.relation) add(`${path}/relation`, 'Copy causal_reentry.bridge.relation exactly');
            } else if (['acquired_clarification', 'player_discharge'].includes(reentry.basis)) {
                if (!known.length || !known.includes(reentry.clue)) add(`${path}/clue`, 'Name one acquired causal_reentry.known evidence row');
                if (!knownRow || reentry.relation !== knownRow.relation) add(`${path}/relation`, 'Copy the selected causal_reentry.known row relation exactly');
            } else {
                if (reentry.clue !== null) add(`${path}/clue`, `${reentry.basis} uses clue null`);
                if (reentry.relation !== null) add(`${path}/relation`, `${reentry.basis} uses relation null`);
            }
            if (reentry.basis === 'chosen_action' && hasBridgeReceipt)
                add(`${path}/basis`, 'A settled bridge receipt uses bridge_receipt, not chosen_action');
            if (reentry.basis === 'preparation_wait' && !object(context.preparation_wait)) add(`${path}/basis`, 'No host-owned preparation_wait is active');
            if (reentry.basis === 'preparation_wait' && reentry.verdict !== 'defer') add(`${path}/verdict`, 'A real preparation wait uses defer');
            if (reentry.basis === 'bridge_offer' && reentry.verdict !== 'defer') add(`${path}/verdict`, 'A choice-preserving bridge offer uses defer');
            if (reentry.basis === 'authority_unavailable' && reentry.verdict !== 'defer') add(`${path}/verdict`, 'A refused placement leaves the reentry standing: use defer');
            if (reentry.basis === 'chosen_action' && reentry.verdict !== 'defer') add(`${path}/verdict`, 'The player\'s own chosen line leaves the reentry standing: use defer');
            // `none` is now reserved for real damage — a candidate that contradicts the thread or its acquired
            // evidence, or that fabricates a carrier or an arrival without a receipt (§37.3, 2026-09-15).
            if (reentry.basis === 'none' && reentry.verdict !== 'revise') add(`${path}/verdict`, 'No causal basis requires revise');
            if (!['preparation_wait', 'bridge_offer', 'authority_unavailable', 'chosen_action', 'none'].includes(reentry.basis) && reentry.verdict !== 'pass') add(`${path}/verdict`, 'A realized or discharged bridge uses pass');
            if (reentry.verdict === 'revise' && review.verdict !== 'revise') add('/continuity_review/verdict', 'A reentry revision requires overall revise');
            if (review.verdict === 'pass' && !['pass', 'defer'].includes(reentry.verdict)) add(`${path}/verdict`, 'Overall pass requires a passing or structurally deferred reentry review');
        }
    }
    const count = conflicts.length + (Array.isArray(value.findings) ? value.findings.length : 0) + (Array.isArray(value.missing) ? value.missing.length : 0)
        + Number(review.intelligibility_review?.verdict === 'revise' || review.player_address_review?.verdict === 'revise' || review.speech_review?.verdict === 'revise' || review.location_review?.verdict === 'revise' || review.locus_review?.verdict === 'revise' || review.reentry_review?.verdict === 'revise');
    if (review.verdict === 'pass' && count) add('/continuity_review/verdict', 'Pass cannot contain conflicts, missing objects or findings');
    if (review.verdict === 'revise' && !count) add('/continuity_review/verdict', 'Revise needs an actionable conflict, missing object or finding');
    return errors;
}
