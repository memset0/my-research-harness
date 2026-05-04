// createExperimentScaffold — shared by `memon new` (CLI) and POST /api/experiments (web).
//
// Creates `<projectRoot>/logs/<name>-<yymmdd>-<hhmmss>/` containing:
//   - README.md  (front matter prefilled, all sections "TBD")
//   - run.sh    (executable launch-script template)
// Then appends a [CREATE] event to <projectRoot>/JOURNAL.md.
//
// Errors:
//   - `ExperimentExistsError` when the target directory already exists
//     (caller decides how to surface: 409 from web, exit code 2 from CLI)

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { appendJournalEvent } from '../journal/append.js'
import { serializeReadme } from '../readme/serialize.js'
import { formatExperimentStamp, formatIsoLocal } from '../time.js'
import type { ExperimentFrontMatter } from '../types.js'

export class ExperimentExistsError extends Error {
  constructor(public readonly path: string) {
    super(`experiment directory already exists: ${path}`)
    this.name = 'ExperimentExistsError'
  }
}

export interface CreateScaffoldInput {
  /** Absolute path to the project's root directory */
  projectRoot: string
  /** Project name to set as the front matter `project` field */
  projectName: string
  /** User-facing experiment name (will be prefixed before the timestamp) */
  name: string
  /** Optional clock injection (defaults to new Date()) — useful for tests */
  now?: Date
  /** If false, skip JOURNAL.md append (default true) */
  appendJournal?: boolean
}

export interface CreateScaffoldResult {
  id: string
  path: string
  createdAt: string
}

const RUN_SH_TEMPLATE = (id: string) => `#!/usr/bin/env bash
# TODO: one-line description of what this script does
# memon experiment ${id}
set -euo pipefail

# TODO: fill in the launch command. The full command line should also be
# recorded in README.md front matter under \`command:\` so future readers
# (and agents) know exactly what was run.

echo "experiment ${id} placeholder"
`

export async function createExperimentScaffold(
  input: CreateScaffoldInput,
): Promise<CreateScaffoldResult> {
  const now = input.now ?? new Date()
  const stamp = formatExperimentStamp(now)
  const createdAt = formatIsoLocal(now)
  const id = `${input.name}-${stamp}`
  const path = join(input.projectRoot, 'logs', id)

  // Collision check (same name within the same second)
  try {
    await fs.access(path)
    throw new ExperimentExistsError(path)
  } catch (err) {
    if (err instanceof ExperimentExistsError) throw err
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  await fs.mkdir(path, { recursive: true })

  const frontMatter: ExperimentFrontMatter = {
    id,
    name: input.name,
    project: input.projectName,
    status: 'PENDING',
    createdAt,
    finishedAt: null,
    host: null,
    pid: null,
    gpus: [],
    entry: './run.sh',
    command: 'TODO: fill in launch command',
    wandb: null,
    hypotheses: [],
    tags: [],
  }

  const readme = serializeReadme({
    frontMatter,
    sections: {
      motivation: 'TBD',
      setup: 'TBD',
      method: 'TBD',
      result: 'TBD',
      conclusion: 'TBD',
      caveats: 'TBD',
      artifacts: [],
      newHypotheses: null,
    },
  })

  await fs.writeFile(join(path, 'README.md'), readme)
  await fs.writeFile(join(path, 'run.sh'), RUN_SH_TEMPLATE(id), { mode: 0o755 })

  if (input.appendJournal !== false) {
    await appendJournalEvent({
      path: join(input.projectRoot, 'JOURNAL.md'),
      event: { timestamp: createdAt, tag: 'CREATE', body: `\`${id}\` PENDING` },
    })
  }

  return { id, path, createdAt }
}
