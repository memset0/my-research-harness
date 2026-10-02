import { DEFAULT_RUN_DIRS } from '../discovery/run-dirs.js'
import { projectFs as fs } from '../project-file-store.js'
import { yamlEngine } from '../yaml-engine.js'
import { resolveProjectDeclarationPath } from './paths.js'
import {
  type ProjectDeclaration,
  ProjectDeclarationError,
  validateProjectDeclaration,
} from './schema.js'

/**
 * Read `<root>/.memon/project.yml`. `null` when the file is absent; the
 * validated declaration otherwise. Unparseable YAML or a schema violation
 * throws `ProjectDeclarationError` (`PROJECT_DECLARATION_INVALID`): callers
 * fail closed instead of silently using the default.
 *
 * Reads go through `projectFs`, so central observes the file through its
 * Store like any other project file.
 */
export async function loadProjectDeclaration(root: string): Promise<ProjectDeclaration | null> {
  const { declarationAbs } = resolveProjectDeclarationPath(root)
  let raw: string
  try {
    raw = await fs.readFile(declarationAbs, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return null
    throw error
  }
  let parsed: unknown
  try {
    parsed = yamlEngine.parse(raw)
  } catch (error) {
    throw new ProjectDeclarationError(`not valid YAML: ${(error as Error).message}`)
  }
  return validateProjectDeclaration(parsed)
}

/** Which source supplied the effective Run locations. */
export type RunDirsSourceName = 'cli' | 'central' | 'project' | 'default'

export interface EffectiveRunDirs {
  patterns: string[]
  source: RunDirsSourceName
}

export interface RunDirsSources {
  /** CLI `--run-dir` patterns of this invocation (CLI only). */
  cliRunDirs?: readonly string[] | undefined
  /** The central Project configuration's `run_dirs` (central only). */
  centralRunDirs?: readonly string[] | undefined
  /** `run_dirs` of `.memon/project.yml` (or the loaded declaration). */
  declaration?: ProjectDeclaration | null | undefined
}

/**
 * The precedence chain without I/O: CLI `--run-dir` > central `run_dirs` >
 * `.memon/project.yml` `run_dirs` > FS v8 default. The first present source
 * wins as a whole; sources are never merged.
 */
export function selectEffectiveRunDirs(sources: RunDirsSources): EffectiveRunDirs {
  if (sources.cliRunDirs !== undefined && sources.cliRunDirs.length > 0)
    return { patterns: [...sources.cliRunDirs], source: 'cli' }
  if (sources.centralRunDirs !== undefined && sources.centralRunDirs.length > 0)
    return { patterns: [...sources.centralRunDirs], source: 'central' }
  const declared = sources.declaration?.run_dirs
  if (declared !== undefined && declared.length > 0)
    return { patterns: [...declared], source: 'project' }
  return { patterns: [...DEFAULT_RUN_DIRS], source: 'default' }
}

/**
 * Resolve the effective Run locations of `root`. The declaration is read only
 * when no higher source is present (or taken from `declaration` when the
 * caller already loaded it); an invalid declaration throws.
 */
export async function resolveEffectiveRunDirs(
  options: { root: string } & RunDirsSources,
): Promise<EffectiveRunDirs> {
  const higher = selectEffectiveRunDirs({
    cliRunDirs: options.cliRunDirs,
    centralRunDirs: options.centralRunDirs,
  })
  if (higher.source !== 'default') return higher
  const declaration =
    options.declaration !== undefined
      ? options.declaration
      : await loadProjectDeclaration(options.root)
  return selectEffectiveRunDirs({ declaration })
}
