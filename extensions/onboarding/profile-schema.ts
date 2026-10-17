import {Type} from 'typebox';

type Row = Record<string, any>;
const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()) : [];
const names = (values: string[], description: string) => values.length
  ? Type.Union(values.map(value => Type.Literal(value)), {description}) : Type.String({description});

/** Project closed rulebook values; the model still supplies every open semantic choice. */
export function projectSetupProfileConstraints(profile: Row, catalog: Row): void {
  const constraints = row(catalog.draft_constraints), policy = row(constraints.aptitude);
  const properties = profile.properties;
  properties.era = Type.Optional(names(strings(constraints.finance_periods),
    'Optional rulebook finance period. Omit to retain the default. Never pass a setting year or prose as a finance-table key.'));
  const printed = strings(catalog.weapons);
  properties.weapons = Type.Optional(Type.Array(Type.Union([Type.String({description: 'A printed weapon name, or ordinary gear kept as equipment.'}),
    Type.Object({name: Type.String({description: 'The carried item name.'}),
      profile: names(printed, 'An exact printed weapon profile from the catalog. No damage, skill or other invented stat fields.')}, {additionalProperties: false})]),
    {description: 'Use strings for ordinary knives, tools or gear. An object must contain both name and a printed profile; the kernel supplies every stat.'}));
  const characteristics = Array.isArray(catalog.characteristics) ? catalog.characteristics.map((value: unknown) => row(value).abbr).filter((value: unknown): value is string => typeof value === 'string') : [];
  const origins = strings(policy.origins);
  if (origins.length) properties.aptitude = Type.Optional(Type.Union(origins.map(origin => {
    const limit = origin === 'concept' && Number.isInteger(policy.concept_limit) && policy.concept_limit >= 0 ? {maxItems: policy.concept_limit} : {};
    const picks = () => Type.Optional(Type.Array(names(characteristics, 'A rulebook characteristic abbreviation.'), {...limit, uniqueItems: true}));
    return Type.Object({strong: picks(), weak: picks(), origin: Type.Literal(origin)}, {additionalProperties: false});
  }), {description: 'Keep player-stated aptitude separate from concept inference. Inferred lists obey the rulebook concept limit; omit if no emphasis is needed.'}));
}
