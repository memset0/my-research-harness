// Read one native result.csv through show --results. Scripts own measurement writes.

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  isResultPathWithin,
  parseResultFile,
  projectRunPath,
  RESULT_FILE_NAME,
  resolveRunReference,
  resultContentHash,
} from '@memon/core'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { runWalkOptions } from '../lib/discovery-options.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { emitJson, type OutputFormat } from '../lib/output.js'

export interface RunResultBaseInput {
  projectRoot?: string
  cwd: string
  /** Project-relative Run path or unique Run ID. */
  run: string
  format: OutputFormat
}

interface ResolvedRun {
  projectRoot: string
  /** Absolute Run directory. */
  runDir: string
  /** Project-relative Run path. */
  runPath: string
  /** Project-relative result file. */
  file: string
}

async function resolveRun(input: RunResultBaseInput): Promise<ResolvedRun> {
  const context = await resolveContext(input)
  const projectRoot = singleProjectRoot(context)
  const projectName = context.config.projects[0]!.name
  let runDir: string | null
  try {
    runDir = await resolveRunReference(
      { root: projectRoot, name: projectName, include: [], exclude: [], ...runWalkOptions() },
      input.run,
    )
  } catch (error) {
    emitErrorAndExit('BAD_REQUEST', (error as Error).message)
  }
  if (!runDir) emitErrorAndExit('NOT_FOUND', `run "${input.run}" not found in ${projectRoot}`)
  let runPath: string
  try {
    runPath = projectRunPath(projectRoot, runDir)
  } catch (error) {
    emitErrorAndExit('BAD_REQUEST', (error as Error).message)
  }
  return { projectRoot, runDir, runPath, file: `${runPath}/${RESULT_FILE_NAME}` }
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return null
    throw error
  }
}

// ---------- get ----------

export interface RunResultGetInput extends RunResultBaseInput {
  /** Only rows whose path equals or lies below this path. */
  path?: string
}

export async function runRunResultGet(input: RunResultGetInput): Promise<void> {
  const run = await resolveRun(input)
  const content = await readOrNull(join(run.runDir, RESULT_FILE_NAME))
  const lightweight = (await readOrNull(join(run.runDir, 'run.json'))) !== null
  const parsed =
    content === null
      ? null
      : parseResultFile(content, run.file, { lightweight, metadataPaths: lightweight })
  const rows = (parsed?.rows ?? [])
    .filter((row) => input.path === undefined || isResultPathWithin(row.path, input.path))
    .map((row) => ({ line: row.line, path: row.path, stat: row.stat || null, value: row.value }))
  const output = {
    run: run.runPath,
    file: run.file,
    exists: content !== null,
    hash: content === null ? null : resultContentHash(content),
    experimentSchemaVersion: parsed?.schemaVersion ?? null,
    reserved: (parsed?.reservedRows ?? []).map((row) => ({
      line: row.line,
      path: row.path,
      stat: row.stat || null,
      value: row.value,
    })),
    rows,
    ...(input.path === undefined ? {} : { filter: { path: input.path } }),
    diagnostics: parsed?.diagnostics ?? [],
  }
  if (input.format !== 'human') {
    emitJson(output)
    return
  }
  if (content === null) {
    process.stdout.write(`${run.file}: no result file\n`)
    return
  }
  const table = [
    ['path', 'stat', 'value'],
    ...rows.map((row) => [row.path, row.stat ?? '', row.value]),
  ]
  const widths = [0, 1].map((index) => Math.max(...table.map((cells) => cells[index]!.length)))
  const lines = [
    lightweight
      ? run.file
      : `${run.file} (experiment_schema_version ${output.experimentSchemaVersion ?? 'missing'})`,
    ...table.map(
      (cells) => `${cells[0]!.padEnd(widths[0]!)}  ${cells[1]!.padEnd(widths[1]!)}  ${cells[2]}`,
    ),
    ...output.diagnostics.map(
      (diagnostic) =>
        `[${diagnostic.severity.toUpperCase()}] ${diagnostic.code}${diagnostic.line ? ` (line ${diagnostic.line})` : ''}: ${diagnostic.message}`,
    ),
  ]
  process.stdout.write(`${lines.join('\n')}\n`)
}
