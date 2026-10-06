/** Read-only action candidates for Jev check selection (§159); settlement stays in table.resolve. */
import type {CampaignSnapshot} from '../read/campaign.js';
import type {ModuleGraph} from '../read/module-graph.js';
import type {SessionView} from '../read/session-view.js';
import {array, normalize, row, string, type Row} from '../read/values.js';
import {npcsPresent} from '../read/capsule.js';
import {continuableCheck, npcProfileOf} from '../resolve/context.js';
import {SOCIAL_APPROACH_SKILLS} from '../resolve/arithmetic.js';
import {INVOLUNTARY_KINDS} from '../sanity/session.js';
import {statedSanLoss} from '../sanity/index.js';
import {parseSanLoss} from '../sanity/expression.js';
import {knownSpells, magicStateName} from '../magic/state.js';
import {statedCheck, statedEndingReward} from '../read/stated.js';
import {jsonDigest} from '../json.js';
import {RuleTables} from '../rules/tables.js';
import {ENDING_KINDS} from '../development/plan.js';
import {loadChaseRules} from '../chase/model.js';
import {magicLearningSources} from '../magic/facts.js';
import {npcPatient} from '../healing/patient.js';
import {hitPointGaps, participantCapability} from '../combat/profiles.js';
import {healingStatePath} from '../healing/session.js';
import {evaluateCondition, factsFromState, RuleObservations} from '../read/rule-facts.js';

interface Parameter {selection?: 'compatible'; name: string; question: string; options: Array<{label: string; value: any}>; multiple?: {minimum: number}; default?: {value: any; question: string}}
interface Option {key: string; family: string; label: string; definition?: string; facts?: Row; action: Row; parameters: Parameter[]; needs: string[]; authorization: 'declaration' | 'consequence'}
const parameter = (name: string, question: string, values: string[]): Parameter => ({name, question, options: values.map(value => ({label: value, value}))});
const modifiers = (): Parameter[] => [
    {...parameter('difficulty', 'What success level does the established difficulty require? Use regular when no harder difficulty is established.', ['regular', 'hard', 'extreme']),
        default: {value: 'regular', question: 'Does an established rule or circumstance require this particular action to achieve a hard or extreme success, instead of the regular default?'}},
    {...parameter('bonus', 'How many bonus dice does an established advantage grant?', ['none', 'one', 'two']),
        default: {value: 'none', question: 'Does an established rule or advantage grant this particular action any bonus dice?'}},
    {...parameter('penalty', 'How many penalty dice does an established disadvantage impose?', ['none', 'one', 'two']),
        default: {value: 'none', question: 'Does an established rule or disadvantage impose any penalty dice on this particular action?'}},
];

