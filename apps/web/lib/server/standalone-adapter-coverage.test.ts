// @vitest-environment node

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTE_MANIFEST } from './api-route-manifest'

type Adapter =
  | 'projects-service'
  | 'documents-service'
  | 'mutations-service'
  | 'experiment-mutation-adapter'
  | 'readme-adapter'
  | 'warning-mutation-adapter'
  | 'git-service'
  | 'stream-service'
  | 'share-service'
  | 'slurm-service'
  | 'terminal-service'
  | 'runtime-sse-presentation'
  | 'runtime-project-presentation'
  | 'runtime-result-metadata-presentation'

interface RouteCoverage {
  family: string
  adapters: readonly Adapter[]
}

/**
 * Standalone composition is deliberately explicit per Backend/composed route.
 * A new route cannot inherit a broad prefix rule: it must identify the shared
 * Backend service (or the narrow Runtime presentation adapter) that owns it.
 */
const STANDALONE_ROUTE_ADAPTER_COVERAGE = {
  'anomalies/route.ts': { family: 'project discovery', adapters: ['projects-service'] },
  'code-preview/route.ts': { family: 'Git', adapters: ['git-service'] },
  'code-reviews/[...id]/route.ts': {
    family: 'documents',
    adapters: ['documents-service'],
  },
  'code-reviews/route.ts': { family: 'documents', adapters: ['documents-service'] },
  'digests/[id]/route.ts': { family: 'documents', adapters: ['documents-service'] },
  'digests/route.ts': { family: 'documents', adapters: ['documents-service'] },
  'events/route.ts': { family: 'events', adapters: ['runtime-sse-presentation'] },
  'experiments/[id]/archive/route.ts': {
    family: 'experiment mutations',
    adapters: ['mutations-service'],
  },
  'experiments/[id]/link/route.ts': {
    family: 'experiment mutations',
    adapters: ['experiment-mutation-adapter'],
  },
  'experiments/[id]/readme/route.ts': {
    family: 'README documents',
    adapters: ['readme-adapter'],
  },
  'experiments/[id]/results/route.ts': {
    family: 'project discovery',
    adapters: ['projects-service'],
  },
  'experiments/[id]/route.ts': {
    family: 'project discovery and experiment mutations',
    adapters: [
      'projects-service',
      'experiment-mutation-adapter',
      'runtime-result-metadata-presentation',
    ],
  },
  'experiments/[id]/status/route.ts': {
    family: 'experiment mutations',
    adapters: ['mutations-service'],
  },
  'experiments/[id]/unlink/route.ts': {
    family: 'experiment mutations',
    adapters: ['experiment-mutation-adapter'],
  },
  'experiments/[id]/warnings/[rowId]/route.ts': {
    family: 'warnings',
    adapters: ['warning-mutation-adapter'],
  },
  'experiments/[id]/warnings/route.ts': {
    family: 'warnings',
    adapters: ['warning-mutation-adapter'],
  },
  'experiments/route.ts': {
    family: 'project discovery and experiment mutations',
    adapters: ['projects-service', 'experiment-mutation-adapter'],
  },
  'hypotheses/route.ts': { family: 'project discovery', adapters: ['projects-service'] },
  'journal/append/route.ts': { family: 'journal mutations', adapters: ['mutations-service'] },
  'journal/route.ts': { family: 'project discovery', adapters: ['projects-service'] },
  'log-files/route.ts': { family: 'streaming', adapters: ['stream-service'] },
  'log/route.ts': { family: 'streaming', adapters: ['stream-service'] },
  'log/stream/route.ts': { family: 'streaming', adapters: ['stream-service'] },
  'projects/[project]/commit-marks/[sha]/route.ts': {
    family: 'Git',
    adapters: ['git-service'],
  },
  'projects/[project]/commit-marks/route.ts': {
    family: 'Git',
    adapters: ['git-service'],
  },
  'projects/[project]/git-branches/route.ts': {
    family: 'Git',
    adapters: ['git-service'],
  },
  'projects/[project]/git-commit/route.ts': {
    family: 'Git',
    adapters: ['git-service'],
  },
  'projects/[project]/git-diff/route.ts': {
    family: 'Git',
    adapters: ['git-service'],
  },
  'projects/[project]/git-log/route.ts': { family: 'Git', adapters: ['git-service'] },
  'projects/[project]/git-range/route.ts': { family: 'Git', adapters: ['git-service'] },
  'projects/[project]/git-status/files/route.ts': {
    family: 'Git',
    adapters: ['git-service'],
  },
  'projects/[project]/git-status/route.ts': {
    family: 'Git',
    adapters: ['git-service'],
  },
  'projects/[project]/shares/[id]/route.ts': {
    family: 'shares',
    adapters: ['share-service'],
  },
  'projects/[project]/shares/route.ts': {
    family: 'shares',
    adapters: ['share-service'],
  },
  'projects/[project]/submodules/route.ts': { family: 'Git', adapters: ['git-service'] },
  'projects/route.ts': {
    family: 'configured Project presentation',
    adapters: ['runtime-project-presentation'],
  },
  'readme/route.ts': {
    family: 'README documents',
    adapters: ['documents-service', 'mutations-service'],
  },
  'report-assets/[project]/[id]/[...path]/route.ts': {
    family: 'streaming',
    adapters: ['stream-service'],
  },
  'reports/[id]/route.ts': { family: 'documents', adapters: ['documents-service'] },
  'reports/route.ts': { family: 'documents', adapters: ['documents-service'] },
  'runs/[id]/archive/route.ts': {
    family: 'run mutations',
    adapters: ['mutations-service'],
  },
  'runs/[id]/files/route.ts': { family: 'project discovery', adapters: ['projects-service'] },
  'runs/[id]/readme/route.ts': {
    family: 'README documents',
    adapters: ['readme-adapter'],
  },
  'runs/[id]/route.ts': { family: 'project discovery', adapters: ['projects-service'] },
  'runs/[id]/status/route.ts': {
    family: 'run mutations',
    adapters: ['mutations-service'],
  },
  'runs/[id]/warnings/[rowId]/route.ts': {
    family: 'warnings',
    adapters: ['warning-mutation-adapter'],
  },
  'runs/[id]/warnings/route.ts': {
    family: 'warnings',
    adapters: ['warning-mutation-adapter'],
  },
  'runs/route.ts': { family: 'project discovery', adapters: ['projects-service'] },
  'slurm/status/route.ts': { family: 'Slurm', adapters: ['slurm-service'] },
  'terminal/attach/route.ts': { family: 'terminal', adapters: ['terminal-service'] },
  'terminal/check/route.ts': { family: 'terminal', adapters: ['terminal-service'] },
  'terminal/herdr/route.ts': { family: 'Herdr', adapters: ['terminal-service'] },
  'terminal/install/route.ts': { family: 'terminal', adapters: ['terminal-service'] },
  'terminal/list/route.ts': { family: 'terminal', adapters: ['terminal-service'] },
  'terminal/start/route.ts': { family: 'terminal', adapters: ['terminal-service'] },
  'terminal/stop/route.ts': { family: 'terminal', adapters: ['terminal-service'] },
  'tmux-sessions/[name]/rename/route.ts': {
    family: 'tmux',
    adapters: ['terminal-service'],
  },
  'tmux-sessions/[name]/route.ts': { family: 'tmux', adapters: ['terminal-service'] },
  'tmux-sessions/route.ts': { family: 'tmux', adapters: ['terminal-service'] },
} as const satisfies Record<string, RouteCoverage>

