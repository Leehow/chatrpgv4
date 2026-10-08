/** Exact cached source-answer pages (§193.2); no source read or semantic decision occurs here. */
type Row = Record<string, any>;
export const SOURCE_ANSWER_PAGE_BYTES = 4 * 1024;
const UNIT_BYTES = 512;
const PAYLOAD = ['excerpts', 'answer', 'answers', 'value'] as const;
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const size = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');
const copy = <T>(value: T): T => structuredClone(value);
const pointer = (key: string): string => key.replaceAll('~', '~0').replaceAll('/', '~1');

/** The host request wins; a different source-authored question remains available separately. */
export function withSourceQuestion(question: string, answer: Row): Row {
  return {...copy(answer), ...(typeof answer.question === 'string' && answer.question !== question ? {source_question: answer.question} : {}), question};
}

export function readableSourceAnswer(answer: Row | undefined): answer is Row {
  if (!answer) return false;
  if (typeof answer.answer === 'string' && answer.answer.trim()) return true;
  if (Array.isArray(answer.excerpts) && answer.excerpts.some(value => typeof value?.text === 'string' && value.text.length)) return true;
  if (Object.hasOwn(answer, 'value') && (answer.value === null || ['string', 'boolean', 'number'].includes(typeof answer.value))) return true;
  return Array.isArray(answer.answers) && answer.answers.some(value => readableSourceAnswer(object(value)));
}

interface Unit {path: string; value: unknown; context?: Row; range?: {field?: string; unit: 'utf16'; start: number; end: number; total: number}}
function unitsOf(answer: Row): Unit[] {
  const units: Unit[] = [];
  const appendText = (value: string, path: string, context?: Row, record?: Row) => {
    let chunk = '', start = 0, encoded = 2;
    const put = () => {
      units.push({path, value: record ? {...record, text: chunk} : chunk, ...(context && Object.keys(context).length ? {context} : {}),
        range: {...(record ? {field: 'text'} : {}), unit: 'utf16', start, end: start + chunk.length, total: value.length}});
      start += chunk.length; chunk = ''; encoded = 2;
    };
    for (const point of value) {
      const cost = Buffer.byteLength(JSON.stringify(point).slice(1, -1), 'utf8');
      if (chunk && encoded + cost > UNIT_BYTES) put();
      chunk += point; encoded += cost;
    }
    if (chunk || !value.length) put();
  };
  const visit = (value: unknown, path: string, context?: Row) => {
    if (typeof value === 'string') { appendText(value, path, context); return; }
    if (Array.isArray(value)) { value.forEach((entry, index) => visit(entry, `${path}/${index}`, context)); return; }
    const row = object(value);
    if (typeof row.text === 'string') {
      const {text: _text, ...record} = row; appendText(row.text, path, context, record); return;
    }
    const payload = PAYLOAD.filter(key => Object.hasOwn(row, key));
    if (payload.length) {
      const metadata = Object.fromEntries(Object.entries(row).filter(([key]) => !PAYLOAD.includes(key as typeof PAYLOAD[number])));
      const nextContext = {...context, ...metadata};
      for (const key of payload) visit(row[key], `${path}/${pointer(key)}`, nextContext);
      return;
    }
    units.push({path, value: copy(value), ...(context && Object.keys(context).length ? {context} : {})});
  };
  for (const key of PAYLOAD) if (Object.hasOwn(answer, key)) visit(answer[key], `/${key}`);
  return units;
}

export interface SourceAnswerPageInput {focus: string; question: string; part?: number; canContinue?: boolean}
export type SourceAnswerPage = {view: Row; truncated?: true; omitted_fields?: string[]}
  | {unavailable: 'metadata_budget' | 'invalid_part'};

/** Fixed 4-KiB layout; a total-carriage budget may omit a page, but never changes its ordinal. */
export function sourceAnswerPage(answer: Row, input: SourceAnswerPageInput): SourceAnswerPage {
  const part = input.part ?? 0;
  if (!Number.isSafeInteger(part) || part < 0) return {unavailable: 'invalid_part'};
  const bound = withSourceQuestion(input.question, answer);
  const whole = {...bound, delivery: {complete: true, part: 0, total_parts: 1}};
  if (size(whole) <= SOURCE_ANSWER_PAGE_BYTES) return part === 0 ? {view: whole} : {unavailable: 'invalid_part'};
  const metadata = Object.fromEntries(Object.entries(bound).filter(([key]) => !PAYLOAD.includes(key as typeof PAYLOAD[number])));
  const units = unitsOf(bound), pages: number[][] = [];
  const omitted = PAYLOAD.filter(key => Object.hasOwn(bound, key));
  const omitted_fields = omitted.map(key => `${key}:original units are supplied in retained_parts`);
  const render = (indices: number[], page: number, count: number, layout = false): Row => ({...metadata, status: 'partial', source_status: bound.status ?? null,
    retained_parts: indices.map(index => ({unit: index, ...units[index]})),
    delivery: {complete: false, part: page, total_parts: count, delivered_units: indices,
      omitted_units: units.length - indices.length, total_units: units.length,
      ...(!layout && input.canContinue === true ? {} : {cache_unavailable: true})},
    ...((layout || input.canContinue === true) && page + 1 < count ? {read_next: {kind: 'source', source_mode: 'answer', query: input.focus,
      question: input.question, answer_part: page + 1}} : {})});
  // Always reserve next and cache-unavailable fields while packing, independent of actual cache availability.
  // The conservative count keeps layout stable when the final page count has fewer digits.
  const reserve = Math.max(1, units.length);
  let current: number[] = [];
  for (let index = 0; index < units.length; index++) {
    if (size(render([...current, index], pages.length, reserve, true)) <= SOURCE_ANSWER_PAGE_BYTES) { current.push(index); continue; }
    if (current.length) { pages.push(current); current = []; }
    if (size(render([index], pages.length, reserve, true)) > SOURCE_ANSWER_PAGE_BYTES) return {unavailable: 'metadata_budget'};
    current.push(index);
  }
  if (current.length) pages.push(current);
  if (!pages.length) return {unavailable: 'metadata_budget'};
  if (part >= pages.length) return {unavailable: 'invalid_part'};
  const view = render(pages[part], part, pages.length);
  return {view, truncated: true, omitted_fields};
}
