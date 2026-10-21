import { describe, expect, it } from 'vitest'
import { BACKEND_API_PREFIX } from './http/paths.js'
import { compileRouteTable, preflight, routeMethods } from './http/route.js'
import { BACKEND_ROUTES } from './routes/index.js'
import { BACKEND_ROUTE_ALLOW_LIST } from './server.js'

const table = compileRouteTable(BACKEND_ROUTES)
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const

function placeholders(key: string): string[] {
  return [...key.matchAll(/\[(?:\.\.\.)?([A-Za-z]+)\]/g)].map((match) => match[1]!)
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
