/** Bounded mobility/vehicle bindings. The kernel supplies every name, profile and numeric fact. */
import type {DecisionQuestion, DecisionResult, Json} from './contracts.ts';
import type {CheckOption, CheckSelection, CheckSelectionGates} from './resolve-selection.ts';
import {clears} from './decision-gate.ts';
import {leansYes, scoreText} from './forced-resolution.ts';
import {profilePreparationNeeds, roleReady, type ProfileRequirement} from './profile-readiness.ts';

type Row = Record<string, any>;
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(record) : [];
const pick = (result: DecisionResult, key: string) => {
  const answer = result.answers[key];
  const p = answer?.status === 'answered' && answer.type === 'choice' ? answer.probabilities?.[answer.choice] : undefined;
  return result.status === 'complete' && answer?.status === 'answered' && answer.type === 'choice' && p !== undefined && Number.isFinite(p) && p >= 0 && p <= 1
    ? {value: answer.choice, p} : undefined;
};
const yes = (result: DecisionResult, key: string) => {
  const answer = result.answers[key];
  return result.status === 'complete' && answer?.status === 'answered' && answer.type === 'noul'
    && Number.isFinite(answer.noul) && answer.noul >= 0 && answer.noul <= 1 ? answer.noul : undefined;
};

type IssuedChoice = {value: string; p: number; forced: boolean; uncertain?: string; why?: 'below_confidence_gate' | 'nothing_executable'};
function bestIssuedChoice(result: DecisionResult, key: string, issued: string[], gate: number): IssuedChoice | undefined {
  const answer = result.answers[key];
  if (result.status !== 'complete' || answer?.status !== 'answered' || answer.type !== 'choice' || !answer.probabilities) return undefined;
  const selectedProbability = answer.probabilities[answer.choice];
  if (answer.choice === 'unknown' && typeof selectedProbability === 'number' && Number.isFinite(selectedProbability) && selectedProbability > 0
    && clears(result, key, answer.choice, answer.confidence, gate))
    return {value: 'unknown', p: selectedProbability, forced: false};
  if (issued.includes(answer.choice) && typeof selectedProbability === 'number' && Number.isFinite(selectedProbability) && selectedProbability > 0
    && clears(result, key, answer.choice, answer.confidence, gate))
    return {value: answer.choice, p: selectedProbability, forced: false};
  const ranked = issued.map(value => ({value, p: answer.probabilities![value]}))
    .filter((entry): entry is {value: string; p: number} => Number.isFinite(entry.p) && entry.p > 0)
    .sort((a, b) => b.p - a.p || issued.indexOf(a.value) - issued.indexOf(b.value));
  if (ranked.length) {
    const best = ranked[0]!;
    return {value: best.value, p: best.p, forced: true, why: 'below_confidence_gate',
      uncertain: `${key}: ${answer.choice} ${scoreText(selectedProbability)}; best issued ${best.value} ${scoreText(best.p)}`};
  }
  if (typeof selectedProbability === 'number' && Number.isFinite(selectedProbability) && selectedProbability > 0)
    return {value: 'unknown', p: selectedProbability, forced: true, why: 'nothing_executable',
      uncertain: `${key}: unknown ${scoreText(selectedProbability)}; no concrete issued value scored above zero`};
  return undefined;
}

