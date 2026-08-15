import { describe, expect, it } from 'vitest'
import {
  classify,
  classifyAndExtract,
  isAuthBypass,
  type ProjectResolverContext,
} from './route-classes'

const stubCtx = (overrides: Partial<ProjectResolverContext> = {}): ProjectResolverContext => ({
  isKnownProject: (name: string) => ['project-a', 'project-b'].includes(name),
  resolveByRunId: () => null,
  resolveByExperimentId: () => null,
  resolveByDigestId: () => null,
  resolveByReportId: () => null,
  resolveByPath: () => null,
  ...overrides,
})

const emptySearch = () => new URLSearchParams('')
const search = (raw: string) => new URLSearchParams(raw)

describe('classify (pure class only)', () => {
  it('classifies anon routes', () => {
    expect(classify('GET', '/login')).toBe('anon')
    expect(classify('POST', '/api/auth/login')).toBe('anon')
    expect(classify('GET', '/api/auth/check')).toBe('anon')
    expect(classify('GET', '/share/project-a/abcd1234')).toBe('anon')
  })

  it('classifies all /api/terminal/* as shell, regardless of method', () => {
    expect(classify('GET', '/api/terminal/check')).toBe('shell')
    expect(classify('POST', '/api/terminal/start')).toBe('shell')
    expect(classify('POST', '/api/terminal/stop')).toBe('shell')
    expect(classify('GET', '/api/terminal/list')).toBe('shell')
    expect(classify('GET', '/api/terminal/proxy/sess/')).toBe('shell')
    expect(classify('PUT', '/api/terminal/anything')).toBe('shell')
  })

  it('classifies tmux + manage as shell', () => {
    expect(classify('GET', '/api/tmux-sessions')).toBe('shell')
    expect(classify('GET', '/api/tmux-sessions/memon-manual-foo')).toBe('shell')
    expect(classify('DELETE', '/api/tmux-sessions/foo')).toBe('shell')
    expect(classify('POST', '/api/tmux-sessions/memon-manual-foo/rename')).toBe('shell')
    expect(classify('GET', '/manage/tmux')).toBe('shell')
    expect(classify('GET', '/terminal-popup')).toBe('shell')
  })

  it('classifies known GET /api/* read endpoints as read', () => {
    expect(classify('GET', '/api/projects')).toBe('read')
    expect(classify('GET', '/api/runs')).toBe('read')
    expect(classify('GET', '/api/runs/foo-260501-100000')).toBe('read')
    expect(classify('GET', '/api/log/foo')).toBe('read')
    expect(classify('GET', '/api/events')).toBe('read')
    expect(classify('GET', '/api/runtime/health')).toBe('read')
    expect(classify('GET', '/api/slurm/status')).toBe('read')
    expect(classify('GET', '/api/code-preview')).toBe('read')
    expect(classify('GET', '/api/report-assets/project-a/R0001/chart.html')).toBe('read')
  })

  it('classifies non-GET /api/code-preview as mutating (logged-in GET only, fail-closed)', () => {
    expect(classify('POST', '/api/code-preview')).toBe('mutating')
    expect(classify('PUT', '/api/code-preview')).toBe('mutating')
  })

  it('classifies /api/projects/<project>/shares family as mutating (owner-only — even GET)', () => {
    expect(classify('GET', '/api/projects/project-a/shares')).toBe('mutating')
    expect(classify('POST', '/api/projects/project-a/shares')).toBe('mutating')
    expect(classify('DELETE', '/api/projects/project-a/shares/shr_abc')).toBe('mutating')
  })

  it('classifies UI preferences as owner-only for reads and writes', () => {
    expect(classify('GET', '/api/ui-preferences')).toBe('mutating')
    expect(classify('PUT', '/api/ui-preferences')).toBe('mutating')
  })

  it('classifies page routes as read', () => {
    expect(classify('GET', '/')).toBe('read')
    expect(classify('GET', '/p/project-a')).toBe('read')
    expect(classify('GET', '/p/project-a/e/exp-id')).toBe('read')
  })

  it('classifies /login as anon (NOT read — anon is reachable without identity)', () => {
    expect(classify('GET', '/login')).toBe('anon')
  })

  it('classifies non-GET on read paths as mutating (default fail-closed)', () => {
    expect(classify('PUT', '/api/runs/foo/readme')).toBe('mutating')
    expect(classify('POST', '/api/journal/append')).toBe('mutating')
    expect(classify('PATCH', '/api/projects')).toBe('mutating')
    expect(classify('DELETE', '/api/runs/foo')).toBe('mutating')
  })

  it('defaults unknown /api/* paths to mutating (fail-closed)', () => {
    expect(classify('GET', '/api/some-future-endpoint')).toBe('mutating')
    expect(classify('POST', '/api/another')).toBe('mutating')
  })

  it('defaults unknown page paths to mutating (forces explicit listing)', () => {
    expect(classify('GET', '/internal-tool')).toBe('mutating')
  })

  it('classifies /api/auth/logout as mutating (owner-only)', () => {
    expect(classify('POST', '/api/auth/logout')).toBe('mutating')
  })
})

