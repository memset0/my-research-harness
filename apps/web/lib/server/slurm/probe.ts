// Startup capability probe for `squeue --me`.
//
// Run once during runtime init when `Config.slurm.totalNodes !== -1`. On
// failure the server refuses to start — see `apps/web/lib/runtime.ts`.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

export interface ProbeResult {
  supported: boolean
  reason?: string
}

/**
 * Two-step probe: `squeue --version` (binary exists) and
 * `squeue --me --noheader` (the `--me` flag is supported; added in
 * Slurm 20.02). Both must exit 0 within 5s.
 */
export async function probeSqueue(): Promise<ProbeResult> {
  try {
    await execFileP('squeue', ['--version'], { timeout: 5_000 })
  } catch (err) {
    return { supported: false, reason: `squeue --version: ${(err as Error).message}` }
  }
  try {
    await execFileP('squeue', ['--me', '--noheader'], { timeout: 5_000 })
  } catch (err) {
    return { supported: false, reason: `squeue --me: ${(err as Error).message}` }
  }
  return { supported: true }
}
