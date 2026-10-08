/** A library browse is fresh; its demand can start one original-book reading. */
type Row = Record<string, any>;
export async function browseInvestigators(call: (method: string, params: Row) => Promise<any>, params: Row,
  moduleId: string | undefined, reading: {pregens?(moduleId: string, params: Row, signal?: AbortSignal): Promise<Row>} | undefined,
  signal?: AbortSignal): Promise<Row> {
  const first = await call('investigator.list', params);
  if (first.pregens_read !== 'unread' || !moduleId) return first;
  if (!reading?.pregens) throw new Error('the pregenerated-investigator reading service is unavailable');
  try { await reading.pregens(moduleId, {campaign: params.campaign}, signal); }
  catch (error) { if ((error as {code?: string}).code !== 'reading_timeout') throw error; }
  return call('investigator.list', params);
}
