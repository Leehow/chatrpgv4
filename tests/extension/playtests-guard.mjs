import { abandonedRuns, finishRun, startRun } from "./playtest-scratch.mjs";

let current;
export async function globalSetup() {
  for (const path of abandonedRuns()) process.stderr.write(`test scratch: earlier unfinished run preserved at ${path}\n`);
  current = startRun();
  process.env.COC_TEST_SCRATCH_RUN = current;
}

export async function globalTeardown() {
  if (!current) return;
  try {
    const { kept, leaked } = finishRun(current);
    for (const path of kept) process.stderr.write(`test scratch: evidence preserved at ${path}\n`);
    if (leaked.length) {
      process.stderr.write(`test scratch: ${leaked.length} unfinished allocation(s) preserved:\n${leaked.map((path) => `  ${path}`).join("\n")}\n`);
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`test scratch: run verification failed; preserved ${current}: ${error.message}\n`);
    process.exitCode = 1;
  } finally { current = undefined; delete process.env.COC_TEST_SCRATCH_RUN; }
}
