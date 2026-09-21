/** Host-owned exact text selection for tool-enabled presentation lanes. */
export const PRESENTATION_REFERENCE_PROTOCOL = 'presentation-reference-v1' as const;
export const DOCUMENT_PRESENTATION_REFERENCE_PROTOCOL = 'document-presentation-reference-v1' as const;

export type PresentationInputPiece = {text:string} | {token:string;kind:'placeholder'|'notation';value:string};
export type PresentationOutputPiece = {text:string} | {token:string};
export type PresentationSource = {alias:string;text:string} | {alias:string;pieces:PresentationInputPiece[]};
export type PresentationOperation = {source:string;action:'keep'} |
    {source:string;action:'translate';text:string} |
    {source:string;action:'translate';pieces:PresentationOutputPiece[]};
type Binding = {original:string;tokens:Array<{alias:string;text:string;kind:'placeholder'|'notation'}>};
export interface PresentationCatalog {
    protocol:string;
    sources:PresentationSource[];
    bindings:Record<string,Binding>;
}
export interface PresentationAcceptance {
    texts:Record<string,string>;
    values:Record<string,string>;
    accepted:string[];
    missing:string[];
    errors:string[];
}

const record = (value:unknown): value is Record<string,any> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value:Record<string,any>, keys:string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
// Closed syntax only: brace placeholders, numeric/dice forms, and uppercase notation. This never
// decides a language or the meaning of a word.
const PROTECTED_SYNTAX = /\{[^{}\r\n]+\}|(?<![A-Za-z0-9_])(?:[+\-]?\d+(?:[Dd]\d+)(?:[+\-*/×]\d+)*|[+\-]?\d+(?:[\/–—-]\d+)+|[+\-]?\d+(?:[.,]\d+)?%?|[A-Z][A-Z0-9]{1,})(?![A-Za-z0-9_])/g;

function protectedPieces(text:string, nextToken:()=>string): {pieces:PresentationInputPiece[];tokens:Binding['tokens']} {
    const pieces:PresentationInputPiece[] = [], tokens:Binding['tokens'] = [];
    let cursor = 0;
    for (const match of text.matchAll(PROTECTED_SYNTAX)) {
        const at = match.index ?? 0;
        if (at > cursor) pieces.push({text:text.slice(cursor,at)});
        const alias = nextToken(), kind = match[0].startsWith('{') ? 'placeholder' : 'notation';
        pieces.push({token:alias,kind,value:match[0]}); tokens.push({alias,text:match[0],kind});
        cursor = at + match[0].length;
    }
    if (cursor < text.length) pieces.push({text:text.slice(cursor)});
    return {pieces,tokens};
}

/** Issue occurrence aliases. Protected bytes are input context only; output selects their aliases. */
export function issuePresentationReferences(texts:readonly string[], options:{protectSyntax?:boolean;deduplicate?:boolean;protocol?:string}={}):PresentationCatalog {
    const unique = options.deduplicate === false ? [...texts] : [...new Set(texts)], sources:PresentationSource[] = [], bindings:Record<string,Binding> = {};
    let token = 0;
    unique.forEach((original,index) => {
        const alias = `text:${index}`;
        if (options.protectSyntax) {
            const protectedValue = protectedPieces(original,()=>`token:${token++}`);
            sources.push(protectedValue.tokens.length ? {alias,pieces:protectedValue.pieces} : {alias,text:original});
            bindings[alias] = {original,tokens:protectedValue.tokens};
        } else {
            sources.push({alias,text:original}); bindings[alias] = {original,tokens:[]};
        }
    });
    return {protocol:options.protocol ?? PRESENTATION_REFERENCE_PROTOCOL,sources,bindings};
}

export function presentationAlias(catalog:PresentationCatalog, original:string):string|undefined {
    return Object.entries(catalog.bindings).find(([,binding]) => binding.original === original)?.[0];
}

/** Keep stable aliases while a second round asks only for unresolved sources. */
export function selectPresentationReferences(catalog:PresentationCatalog, originals:readonly string[]):PresentationCatalog {
    const wanted = new Set(originals), sources = catalog.sources.filter(source => wanted.has(catalog.bindings[source.alias]?.original));
    return {protocol:catalog.protocol,sources,bindings:Object.fromEntries(sources.map(source => [source.alias,catalog.bindings[source.alias]]))};
}

function operationValue(operation:unknown, source:PresentationSource, binding:Binding): {value?:string;error?:string} {
    if (!record(operation) || typeof operation.source !== 'string' || operation.source !== source.alias)
        return {error:'Select one issued source alias'};
    if (operation.action === 'keep') {
        if (!exact(operation,['source','action'])) return {error:'Keep accepts only source and action'};
        return {value:binding.original};
    }
    if (operation.action !== 'translate') return {error:'Action must be keep or translate'};
    if (!binding.tokens.length) {
        if (!exact(operation,['source','action','text']) || typeof operation.text !== 'string' || !operation.text.trim())
            return {error:'Translate needs nonempty generated text'};
        if (operation.text === binding.original) return {error:'Use keep when the source needs no change'};
        return {value:operation.text};
    }
    if (!exact(operation,['source','action','pieces']) || !Array.isArray(operation.pieces) || !operation.pieces.length)
        return {error:'Protected translation needs generated text and issued token pieces'};
    const seen:string[] = [], materialized:string[] = [];
    for (const piece of operation.pieces) {
        if (!record(piece)) return {error:'Each translated piece must be generated text or an issued token'};
        if (exact(piece,['text']) && typeof piece.text === 'string') {
            if (binding.tokens.some(token => piece.text.includes(token.text))) return {error:'Protected syntax must be selected by token alias'};
            materialized.push(piece.text);
        }
        else if (exact(piece,['token']) && typeof piece.token === 'string') {
            const selected = binding.tokens.find(token => token.alias === piece.token);
            if (!selected) return {error:'Select an issued token alias from this source'};
            seen.push(piece.token); materialized.push(selected.text);
        } else return {error:'Each translated piece must be generated text or an issued token'};
    }
    const expected = binding.tokens.map(token => token.alias);
    if (seen.length !== expected.length || new Set(seen).size !== seen.length || expected.some(alias => !seen.includes(alias)))
        return {error:'Select every issued token occurrence exactly once'};
    const value = materialized.join('');
    if (!value.trim()) return {error:'Translation must not be empty'};
    if (value === binding.original) return {error:'Use keep when the source needs no change'};
    return {value};
}