const API_ROOT = join(__dirname, '..', '..', 'app', 'api')

function source(route: string): string {
  return readFileSync(join(API_ROOT, route), 'utf8')
}

const ADAPTER_EVIDENCE: Record<Adapter, readonly RegExp[]> = {
  'projects-service': [/standaloneServices\s*\(/, /\.projects\b/],
  'documents-service': [/standaloneServices\s*\(/, /\.documents\b/],
  'mutations-service': [/standaloneServices\s*\(/, /\.mutations\b/],
  'experiment-mutation-adapter': [/standalone-experiment-mutation-route/],
  'readme-adapter': [/standalone-readme-route/],
  'warning-mutation-adapter': [/standalone-warning-route/],
  'git-service': [/standaloneGitContext\s*\(/],
  'stream-service': [/standaloneServices\s*\(/, /\.streaming\b/],
  'share-service': [/standaloneServices\s*\(/, /\.shares\b/],
  'slurm-service': [/standaloneServices\s*\(/, /\.slurm\b/],
  'terminal-service': [/standaloneTerminal\s*\(/],
  'runtime-sse-presentation': [/createEventsReadableStream/, /runtime|\brt\.events/],
  'runtime-project-presentation': [/getRuntime\s*\(/, /config\.projects/],
  'runtime-result-metadata-presentation': [/managedResultsUpdatedAt/, /\bstat\s*\(/],
}

const DIRECT_IMPLEMENTATION_IMPORT =
  /from\s+['"][^'"]*(?:\/lib\/(?:experiments|warnings)(?:['"]|\/)|\/lib\/(?:terminal|git)\/)/
const DIRECT_MUTATION_SYMBOL =
  /\b(?:appendJournalEvent|createExperiment|deleteExperiment|linkRun|unlinkRun|writeExperimentReadme|writeRunReadme|addWarning|patchWarning|deleteWarning|addShare|listShares|revokeShare|validateShare)\b/

describe('standalone shared-service route coverage', () => {
  it('maps every Backend/composed manifest route exactly once', () => {
    const clusterRoutes = Object.entries(API_ROUTE_MANIFEST)
      .filter(([, entry]) => entry.owner === 'backend' || entry.owner === 'composed')
      .map(([route]) => route)
      .sort()
    expect(Object.keys(STANDALONE_ROUTE_ADAPTER_COVERAGE).sort()).toEqual(clusterRoutes)
  })

  it('requires concrete source evidence for every registered adapter', () => {
    for (const [route, coverage] of Object.entries(STANDALONE_ROUTE_ADAPTER_COVERAGE)) {
      const routeSource = source(route)
      for (const adapter of coverage.adapters) {
        for (const evidence of ADAPTER_EVIDENCE[adapter]) {
          expect(routeSource, `${route}: ${adapter} lacks ${evidence}`).toMatch(evidence)
        }
      }
    }
  })

  it('allows no unregistered filesystem, process, or legacy cluster implementation', () => {
    for (const [route, coverage] of Object.entries(STANDALONE_ROUTE_ADAPTER_COVERAGE)) {
      const routeSource = source(route)
      const allowsReadOnlyStat = coverage.adapters.some(
        (adapter) => adapter === 'runtime-result-metadata-presentation',
      )
      if (allowsReadOnlyStat) {
        expect(routeSource, route).toMatch(
          /import\s+\{\s*stat\s*\}\s+from\s+['"]node:fs\/promises['"]/,
        )
        expect(routeSource.match(/\bstat\s*\(/g), route).toHaveLength(1)
      } else {
        expect(routeSource, route).not.toMatch(/from\s+['"]node:fs(?:\/promises)?['"]/)
      }
      expect(routeSource, route).not.toMatch(/from\s+['"]node:child_process['"]/)
      expect(routeSource, route).not.toMatch(DIRECT_IMPLEMENTATION_IMPORT)
      const imports = [...routeSource.matchAll(/import[\s\S]*?from\s+['"][^'"]+['"]/g)]
        .map((match) => match[0])
        .join('\n')
      expect(imports, route).not.toMatch(DIRECT_MUTATION_SYMBOL)
      expect(routeSource, route).not.toMatch(/\b(?:LineIndex|createReadStream|execFile|spawn)\b/)
    }
  })

  it('keeps compatibility refresh adapters read-only after shared mutations commit', () => {
    const refresh = readFileSync(join(__dirname, 'standalone-mutation-refresh.ts'), 'utf8')
    expect(refresh).toContain('Runtime refresh is best-effort')
    expect(refresh).not.toMatch(
      /\bfs\.(?:appendFile|chmod|chown|copyFile|link|mkdir|open|rename|rm|rmdir|symlink|truncate|unlink|writeFile)\s*\(/,
    )

    for (const adapter of [
      'standalone-experiment-mutation-route.ts',
      'standalone-readme-route.ts',
      'standalone-warning-route.ts',
    ]) {
      const adapterSource = readFileSync(join(__dirname, adapter), 'utf8')
      expect(adapterSource, adapter).toMatch(/standaloneServices\s*\(/)
      expect(adapterSource, adapter).toMatch(/\.mutations\b/)
      expect(adapterSource, adapter).not.toMatch(/from\s+['"]node:(?:fs|child_process)/)
      expect(adapterSource, adapter).not.toMatch(DIRECT_IMPLEMENTATION_IMPORT)
    }
  })
})
