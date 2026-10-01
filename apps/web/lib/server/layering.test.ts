// @vitest-environment node

// Enforces the lib/server layering contract (web-lib-layering):
// - every non-test module under lib/server imports Next's `server-only` guard,
// - except modules the custom Node entry (`server.ts`) loads through value
//   imports: tsx resolves those outside Next's bundler, where the bare
//   `server-only` specifier does not resolve, so they must not import it.
// The exempt set is derived from the entry's import graph, never hand-listed.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const WEB_ROOT = join(__dirname, '..', '..')
const SERVER_ROOT = join(WEB_ROOT, 'lib', 'server')
const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx']
const GUARD = /^import 'server-only'$/m

function resolveLocal(from: string, specifier: string): string | null {
  let base: string
  if (specifier.startsWith('@/')) base = join(WEB_ROOT, specifier.slice(2))
  else if (specifier.startsWith('.')) base = resolve(dirname(from), specifier)
  else return null
  for (const extension of EXTENSIONS) {
    const candidate = base + extension
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

/** Specifiers the module loads at runtime (type-only imports are erased). */
function valueImports(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const specifiers: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause
      const bindings = clause?.namedBindings
      const allTypeElements =
        clause !== undefined &&
        clause.name === undefined &&
        bindings !== undefined &&
        ts.isNamedImports(bindings) &&
        bindings.elements.length > 0 &&
        bindings.elements.every((element) => element.isTypeOnly)
      if (!clause?.isTypeOnly && !allTypeElements) specifiers.push(node.moduleSpecifier.text)
    } else if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text)
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return specifiers
}

function entryGraph(entry: string): Set<string> {
  const seen = new Set<string>()
  const pending = [entry]
  while (pending.length > 0) {
    const file = pending.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    for (const specifier of valueImports(file)) {
      const target = resolveLocal(file, specifier)
      if (target) pending.push(target)
    }
  }
  return seen
}

function serverModules(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...serverModules(path))
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(path)
  }
  return files
}

const label = (path: string) => relative(WEB_ROOT, path).replaceAll('\\', '/')

describe('lib/server layering', () => {
  const bootGraph = entryGraph(join(WEB_ROOT, 'server.ts'))
  const modules = serverModules(SERVER_ROOT)

  it('marks every Next-only server module with the server-only guard', () => {
    const unmarked = modules
      .filter((path) => !bootGraph.has(path))
      .filter((path) => !GUARD.test(readFileSync(path, 'utf8')))
      .map(label)
    expect(unmarked).toEqual([])
  })

  it('keeps the guard out of modules the custom Node entry loads', () => {
    const marked = [...bootGraph]
      .filter((path) => GUARD.test(readFileSync(path, 'utf8')))
      .map(label)
    expect(marked).toEqual([])
  })

  it('derives a non-trivial boot graph from server.ts', () => {
    expect(bootGraph.has(join(SERVER_ROOT, 'runtime.ts'))).toBe(true)
    expect(bootGraph.has(join(SERVER_ROOT, 'server-core.ts'))).toBe(true)
    expect(modules.some((path) => !bootGraph.has(path))).toBe(true)
  })
})
