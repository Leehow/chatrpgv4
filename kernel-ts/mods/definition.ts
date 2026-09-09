/** Pure immutable definition checks shared by host feedback and later acceptance. */
import { RpcError } from '../errors.js';
import { isJsonObject, PythonFloat } from '../json.js';
import { array, clone, integer, length, number, row, string, truth, type Row } from '../read/values.js';

const WEAPON_FIELDS = new Set(['skill', 'damage', 'base_range_yards', 'uses_per_round', 'magazine', 'malfunction', 'impale', 'adds_damage_bonus', 'initial_ammo', 'reload_rounds']);
const SPELL_FIELDS = new Set(['cost_mp', 'cost_sanity', 'cost_pow', 'casting_time', 'effects']);
const ITEM_FIELDS = new Set(['charges', 'effects']);
const invalid = (message: string): never => { throw new RpcError('invalid_params', message); };
const exactly = (value: Row, keys: string[]): boolean => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const scalarType = (value: any): string => value instanceof PythonFloat ? 'float' : typeof value === 'bigint' ? 'int'
  : typeof value === 'number' ? Number.isInteger(value) && !Object.is(value, -0) ? 'int' : 'float' : typeof value;
const numeric = (value: any): boolean => ['int', 'float'].includes(scalarType(value));
const nonempty = (value: any): value is string => typeof value === 'string' && Boolean(value.trim());
function hashable(value: any, collection: 'dict key' | 'set element' = 'dict key'): void {
  if (Array.isArray(value) || isJsonObject(value)) { const type = Array.isArray(value) ? 'list' : 'dict'; const error = new Error(`cannot use '${type}' as a ${collection} (unhashable type: '${type}')`); error.name = 'TypeError'; throw error; }
}
function member(values: readonly string[], value: any): boolean { hashable(value, 'set element'); return values.includes(value); }

export function validateDocumentSeed(value: any): Row {
  const message = 'Document needs bounded plain text and presentation paper, notebook or book';
  if (!isJsonObject(value) || !member(['paper', 'notebook', 'book'], value.presentation)) return invalid(message);
  const text = exactly(value, ['text', 'presentation']) && typeof value.text === 'string' && length(value.text) <= 64000;
  const handout = exactly(value, ['handout', 'presentation']) && typeof value.handout === 'string' && length(value.handout) > 0 && length(value.handout) <= 160;
  if (!text && !handout) return invalid(message);
  return clone(value);
}

export function definitionExpression(value: any, field: string): string {
  if (integer(value) && number(value) >= 0 && number(value) <= 10000) return string(value);
  if (typeof value !== 'string' || length(value) > 80 || !/^(?:[0-9]+D[0-9]+|[0-9]+)(?:[+-](?:[0-9]+D[0-9]+|[0-9]+))*$/i.test(value))
    return invalid(`${field} must be a nonnegative number or bounded dice expression`);
  for (const term of value.toUpperCase().split(/[+-]/)) {
    const parts = term.split('D').map(Number);
    if (parts.some(value => value > 10000) || parts.length === 2 && (parts[0] > 100 || parts[1] < 1)) return invalid(`${field} exceeds the dice budget`);
  }
  if (field !== 'damage') {
    let minimum = 0;
    for (const match of value.toUpperCase().matchAll(/([+-]?)([0-9]+D[0-9]+|[0-9]+)/g)) {
      const parts = match[2].split('D').map(Number), low = parts[0], high = parts.length === 2 ? parts[0] * parts[1] : low;
      minimum += match[1] === '-' ? -high : low;
    }
    if (minimum < 0) return invalid(`${field} can produce a negative cost or effect amount`);
  }
  return value.toUpperCase();
}

