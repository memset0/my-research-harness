// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { BackendRouteError, mapCentralApiToBackend } from './backend-route'

function expectRouteError(fn: () => unknown, code: BackendRouteError['code']): void {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(BackendRouteError)
    expect((error as BackendRouteError).code).toBe(code)
    return
  }
  throw new Error(`expected BackendRouteError ${code}`)
}

describe('mapCentralApiToBackend', () => {
  it.each([
    ['GET', '/api/runs', 'runs/route.ts'],
    ['GET', '/api/runs/run-a', 'runs/[id]/route.ts'],
    ['GET', '/api/runs/run-a/readme', 'runs/[id]/readme/route.ts'],
    ['PUT', '/api/runs/run-a/readme', 'runs/[id]/readme/route.ts'],
    ['GET', '/api/experiments/E0001-exp/readme', 'experiments/[id]/readme/route.ts'],
    ['POST', '/api/experiments', 'experiments/route.ts'],
    ['DELETE', '/api/experiments/E0001-exp', 'experiments/[id]/route.ts'],
    ['POST', '/api/experiments/E0001-exp/link', 'experiments/[id]/link/route.ts'],
    ['POST', '/api/experiments/E0001-exp/unlink', 'experiments/[id]/unlink/route.ts'],
    ['GET', '/api/projects/project-a/git-status', 'projects/[project]/git-status/route.ts'],
    [
      'GET',
      '/api/report-assets/project-a/R0001/charts/loss.png',
      'report-assets/[project]/[id]/[...path]/route.ts',
    ],
    ['GET', '/api/projects', 'projects/route.ts'],
  ] as const)('maps %s %s through %s', (method, pathname, manifestRoute) => {
    expect(mapCentralApiToBackend(method, pathname)).toMatchObject({
      manifestRoute,
      backendPath: `/api/backend/v1${pathname.slice('/api'.length)}`,
    })
  })

  it.each([
    ['GET', '/api/auth/check'],
    ['POST', '/api/auth/login'],
    ['GET', '/api/runtime/health'],
    ['GET', '/api/ui-preferences'],
  ])('blocks central-owned route %s %s', (method, pathname) => {
    expectRouteError(() => mapCentralApiToBackend(method, pathname), 'CENTRAL_ONLY_ROUTE')
  })

  it('rejects a method that the registered route does not export', () => {
    expectRouteError(
      () => mapCentralApiToBackend('DELETE', '/api/projects/project-a/git-status'),
      'METHOD_NOT_ALLOWED',
    )
  })

  it.each([
    '/api/backend/v1/meta',
    '/api/install',
    '/api/daemon/restart',
    '/api/exec',
    '/not-api/runs',
  ])('rejects unregistered path %s', (pathname) => {
    const expected = pathname.startsWith('/api/') ? 'UNREGISTERED_ROUTE' : 'INVALID_PATH'
    expectRouteError(() => mapCentralApiToBackend('GET', pathname), expected)
  })

  it.each([
    '/api/runs/a%2fb',
    '/api/runs/a%5cb',
    '/api/runs/a%00b',
    '/api/runs/a\\b',
    '/api/runs/%zz',
  ])('rejects unsafe dynamic path %s', (pathname) => {
    expectRouteError(() => mapCentralApiToBackend('GET', pathname), 'INVALID_PATH')
  })

  it('does not confuse a single dynamic segment with a catch-all', () => {
    expect(mapCentralApiToBackend('GET', '/api/code-reviews/review-a')).toMatchObject({
      manifestRoute: 'code-reviews/[...id]/route.ts',
    })
    expect(mapCentralApiToBackend('GET', '/api/code-reviews/experiment/review-a')).toMatchObject({
      manifestRoute: 'code-reviews/[...id]/route.ts',
    })
  })
})
