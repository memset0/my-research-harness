// Startup capability probe for `squeue --me`.
//
// Run once during runtime init when `Config.slurm.totalNodes !== -1`. On
// failure the server refuses to start — see `apps/web/lib/runtime.ts`.

import { type BackendExecutionProvider, createLocalExecutionProvider } from '@memon/backend'

export interface ProbeResult {
  supported: boolean
  reason?: string
}

/**
 * Two-step probe: `squeue --version` (binary exists) and
 * `squeue --me --noheader` (the `--me` flag is supported; added in
 * Slurm 20.02). Both must exit 0 within 5s.
 */
export async function probeSqueue(
  execution: BackendExecutionProvider = createLocalExecutionProvider(),
): Promise<ProbeResult> {
  for (const args of [['--version'], ['--me', '--noheader']]) {
    const result = await execution.run('squeue', args, { timeoutMs: 5_000 })
    if (result.code !== 0)
      return {
        supported: false,
        reason: 'squeue capability probe failed on the configured execution target',
      }
  }
  return { supported: true }
}
