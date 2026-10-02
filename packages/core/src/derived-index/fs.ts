// The filesystem subset the derived index reads and writes through.
//
// Defaults to core's `projectFs`, so central writers keep the project file
// store's containment, scheduling and cache invalidation while the CLI
// writes the native filesystem. Tests inject failures through this port.

import type { promises as nodeFs } from 'node:fs'
import { projectFs } from '../project-file-store.js'

export type IndexFs = Pick<
  typeof nodeFs,
  'readFile' | 'writeFile' | 'rename' | 'unlink' | 'mkdir' | 'readdir' | 'stat' | 'link' | 'rm'
>

export const defaultIndexFs: IndexFs = projectFs as unknown as IndexFs

export function errnoCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code
}
