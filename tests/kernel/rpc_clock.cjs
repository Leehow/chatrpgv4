// Developer-only preload for the candidate kernel; no production clock hook.
if (process.env.COC_TEST_CLOCK) {
  const OriginalDate = Date;
  const epoch = OriginalDate.parse(process.env.COC_TEST_CLOCK);
  if (!Number.isFinite(epoch)) throw new Error('Invalid COC_TEST_CLOCK');
  class FixedDate extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [epoch])); }
    static now() { return epoch; }
  }
  globalThis.Date = FixedDate;
}
