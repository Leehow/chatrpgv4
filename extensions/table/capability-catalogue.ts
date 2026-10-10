/** Request-local schema views derived from the canonical registry; never an execution registry. */
import {createHash} from 'node:crypto';
type Row = Record<string, any>;
export interface CapabilityTool {name: string; description: string; parameters: Row}
export interface CapabilityCard {
    name: string;
    verb: string;
    effect?: string;
    applicability: string;
    exclusions: string;
    fields?: readonly string[];
    detail: string;
    version: string;
}
type Facet = {name: string; fields: readonly string[]; applicability: string; exclusions: string};
const FACETS: Readonly<Record<string, readonly Facet[]>> = {
    npc: [
        {name: 'npc-presence', fields: ['to','walk_on','creature','archetype','stance','skill'], applicability: 'Bring, move, seat or prepare a person or creature at the current encounter.', exclusions: 'Ordinary activity, mood, intentions or combat actions without a presence change.'},
        {name: 'npc-activity', fields: ['activity'], applicability: 'Record a supported waking, sleeping, resting or other ordinary activity transition.', exclusions: 'Routine speculation that erases observed events; combat conditions.'},
        {name: 'npc-mood', fields: ['mood'], applicability: 'Record the person current mood before their speech or when it materially changes.', exclusions: 'Location changes, social disposition or physical conditions.'},
        {name: 'npc-disposition', fields: ['disposition'], applicability: 'Record a changed social disposition after an actual interaction.', exclusions: 'A mood, a predicted response or a change of presence.'},
        {name: 'npc-intention', fields: ['intends','intent_ref','intent_outcome','spend_turn','outcome'], applicability: 'Record a person intention, its attempted progress or actual outcome.', exclusions: 'Unchosen player actions or automatic fulfilment of an offstage plan.'},
        {name: 'npc-combat', fields: ['conditions','defense','action','dead','archetype','skill'], applicability: 'Prepare or record NPC combat behaviour, rules conditions or actual death.', exclusions: 'Ordinary sleep, inferred harm or an outcome without canonical adjudication.'},
        {name: 'npc-reunion', fields: ['reunion'], applicability: 'Establish compatible offstage continuity at an actual return encounter.', exclusions: 'A simulated offstage schedule, ownership transfer or changed numeric profile.'},
    ],
    object: [
        {name: 'object-acquisition', fields: ['adopt','definition','source_object','from','quantity','condition'], applicability: 'Create or adopt a supported physical instance with its actual definition and ownership.', exclusions: 'Granting possession solely from narration or an unaccepted source draft.'},
        {name: 'object-document', fields: ['document'], applicability: 'Record carrier text, append writing, open, show or observe an actual readable carrier.', exclusions: 'Inventing undiscovered source truth or showing a document without authorization.'},
        {name: 'object-transfer', fields: ['from','offer','handover','check','part','quantity'], applicability: 'Offer, hand over or transfer an actual physical instance or part.', exclusions: 'An unaccepted request or an automatic theft result.'},
        {name: 'object-state', fields: ['condition','quantity'], applicability: 'Record supported physical condition or quantity changes on an existing instance.', exclusions: 'A new rules profile, imagined damage or a duplicated acquisition.'},
    ],
};
const COMMON: Readonly<Record<string, readonly string[]>> = {
    npc: ['kind','name','why','owed'],
    object: ['kind','name','to','why','owed'],
};

