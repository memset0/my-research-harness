// `memon new <name> [--project NAME]`
//
// Creates `<root>/logs/<name>-<yymmdd>-<hhmmss>/` (using the current local time)
// containing:
//   - README.md   — front matter prefilled, sections empty
//   - run.sh      — entry script template (executable)
// Then appends a [CREATE] event to the project's JOURNAL.md.

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  appendJournalEvent,
  serializeReadme,
  type ExperimentFrontMatter,
} from '@memon/core'
import { resolveConfig } from '../lib/resolver.js'
import { emitError, emitJson, emitHuman } from '../lib/output.js'

export interface NewOptions {
  name: string
  project?: string
  configPath?: string
  cwd: string
  format: 'json' | 'human'
}

export async function runNew(opts: NewOptions): Promise<void> {
  const config = await resolveConfig({
    configPath: opts.configPath,
    cwd: opts.cwd,
    requireExplicit: false,
  })

  const project =
    opts.project !== undefined
      ? config.projects.find((p) => p.name === opts.project)
      : config.projects[0]
  if (!project) {
    emitError(`project "${opts.project ?? '(default)'}" not found in config`)
  }

  const now = new Date()
  const stamp = formatStamp(now)
  const isoNow = formatIsoLocal(now)
  const id = `${opts.name}-${stamp}`
  const dir = join(project.root, 'logs', id)

  // Collision check (same-second name within same project)
  try {
    await fs.access(dir)
    emitError(`experiment directory already exists: ${dir}`, 2)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  await fs.mkdir(dir, { recursive: true })

  // README.md
  const fm: ExperimentFrontMatter = {
    id,
    name: opts.name,
    project: project.name,
    status: 'PENDING',
    createdAt: isoNow,
    finishedAt: null,
    host: null,
    pid: null,
    gpus: [],
    entry: './run.sh',
    command: '',
    wandb: null,
    hypotheses: [],
    tags: [],
  }
  const readme = serializeReadme({
    frontMatter: fm,
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
  await fs.writeFile(join(dir, 'README.md'), readme)

  // run.sh template
  const runSh = `#!/usr/bin/env bash
# memon experiment ${id}
set -euo pipefail

# TODO: fill in the launch command. The full command line should also be
# recorded in README.md front matter under \`command:\` so future readers
# (and agents) know exactly what was run.

echo "experiment ${id} placeholder"
`
  await fs.writeFile(join(dir, 'run.sh'), runSh, { mode: 0o755 })

  // Append [CREATE] event to project JOURNAL.md
  await appendJournalEvent({
    path: join(project.root, 'JOURNAL.md'),
    event: {
      timestamp: isoNow,
      tag: 'CREATE',
      body: `\`${id}\` PENDING`,
    },
  })

  if (opts.format === 'json') {
    emitJson({ created: { id, path: dir, project: project.name } })
  } else {
    emitHuman(`created ${dir}`)
  }
}

function formatStamp(d: Date): string {
  const yy = String(d.getFullYear()).slice(-2)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${yy}${mm}${dd}-${hh}${mi}${ss}`
}

function formatIsoLocal(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const offsetMin = -d.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const oh = String(Math.floor(Math.abs(offsetMin) / 60)).padStart(2, '0')
  const om = String(Math.abs(offsetMin) % 60).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}${sign}${oh}:${om}`
}
