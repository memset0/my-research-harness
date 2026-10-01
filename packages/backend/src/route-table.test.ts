import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { BACKEND_API_PREFIX } from './http/paths.js'
import { compileRouteTable, type PreflightResult, preflight, routeMethods } from './http/route.js'
import { BACKEND_ROUTES } from './routes/index.js'
import { BACKEND_ROUTE_ALLOW_LIST } from './server.js'

const table = compileRouteTable(BACKEND_ROUTES)
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const

function mulberry32(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Raw (still percent-encoded) path-segment candidates per placeholder name. */
const PARAM_SAMPLES: Record<string, readonly string[]> = {
  project: ['project-a', 'p1', 'bad%20name', '%ZZ', '..'],
  id: [
    'foo-260501-100000',
    'E0001-alpha',
    'R0001',
    'R12',
    'W0001',
    'shr_abc123',
    'shr_',
    'a%2Fb',
    '%2E%2E',
    '%ZZ',
    'code-review/2026-01-01-review',
    'code-review%2F2026-01-01-review',
    'experiments/E0001-a/code-review/2026-01-01-x',
    'code-review/bad',
  ],
  rowId: ['w_abc', 'x_abc', `w_${'a'.repeat(140)}`, 'w_a%2Fb', '%ZZ'],
  sha: ['abc123', 'next', 'ZZ', 'main', 'a..b', '0123456789abcdef0123456789abcdef01234567'],
  artifact: ['E0001-alpha', 'a%2Fb', 'a%5Cb', 'a%00b', 'x'.repeat(513)],
  path: ['a.png', 'dir/a.png', '..%2Fx', 'a//b', '%ZZ', 'a%20b.txt'],
}

const QUERY_VALUES: Record<string, readonly string[]> = {
  project: ['project-a', 'project-b', 'p1', 'bad name', ''],
  reveal: ['true', 'false', 'x'],
  force: ['true', 'false', '1'],
  inventory: ['1', '0', ''],
  deprecated: ['include', 'only', 'x', ''],
  limit: ['10', '', 'abc', '1000', '1001', '0', '1234567'],
  before: ['2026-01-01', '', 'x'.repeat(129)],
  countOnly: ['1', '0'],
  depth: ['3', '7', ''],
  resource: ['logs/a/out.log', 'README.md', 'docs/x/README.md', 'logs/README.md.txt', '../x', ''],
  endLine: ['1', '0', '', '1234567890123'],
  count: ['1', '2000', '2001', ''],
  ref: ['main', 'a..b', ''],
  sha: ['abc123', 'a..b'],
  from: ['main', 'a..b'],
  to: ['HEAD', ''],
  path: ['src/a.ts', '../x'],
  side: ['staged', 'unstaged', 'untracked', 'commit', 'range', 'bogus'],
  submodule: ['', 'sub', 'x'.repeat(513)],
  url: ['https://example.invalid/x', '', 'x'.repeat(4097)],
  extra: ['1'],
}
const ALL_KEYS = Object.keys(QUERY_VALUES)

/** Hand-picked well-formed and boundary queries tried on every path. */
const FIXED_QUERIES = [
  'project=project-a',
  'project=p1',
  'project=project-a&resource=README.md',
  'project=project-a&resource=docs/x/README.md',
  'project=project-a&resource=logs/a/out.log',
  'project=project-a&resource=logs/a/out.log&endLine=1&count=2000',
  'project=project-a&resource=logs/a/out.log&endLine=&count=',
  'project=project-a&ref=main&limit=1000&submodule=sub',
  'project=project-a&ref=main&limit=',
  'project=project-a&sha=abc123',
  'project=project-a&from=main&to=HEAD',
  'project=project-a&path=src/a.ts&side=commit&sha=abc123',
  'project=project-a&path=src/a.ts&side=range&from=main&to=HEAD',
  'project=project-a&path=src/a.ts&side=staged',
  'project=project-a&path=src/a.ts&side=staged&sha=abc123',
  'project=project-a&url=https://example.invalid/x',
  'project=project-a&limit=10&before=2026&countOnly=1',
  'project=project-a&limit=&before=',
  'project=project-a&inventory=1',
  'project=project-a&inventory=1&deprecated=include',
  'project=project-a&deprecated=only',
  'reveal=true',
  'project=p1&reveal=false',
  'project=project-a&force=true',
  'project=project-a&depth=3',
  'project=project-a&submodule=sub',
  'project=p1&submodule=sub',
  'project=project-a&project=project-a',
]

function placeholders(key: string): string[] {
  return [...key.matchAll(/\[(?:\.\.\.)?([A-Za-z]+)\]/g)].map((match) => match[1]!)
}

function samplePaths(key: string): string[] {
  const names = placeholders(key)
  let paths = [key]
  for (const name of names) {
    const next: string[] = []
    for (const path of paths) {
      for (const value of PARAM_SAMPLES[name] ?? ['x']) {
        next.push(path.replace(new RegExp(`\\[(?:\\.\\.\\.)?${name}\\]`), value))
      }
    }
    paths = next
  }
  return paths
}

function corpusPaths(): string[] {
  const out = new Set<string>([
    BACKEND_API_PREFIX,
    `${BACKEND_API_PREFIX}/`,
    `${BACKEND_API_PREFIX}/unknown`,
    `${BACKEND_API_PREFIX}/runs/x/results`,
    `${BACKEND_API_PREFIX}/experiments/x/files`,
    `${BACKEND_API_PREFIX}/runs/x/link`,
    `${BACKEND_API_PREFIX}/projects/project-a/shares/validate/x`,
    `${BACKEND_API_PREFIX}/projects/project-a`,
    `${BACKEND_API_PREFIX}/wiki/backlinks`,
    `${BACKEND_API_PREFIX}/wiki/review/abc/x`,
    `${BACKEND_API_PREFIX}/code-reviews`,
    `${BACKEND_API_PREFIX}/runs//readme`,
    `${BACKEND_API_PREFIX}/report-assets/project-a/R0001`,
  ])
  for (const route of BACKEND_ROUTES) {
    for (const [index, path] of samplePaths(route.key).entries()) {
      out.add(path)
      if (index < 3) out.add(`${path}/extra`)
    }
  }
  // Literal template paths are an intentional divergence, asserted separately.
  return [...out].filter((path) => !path.includes('[')).sort()
}

function sampleQuery(random: () => number, relevant: readonly string[]): URLSearchParams {
  const search = new URLSearchParams()
  const pool = random() < 0.65 ? relevant : ALL_KEYS
  if (random() < 0.85) {
    const values = QUERY_VALUES.project!
    search.append('project', values[Math.floor(random() * 3)]!)
  }
  const count = Math.floor(random() * 4)
  for (let index = 0; index < count && pool.length > 0; index++) {
    const key = pool[Math.floor(random() * pool.length)]!
    const values = QUERY_VALUES[key] ?? ['1']
    search.append(key, values[Math.floor(random() * values.length)]!)
  }
  if (random() < 0.05) search.append('project', 'project-a')
  return search
}

function relevantKeys(pathname: string, method: string): string[] {
  const match = table.match(pathname)
  if (!match) return ALL_KEYS
  const spec =
    typeof match.route.query === 'function' ? match.route.query(method) : match.route.query
  return Object.keys(spec.fields).sort()
}

type Outcome = Record<string, unknown>

function newOutcome(result: PreflightResult<(typeof BACKEND_ROUTES)[number]>): Outcome {
  if (result.outcome === 'not-found') return { outcome: 'not-found' }
  const base: Outcome = {
    outcome: result.outcome,
    key: result.route.key,
    params: Object.fromEntries(
      placeholders(result.route.key).map((name) => [name, result.params[name] ?? '']),
    ),
  }
  if (result.outcome === 'method-not-allowed') base.allow = [...result.allow]
  if (result.outcome === 'dispatch') base.routeClass = result.operation.routeClass
  return base
}

describe('declarative Backend route table', () => {
  it('exports the method allow-list derived from the table', () => {
    const derived = Object.fromEntries(
      BACKEND_ROUTES.map((route) => [route.key, routeMethods(route)]),
    )
    const exported = Object.fromEntries(
      Object.entries(BACKEND_ROUTE_ALLOW_LIST).map(([key, methods]) => [key, [...methods]]),
    )
    expect(exported).toEqual(derived)
    expect(Object.keys(exported)).toHaveLength(BACKEND_ROUTES.length)
    expect(new Set(BACKEND_ROUTES.map((route) => route.key)).size).toBe(BACKEND_ROUTES.length)
  })

  it('makes every routing decision the legacy tables made (pinned digest)', () => {
    const random = mulberry32(0x5eed)
    const digest = createHash('sha256')
    let compared = 0
    const outcomes = new Map<string, number>()
    for (const pathname of corpusPaths()) {
      // An unmatched path never consults method or query.
      const unrouted = table.match(pathname) === null
      for (const method of unrouted ? (['GET'] as const) : METHODS) {
        const relevant = relevantKeys(pathname, method)
        const queries = [new URLSearchParams()]
        if (!unrouted) queries.push(...FIXED_QUERIES.map((query) => new URLSearchParams(query)))
        for (let index = 0; index < (unrouted ? 0 : 8); index++)
          queries.push(sampleQuery(random, relevant))
        for (const search of queries) {
          for (const readOnly of method === 'GET' || method === 'HEAD' ? [false] : [false, true]) {
            const actual = newOutcome(preflight(table, { method, pathname, search, readOnly }))
            compared++
            const tally = `${actual.outcome}:${String(actual.key ?? '')}`
            outcomes.set(tally, (outcomes.get(tally) ?? 0) + 1)
            const line = JSON.stringify([method, pathname, search.toString(), readOnly, actual])
            digest.update(`${line}\n`)
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(100_000)
    // Every route is reached and also rejected by its query rules.
    for (const route of BACKEND_ROUTES) {
      expect(outcomes.get(`dispatch:${route.key}`) ?? 0, route.key).toBeGreaterThan(0)
    }
    expect(digest.digest('hex')).toBe(ROUTE_DECISION_DIGEST)
  })

  it('never resolves a literal template path to its route without parameters', () => {
    for (const route of BACKEND_ROUTES.filter((entry) => entry.key.includes('['))) {
      for (const method of METHODS) {
        const result = preflight(table, {
          method,
          pathname: route.key,
          search: new URLSearchParams('project=project-a'),
          readOnly: false,
        })
        if (result.outcome === 'not-found') continue
        // Otherwise the bracket text is an ordinary, validated parameter value.
        for (const name of placeholders(route.key)) {
          expect(result.params[name], route.key).toBe(`[${name}]`)
        }
      }
    }
    // The legacy table answered Instance metadata here; the template is now validated.
    expect(
      preflight(table, {
        method: 'GET',
        pathname: `${BACKEND_API_PREFIX}/projects/[project]/shares`,
        search: new URLSearchParams(),
        readOnly: false,
      }).outcome,
    ).toBe('not-found')
  })
})

/**
 * SHA-256 of every routing decision over the deterministic corpus. It was
 * recorded while the legacy allow-list, regex resolver and query validator
 * still existed and the decisions were proven identical to theirs (commit
 * "introduce the declarative route table and prove parity with the legacy
 * tables"). A table change that alters any decision changes this digest.
 * Re-pinned when `/runs` gained its `limit` / `cursor` page parameters.
 */
const ROUTE_DECISION_DIGEST = '8544990c6b97b90a2e78779b0cd807fe9d76ac4ce4051c7377ae4ee7c882462f'