/** Accept valid rows from a near miss; foreign or duplicate aliases refuse the whole artifact. */
export function acceptPresentationReferences(value:unknown, catalog:PresentationCatalog, extraKeys:string[]=[]):PresentationAcceptance {
    const aliases = catalog.sources.map(source => source.alias), allMissing = [...aliases];
    if (!record(value) || !exact(value,['protocol','texts',...extraKeys]) || value.protocol !== catalog.protocol || !Array.isArray(value.texts))
        return {texts:{},values:{},accepted:[],missing:allMissing,errors:[`Expected a ${catalog.protocol} artifact`]};
    const rows = value.texts as unknown[], named = rows.map(row => record(row) ? row.source : undefined);
    if (named.some(alias => typeof alias !== 'string' || !aliases.includes(alias)) || new Set(named).size !== named.length)
        return {texts:{},values:{},accepted:[],missing:allMissing,errors:['Every operation must select a unique issued text alias']};
    const texts:Record<string,string> = {}, values:Record<string,string> = {}, accepted:string[] = [], errors:string[] = [];
    for (const source of catalog.sources) {
        const row = rows.find(operation => record(operation) && operation.source === source.alias);
        if (!row) continue;
        const result = operationValue(row,source,catalog.bindings[source.alias]);
        if (result.value !== undefined) {
            texts[catalog.bindings[source.alias].original] = result.value; values[source.alias]=result.value; accepted.push(source.alias);
        } else errors.push(`${source.alias}: ${result.error}`);
    }
    return {texts,values,accepted,missing:aliases.filter(alias => !accepted.includes(alias)),errors};
}

/** Public checker: validates alias/token coverage without receiving host-only token bytes. */
export function validatePresentationReferenceShape(value:unknown, sources:readonly PresentationSource[], extraKeys:string[]=[], protocol:string=PRESENTATION_REFERENCE_PROTOCOL):void {
    if (!record(value) || !exact(value,['protocol','texts',...extraKeys]) || value.protocol !== protocol || !Array.isArray(value.texts))
        throw new Error('Incomplete presentation reference artifact');
    const aliases = sources.map(source => source.alias), rows = value.texts as unknown[];
    const named = rows.map(row => record(row) ? row.source : undefined);
    if (rows.length !== aliases.length || named.some(alias => typeof alias !== 'string' || !aliases.includes(alias)) || new Set(named).size !== named.length)
        throw new Error('Incomplete presentation reference artifact');
    for (const source of sources) {
        const operation = rows.find(row => record(row) && row.source === source.alias);
        if (!record(operation)) throw new Error('Incomplete presentation reference artifact');
        if (operation.action === 'keep') {
            if (!exact(operation,['source','action'])) throw new Error('Incomplete presentation reference artifact');
            continue;
        }
        const protectedTokens = 'pieces' in source ? source.pieces.flatMap(piece => 'token' in piece ? [piece.token] : []) : [];
        if (operation.action !== 'translate') throw new Error('Incomplete presentation reference artifact');
        if (!protectedTokens.length) {
            if (!exact(operation,['source','action','text']) || typeof operation.text !== 'string' || !operation.text.trim()
                || 'text' in source && operation.text === source.text) throw new Error('Incomplete presentation reference artifact');
            continue;
        }
        if (!exact(operation,['source','action','pieces']) || !Array.isArray(operation.pieces) || !operation.pieces.length)
            throw new Error('Incomplete presentation reference artifact');
        const seen:string[] = [];
        for (const piece of operation.pieces) {
            if (!record(piece)) throw new Error('Incomplete presentation reference artifact');
            if (exact(piece,['text']) && typeof piece.text === 'string') {
                const values = 'pieces' in source ? source.pieces.flatMap(sourcePiece => 'token' in sourcePiece ? [sourcePiece.value] : []) : [];
                if (values.some(value => piece.text.includes(value))) throw new Error('Incomplete presentation reference artifact');
                continue;
            }
            if (exact(piece,['token']) && typeof piece.token === 'string' && protectedTokens.includes(piece.token)) {seen.push(piece.token);continue;}
            throw new Error('Incomplete presentation reference artifact');
        }
        if (seen.length !== protectedTokens.length || new Set(seen).size !== seen.length || protectedTokens.some(alias => !seen.includes(alias)))
            throw new Error('Incomplete presentation reference artifact');
    }
}

/** Full checker used by the tool-enabled owner's check.mjs. */
export function validatePresentationReferences(value:unknown, catalog:PresentationCatalog, extraKeys:string[]=[]):Record<string,string> {
    validatePresentationReferenceShape(value,catalog.sources,extraKeys,catalog.protocol);
    const accepted = acceptPresentationReferences(value,catalog,extraKeys);
    if (accepted.missing.length || accepted.errors.length || (value as any)?.texts?.length !== catalog.sources.length)
        throw new Error('Incomplete presentation reference artifact');
    return accepted.texts;
}
