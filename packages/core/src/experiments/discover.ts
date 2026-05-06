// Discovery for v3 experiment docs at `<projectRoot>/docs/experiments/`.
//
// Each file matching `E<NNNN>-<slug>.md` is parsed and added to the index.
// Subdirectories under `docs/experiments/` are NOT descended into. Files
// not matching the regex are silently ignored (no warning).

import { promises as fs } from 'node:fs'
import * as path from 'node:path'

import type { Experiment } from '../types.js'
import { EXPERIMENT_FILENAME_REGEX } from '../types.js'
import { buildExperimentRecord, parseExperimentReadme } from './parse.js'

const EXPERIMENTS_SUBDIR = 'docs/experiments'

export interface DiscoverExperimentsResult {
  experiments: Experiment[]
}

/**
 * Scan `<projectRoot>/docs/experiments/E*-*.md` and return parsed
 * experiment records. The membership project is supplied by the caller
 * from `config.yml`'s project name.
 */
export async function discoverExperiments(
  projectRoot: string,
  projectName: string,
): Promise<DiscoverExperimentsResult> {
  const dir = path.join(projectRoot, EXPERIMENTS_SUBDIR)
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT') return { experiments: [] }
    throw err
  }

  const experiments: Experiment[] = []
  for (const entry of entries) {
    const m = entry.match(EXPERIMENT_FILENAME_REGEX)
    if (!m) continue
    const absPath = path.join(dir, entry)
    let stat: Awaited<ReturnType<typeof fs.stat>>
    try {
      stat = await fs.stat(absPath)
    } catch {
      continue
    }
    if (!stat.isFile()) continue
    let content = ''
    try {
      content = await fs.readFile(absPath, 'utf8')
    } catch {
      continue
    }
    const filenameStem = entry.replace(/\.md$/, '')
    const parsed = parseExperimentReadme(content, filenameStem)
    const id = `E${m[1]}-${m[2]}`
    experiments.push(
      buildExperimentRecord(parsed, {
        id,
        project: projectName,
        path: absPath,
        mtime: stat.mtimeMs,
      }),
    )
  }
  return { experiments }
}

/**
 * Read a single experiment doc by id (`E<NNNN>-<slug>`) under the given
 * project root. Returns null when the file does not exist; throws on
 * unrelated I/O errors.
 */
export async function readExperimentDoc(
  projectRoot: string,
  projectName: string,
  experimentId: string,
): Promise<Experiment | null> {
  const filename = `${experimentId}.md`
  if (!filename.match(EXPERIMENT_FILENAME_REGEX)) return null
  const absPath = path.join(projectRoot, EXPERIMENTS_SUBDIR, filename)
  let stat: Awaited<ReturnType<typeof fs.stat>>
  try {
    stat = await fs.stat(absPath)
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT') return null
    throw err
  }
  const content = await fs.readFile(absPath, 'utf8')
  const parsed = parseExperimentReadme(content, experimentId)
  return buildExperimentRecord(parsed, {
    id: experimentId,
    project: projectName,
    path: absPath,
    mtime: stat.mtimeMs,
  })
}
