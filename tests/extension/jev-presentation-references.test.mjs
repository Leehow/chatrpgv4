/** Pure presentation source fidelity; no model calls or rendering. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {
    acceptPresentationReferences, issuePresentationReferences, PRESENTATION_REFERENCE_PROTOCOL,
    selectPresentationReferences, validatePresentationReferenceShape, validatePresentationReferences,
} from '../../runtime/jev/presentation-references.ts';

const keep = source => ({source,action:'keep'});
const translate = (source,text) => ({source,action:'translate',text});
const artifact = texts => ({protocol:PRESENTATION_REFERENCE_PROTOCOL,texts});

test('keep materializes exact host bytes while translate contains only new text', () => {
    const originals = ['“e\u0301😀”\r\nSecond line', 'Already distinct', 'Already distinct'];
    const catalog = issuePresentationReferences(originals);
    assert.deepEqual(catalog.sources.map(source => source.alias), ['text:0','text:1']);
    const value = artifact([keep('text:0'),translate('text:1','New target wording')]);
    assert.deepEqual(validatePresentationReferences(value,catalog), {
        '“e\u0301😀”\r\nSecond line':'“e\u0301😀”\r\nSecond line',
        'Already distinct':'New target wording',
    });
    assert.ok(!JSON.stringify(value).includes('Already distinct'));
    assert.throws(() => validatePresentationReferences(artifact([keep('text:0'),translate('text:1','Already distinct')]),catalog));
});

test('protected syntax is selected by occurrence alias and may move for target grammar', () => {
    const catalog = issuePresentationReferences(['From {first} to {second}: roll 1D100 against HP 50/25/10.'], {protectSyntax:true});
    const [source] = catalog.sources;
    assert.ok('pieces' in source);
    const tokens = source.pieces.filter(piece => 'token' in piece);
    assert.deepEqual(tokens.map(token => token.value), ['{first}','{second}','1D100','HP','50/25/10']);
    assert.deepEqual(issuePresentationReferences(['Damage +1D4; decade 1920s.'],{protectSyntax:true}).sources[0].pieces
        .filter(piece=>'token' in piece).map(piece=>piece.value),['+1D4'],'syntax protection does not treat a language-specific decade suffix as notation');
    assert.equal(new Set(tokens.map(token => token.token)).size, tokens.length, 'equal spellings would still receive occurrence aliases');
    const reordered = artifact([{source:'text:0',action:'translate',pieces:[
        {token:tokens[1].token},{text:' then '},{token:tokens[0].token},{text:' '},
        ...tokens.slice(2).map(token => ({token:token.token})),
    ]}]);
    validatePresentationReferenceShape(reordered,catalog.sources);
    assert.equal(validatePresentationReferences(reordered,catalog)['From {first} to {second}: roll 1D100 against HP 50/25/10.'],
        '{second} then {first} 1D100HP50/25/10');
    for (const pieces of [
        tokens.slice(0,-1).map(token => ({token:token.token})),
        [...tokens.map(token => ({token:token.token})),{token:tokens[0].token}],
        [...tokens.slice(0,-1).map(token => ({token:token.token})),{token:'token:999'}],
        [{text:'Copied {first}'},...tokens.map(token => ({token:token.token}))],
    ]) assert.throws(() => validatePresentationReferences(artifact([{source:'text:0',action:'translate',pieces}]),catalog));
});

test('partial retry keeps valid rows under stable aliases and structural alias errors refuse', () => {
    const catalog = issuePresentationReferences(['Alpha','Beta','Gamma']);
    const round = selectPresentationReferences(catalog,['Alpha','Gamma']);
    assert.deepEqual(round.sources.map(source => source.alias),['text:0','text:2']);
    const partial = acceptPresentationReferences(artifact([translate('text:0','A')]),round);
    assert.deepEqual(partial.texts,{Alpha:'A'});
    assert.deepEqual(partial.missing,['text:2']);
    const foreign = acceptPresentationReferences(artifact([translate('text:0','A'),translate('text:99','X')]),round);
    assert.deepEqual(foreign.texts,{});
    assert.deepEqual(foreign.missing,['text:0','text:2']);
    const duplicate = acceptPresentationReferences(artifact([translate('text:0','A'),translate('text:0','Again')]),round);
    assert.deepEqual(duplicate.texts,{});
});

test('all three tool-enabled presenter instructions require aliases rather than copied keys', async () => {
    const urls = [
        new URL('../../content/setup/character-presentation.md',import.meta.url),
        new URL('../../content/setup/ui-presentation.md',import.meta.url),
        new URL('../../extensions/module/map-presentation.md',import.meta.url),
    ];
    for (const url of urls) {
        const prompt = await readFile(url,'utf8');
        assert.match(prompt,/presentation-reference-v1/);
        assert.match(prompt,/\bkeep\b/);
        assert.match(prompt,/\btranslate\b/);
        assert.doesNotMatch(prompt,/"exact source (?:text|string)"/);
        assert.doesNotMatch(prompt,/keyed by the source string/);
    }
});
