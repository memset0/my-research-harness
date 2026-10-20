// Initialize fresh research at first creation; preserve existing declarations and markers.

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  DEFAULT_RUN_DIRS,
  FS_CONVENTION_VERSION,
  formatIsoLocal,
  loadProjectDeclaration,
  readFsVersion,
  rebuildIndex,
  resolveProjectDeclarationPath,
  writeFsVersion,
} from '@memon/core'
import { cliRunDirs } from '../lib/discovery-options.js'
import { emitErrorAndExit } from '../lib/emit-error.js'

/** Called under the project writer lock, before allocating the first Experiment. */
export async function initializeFreshResearch(root: string): Promise<void> {
  const marker = await readFsVersion(root)
  const declaration = await loadProjectDeclaration(root)
  if (marker) {
    if (marker.fs_convention_version > FS_CONVENTION_VERSION)
      emitErrorAndExit(
        'BAD_STATE',
        'Project uses a newer filesystem convention; update memon first',
      )
    return
  }
  // Source code and ordinary documents can exist. Research must not be relabeled.
  for (const relative of [
    'docs/experiments',
    'docs/wiki',
    'docs/reports',
    'logs',
    'outputs',
    'experiments',
  ]) {
    try {
      if ((await fs.readdir(join(root, relative))).length)
        emitErrorAndExit(
          'BAD_STATE',
          `Unmarked research exists in ${relative}; use the reviewed filesystem migration before creating an Experiment`,
        )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  if (!declaration) {
    const { declarationAbs } = resolveProjectDeclarationPath(root)
    await fs.mkdir(dirname(declarationAbs), { recursive: true })
    await fs.writeFile(
      declarationAbs,
      projectDeclarationContent(cliRunDirs() ?? [...DEFAULT_RUN_DIRS]),
      { encoding: 'utf8', flag: 'wx' },
    )
  }
  const registration = await rebuildIndex(root, { role: 'cli' })
  if (registration.status !== 'rebuilt')
    emitErrorAndExit(
      'CONFLICT',
      'Project inventory initialization failed; run memon refresh and retry',
    )
  await writeFsVersion(root, {
    fs_convention_version: FS_CONVENTION_VERSION,
    installed_at: formatIsoLocal(new Date()),
    last_migrated_at: null,
  })
}

const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`

/** Minimal tracked declaration; agents can add other supported layout keys. */
function projectDeclarationContent(patterns: readonly string[]): string {
  return [
    'schema_version: 1',
    'run_dirs:',
    ...patterns.map((pattern) => `  - ${quote(pattern)}`),
    '',
  ].join('\n')
}
