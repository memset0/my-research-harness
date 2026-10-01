// Backend Run path resolution.
//
// Mirrors core's `resolveDeclaredRunPath` / `resolveRunReference` checks —
// Run-path shape, the target and its README real paths inside the real
// Project root, the target is a directory — but takes the root's real path
// from the request scope, so a request resolving hundreds of declared Runs
// resolves the root once.

import { basename, join, relative, resolve, sep } from 'node:path'
import { projectFs as fs, isRunPath, type ProjectConfig, projectRunPath } from '@memon/core'
import { realProjectRoot } from './request-scope.js'

function escapes(relativePath: string): boolean {
  return relativePath === '..' || relativePath.startsWith(`..${sep}`)
}

/**
 * Resolve a project-relative Run path to its (lexical) directory. Throws a
 * plain error for a malformed or escaping path and propagates filesystem
 * errors (`ENOENT` when the directory is absent).
 */
export async function resolveRunPath(root: string, path: string): Promise<string> {
  if (!isRunPath(path)) throw new Error('Invalid project-relative Run path')
  const target = join(root, ...path.split('/'))
  const [realRoot, realTarget] = await Promise.all([realProjectRoot(root), fs.realpath(target)])
  const contained = relative(realRoot, realTarget)
  if (escapes(contained) || resolve(realRoot, contained) !== realTarget) {
    throw new Error('Run path escapes project root')
  }
  if (!(await fs.stat(realTarget)).isDirectory()) throw new Error('Run path is not a directory')
  try {
    if (escapes(relative(realRoot, await fs.realpath(join(target, 'README.md'))))) {
      throw new Error('Run README escapes project root')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return target
}

/**
 * A Run reference — a project-relative path, or a unique Run directory name
 * looked up in `walk()` — to its directory; null when absent. An ambiguous
 * base name is an error naming the candidates.
 */
export async function resolveRunReferencePath(
  project: ProjectConfig,
  reference: string,
  walk: () => Promise<readonly string[]>,
): Promise<string | null> {
  if (reference.includes('/')) {
    try {
      return await resolveRunPath(project.root, reference)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
  const matches = (await walk()).filter((path) => basename(path) === reference)
  if (matches.length > 1)
    throw new Error(
      `Ambiguous Run ID; use a project-relative path: ${matches.map((path) => projectRunPath(project.root, path)).join(', ')}`,
    )
  return matches[0] ?? null
}
