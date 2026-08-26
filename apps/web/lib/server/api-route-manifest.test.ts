// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTE_MANIFEST, type ApiMethod, DIRECT_RUNTIME_SURFACES } from './api-route-manifest'

const WEB_ROOT = join(__dirname, '..', '..')
const API_ROOT = join(__dirname, '..', '..', 'app', 'api')
const METHOD_RE = /^export async function (GET|HEAD|POST|PUT|PATCH|DELETE)/gm

function walkRouteFiles(directory: string): string[] {
  const routes: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) routes.push(...walkRouteFiles(path))
    if (entry.isFile() && entry.name === 'route.ts') {
      routes.push(relative(API_ROOT, path).replaceAll('\\', '/'))
    }
  }
  return routes
}

function exportedMethods(route: string): ApiMethod[] {
  const source = readFileSync(join(API_ROOT, route), 'utf8')
  return [...source.matchAll(METHOD_RE)].map((match) => match[1] as ApiMethod).sort()
}

function walkSourceFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.next' || entry.name === 'node_modules' || entry.name === 'test') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...walkSourceFiles(path))
    if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) files.push(path)
  }
  return files
}

function directRuntimeUsers(): string[] {
  return walkSourceFiles(WEB_ROOT)
    .filter((path) => !path.includes(`${join('app', 'api')}/`))
    .filter((path) => !path.endsWith('.test.ts') && !path.endsWith('.test.tsx'))
    .filter((path) => relative(WEB_ROOT, path) !== 'lib/runtime.ts')
    .filter((path) => /\bgetRuntime\s*\(/.test(readFileSync(path, 'utf8')))
    .map((path) => relative(WEB_ROOT, path).replaceAll('\\', '/'))
    .sort()
}

describe('API route ownership manifest', () => {
  it('covers every App Router API module exactly once', () => {
    expect(Object.keys(API_ROUTE_MANIFEST).sort()).toEqual(walkRouteFiles(API_ROOT).sort())
  })

  it('records the exported methods for every module', () => {
    for (const [route, entry] of Object.entries(API_ROUTE_MANIFEST)) {
      expect([...entry.methods].sort(), route).toEqual(exportedMethods(route))
    }
  })

  it('marks every Backend route with a capability', () => {
    for (const [route, entry] of Object.entries(API_ROUTE_MANIFEST)) {
      if (entry.owner === 'backend') expect(entry.capability, route).toBeTruthy()
    }
  })

  it('keeps auth, runtime health, and UI preferences central-owned', () => {
    expect(API_ROUTE_MANIFEST['auth/login/route.ts'].owner).toBe('central')
    expect(API_ROUTE_MANIFEST['runtime/health/route.ts'].owner).toBe('central')
    expect(API_ROUTE_MANIFEST['ui-preferences/route.ts'].owner).toBe('central')
  })

  it('inventories every non-API direct Runtime consumer', () => {
    expect(Object.keys(DIRECT_RUNTIME_SURFACES).sort()).toEqual(directRuntimeUsers())
  })
})
