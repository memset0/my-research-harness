import { describe, expect, it } from 'vitest'
import { classify, isAuthBypass } from './route-classes'

describe('classify', () => {
  it('classifies all /api/terminal/* as shell, regardless of method', () => {
    expect(classify('GET', '/api/terminal/check')).toBe('shell')
    expect(classify('POST', '/api/terminal/start')).toBe('shell')
    expect(classify('POST', '/api/terminal/stop')).toBe('shell')
    expect(classify('POST', '/api/terminal/install')).toBe('shell')
    expect(classify('GET', '/api/terminal/list')).toBe('shell')
    expect(classify('GET', '/api/terminal/proxy/sess/')).toBe('shell')
    // Hypothetical future terminal sub-route.
    expect(classify('PUT', '/api/terminal/anything')).toBe('shell')
  })

  it('classifies known GET /api/* read endpoints as read', () => {
    expect(classify('GET', '/api/projects')).toBe('read')
    expect(classify('GET', '/api/experiments')).toBe('read')
    expect(classify('GET', '/api/experiments/foo-260501-100000')).toBe('read')
    expect(classify('GET', '/api/log/foo')).toBe('read')
    expect(classify('GET', '/api/log/stream/foo')).toBe('read')
    expect(classify('GET', '/api/events')).toBe('read')
    expect(classify('GET', '/api/runtime/health')).toBe('read')
  })

  it('classifies page routes as read', () => {
    expect(classify('GET', '/')).toBe('read')
    expect(classify('GET', '/p/project-a')).toBe('read')
    expect(classify('GET', '/e/foo-260501-100000')).toBe('read')
    expect(classify('GET', '/login')).toBe('read')
  })

  it('classifies non-GET on read paths as mutating (default fail-closed)', () => {
    expect(classify('PUT', '/api/experiments/foo/readme')).toBe('mutating')
    expect(classify('POST', '/api/experiments/foo/journal')).toBe('mutating')
    expect(classify('PATCH', '/api/projects')).toBe('mutating')
    expect(classify('DELETE', '/api/runtime/cache')).toBe('mutating')
  })

  it('defaults unknown /api/* paths to mutating (fail-closed)', () => {
    expect(classify('GET', '/api/some-future-endpoint')).toBe('mutating')
    expect(classify('POST', '/api/another')).toBe('mutating')
  })

  it('defaults unknown page paths to mutating (forces explicit listing)', () => {
    expect(classify('GET', '/internal-tool')).toBe('mutating')
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
})
