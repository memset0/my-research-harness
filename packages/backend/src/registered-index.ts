import { type IndexSnapshot, type ProjectConfig, parseSnapshot } from '@memon/core'
import { join } from '@memon/file-protocol/paths'
import { resolveContained } from './containment.js'
import { projectReadIndex } from './read-index.js'

/** FS11 inventories are published by writers; readers never repair them by walking. */
export async function registeredProjectSnapshot(
  project: ProjectConfig,
): Promise<IndexSnapshot | null> {
  const markerPath = await resolveContained(
    project.root,
    join(project.root, '.memon/version.json'),
    { allowMissing: true },
  )
  if (!markerPath) return null
  const version = await projectReadIndex(project.root).file(
    markerPath,
    'registered-project-version',
    1000,
    (content) => {
      const value = JSON.parse(content) as { fs_convention_version?: number }
      return value.fs_convention_version ?? 0
    },
  )
  if (version === null || version < 11) return null
  const path = await resolveContained(
    project.root,
    join(project.root, '.memon/index/snapshot.json'),
    { allowMissing: true },
  )
  const snapshot = path
    ? await projectReadIndex(project.root).file(
        path,
        'registered-project-snapshot',
        1000,
        (content) => {
          const parsed = parseSnapshot(JSON.parse(content))
          if (!parsed.ok)
            throw new Error(`REGISTERED_INDEX_INVALID: ${parsed.reason}; run memon index rebuild`)
          return parsed.value
        },
      )
    : null
  if (!snapshot)
    throw new Error('REGISTERED_INDEX_MISSING: run memon index rebuild to register project files')
  return snapshot
}

export function experimentRunPaths(snapshot: IndexSnapshot, experimentId: string): string[] {
  const prefix = `logs/${experimentId.slice(0, 5)}/`
  return Object.keys(snapshot.runs)
    .filter((path) => path.startsWith(prefix))
    .sort()
}
