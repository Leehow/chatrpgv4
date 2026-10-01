/** Bounded mobility/vehicle bindings. The kernel supplies every name, profile and numeric fact. */
import type {DecisionQuestion, DecisionResult, Json} from './contracts.ts';
import type {CheckOption, CheckSelection, CheckSelectionGates} from './resolve-selection.ts';

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

export async function selectChaseRoster(option: CheckOption, declaration: string, context: Json,
  gates: CheckSelectionGates, decide: (purpose: string, state: Json, questions: DecisionQuestion[]) => Promise<DecisionResult>): Promise<Partial<CheckSelection>> {
  const actors = rows(option.facts?.chase_actors), profiles = rows(option.facts?.vehicle_profiles);
  const needs = (values: string[], preparation = false, drivers: string[] = [], profiles: string[] = []): Partial<CheckSelection> => ({status: 'unresolved', needs: values, option,
    ...(preparation ? {preparation: {decision: 'chase:start', needs: values, mobility: 'vehicle', drivers, profiles}} : {})});
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
  for (const [index, actor] of actors.entries()) {
    const answer = pick(roleResult, `role_${index}`);
    if (!answer || !['foot', 'driver', 'passenger', 'absent'].includes(answer.value) || answer.p < gates.choice) return needs(['chase_mobility_uncertain']);
    if (answer.value === 'absent') {if (actor.investigator) return needs(['chase_investigator_role_unbound']); continue;}
    if (answer.value === 'passenger' && actor.investigator) return needs(['chase_investigator_driver_unbound']);
    selected.push({actor, index, role: answer.value});
  }
  const missingProfiles = selected.filter(entry => entry.actor.profile_available !== true).map(entry => entry.actor.name);
  if (missingProfiles.length) return needs(['chase_actor_profile_unavailable'], true, [], missingProfiles);
  if (selected.length < 2 || !selected.some(entry => entry.actor.investigator)) return needs(['chase_participants_unbound'], true);
  const drivers = selected.filter(entry => entry.role === 'driver');
  const missingDrivers = drivers.filter(entry => entry.actor.driving_available !== true).map(entry => entry.actor.name);
  if (missingDrivers.length) return needs(['chase_driver_skill_unavailable'], true, missingDrivers);
  if (!drivers.length) return needs(['vehicle_chase_has_no_driver']);
  const profileState = {...record(state), context, selected_roles: selected.map(entry => ({actor: entry.actor.name, role: entry.role})),
    vehicle_profiles: Object.fromEntries(profiles.map((profile, index) => [`profile_${index}`, profile]))} as Json;
  const choices = await decide('chase-vehicles', profileState, drivers.map(entry => ({key: `vehicle_${entry.index}`, type: 'choice', target: `${entry.actor.name}'s vehicle profile`,
    instructions: 'Choose one published vehicle profile compatible with the vehicle this participant is currently driving. '
      + 'Use observed/source facts, never which profile would make the chase easier. When no exact type is established, choose a reasonable compatible class. Use unknown if none is supported.',
    criteria: {...Object.fromEntries(profiles.map((profile, index) => [`profile_${index}`, {what: profile.label ?? profile.key}])), unknown: 'No supplied profile fits the established vehicle.'}})));
  const roster: Row[] = selected.map(entry => ({actor: entry.actor.name, role: entry.role}));
  const compatible: Array<{entry: typeof drivers[number]; profile: Row}> = [];
  for (const entry of drivers) {
    const answer = pick(choices, `vehicle_${entry.index}`), profile = answer && profiles.find((_, index) => answer.value === `profile_${index}`);
    if (!answer || !profile || answer.p <= 0) return needs(['chase_vehicle_profile_unbound']);
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
    if (p === undefined || p < gates.adjudication) return needs(['chase_vehicle_profile_uncertain']);
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
  return {status: 'selected', action: {...option.action, chase_roster: roster as Json}, option, needs: []};
}