export function validateDefinition(raw: any, options: {name?: string | null; category?: string | null} = {}): Row {
  if (!isJsonObject(raw)) return invalid('Definition must be an object');
  if (truth(raw.error)) throw new RpcError('needs', string(truth(raw.reason) ? raw.reason : 'Definition requires an unsupported capability'),
    {details: {reason: 'unsupported_capability', required: Object.hasOwn(raw, 'required') ? raw.required : []}});
  if (Object.keys(raw).some(key => !['name', 'category', 'description', 'basis', 'parameters', 'traits', 'player_view', 'document'].includes(key))) return invalid('Unknown definition field');
  for (const key of ['name', 'description', 'basis']) if (!nonempty(raw[key]) || length(raw[key]) > 8000) return invalid(`Definition needs a bounded ${key}`);
  if (length(raw.name as string) > 120) return invalid('Definition names are limited to 120 characters');
  if (options.name != null && raw.name !== options.name || options.category != null && raw.category !== options.category) return invalid('Definition identity differs from its request');
  const kind = raw.category;
  hashable(kind);
  const fields = kind === 'weapon' ? WEAPON_FIELDS : kind === 'spell' ? SPELL_FIELDS : kind === 'item' ? ITEM_FIELDS : null;
  if (!fields || !isJsonObject(raw.parameters) || Object.keys(raw.parameters).some(key => !fields.has(key))) return invalid('Unsupported definition category or parameter');
  const result = clone(raw);
  if (Object.hasOwn(raw, 'document')) {
    if (kind === 'spell') return invalid('A spell is knowledge, not a writable carrier');
    result.document = validateDocumentSeed(raw.document);
  }
  const traits = Object.hasOwn(raw, 'traits') ? raw.traits : [];
  if (!Array.isArray(traits) || traits.length > 16) return invalid('Physical traits must be a list of at most sixteen facts');
  const names = new Set<string>();
  for (const trait of traits) {
    if (!isJsonObject(trait) || Object.keys(trait).some(key => !['name', 'value', 'unit', 'basis'].includes(key))
      || !nonempty(trait.name) || length(trait.name) > 80 || !['string', 'int', 'float', 'boolean'].includes(scalarType(trait.value)))
      return invalid('Each physical trait needs a name and scalar value');
    if (names.has(trait.name)) return invalid('Physical trait names must be unique');
    if (scalarType(trait.value) === 'float' && !Number.isFinite(number(trait.value))) return invalid('Physical traits must contain finite JSON numbers');
    if (['unit', 'basis'].some(key => Object.hasOwn(trait, key) && (typeof trait[key] !== 'string' || length(trait[key]) > 1024)))
      return invalid('Trait units and basis must be bounded strings');
    names.add(trait.name);
  }
  const params = row(result.parameters);
  if (kind === 'weapon') {
    if (!nonempty(params.skill)) return invalid('Weapon needs a rulebook skill');
    params.damage = definitionExpression(params.damage, 'damage');
    if (!integer(params.uses_per_round) || number(params.uses_per_round) < 1 || number(params.uses_per_round) > 100) return invalid('weapon.uses_per_round must be 1..100');
    if (params.malfunction != null && (!integer(params.malfunction) || number(params.malfunction) < 1 || number(params.malfunction) > 100)) return invalid('Weapon malfunction must be null or 1..100');
    if (params.base_range_yards != null && (!numeric(params.base_range_yards) || !(0 <= number(params.base_range_yards) && number(params.base_range_yards) <= 100000))) return invalid('Weapon range must be null or 0..100000 yards');
    const magazine = params.magazine;
    if (magazine != null && (!integer(magazine) || number(magazine) < 1 || number(magazine) > 1000)) return invalid('Weapon magazine must be null or 1..1000');
    if (Object.hasOwn(params, 'initial_ammo') && (!integer(params.initial_ammo) || magazine == null || number(params.initial_ammo) < 0 || number(params.initial_ammo) > number(magazine))) return invalid('Initial ammunition exceeds magazine capacity');
    if (typeof params.impale !== 'boolean') return invalid('Weapon impale must be boolean');
    if (Object.hasOwn(params, 'adds_damage_bonus') && typeof params.adds_damage_bonus !== 'boolean') return invalid('Weapon adds_damage_bonus must be boolean');
    if (Object.hasOwn(params, 'reload_rounds') && (!integer(params.reload_rounds) || number(params.reload_rounds) < 1 || number(params.reload_rounds) > 100)) return invalid('Reload rounds must be 1..100');
  } else {
    if (kind === 'spell') {
      for (const key of ['cost_mp', 'cost_sanity']) params[key] = definitionExpression(params[key], key);
      if (Object.hasOwn(params, 'cost_pow')) params.cost_pow = definitionExpression(params.cost_pow, 'cost_pow');
      if (!nonempty(params.casting_time)) return invalid('Spell needs a casting time');
    } else if (params.charges != null && (!integer(params.charges) || number(params.charges) < 0 || number(params.charges) > 10000)) return invalid('Charges must be null or 0..10000');
    const effects = params.effects;
    if (!Array.isArray(effects) || effects.length > 8) return invalid('Definition effects must be a list of at most eight typed effects');
    for (const effect of effects) {
      if (!isJsonObject(effect)) return invalid('Invalid definition effect');
      if (member(['hp', 'san', 'mp'], effect.kind)) {
        if (!exactly(effect, ['kind', 'amount', 'direction']) || !member(['gain', 'loss'], effect.direction)) return invalid('Resource effect needs kind, amount and direction');
        effect.amount = definitionExpression(effect.amount, 'effect.amount');
      } else if (effect.kind === 'condition') {
        if (!exactly(effect, ['kind', 'value']) || !nonempty(effect.value)) return invalid('Condition effect needs a value');
      } else return invalid('Definition references an unsupported effect executor');
    }
  }
  const publicView = raw.player_view;
  if (!isJsonObject(publicView) || Object.keys(publicView).some(key => !['description', 'fields', 'traits'].includes(key))
    || typeof publicView.description !== 'string' || !Array.isArray(publicView.fields)
    || publicView.fields.some(key => typeof key !== 'string' || !Object.hasOwn(params, key))) return invalid('player_view must declare a description and known parameter fields');
  const visibleTraits = Object.hasOwn(publicView, 'traits') ? publicView.traits : [];
  if (!Array.isArray(visibleTraits) || visibleTraits.some(name => typeof name !== 'string' || !names.has(name))) return invalid('Public traits must reference accepted physical facts');
  return result;
}