export async function checkCatalog(campaign: CampaignSnapshot, graph: ModuleGraph, sessions: SessionView, profiles: Row[], decisions: Row[],
    owners: {phases: Record<string, string>; openingAttack: Row | null; history: Row[]; publicText: string}): Promise<Row> {
    const options: Option[] = [], covered = new Set<string>();
    const declaration = string(row(campaign.turn.player_input).text ?? campaign.turn.player_text ?? '');
    const session = sessions.activeSession(), pending = sessions.pendingChoice() || campaign.turn.pending_choice;
    const currentActor = session?.kind === 'combat' ? campaign.party.find(sheet => sheet.id === session.turn_of || sheet.name === session.turn_of) : undefined;
    if (currentActor) profiles = profiles.filter(profile => profile.actor === currentActor.name);
    const scene = graph.scene(campaign.world.active_scene);
    const people = scene ? npcsPresent(graph, campaign.world, scene).map(node => ({name: graph.displayName(node),
        profile: npcProfileOf(graph, campaign.world, graph.handle(node)), node})) : [];
    // Numeric values remain host data. Only authored/pinned NPC profile rows become candidates;
    // neither another person's sheet nor an invented base chance supplies a missing helper skill.
    if (!session) {
        const canonical = new Map(profiles.map(profile => [normalize(profile.skill), profile.skill]));
        profiles = [...profiles];
        const ledger = row(await campaign.optional('npc-ledger.json'));
        for (const person of people) {
            const pins = Object.fromEntries(array(campaign.turn.receipts).filter(receipt => receipt.kind === 'npc'
                && receipt.npc === person.node.node_id && row(receipt.skill).name).map(receipt => [receipt.skill.name, receipt.skill.value]));
            const known = {...row(row(person.profile).characteristics), ...row(row(person.profile).skills), ...row(row(ledger[person.node.node_id]).skills), ...pins};
            for (const [name, given] of Object.entries(known)) {
                const skill = canonical.get(normalize(name));
                if (!skill) continue;
                const value = typeof given === 'object' && given !== null ? row(given).value : given;
                if (Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 100)
                    profiles.push({actor: person.name, skill, value, held: true, availability: 'bound'});
            }
        }
    }
    const actors = [...new Set(profiles.map(profile => string(profile.actor)))];
    const has = (decision: string): boolean => decisions.some(row => row.name === decision);
    const add = (decision: string, label: string, action: Row, parameters: Parameter[] = [], needs: string[] = [],
        authorization: Option['authorization'] = 'declaration', facts?: Row) => {
        if (!has(decision)) return;
        covered.add(decision);
        const boundAction: Row = {intent: 'investigate', goal: declaration, method: declaration, decision, ...action};
        for (const parameter of parameters) delete boundAction[parameter.name];
        options.push({key: `check:${options.length}`, family: string(decisions.find(row => row.name === decision)?.family ?? ''), label,
            action: boundAction, parameters, needs, authorization, ...(facts ? {facts} : {})});
    };
    // Active combat/chase candidates are already issued by sessionCandidates. Do not invent another
    // session executor or let an out-of-session candidate bypass a pending choice.
    if (pending || session && !currentActor) return {version: 1, owner: 'jev', options: [], session_owned: true,
        coverage: decisions.map(decision => ({decision: decision.name, owner: 'session', executable: false}))};
    if (owners.openingAttack) {
        const opening = owners.openingAttack;
        const preparation = row(opening.preparation);
        for (const target of array(opening.targets)) for (const weapon of array(opening.weapons)) {
            const needs = [...(array(preparation.targets).includes(target) ? [`npc_combat_profile_required:${target}`] : []),
                ...(array(preparation.weapons).includes(weapon) ? [`object_attack_usage_required:${weapon}`] : [])];
            add('combat:attack', `${opening.actor}: attack ${target} with ${weapon}`, {actor:opening.actor, target, weapon, intent:'combat'}, modifiers(), needs);
        }
        const readiness = (person: typeof people[number], role: 'foot' | 'driver' | 'passenger'): Row => ({
            ...participantCapability(person.profile, role), completion: graph.isPerson(person.node) ? 'archetype' : 'creature'});
        for (const target of array(opening.targets)) {
            const person = people.find(person => person.name === target)!;
            const capability = readiness(person, 'foot');
            const requirements = capability.ready ? [] : [{actor: target, role: 'foot', missing: capability.missing, completion: capability.completion}];
            add('chase:start', `${opening.actor}: pursue or flee from ${target}`, {actor: opening.actor, target}, [
            parameter('intent', 'Is the investigator fleeing this person or moving after them?', ['flee', 'move']),
            ], requirements.map(entry => `chase_actor_profile_required:${entry.actor}:foot`), 'declaration', {mobility: 'foot',
                profile_requirements: requirements, chase_actors: [{name: target, readiness: {foot: capability}}]});
        }
        const chaseRules = await loadChaseRules(new RuleTables(campaign.context));
        const placements = [...owners.history.flatMap(record => array(record.receipts)), ...array(campaign.turn.receipts)].reverse();
        const presenceEvidence = (person: typeof people[number]): string | null => {
            const receipt = placements.find(receipt => receipt.kind === 'npc' && receipt.npc === person.node.node_id && receipt.to != null);
            return receipt?.to === campaign.world.active_scene ? string(receipt.why).slice(0, 1500) || null : null;
        };
        const ownProfile = profiles.filter(profile => profile.actor === opening.actor && normalize(profile.skill) === normalize('Drive Auto'));
        add('chase:start', `${opening.actor}: a chase involving vehicles`, {actor: opening.actor},
            [parameter('intent', 'Is the investigator fleeing the pursuers or pursuing the quarry?', ['flee', 'move'])], [], 'declaration', {
                mobility: 'vehicle',
                chase_actors: [{name: opening.actor, investigator: true, profile_available: true,
                    readiness: Object.fromEntries(['foot', 'driver', 'passenger'].map(role => [role, {ready: true, missing: []}])),
                    driving_available: ownProfile.some(profile => profile.availability === 'bound')},
                    ...people.filter(person => array(opening.targets).includes(person.name)).map(person => ({name: person.name, investigator: false,
                        description: string(person.node.summary ?? person.node.description).slice(0, 600),
                        presence_evidence: presenceEvidence(person),
                        profile_available: person.profile !== null,
                        readiness: Object.fromEntries((['foot', 'driver', 'passenger'] as const).map(role => [role, readiness(person, role)])),
                        driving_available: profiles.some(profile => profile.actor === person.name && normalize(profile.skill) === normalize('Drive Auto') && profile.availability === 'bound')}))],
                vehicle_profiles: Object.entries(row(row(chaseRules.vehicles).entries)).map(([key, value]) => ({key, ...row(value)})),
            });
    }
    if (!session && campaign.party.length) {
        const actor = campaign.party[0].name;
        for (const ending of ENDING_KINDS) {
            if (ending === 'tpk' && !campaign.party.every(sheet => array(sheet.conditions).includes('dead'))) continue;
            const reward = statedEndingReward(graph, campaign.world, ending);
            add('development:end-session', `Close the party's session as ${ending} and settle its source-bound development`,
                {actor, intent: 'montage', ending, ...(reward ? {scenario_san_reward_expr: reward.expression} : {})}, [], [],
                ending === 'tpk' ? 'consequence' : 'declaration');
        }
    }
    const learningSources = magicLearningSources({graph, world: campaign.world, npcProfile: handle => npcProfileOf(graph, campaign.world, handle)});
    const receipts = [...owners.history.flatMap(record => array(record.receipts)), ...array(campaign.turn.receipts)];
    let visitStart = 0;
    receipts.forEach((receipt, index) => { if (receipt.kind === 'move' && receipt.from !== receipt.to) visitStart = index + 1; });
    const visitReceipts = receipts.slice(visitStart);
    const publicChecks: Row[] = [];
    const descriptions = row((await new RuleTables(campaign.context).skillDescriptions()).skills);
    for (const profile of profiles) {
        if (profile.availability !== 'bound') continue;
        // These are exact canonical rule bindings, the same ones used by ResolvePipeline.candidates.
        // They are not a classifier of the declaration: Jev still judges the actual method.
        if (['First Aid', 'Medicine'].includes(profile.skill)) continue;
        add('core-check:ordinary-check', `${profile.actor}: ordinary ${profile.skill} check`,
            {actor: profile.actor, skill: profile.skill}, [
                parameter('intent', 'Which canonical intent describes this ordinary action? A specialized rule check is not ordinary.', ['investigate', 'move', 'social']),
                ...modifiers(),
            ]);
        const definition = row(descriptions[profile.skill]).description;
        const added = options.at(-1);
        if (added && added.action.skill === profile.skill && typeof definition === 'string') added.definition = definition;
    }
    const patients: Row[] = [];
    const observations = await RuleObservations.load(campaign.context);
    const now = Number(row(campaign.world.clock).minutes ?? 0);
    for (const patient of [...campaign.party, ...people.filter(person => person.profile !== null && !hitPointGaps(person.profile).length).map(person => npcPatient(graph, campaign.world, person.name)).filter((patient): patient is Row => patient !== null)]) {
        const healing = row(await campaign.optional(`save/${healingStatePath(string(patient.id))}`));
        const conditions = Array.isArray(healing.conditions) ? healing.conditions : array(patient.conditions);
        const facts = factsFromState({...patient, investigator_id: patient.id, conditions,
            wound_ledger: array(healing.wound_ledger), major_wound_recovery_ledger: array(healing.major_wound_recovery_ledger)}, patient, now);
        const hp = patient.current_hp ?? null, max = row(patient.derived).HP ?? null;
        const usage = row(healing.healing_usage), wound = string(usage.active_wound_id || usage.wound_id || 'active-wound'), day = string(usage.active_day_id || usage.day_id || 'day-0');
        const flags = Object.keys(row(usage.records)).length ? row(row(row(usage.records)[wound])[day]) : usage;
        patients.push({name: patient.name, hp, max, conditions, injured: typeof hp === 'number' && typeof max === 'number' ? hp < max : null,
            minutes_since_injury: facts['time.minutes_since_injury'] ?? null, first_aid_used: flags.first_aid_used === true,
            medicine_used: flags.medicine_used === true, rule_facts: facts});
    }
    for (const actor of actors) {
        const own = profiles.filter(profile => profile.actor === actor && profile.availability === 'bound');
        if (own.length >= 2) add('core-check:combined-check', `${actor}: one source-required combined roll using multiple skills, not a sequence of separate attempts`, {actor}, [
            {...parameter('skills', 'Which skills are jointly required by this one combined check? Do not combine separate sequential actions.', own.map(profile => profile.skill)), multiple: {minimum: 2}},
            parameter('mode', 'Does this combined check succeed if any one skill succeeds, or must all its required skills succeed?', ['any', 'all']),
            ...modifiers(),
        ]);
        for (const node of scene ? graph.ruleNodes(scene) : []) {
            const mechanics = graph.mechanicsOf(node), stated = statedCheck(graph, node, null), rule = graph.handle(node);
            if (stated) {
                const paths = array(stated.check.values).map(value => string(row(value).path));
                const skills = paths.map(path => path.slice(path.indexOf('.') + 1));
                const decision = stated.check.scope === 'opposed' ? 'core-check:opposed-check'
                    : paths.length === 1 && paths[0].toLowerCase() === 'characteristics.luck' ? 'push-luck:luck-roll' : 'core-check:ordinary-check';
                const parameters: Parameter[] = [];
                if (skills.length > 1 && stated.check.selection !== 'maximum') parameters.push(parameter('skill', 'Which source-stated approach implements the declared method?', skills));
                add(decision, `${actor}: the source-stated check for ${graph.displayName(node)}`, {actor, rule, ...(stated.step !== null ? {step: stated.step} : {})}, parameters,
                    row(row(mechanics.hazard).trigger).kind === 'keeper' ? ['hazard_trigger_not_established'] : []);
            }
            const loss = statedSanLoss(mechanics.sanity_loss);
            if (loss) add('sanity:check', `${actor}: source-stated sanity check for ${graph.displayName(node)}`, {actor, rule, san_loss: loss.join('/')},
                [{...parameter('involuntary', 'Assume the upcoming SAN roll fails. The SAN rule then authorizes the Keeper to choose one brief involuntary response from these legal options; this is not a voluntary player decision. Judge its immediate compatibility, not whether the roll has already failed. Do not choose an extended strategy.', [...INVOLUNTARY_KINDS]), selection: 'compatible'}], [], 'consequence');
        }
        for (const [skill, prefix] of [['First Aid', 'first-aid'], ['Medicine', 'medicine']]) {
            if (!own.some(profile => profile.skill === skill)) continue;
            for (const kind of ['ordinary', 'stabilization']) {
                const decision = `healing:${prefix}-${kind}`;
                covered.add(decision);
                for (const patient of patients) {
                    const conditions = array(patient.conditions), used = prefix === 'first-aid' ? patient.first_aid_used : patient.medicine_used;
                    if (conditions.includes('dead') || used || kind === 'ordinary' && patient.injured === false && !conditions.includes('unconscious')) continue;
                    const gates = observations.conditionsFor(`decision:coc7:${decision}`).filter(condition => condition.hard_gate === true)
                        .map(condition => evaluateCondition(row(condition.properties).expression, patient.rule_facts));
                    if (gates.includes(false)) continue;
                    const {rule_facts: _facts, ...clinical} = patient;
                    const needs = gates.includes(null) || patient.injured === null ? ['patient_treatment_state_incomplete'] : [];
                    add(decision, `${actor}: ${skill} ${kind} for patient ${patient.name}`, {actor, skill, target: patient.name}, [], needs,
                        'declaration', {patient: clinical, clinical_eligibility: needs.length ? 'unknown' : 'eligible'});
                    const added = options.at(-1);
                    if (added?.action.decision === decision) added.definition = 'The actor is the rescuer; the target is the patient. Clinical conditions apply to the patient, not the rescuer. '
                        + 'The host evaluates injury, timing and prior-treatment limits. Judge whether this rescuer is performing this listed treatment on this patient; do not replace an eligible First Aid or Medicine roll with automatic recovery.';
                }
            }
        }
        for (const person of people) {
            // §180.3: talking a being round and reading what it hides are offered against a person only; a creature
            // present is still a body to contest (`core-check:opposed-check`) and to perceive (`sanity:check`).
            if (graph.isPerson(person.node)) {
                const skills = own.map(profile => profile.skill).filter(skill => Object.values(SOCIAL_APPROACH_SKILLS).includes(skill));
                add('social:adjudicate-difficulty', `${actor}: influence ${person.name} with a social approach`, {actor, target: person.name, intent: 'social'},
                    [{...parameter('skill', 'Which social skill fits the conduct the player actually described? The Keeper selects the skill from that conduct, not the player.', skills), selection: 'compatible'}, ...modifiers()], [], 'declaration',
                    {stage: 'difficulty_adjudication', actor_role: campaign.party.some(sheet => sheet.name === actor) ? 'investigator'
                        : people.some(person => person.name === actor) ? 'npc' : 'unknown', target_role: 'npc'});
                if (own.some(profile => profile.skill === 'Psychology'))
                    add('psychology:observe-concealed', `${actor}: observe ${person.name} with Psychology`, {actor, target: person.name, skill: 'Psychology'});
            }
            const opposing = [...Object.keys(row(row(person.profile).skills)), ...Object.keys(row(row(person.profile).characteristics))];
            const shared = own.map(profile => profile.skill).filter(skill => opposing.includes(skill));
            if (shared.length) add('core-check:opposed-check', `${actor}: opposed noncombat check against ${person.name}`, {actor, target: person.name},
                [parameter('skill', 'Which shared skill or characteristic is the declared contest resolved with?', shared), ...modifiers()]);
            const profile = row(person.profile);
            let loss = statedSanLoss(profile.sanity_loss);
            for (const key of ['san_loss', 'san_loss_to_see', 'sanity_loss']) if (!loss) loss = parseSanLoss(profile[key]);
            const investigator = campaign.party.find(sheet => sheet.name === actor);
            const alreadyExposed = investigator && visitReceipts.some(receipt => receipt.kind === 'roll' && receipt.roll_kind === 'sanity_check'
                && receipt.actor === investigator.id && receipt.npc_exposure === graph.handle(person.node));
            if (loss && investigator) covered.add('sanity:check');
            if (loss && investigator && !alreadyExposed) add('sanity:check', `${actor}: source-stated sanity check on perceiving ${person.name}`, {actor, target: person.name, san_loss: loss.join('/')},
                [{...parameter('involuntary', 'Assume the upcoming SAN roll fails. The SAN rule then authorizes the Keeper to choose one brief involuntary response from these legal options; this is not a voluntary player decision. Judge its immediate compatibility, not whether the roll has already failed. Do not choose an extended strategy.', [...INVOLUNTARY_KINDS]), selection: 'compatible'}], [], 'consequence');
        }
        add('push-luck:luck-roll', `${actor}: a Luck percentile check`, {actor}, modifiers());
        const sheet = campaign.party.find(sheet => sheet.name === actor);
        if (sheet) {
            const previous = [...receipts].reverse().find(receipt => continuableCheck(receipt, sheet.id));
            if (previous && !receipts.some(receipt => receipt.source_receipt === previous.id)) {
                const check = row(previous.check);
                publicChecks.push({actor, skill: previous.skill ?? null, passed: previous.passed ?? check.passed ?? null,
                    roll: previous.roll ?? check.roll ?? null, threshold: previous.threshold ?? check.threshold ?? null, goal: check.goal ?? null});
                if (check.push_eligible === true && previous.pushed !== true && previous.passed === false) {
                    const sentences = [...new Intl.Segmenter(undefined, {granularity: 'sentence'}).segment(owners.publicText)]
                        .filter(part => part.index >= Math.max(0, owners.publicText.length - 4000)).map(part => part.segment.trim()).filter(Boolean).slice(-254);
                    add('push-luck:pushed-roll', `${actor}: explicitly push the failed ${previous.skill} check with an accepted announced risk`,
                        {actor, push: true}, [parameter('stakes', 'Select the previously published failure consequence which the player explicitly accepts for this pushed roll. Do not invent a risk or use a sentence that does not announce one.', sentences)]);
                }
                const luck = Number(sheet.current_luck ?? row(sheet.characteristics).LUCK ?? 0);
                if (Number.isSafeInteger(luck) && luck > 0 && luck <= 254 && previous.pushed !== true && previous.level !== 'fumble')
                    add('push-luck:luck-spend', `${actor}: explicitly spend Luck on the previous ${previous.skill} check`, {actor}, [{name: 'luck',
                        question: 'Select only the number of Luck points the player explicitly chose to spend. Do not compute or choose an unstated cost.',
                        options: Array.from({length: luck}, (_, index) => ({label: `Spend ${index + 1} Luck point(s)`, value: index + 1}))}]);
            }
            const patient = patients.find(patient => patient.name === actor), conditions = array(patient?.conditions), facts = row(patient?.rule_facts);
            for (const decision of ['healing:dying-hour-clock', 'healing:dying-round-clock', 'healing:weekly-major-wound-recovery', 'sanity:reality-check']) covered.add(decision);
            if (conditions.includes('dying') && !conditions.includes('dead')) {
                const decision = conditions.includes('stabilized') ? 'healing:dying-hour-clock' : 'healing:dying-round-clock';
                add(decision, `${actor}: ${decision} for an existing dying condition`, {actor}, [], [], 'consequence', {conditions});
            }
            if (conditions.includes('major_wound') && !conditions.includes('dying') && !conditions.includes('dead') && facts['actor.recovery.major_wound_week_due'] !== false)
                add('healing:weekly-major-wound-recovery', `${actor}: a due weekly major-wound recovery check`, {actor}, [{name: 'rest',
                question: 'Which convalescence conditions are established for the completed recovery interval?', options: [
                    {label: 'Complete rest in adequate surroundings', value: {complete: true, poor_environment: false}},
                    {label: 'Incomplete rest in adequate surroundings', value: {complete: false, poor_environment: false}},
                    {label: 'Complete rest in poor surroundings', value: {complete: true, poor_environment: true}},
                    {label: 'Incomplete rest in poor surroundings', value: {complete: false, poor_environment: true}},
                ]}], facts['actor.recovery.major_wound_week_due'] === true ? [] : ['major_wound_recovery_due_unknown'], 'consequence',
                    {conditions, week_due: facts['actor.recovery.major_wound_week_due'] ?? null});
            const sanity = row(sessions.sanity.get(string(sheet.id)));
            if (sanity.active_delusion) add('sanity:reality-check', `${actor}: test the existing delusion against reality`, {actor});
            const magic = row(await campaign.optional(`save/${magicStateName(string(sheet.id))}`));
            const spells = knownSpells(magic, Number(row(campaign.world.clock).minutes ?? 0));
            for (const spell of spells) add('magic:cast-spell', `${actor}: cast known spell ${spell}`, {actor, intent: 'cast', spell});
            for (const [source, taught] of Object.entries(learningSources)) {
                const handle = source.slice(source.indexOf(':') + 1), node = graph.find(handle);
                if (!node) continue;
                const available = people.some(person => person.node.node_id === node.node_id)
                    || !!scene && graph.sceneAssetNodes(scene).some(asset => asset.node_id === node.node_id)
                    || array(sheet.equipment).some(item => normalize(row(item).name) === normalize(graph.displayName(node)));
                if (!available) continue;
                for (const spell of array(taught).filter(value => typeof value === 'string'))
                    add('magic:learn-spell', `${actor}: learn ${spell} from ${graph.displayName(node)}`, {actor, spell, target: graph.displayName(node)});
            }
        }
    }
    // Inventory every decision, including ones without a closed action adapter. An unsupported selected
    // family is a named need, never silently dropped or replaced by an ordinary roll.
    for (const decision of decisions) {
        if (covered.has(decision.name)) continue;
        if (['context', 'advise', 'realize', 'due-trigger'].includes(owners.phases[decision.name])) continue;
        if (session && ['combat', 'chase'].includes(decision.family)) continue;
        if (['combat', 'chase'].includes(decision.family) && !['combat:attack', 'chase:start'].includes(decision.name)) continue;
        if (['sanity:bout-tick', 'sanity:bout-end'].includes(decision.name)) continue;
        add(decision.name, string(decision.description ?? decision.name), {}, [], [`check_arguments_unavailable:${decision.name}`]);
    }
    return {version: 1, owner: 'jev', options, profiles_revision: jsonDigest(profiles), coverage: decisions.map(decision => ({decision: decision.name, executable: covered.has(decision.name)
        && options.some(option => option.action.decision === decision.name && !option.needs.length),
        phase: owners.phases[decision.name], owner: options.some(option => option.action.decision === decision.name) ? 'jev' : 'existing-phase'})),
        situation: {patients: patients.map(({rule_facts: _facts, ...patient}) => patient), public_checks: publicChecks, people: people.map(person => ({name: person.name, profile_available: person.profile !== null}))}};
}
