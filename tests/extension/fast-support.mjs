import { resourceSuite } from './resource-settlement-support.mjs';
export { ROOT, INVESTIGATOR, DAY, WEEK } from './resource-settlement-support.mjs';
// Explicit build entry for scripts/select-tests.mjs dependency discovery.
export const fastSuite = () => resourceSuite({ entryPoint: 'kernel-ts/testing/fast.ts' });
