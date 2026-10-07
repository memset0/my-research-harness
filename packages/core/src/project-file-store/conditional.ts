import {
  contentVersion,
  type DirectoryEntry,
  directoryVersion,
  type FileReadResult,
} from '@memon/file-protocol'
import { resolve } from '@memon/file-protocol/paths'
import type { ProjectFileContext } from '../project-file-context.js'
import { projectFs } from './fs-facade.js'
import { getStore, withProjectFileContext } from './runtime.js'

export type ConditionalFileOptions = {
  knownVersion?: string
  policy?: ProjectFileContext['observationPolicy']
}
export async function readProjectFile(
  context: ProjectFileContext,
  path: string,
  options: ConditionalFileOptions = {},
): Promise<FileReadResult> {
  context = { ...context, root: resolve(context.root) }
  path = resolve(path)
  return withProjectFileContext(
    { ...context, observationPolicy: options.policy ?? 'fresh' },
    async () => {
      try {
        const bytes = await projectFs.readFile(path)
        const version = contentVersion(bytes)
        const checkedAt = getStore().observationTime(context.root, path, 'readFile') ?? Date.now()
        return options.knownVersion === version
          ? { outcome: 'unchanged', version, checkedAt }
          : { outcome: 'present', version, checkedAt, content: bytes.toString('base64') }
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? ''))
          throw error
        return {
          outcome: 'missing',
          checkedAt: getStore().observationTime(context.root, path, 'readFile') ?? Date.now(),
        }
      }
    },
  )
}
export async function listProjectFiles(
  context: ProjectFileContext,
  path: string,
  options: ConditionalFileOptions = {},
) {
  context = { ...context, root: resolve(context.root) }
  path = resolve(path)
  return withProjectFileContext(
    { ...context, observationPolicy: options.policy ?? 'fresh' },
    async () => {
      try {
        const items = await projectFs.readdir(path, { withFileTypes: true })
        const entries: DirectoryEntry[] = items.map((entry) => ({
          name: entry.name,
          kind: entry.isFile()
            ? 'file'
            : entry.isDirectory()
              ? 'directory'
              : entry.isSymbolicLink()
                ? 'symlink'
                : 'other',
        }))
        const version = directoryVersion(entries)
        const checkedAt = getStore().observationTime(context.root, path, 'readdir') ?? Date.now()
        return options.knownVersion === version
          ? { outcome: 'unchanged' as const, version, checkedAt }
          : { outcome: 'present' as const, entries, version, checkedAt }
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? ''))
          throw error
        return {
          outcome: 'missing' as const,
          checkedAt: getStore().observationTime(context.root, path, 'readdir') ?? Date.now(),
        }
      }
    },
  )
}