describe('classifyAndExtract — project extraction', () => {
  it('extracts project from /p/<project>/...', () => {
    const r = classifyAndExtract('GET', '/p/project-a/journal', emptySearch(), stubCtx())
    expect(r).toEqual({ class: 'read', project: 'project-a' })
  })

  it('returns "global" for / (root)', () => {
    const r = classifyAndExtract('GET', '/', emptySearch(), stubCtx())
    expect(r).toEqual({ class: 'read', project: 'global' })
  })

  it('returns "multi" for /api/projects', () => {
    const r = classifyAndExtract('GET', '/api/projects', emptySearch(), stubCtx())
    expect(r).toEqual({ class: 'read', project: 'multi' })
  })

  it('extracts project from /api/anomalies?project=', () => {
    const r = classifyAndExtract('GET', '/api/anomalies', search('project=project-a'), stubCtx())
    expect(r).toEqual({ class: 'read', project: 'project-a' })
  })

  it('returns "multi" when /api/anomalies has no project query', () => {
    const r = classifyAndExtract('GET', '/api/anomalies', emptySearch(), stubCtx())
    expect(r).toEqual({ class: 'read', project: 'multi' })
  })

  it('extracts project from /api/runs?project=', () => {
    const r = classifyAndExtract('GET', '/api/runs', search('project=project-b'), stubCtx())
    expect(r).toEqual({ class: 'read', project: 'project-b' })
  })

  it('extracts project from /api/code-preview?project= (read + project-scoped)', () => {
    const r = classifyAndExtract('GET', '/api/code-preview', search('project=project-a'), stubCtx())
    expect(r).toEqual({ class: 'read', project: 'project-a' })
  })

  it('returns "multi" when /api/code-preview has no project query', () => {
    const r = classifyAndExtract('GET', '/api/code-preview', emptySearch(), stubCtx())
    expect(r).toEqual({ class: 'read', project: 'multi' })
  })

  it('resolves /api/runs/<id> via RunIndex', () => {
    const r = classifyAndExtract(
      'GET',
      '/api/runs/some-run-260501-100000',
      emptySearch(),
      stubCtx({ resolveByRunId: (id) => (id === 'some-run-260501-100000' ? 'project-a' : null) }),
    )
    expect(r).toEqual({ class: 'read', project: 'project-a' })
  })

  it('returns null for unknown run id (handler will 404 anyway)', () => {
    const r = classifyAndExtract('GET', '/api/runs/unknown-id', emptySearch(), stubCtx())
    expect(r).toEqual({ class: 'read', project: null })
  })

  it('resolves /api/experiments/<id> via experiments cache', () => {
    const r = classifyAndExtract(
      'GET',
      '/api/experiments/E0001-some-slug',
      emptySearch(),
      stubCtx({
        resolveByExperimentId: (id) => (id === 'E0001-some-slug' ? 'project-a' : null),
      }),
    )
    expect(r).toEqual({ class: 'read', project: 'project-a' })
  })

  it('resolves /api/digests/<id>', () => {
    const r = classifyAndExtract(
      'GET',
      '/api/digests/D0042',
      emptySearch(),
      stubCtx({ resolveByDigestId: () => 'project-a' }),
    )
    expect(r).toEqual({ class: 'read', project: 'project-a' })
  })

  it('resolves /api/reports/<id>', () => {
    const r = classifyAndExtract(
      'GET',
      '/api/reports/R0007',
      emptySearch(),
      stubCtx({ resolveByReportId: () => 'project-b' }),
    )
    expect(r).toEqual({ class: 'read', project: 'project-b' })
  })

  it('extracts project from directory-report asset URLs', () => {
    const r = classifyAndExtract(
      'GET',
      '/api/report-assets/project-a/R0007/charts/loss.html',
      emptySearch(),
      stubCtx(),
    )
    expect(r).toEqual({ class: 'read', project: 'project-a' })
  })

  it('extracts project from /api/log?path= via path resolver', () => {
    const r = classifyAndExtract(
      'GET',
      '/api/log',
      search('path=/abs/path/to/foo.log'),
      stubCtx({
        resolveByPath: (p) => (p === '/abs/path/to/foo.log' ? 'project-a' : null),
      }),
    )
    expect(r).toEqual({ class: 'read', project: 'project-a' })
  })

  it('extracts project from /api/readme?path=', () => {
    const r = classifyAndExtract(
      'GET',
      '/api/readme',
      search('path=/abs/path/to/run/README.md'),
      stubCtx({ resolveByPath: () => 'project-b' }),
    )
    expect(r).toEqual({ class: 'read', project: 'project-b' })
  })

  it('returns "multi" for /api/events (SSE — handler filters)', () => {
    const r = classifyAndExtract('GET', '/api/events', emptySearch(), stubCtx())
    expect(r).toEqual({ class: 'read', project: 'multi' })
  })

  it('returns "global" for /api/runtime/health', () => {
    const r = classifyAndExtract('GET', '/api/runtime/health', emptySearch(), stubCtx())
    expect(r).toEqual({ class: 'read', project: 'global' })
  })

  it('returns "global" for /api/slurm/status (owner-only host query)', () => {
    const r = classifyAndExtract('GET', '/api/slurm/status', emptySearch(), stubCtx())
    expect(r).toEqual({ class: 'read', project: 'global' })
  })

  it('share-landing extracts project from URL segment', () => {
    const r = classifyAndExtract('GET', '/share/project-a/some-token', emptySearch(), stubCtx())
    expect(r).toEqual({ class: 'anon', project: 'project-a' })
  })

  it('mutating routes return null project (extraction not relevant)', () => {
    const r = classifyAndExtract(
      'POST',
      '/api/experiments/E0001/readme',
      emptySearch(),
      stubCtx(),
    )
    // Default rule: class=mutating, project=null. Middleware won't bother
    // resolving project for mutating routes since they're owner-only.
    expect(r.class).toBe('mutating')
  })

  it('shell routes return "global" project', () => {
    const r = classifyAndExtract('POST', '/api/terminal/start', emptySearch(), stubCtx())
    expect(r).toEqual({ class: 'shell', project: 'global' })
  })
})

describe('isAuthBypass', () => {
  it('bypasses /api/auth/check for forward_auth probe', () => {
    expect(isAuthBypass('/api/auth/check')).toBe(true)
  })

  it('bypasses Next.js static + image + favicon', () => {
    expect(isAuthBypass('/_next/static/css/app/layout.css')).toBe(true)
    expect(isAuthBypass('/_next/image')).toBe(true)
    expect(isAuthBypass('/favicon.ico')).toBe(true)
  })

  it('does NOT bypass arbitrary "_next-ish" paths', () => {
    expect(isAuthBypass('/_next/server-only')).toBe(false)
    expect(isAuthBypass('/_next-other')).toBe(false)
  })

  it('does NOT bypass arbitrary api routes', () => {
    expect(isAuthBypass('/api/projects')).toBe(false)
    expect(isAuthBypass('/api/auth/something-else')).toBe(false)
  })

  it('does NOT bypass /login (the page goes through middleware, just classified as anon)', () => {
    expect(isAuthBypass('/login')).toBe(false)
  })
})
