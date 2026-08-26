// @vitest-environment node

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { STANDALONE_SERVICE_MIGRATION } from './standalone-services'

const WEB = join(__dirname, '..', '..')
const routes = [
  'app/api/runs/[id]/status/route.ts',
  'app/api/runs/[id]/archive/route.ts',
  'app/api/runs/[id]/warnings/route.ts',
  'app/api/runs/[id]/warnings/[rowId]/route.ts',
  'app/api/experiments/[id]/status/route.ts',
  'app/api/experiments/[id]/archive/route.ts',
  'app/api/experiments/[id]/warnings/route.ts',
  'app/api/experiments/[id]/warnings/[rowId]/route.ts',
  'app/api/journal/append/route.ts',
  'app/api/experiments/route.ts',
  'app/api/experiments/[id]/route.ts',
  'app/api/experiments/[id]/link/route.ts',
  'app/api/experiments/[id]/unlink/route.ts',
  'app/api/experiments/[id]/results/route.ts',
  'app/api/runs/[id]/files/route.ts',
] as const

describe('standalone mutation adapter ownership', () => {
  it('routes every owned family through shared services or its legacy DTO adapter', () => {
    expect(STANDALONE_SERVICE_MIGRATION.mutations).toBe('shared')
    for (const route of routes) {
      const source = readFileSync(join(WEB, route), 'utf8')
      expect(
        source,
        route,
      ).toMatch(/standaloneServices|standaloneWarning|StandaloneExperiment/)
      expect(source, route).not.toMatch(/lib\/experiments['"]|lib\/warnings['"]/)
      expect(source, route).not.toMatch(
        /\b(?:appendJournalEvent|applyWarningOp|archiveRun|unarchiveRun)\b/,
      )
    }
  })
})
