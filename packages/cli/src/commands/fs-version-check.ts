// memon fs-version check — read-only status report for a project's
// .memon/version.json marker.
//
// Exit codes:
//   0  match / behind / uninitialised  (the state is observable; caller decides)
//   11 ahead  (MEMON_TOO_OLD; tool too old for project's recorded version)
//
// stdout always carries the full status block (even on exit 11) so callers
// can parse before checking exit.

import { resolve } from 'node:path'
import {
  computeFsVersionStatus,
  FS_CONVENTION_VERSION,
  type FsVersionStatus,
  readFsVersion,
} from '@memon/core'
import { emitGenericAndExit } from '../lib/emit-error.js'
import { EXIT } from '../lib/exit-codes.js'
import { emitHuman, emitJson, type OutputFormat } from '../lib/output.js'

export interface FsVersionCheckInput {
  projectRoot?: string
  cwd: string
  format: OutputFormat
}

export interface FsVersionCheckResult {
  projectRoot: string
  current: number | null
  available: number
  status: FsVersionStatus
}

/**
 * Inspect the project root's `.memon/version.json` and return the comparison
 * result. Pure read; no filesystem mutations.
 */
export async function inspectFsVersion(projectRoot: string): Promise<FsVersionCheckResult> {
  const abs = resolve(projectRoot)
  const record = await readFsVersion(abs)
  const current = record?.fs_convention_version ?? null
  return {
    projectRoot: abs,
    current,
    available: FS_CONVENTION_VERSION,
    status: computeFsVersionStatus(current, FS_CONVENTION_VERSION),
  }
}

export async function runFsVersionCheck(input: FsVersionCheckInput): Promise<void> {
  const root = input.projectRoot ?? input.cwd
  let result: FsVersionCheckResult
  try {
    result = await inspectFsVersion(root)
  } catch (err) {
    emitGenericAndExit(err)
  }

  if (input.format === 'human') {
    emitHuman(formatHuman(result))
  } else {
    emitJson(result)
  }

  if (result.status === 'ahead') {
    process.exit(EXIT.MEMON_TOO_OLD)
  }
  process.exit(EXIT.SUCCESS)
}

function formatHuman(r: FsVersionCheckResult): string {
  const lines: string[] = []
  lines.push(`project root: ${r.projectRoot}`)
  lines.push(`current:      ${r.current ?? '(uninitialised)'}`)
  lines.push(`available:    ${r.available}`)
  lines.push(`status:       ${r.status}`)
  switch (r.status) {
    case 'match':
      lines.push('OK — project FS convention matches the tool.')
      break
    case 'behind':
      lines.push(
        `Project is behind. Run the memon-migrate-fs skill to upgrade ${r.current} -> ${r.available}.`,
      )
      break
    case 'uninitialised':
      lines.push(
        'No .memon/version.json on disk. Run `memon install-skills --project-root <p>` to initialise.',
      )
      break
    case 'ahead':
      lines.push(
        `Project expects FS convention v${r.current}; this memon supports up to v${r.available}. Upgrade memon.`,
      )
      break
  }
  return lines.join('\n')
}