/** These are closed effect descriptions, not a classifier over player text. */
const EFFECTS: Readonly<Record<string, readonly [string, string]>> = {
    ending: ['Record an actual scenario ending.', 'A scene transition or an unfinished objective.'],
    adaptation: ['Record a supported campaign adaptation.', 'Changing original source truth or player choices.'],
    move: ['Travel to an actual supported destination or perform a local transition.', 'A destination the player has not chosen.'],
    clue: ['Acquire a clue through an actual supported discovery.', 'A guess or unrevealed module truth.'],
    clock: ['Pin the opening local datetime when the source left it open.', 'Changing an already pinned anchor.'],
    scene: ['Reassess current service availability and local crowd activity.', 'Granting entry, moving an actor or acquiring an item.'],
    time: ['Advance canonical time for an actual wait or activity.', 'Charging a journey twice or an unattempted full activity.'],
    damage: ['Settle source-grounded environmental harm through the canonical rules.', 'Invented harm or replacing combat adjudication.'],
    item: ['Transfer a canonical item as a supported world change.', 'Creating an unsupported ownership outcome.'],
    define: ['Register a supported object definition.', 'Choosing numeric results outside their existing authority.'],
    usage: ['Prepare the actual physical use of an existing object.', 'Renaming the object as a weapon to bypass preparation.'],
    ability: ['Register or change a supported ability.', 'Granting an ability from unaccepted material.'],
    cash: ['Settle an actual transfer, payment or supported money change.', 'A promised payment or a quoted price without a transaction.'],
    flag: ['Record an established world switch.', 'An inferred event that did not happen.'],
    note: ['Record or close actual unresolved continuity.', 'Closing a remembered reference through the wrong owner.'],
    ruling: ['Record the table ruling and its actual applicability.', 'Changing canonical rules or unresolved rulings silently.'],
    dossier: ['Record a package-owned missing dossier fact established in play.', 'Overwriting an authored fact or a lane-owned value.'],
    person: ['Record a supported name or form of address for an existing person.', 'Inventing another identity or changing investigator identity.'],
    threat: ['Advance or mint a supported threat clock.', 'Treating a clock offer as an obligation.'],
    fork: ['Branch the canonical worldline after the current turn commits.', 'Executing a branch before narration or without its normal gates.'],
    switch: ['Resume an existing canonical worldline.', 'A nonexistent, merged or unauthorized destination line.'],
    merge: ['Merge worldlines through the canonical conflict protocol.', 'Skipping conflicts or committing a partial merge.'],
    handout: ['Deliver a revealable source-backed handout.', 'Leaking unrevealed material or fabricating an attachment.'],
    map: ['Reveal actual source-backed regions established in play.', 'Revealing unknown areas or changing source geometry.'],
};
const VERBS: Readonly<Record<string, string>> = {
    look: 'Inspect current named scenes, people, clues, equipment or rules already available at the table.',
    lookup: 'Consult source material, catalogues or rules, or discover missing capability detail.',
    recall: 'Read actual past dialogue, events or attributed memories.',
    resolve: 'Request a permitted canonical rules adjudication; the hybrid engine owns its normal route.',
    ask: 'Return a genuine decision boundary to the player.',
    narrate: 'Deliver the actual outcome in the player language and close the current turn.',
};
const clone = <T>(value: T): T => {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(clone) as T;
    const result = Object.create(Object.getPrototypeOf(value));
    for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if ('value' in descriptor) descriptor.value = clone(descriptor.value);
        Object.defineProperty(result, key, descriptor);
    }
    return result;
};
const kindOf = (schema: Row): string | undefined => schema.properties?.kind?.const ?? schema.properties?.kind?.enum?.[0];
const variantsOf = (tool: CapabilityTool): Row[] => tool.parameters?.properties?.effects?.items?.anyOf ?? [];
const versionOf = (schema: Row): string => createHash('sha256').update(JSON.stringify(schema)).digest('hex');

