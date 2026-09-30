import { basename, join, relative, resolve, sep } from 'node:path'
import { discoverRuns } from '../discovery/discover.js'
import { projectFs as fs } from '../project-file-store.js'
import type { ProjectConfig } from '../types.js'
import { listExperimentPaths } from './discover.js'
import { parseExperimentReadme } from './parse.js'

export function isRunPath(value: string): boolean {
  const parts = value.split('/')
  return (
    parts.length >= 2 &&
    ['logs', 'outputs', 'experiments'].includes(parts[0]!) &&
    !/[\\\0]/.test(value) &&
    !/%(?:2f|5c)/i.test(value) &&
    parts.every((part) => part !== '' && part !== '.' && part !== '..') &&
    /^.+-\d{6}-\d{6}$/.test(parts.at(-1)!)
  )
}

export function projectRunPath(root: string, directory: string): string {
  const path = relative(resolve(root), resolve(directory)).split(sep).join('/')
  if (!isRunPath(path))
    throw new Error('Run path must be relative to the project and inside a Run root')
  return path
}

export async function resolveDeclaredRunPath(root: string, path: string): Promise<string> {
  if (!isRunPath(path)) throw new Error('Invalid project-relative Run path')
  const realRoot = await fs.realpath(root)
  const target = join(root, ...path.split('/'))
  const realTarget = await fs.realpath(target)
  const contained = relative(realRoot, realTarget)
  if (
    contained === '..' ||
    contained.startsWith(`..${sep}`) ||
    resolve(realRoot, contained) !== realTarget
  ) {
    throw new Error('Run path escapes project root')
  }
  if (!(await fs.stat(realTarget)).isDirectory()) throw new Error('Run path is not a directory')
  try {
    const readme = relative(realRoot, await fs.realpath(join(target, 'README.md')))
    if (readme === '..' || readme.startsWith(`..${sep}`))
      throw new Error('Run README escapes project root')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return target
}

export async function resolveRunReference(
  project: ProjectConfig,
  reference: string,
): Promise<string | null> {
  if (reference.includes('/')) {
    try {
      return await resolveDeclaredRunPath(project.root, reference)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
  const matches = (await discoverRuns(project, { includeArchived: true })).filter(
    (path) => basename(path) === reference,
  )
  if (matches.length > 1)
    throw new Error(
      `Ambiguous Run ID; use a project-relative path: ${matches.map((path) => projectRunPath(project.root, path)).join(', ')}`,
    )
  return matches[0] ?? null
}

export async function declaredRunOwner(
  root: string,
  directory: string,
  projectName = '(project-root)',
): Promise<string | null> {
  const path = projectRunPath(root, directory)
  const owners: string[] = []
  let legacyTarget: string | null | undefined
  for (const [id, document] of await listExperimentPaths(root)) {
    let content: string
    try {
      content = await fs.readFile(join(root, document), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    const experiment = parseExperimentReadme(content, id)
    let declared = experiment.frontMatter.runs.includes(path)
    if (!declared && experiment.frontMatter.runs.includes(basename(directory))) {
      legacyTarget ??= await resolveRunReference(
        { root, name: projectName, include: [], exclude: [] },
        basename(directory),
      )
      declared = legacyTarget === directory
    }
    if (declared) owners.push(id)
  }
  if (owners.length > 1) throw new Error(`Run path has multiple Experiment owners: ${path}`)
  return owners[0] ?? null
}
