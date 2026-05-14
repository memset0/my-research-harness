// `squeue --me` executor + parser.
//
// The dashboard's `/api/slurm/status` endpoint and the slurm-status widget
// both consume this. We use `-O '<field-list>'` with no per-field size so
// each line is a single-space-delimited record; default `squeue` output is
// column-aligned with variable widths and re-implementing slurm's pad logic
// would be brittle across versions.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

export interface SlurmJob {
  jobId: string
  partition: string
  name: string
  /** R, PD, CG, etc. — state code from `squeue` */
  state: string
  /** TIME column, e.g. "3:39:55" or "4-21:58:30". */
  time: string
  numNodes: number
  /** e.g. "fs-mbz-gpu-111" or "fs-mbz-gpu-[111,469]". */
  nodeList: string
}

// Each field carries a `|` suffix so the output is pipe-delimited rather
// than column-padded. The default column width is finite (20 chars for
// `Name`), so a name that exactly fills it fuses with the next column
// (e.g. `lk-lambda-eta10-coldR  ...`) and a whitespace split silently
// drops a column. Pipe-delimited bypasses the width problem entirely.
//
// `StateCompact` returns the short code (R, PD, CG, …); `State` would
// return the long word (RUNNING) and breaks the `state === 'R'` filter
// the API handler uses to compute `usedNodes`.
const SQUEUE_FORMAT =
  'JobID:|,Partition:|,Name:|,StateCompact:|,TimeUsed:|,NumNodes:|,NodeList:|'

export async function runSqueueMe(): Promise<SlurmJob[]> {
  const { stdout } = await execFileP(
    'squeue',
    ['--me', '--noheader', '-O', SQUEUE_FORMAT],
    { timeout: 10_000, maxBuffer: 262_144 },
  )
  return parseSqueueOutput(stdout)
}

export function parseSqueueOutput(stdout: string): SlurmJob[] {
  const jobs: SlurmJob[] = []
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    // With the `:|` suffix on each field, slurm emits exactly 7 `|`
    // separators per row (one after each field), so split() returns 8
    // elements with the last being empty. Drop the trailing empty.
    const parts = line.split('|')
    if (parts.length === 8 && parts[7] === '') parts.pop()
    if (parts.length !== 7) {
      throw new Error(
        `squeue parse error: expected 7 pipe-delimited columns, got ${parts.length} — line: ${JSON.stringify(line)}`,
      )
    }
    const numNodes = Number.parseInt(parts[5]!, 10)
    if (!Number.isFinite(numNodes)) {
      throw new Error(
        `squeue parse error: NumNodes is not an integer — line: ${JSON.stringify(line)}`,
      )
    }
    jobs.push({
      jobId: parts[0]!,
      partition: parts[1]!,
      name: parts[2]!,
      state: parts[3]!,
      time: parts[4]!,
      numNodes,
      nodeList: parts[6]!,
    })
  }
  return jobs
}