export function capabilityCatalogue(tools: readonly CapabilityTool[]): CapabilityCard[] {
    const cards: CapabilityCard[] = [];
    for (const tool of tools) {
        if (tool.name !== 'apply') {
            if (!VERBS[tool.name]) throw Error('Canonical verb needs an index summary: '+tool.name);
            cards.push({name: tool.name, verb: tool.name, applicability: VERBS[tool.name],
                exclusions: 'The ordinary canonical phase and authorization gates still apply.',
                detail: tool.description, version: versionOf(tool.parameters)});
            continue;
        }
        for (const variant of variantsOf(tool)) {
            const effect = kindOf(variant);
            if (!effect) throw Error('Capability effect has no canonical kind');
            const facets = FACETS[effect];
            if (!facets) {
                const description = EFFECTS[effect];
                if (!description) throw Error('Canonical effect needs a capability description: '+effect);
                cards.push({name: effect, verb: 'apply', effect, applicability: description[0],
                    exclusions: description[1], detail: JSON.stringify(variant), version: versionOf(variant)});
                continue;
            }
            const covered = new Set([...COMMON[effect], ...(variant.required ?? []), ...facets.flatMap(f => [...f.fields])]);
            const missing = Object.keys(variant.properties).filter(field => !covered.has(field));
            if (missing.length) throw Error('Canonical fields need capability owners: '+effect+'.'+missing.join(','));
            for (const facet of facets) {
                for (const field of facet.fields) if (!Object.hasOwn(variant.properties, field))
                    throw Error('Capability references an unknown canonical field: '+effect+'.'+field);
                const fields = [...new Set([...COMMON[effect], ...(variant.required ?? []), ...facet.fields])];
                const schema = clone(variant);
                schema.properties = Object.fromEntries(Object.entries(schema.properties).filter(([field]) => fields.includes(field)));
                cards.push({name: facet.name, verb: 'apply', effect, fields, applicability: facet.applicability,
                    exclusions: facet.exclusions, detail: JSON.stringify(schema), version: versionOf(variant)});
            }
        }
    }
    return cards;
}

/** Fold selected facets of the same effect into one canonical shape, preserving mixed batches. */
export function projectCapabilityTools(tools: readonly CapabilityTool[], selected: ReadonlySet<string>,
    core: readonly string[] = ['look','lookup','recall','ask','narrate']): CapabilityTool[] {
    const catalogue = capabilityCatalogue(tools);
    const unknown = [...selected].filter(name => !catalogue.some(card => card.name === name));
    if (unknown.length) throw Error('Unknown capability selection: '+unknown.join(','));
    const applyCards = catalogue.filter(card => card.verb === 'apply' && selected.has(card.name));
    const effects = new Set(applyCards.map(card => card.effect));
    return tools.flatMap(tool => {
        if (tool.name !== 'apply') return core.includes(tool.name) || selected.has(tool.name) ? [clone(tool)] : [];
        if (!applyCards.length) return [];
        const projected = clone(tool);
        projected.parameters.properties.effects.items.anyOf = variantsOf(projected).filter(variant => {
            const effect = kindOf(variant)!;
            if (!effects.has(effect)) return false;
            const cards = applyCards.filter(card => card.effect === effect);
            if (cards.every(card => card.fields)) {
                const fields = new Set(cards.flatMap(card => [...card.fields!]));
                variant.properties = Object.fromEntries(Object.entries(variant.properties).filter(([field]) => fields.has(field)));
            }
            // This restricts the model view; the complete registered canonical validator remains unchanged.
            variant.additionalProperties = false;
            return true;
        });
        return [projected];
    });
}

/** Structural missing-view check only. It never interprets intent or grants permission. */
export function missingEffectCapabilities(effects: readonly Row[], tools: readonly CapabilityTool[],
    selected: ReadonlySet<string>): string[] {
    const cards = capabilityCatalogue(tools).filter(card => card.verb === 'apply');
    const missing = new Set<string>();
    for (const effect of effects) {
        const candidates = cards.filter(card => card.effect === effect.kind);
        if (!candidates.length) throw Error('Unknown canonical effect: '+String(effect.kind));
        if (candidates.every(card => !card.fields)) {
            if (!selected.has(candidates[0].name)) missing.add(candidates[0].name);
            continue;
        }
        const fields = Object.keys(effect).filter(field => !(COMMON[String(effect.kind)] ?? []).includes(field));
        for (const field of fields) {
            const owners = candidates.filter(card => card.fields!.includes(field));
            if (!owners.length) throw Error('Unknown canonical effect field: '+String(effect.kind)+'.'+field);
            if (!owners.some(card => selected.has(card.name))) missing.add(owners[0].name);
        }
        if (!fields.length && !candidates.some(card => selected.has(card.name))) missing.add(candidates[0].name);
    }
    return [...missing];
}
