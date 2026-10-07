import { dirname, relative, resolve, sep } from '@memon/file-protocol/paths'
import { type ResourceId, ResourceIdSchema } from './backend-protocol.js'
import { projectFs as fs } from './project-file-store.js'

export type ProjectResourceErrorCode =
  | 'INVALID_RESOURCE'
  | 'PROJECT_ROOT_UNAVAILABLE'
  | 'NOT_FOUND'
  | 'OUTSIDE_PROJECT'
  | 'NOT_A_DIRECTORY'
  | 'UNSUPPORTED_RESOURCE'

export class ProjectResourceError extends Error {
  constructor(
    public readonly code: ProjectResourceErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ProjectResourceError'
  }
}

export interface ResolvedProjectResource {
  /** Resolved Project root after following the root itself. */
  realRoot: string
  /** Safe absolute target. Existing targets are returned as their realpath. */
  path: string
  /** Whether the target existed when it was checked. */
  exists: boolean
  resourceId: ResourceId
}

export interface ResolveProjectResourceOptions {
  /** Permit a missing final target after validating its nearest existing parent. */
  forCreate?: boolean
}

/**
 * Resolve a portable Backend resource ID beneath one configured Project root.
 *
 * This is the cross-boundary primitive. It rejects unsafe identifier spellings
 * through ResourceIdSchema, then performs both lexical and realpath checks.
 * For creation, every existing ancestor is resolved before returning the
 * lexical missing target. Callers must invoke this immediately before their
 * atomic create/rename boundary as well as at request validation time.
 */
export async function resolveProjectResource(
  projectRoot: string,
  resourceIdInput: unknown,
  options: ResolveProjectResourceOptions = {},
): Promise<ResolvedProjectResource> {
  const parsed = ResourceIdSchema.safeParse(resourceIdInput)
  if (!parsed.success) {
    throw new ProjectResourceError('INVALID_RESOURCE', 'resource identifier is invalid')
  }
  const resourceId = parsed.data

  let realRoot: string
  try {
    realRoot = await fs.realpath(projectRoot)
    const rootStat = await fs.stat(realRoot)
    if (!rootStat.isDirectory()) {
      throw new ProjectResourceError(
        'NOT_A_DIRECTORY',
        'configured Project root is not a directory',
      )
    }
  } catch (error) {
    if (error instanceof ProjectResourceError) throw error
    throw new ProjectResourceError(
      'PROJECT_ROOT_UNAVAILABLE',
      `configured Project root is unavailable: ${errnoCode(error)}`,
    )
  }

  const lexicalTarget = resolve(realRoot, ...resourceId.split('/'))
  if (!isWithin(realRoot, lexicalTarget)) {
    // ResourceIdSchema already rejects dot segments; keep this independent
    // check so a future schema widening cannot weaken the filesystem boundary.
    throw new ProjectResourceError('OUTSIDE_PROJECT', 'resource escapes its Project root')
  }

  try {
    const realTarget = await fs.realpath(lexicalTarget)
    if (!isWithin(realRoot, realTarget)) {
      throw new ProjectResourceError('OUTSIDE_PROJECT', 'resource symlink escapes its Project root')
    }
    const targetStat = await fs.stat(realTarget)
    if (!targetStat.isFile() && !targetStat.isDirectory()) {
      throw new ProjectResourceError(
        'UNSUPPORTED_RESOURCE',
        'resource is not a regular file or directory',
      )
    }
    return { realRoot, path: realTarget, exists: true, resourceId }
  } catch (error) {
    if (error instanceof ProjectResourceError) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new ProjectResourceError(
        'NOT_FOUND',
        `resource cannot be resolved: ${errnoCode(error)}`,
      )
    }
  }

  if (!options.forCreate) {
    throw new ProjectResourceError('NOT_FOUND', 'resource does not exist')
  }

  const realParent = await nearestExistingParent(lexicalTarget, realRoot)
  if (!isWithin(realRoot, realParent)) {
    throw new ProjectResourceError(
      'OUTSIDE_PROJECT',
      'resource parent symlink escapes its Project root',
    )
  }
  return { realRoot, path: lexicalTarget, exists: false, resourceId }
}

async function nearestExistingParent(target: string, realRoot: string): Promise<string> {
  let candidate = dirname(target)
  while (isWithin(realRoot, candidate)) {
    try {
      const realCandidate = await fs.realpath(candidate)
      const stat = await fs.stat(realCandidate)
      if (!stat.isDirectory()) {
        throw new ProjectResourceError(
          'NOT_A_DIRECTORY',
          'nearest existing resource parent is not a directory',
        )
      }
      return realCandidate
    } catch (error) {
      if (error instanceof ProjectResourceError) throw error
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new ProjectResourceError(
          'NOT_FOUND',
          `resource parent cannot be resolved: ${errnoCode(error)}`,
        )
      }
    }
    if (candidate === realRoot) break
    candidate = dirname(candidate)
  }
  throw new ProjectResourceError('OUTSIDE_PROJECT', 'resource has no safe Project parent')
}

function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep))
}

function errnoCode(error: unknown): string {
  return (error as NodeJS.ErrnoException).code ?? 'UNKNOWN'
}