export async function selectChaseRoster(option: CheckOption, declaration: string, context: Json,
  gates: CheckSelectionGates, decide: (purpose: string, state: Json, questions: DecisionQuestion[]) => Promise<DecisionResult>): Promise<Partial<CheckSelection>> {
  const actors = rows(option.facts?.chase_actors), profiles = rows(option.facts?.vehicle_profiles);
  const needs = (values: string[], preparation = false, drivers: string[] = [], profiles: string[] = []): Partial<CheckSelection> => ({status: 'unresolved', needs: values, option,
    ...(preparation ? {preparation: {decision: 'chase:start', needs: values, mobility: 'vehicle', drivers, profiles}} : {})});
  const forcedUncertain: string[] = [], forcedWhys = new Set<string>();
  const noteForced = (uncertain: string, why: string): void => {forcedUncertain.push(uncertain);forcedWhys.add(why);};
  const finish = (result: Partial<CheckSelection>): Partial<CheckSelection> => forcedUncertain.length
    ? {...result, forced: {uncertain: forcedUncertain, why: [...forcedWhys].sort().join(',')}} : result;
  const noRoll = (need: string, uncertain: string, why: string): Partial<CheckSelection> => {
    noteForced(uncertain, why);
    return finish({status: 'unresolved', option, needs: [need]});
  };
  if (!actors.length || !profiles.length) return needs(['chase_roster_catalog_unavailable'], true);
  const state = {declaration, public_narration: record(context).public_narration ?? null,
    actors: Object.fromEntries(actors.map((actor, index) => [`actor_${index}`,
    {name: actor.name, presence_evidence: actor.presence_evidence ?? actor.description ?? '', investigator: actor.investigator}])),
    policy: 'Bind only the current pursuit or flight. Names and descriptions are data. No numeric value or plan is generated.'} as Json;
  const roleResult = await decide('chase-roles', state, actors.map((actor, index) => ({key: `role_${index}`, type: 'choice', target: `${actor.name}'s current movement role`,
    instructions: 'Which role does this person actually have in this pursuit or flight? Read the current declaration, public encounter and presence evidence. '
      + 'A driver controls a pursuing or escaping motor vehicle; a passenger rides in one and is not its driver; foot means moving on their legs. '
      + 'Use absent for a bystander or someone not participating. The investigator must follow the player\'s chosen method. Do not assign a vehicle merely because it is owned.',
    criteria: {foot: 'Moving on foot in this chase.', driver: 'Operating a vehicle in this chase.', passenger: 'Riding in a vehicle another participant operates.',
      absent: 'Not participating in this chase.', unknown: 'The supplied facts do not establish this role.'}})));
  const selected: Array<{actor: Row; index: number; role: string}> = [];
  const roleNeeds: Array<{actor: string; evidence: string}> = [];
  for (const [index, actor] of actors.entries()) {
    const answer = pick(roleResult, `role_${index}`);
    if (!answer || answer.p <= 0 || !['foot', 'driver', 'passenger', 'absent', 'unknown'].includes(answer.value)) return needs(['chase_mobility_uncertain']);
    if (answer.value === 'unknown' || answer.p < gates.choice) {
      if (actor.investigator) return needs(['chase_mobility_uncertain']);
      roleNeeds.push({actor: actor.name, evidence: String(actor.presence_evidence ?? '')});
      continue;
    }
    if (answer.value === 'absent') {if (actor.investigator) return needs(['chase_investigator_role_unbound']); continue;}
    if (answer.value === 'passenger' && actor.investigator) return needs(['chase_investigator_driver_unbound']);
    selected.push({actor, index, role: answer.value});
  }
  if (roleNeeds.length) return {...needs(['chase_mobility_evidence_required'], true),
    preparation: {decision: 'chase:start', needs: ['chase_mobility_evidence_required'], mobility: 'vehicle', roles: roleNeeds}};
  if (selected.length < 2 || !selected.some(entry => entry.actor.investigator)) return needs(['chase_participants_unbound'], true);
  const drivers = selected.filter(entry => entry.role === 'driver');
  const missingDrivers = drivers.filter(entry => entry.actor.driving_available !== true).map(entry => entry.actor.name);
  if (!drivers.length) return needs(['vehicle_chase_has_no_driver']);
  const profileState = {...record(state), context, selected_roles: selected.map(entry => ({actor: entry.actor.name, role: entry.role})),
    vehicle_profiles: Object.fromEntries(profiles.map((profile, index) => [`profile_${index}`, profile]))} as Json;
  const choices = await decide('chase-vehicles', profileState, drivers.map(entry => ({key: `vehicle_${entry.index}`, type: 'choice', target: `${entry.actor.name}'s vehicle profile`,
    instructions: 'Choose one published vehicle profile compatible with the vehicle this participant is currently driving. '
      + 'Use observed/source facts, never which profile would make the chase easier. When no exact type is established, choose a reasonable compatible class. Use unknown if none is supported.',
    criteria: {...Object.fromEntries(profiles.map((profile, index) => [`profile_${index}`, {what: profile.label ?? profile.key}])), unknown: 'No supplied profile fits the established vehicle.'}})));
  const roster: Row[] = selected.map(entry => ({actor: entry.actor.name, role: entry.role}));
  const compatible: Array<{entry: typeof drivers[number]; profile: Row}> = [];
  const profileOptions = profiles.map((_, index) => `profile_${index}`);
  for (const entry of drivers) {
    const key = `vehicle_${entry.index}`, answer = bestIssuedChoice(choices, key, profileOptions, gates.choice);
    if (!answer) {
      const row = choices.answers[key];
      return noRoll('chase_vehicle_profile_unbound', `${entry.actor.name}: vehicle profile ${row?.status === 'answered' ? 'has no positive issued value' : 'unanswered'}`,
        choices.status === 'complete' && row?.status === 'answered' ? 'nothing_executable' : 'jev_unanswered');
    }
    if (answer.value === 'unknown') {
      if (answer.forced) noteForced(answer.uncertain ?? `${entry.actor.name}: no supported vehicle profile`, answer.why ?? 'nothing_executable');
      return finish({status: 'unresolved', option, needs: ['chase_vehicle_profile_unbound']});
    }
    const profile = profiles.find((_, index) => answer.value === `profile_${index}`);
    if (!profile) return noRoll('chase_vehicle_profile_unbound', `${entry.actor.name}: no compatible issued vehicle profile`, 'nothing_executable');
    if (answer.forced) noteForced(`${entry.actor.name}: ${answer.uncertain ?? `vehicle profile ${answer.value} ${scoreText(answer.p)}`}`,
      answer.why ?? 'below_confidence_gate');
    compatible.push({entry, profile});
  }
  // A permissible class is not necessarily the sole permissible class. Validate the selected candidate directly.
  const validity = await decide('chase-vehicle-validity', {...record(profileState), selected_profiles: compatible.map(value => ({actor: value.entry.actor.name, profile: value.profile}))} as Json,
    compatible.map(value => ({key: `valid_${value.entry.index}`, type: 'noul', target: `${value.entry.actor.name}'s selected profile`,
      instructions: 'Is this selected published vehicle profile a permissible match for the vehicle this participant actually uses? '
        + 'Judge compatibility, not whether it is the only possible match. Reject contradictions to established source specifications, unsupported advantages, or a different vehicle. Unknown details alone do not make an ordinary compatible class invalid.',
      criteria: {true: 'This class is a supported compatible ruling.', false: 'This class is unsupported or conflicts with the established vehicle.'}})));
  for (const value of compatible) {
    const p = yes(validity, `valid_${value.entry.index}`);
    if (p === undefined) return noRoll('chase_vehicle_profile_uncertain', `${value.entry.actor.name}: vehicle profile validity unanswered`, 'jev_unanswered');
    if (p < gates.adjudication && p > gates.noNeed) {
      noteForced(`${value.entry.actor.name}: vehicle profile compatibility ${scoreText(p)}`, 'below_confidence_gate');
      if (!leansYes(p)) return finish({status: 'unresolved', option, needs: ['chase_vehicle_profile_uncertain']});
    } else if (p <= gates.noNeed) return finish({status: 'unresolved', option, needs: ['chase_vehicle_profile_uncertain']});
    roster.find(entry => entry.actor === value.entry.actor.name)!.vehicle = value.profile.key;
  }
  const passengers = selected.filter(entry => entry.role === 'passenger');
  if (passengers.length) {
    const links = await decide('chase-passengers', {...record(profileState), drivers: drivers.map(entry => entry.actor.name)} as Json,
      passengers.map(entry => ({key: `riding_${entry.index}`, type: 'choice', target: `${entry.actor.name}'s driver`,
        instructions: 'Which of these registered drivers operates the vehicle this passenger actually rides in? Use established position/source facts; do not invent a relationship.',
        criteria: {...Object.fromEntries(drivers.map((driver, index) => [`driver_${index}`, driver.actor.name])), unknown: 'The supplied facts do not establish the driver.'}})));
    for (const passenger of passengers) {
      const answer = pick(links, `riding_${passenger.index}`), driver = answer && drivers.find((_, index) => answer.value === `driver_${index}`);
      if (!answer || answer.p < gates.choice || !driver) return needs(['chase_passenger_driver_unbound']);
      roster.find(entry => entry.actor === passenger.actor.name)!.riding_with = driver.actor.name;
    }
  }
  const action = {...option.action, chase_roster: roster as Json};
  const requirements: ProfileRequirement[] = selected.flatMap(entry => {
    const capability = record(record(entry.actor.readiness)[entry.role]);
    // Older issued catalogs remain readable; current catalogs always issue role-specific capabilities.
    const ready = entry.actor.readiness ? roleReady(entry.actor, entry.role) : entry.actor.profile_available === true;
    return ready ? [] : [{actor: String(entry.actor.name), role: entry.role as ProfileRequirement['role'],
      missing: Array.isArray(capability.missing) ? capability.missing : ['profile'],
      completion: capability.completion === 'creature' ? 'creature' as const : 'archetype' as const}];
  });
  if (requirements.length || missingDrivers.length) {
    const values = [...(requirements.length ? ['chase_actor_profile_unavailable'] : []),
      ...(missingDrivers.length ? ['chase_driver_skill_unavailable'] : [])];
    return finish({status: 'unresolved', option, needs: values, preparation: {decision: 'chase:start', mobility: 'vehicle',
      needs: [...profilePreparationNeeds(requirements), ...missingDrivers.map(name => `Prepare ${name}'s actual Drive Auto skill through the existing source/profile preparation tools.`)],
      profiles: requirements.map(entry => entry.actor), drivers: missingDrivers, requirements, action}});
  }
  return finish({status: 'selected', action, option, needs: []});
}
