/**
 * The baseline checker's own tests.
 *
 * They live inside the suite the checker measures on purpose: if the parser breaks, the failure
 * shows up as a NEW FAILURE in `npm run test:electron`, which is the one place anyone looks.
 *
 * What is worth guarding is the part that can rot silently. A checker that quietly reported zero
 * failures — because it read the wrong field, or because a file that never loaded contributes no
 * assertion rows — would print "matches its baseline" forever while the suite fell apart.
 */
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-expect-error -- plain ESM tooling, no type declarations
import { BASELINE_PATH, compare, confirmed, failureId, failuresOf, fileOf, vitestArguments, vitestLaunch } from './suite-baseline.mjs'

const electronRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('vitest arguments come from the test script', () => {
  it('takes the exclude list verbatim and strips the shell quoting', () => {
    expect(vitestArguments("vitest run --exclude '**/dist/**' --exclude 'packs/**'"))
      .toEqual(['--exclude', '**/dist/**', '--exclude', 'packs/**'])
  })

  it('refuses a reshaped test script rather than measuring a different file set', () => {
    expect(() => vitestArguments('jest --ci')).toThrow(/not a `vitest run` command/)
  })

  it('parses the real Electron test script, so the baseline covers what npm test runs', () => {
    const script = JSON.parse(readFileSync(join(electronRoot, 'package.json'), 'utf8')).scripts.test
    expect(vitestArguments(script)).toContain('**/dist/**')
  })

  it('runs Vitest with this checker\'s Node instead of resolving another ABI through the shebang', () => {
    const launch = vitestLaunch(['--retry=2'])
    expect(launch.command).toBe(process.execPath)
    expect(launch.args[0].replaceAll('\\', '/')).toMatch(/\/node_modules\/vitest\/vitest\.mjs$/)
    expect(launch.args.slice(1)).toEqual(['--retry=2'])
  })
})

describe('failures of one report', () => {
  const report = {
    testResults: [
      {
        name: join(electronRoot, 'packages/ui/src/App.test.tsx'),
        status: 'failed',
        assertionResults: [
          { status: 'passed', ancestorTitles: ['layout'], title: 'renders' },
          { status: 'failed', ancestorTitles: ['layout'], title: 'maps the selected model' },
        ],
      },
      {
        // A file that never loaded reports no assertions at all: without the file-level row it
        // would contribute nothing, and a whole suite going dark would read as green.
        name: join(electronRoot, 'scripts/windows-package-path.test.ts'),
        status: 'failed',
        assertionResults: [],
      },
      { name: join(electronRoot, 'packages/ui/src/quiet.test.ts'), status: 'passed', assertionResults: [] },
    ],
  }

  it('names each failure by file and test path, and a dead file as its whole suite', () => {
    expect(failuresOf(report, electronRoot)).toEqual([
      'packages/ui/src/App.test.tsx > layout > maps the selected model',
      'scripts/windows-package-path.test.ts [suite failed to run]',
    ])
  })

  it('reports nothing for a green report', () => {
    expect(failuresOf({ testResults: [report.testResults[2]] }, electronRoot)).toEqual([])
  })

  it('distinguishes two tests that differ only in their suite', () => {
    expect(failureId('a.test.ts', ['outer', 'name'])).not.toBe(failureId('a.test.ts', ['other', 'name']))
  })
})

describe('comparing against the baseline', () => {
  it('calls an unrecorded failure a regression and a recorded one that passes a stale baseline', () => {
    expect(compare(['known', 'gone'], ['known', 'fresh']))
      .toEqual({ regressions: ['fresh'], fixed: ['gone'] })
  })

  it('is silent when the run matches the record exactly', () => {
    expect(compare(['a', 'b'], ['b', 'a'])).toEqual({ regressions: [], fixed: [] })
  })

  it('reports a flaky id in neither direction, whichever way it landed this run', () => {
    expect(compare([], ['coin'], ['coin'])).toEqual({ regressions: [], fixed: [] })
    expect(compare(['coin'], [], ['coin'])).toEqual({ regressions: [], fixed: [] })
  })

  it('still catches a real regression while a flaky test is exempt', () => {
    expect(compare([], ['coin', 'real'], ['coin'])).toEqual({ regressions: ['real'], fixed: [] })
  })
})

describe('naming the file a failure lives in', () => {
  it('takes everything before the test path, so a re-run can target it', () => {
    expect(fileOf('packages/ui/src/App.test.tsx > layout > maps the model')).toBe('packages/ui/src/App.test.tsx')
  })

  it('handles a file that never loaded, which has no test path at all', () => {
    expect(fileOf('scripts/windows-package-path.test.ts [suite failed to run]')).toBe('scripts/windows-package-path.test.ts')
  })
})

describe('confirming a difference before anyone is told', () => {
  it('replaces every result from the re-run files and keeps the rest of the run', () => {
    const current = ['a.test.ts > one', 'a.test.ts > two', 'b.test.ts > kept']
    const run = vi.fn(() => ['a.test.ts > two'])
    expect(confirmed(current, ['a.test.ts > one'], run))
      .toEqual(['a.test.ts > two', 'b.test.ts > kept'])
    // Only the differing file is re-run, and serially: the point is to take the load away.
    expect(run).toHaveBeenCalledWith(['a.test.ts'], true)
  })

  it('keeps a failure that survives its own serial run, so a real break still reports', () => {
    const run = vi.fn(() => ['a.test.ts > real'])
    expect(confirmed(['a.test.ts > real'], ['a.test.ts > real'], run)).toEqual(['a.test.ts > real'])
  })

  it('runs nothing when there is no difference to confirm', () => {
    const run = vi.fn(() => [])
    expect(confirmed(['a.test.ts > one'], [], run)).toEqual(['a.test.ts > one'])
    expect(run).not.toHaveBeenCalled()
  })
})

describe('the recorded baseline', () => {
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))

  it('carries the commit it was measured at and agrees with its own count', () => {
    expect(baseline.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(baseline.count).toBe(baseline.failures.length)
  })

  it('holds no duplicate and no empty entry', () => {
    expect(new Set(baseline.failures).size).toBe(baseline.failures.length)
    expect(baseline.failures.every((id: string) => id.trim().length > 0)).toBe(true)
  })

  it('keeps every exempted test out of the pinned list and makes it say why', () => {
    const pinned = new Set(baseline.failures)
    for (const row of baseline.flaky ?? []) {
      expect(pinned.has(row.id)).toBe(false)
      expect(row.why?.trim().length ?? 0).toBeGreaterThan(20)
    }
  })

  it('names a real test file for every entry, so a renamed file cannot hide in the record', () => {
    const files = new Set(baseline.failures.map((id: string) => id.split(/ (?:>|\[)/)[0].trim()))
    for (const file of files) expect(() => readFileSync(join(electronRoot, file as string))).not.toThrow()
  })
})
