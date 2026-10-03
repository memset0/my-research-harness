// memon run result {get, set, lint} — one Run's `result.csv` (FS v9).
//
// `get` prints the parsed rows (reserved rows separately) and the parse
// diagnostics; `lint` adds the checks that need the declaring Experiment
// (version agreement, declared types, conflicts with sibling member files)
// and, inside a Git work tree, the `RESULT_FILE_IGNORED` warning. Neither
// writes anything or is journaled. `set` upserts `(path, stat)` rows through
// core's atomic writer: every value is validated against the owner's declared
// column types before anything is written, a new file starts with the owner's
// `$experiment_schema_version` row, and a newly created file that the
// project's ignore rules exclude is still written with the
// `RESULT_FILE_IGNORED` warning — no ignore file is ever edited here.

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  checkResultFilesConsistency,
  checkResultFileTypes,
  declaredRunOwner,
  EXPERIMENT_DESCRIPTION_FILE,
  EXPERIMENTS_RELDIR,
  type ExperimentDescription,
  isResultPathWithin,
  MutationError,
  markJournalInvocationOutcome,
  parseExperimentDescription,
  parseExperimentReadme,
  parseResultFile,
  projectRunPath,
  RESULT_FILE_NAME,
  RESULT_SCHEMA_VERSION_PATH,
  type ResultPair,
  type ResultsDiagnostic,
  type RunResultAssignment,
  readMemberResultFiles,
  resolveRunReference,
  resultContentHash,
  resultFileIgnoredWarning,
  schemaUpgradeCommand,
  writeRunResult,
} from '@memon/core'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { effectiveRunDirs, runWalkOptions } from '../lib/discovery-options.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { cliIndexSink, indexWarningFields } from '../lib/index-sink.js'
import { emitJson, emitLintDiagnostics, type OutputFormat } from '../lib/output.js'
import { readStdin } from './experiment.js'

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

/** Effective Run locations, used only to name the Run location of an ignored file. */
async function runDirPatterns(projectRoot: string): Promise<string[] | undefined> {
  try {
    return (await effectiveRunDirs(projectRoot)).patterns
  } catch {
    return undefined
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
  const parsed = content === null ? null : parseResultFile(content, run.file)
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
    `${run.file} (experiment_schema_version ${output.experimentSchemaVersion ?? 'missing'})`,
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

// ---------- set ----------

export interface RunResultSetInput extends RunResultBaseInput {
  /** `<path>=<value>` or `<path>:<stat>=<value>` assignments. */
  assignments: string[]
  /** A CSV file with the three result columns, or `-` for stdin. */
  from?: string
  /** `<path>` or `<path>:<stat>` pairs to remove. */
  unset: string[]
  expectedHash?: string
}

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string }

/** `<path>[:<stat>]=<value>`: the first `=` ends the target, the first `:` ends the path. */
export function parseResultAssignment(text: string): Parsed<RunResultAssignment> {
  const equals = text.indexOf('=')
  if (equals <= 0)
    return {
      ok: false,
      message: `"${text}" is not an assignment; write <path>=<value> or <path>:<stat>=<value>`,
    }
  const pair = parseResultPair(text.slice(0, equals))
  if (!pair.ok) return pair
  return { ok: true, value: { ...pair.value, value: text.slice(equals + 1) } }
}

/** `<path>` or `<path>:<stat>`. */
export function parseResultPair(text: string): Parsed<{ path: string; stat: string | null }> {
  const colon = text.indexOf(':')
  const path = colon < 0 ? text : text.slice(0, colon)
  const stat = colon < 0 ? null : text.slice(colon + 1)
  if (path === '') return { ok: false, message: `"${text}" names no path` }
  if (stat === '') return { ok: false, message: `"${text}" has an empty statistic after ":"` }
  return { ok: true, value: { path, stat } }
}

const pairKey = (path: string, stat: string | null | undefined) => `${path}\u0000${stat ?? ''}`
const pairLabel = (path: string, stat: string | null | undefined) =>
  stat ? `${path}:${stat}` : path

async function ownerVersion(projectRoot: string, runDir: string): Promise<number | null> {
  try {
    const owner = await declaredRunOwner(projectRoot, runDir)
    if (owner === null) return null
    const raw = await readOrNull(
      join(projectRoot, EXPERIMENTS_RELDIR, owner, EXPERIMENT_DESCRIPTION_FILE),
    )
    return raw === null
      ? null
      : (parseExperimentDescription(raw).data?.experimentSchemaVersion ?? null)
  } catch {
    return null
  }
}

/** Rows of a `--from` CSV (three result columns; a version row must match the owner's). */
async function rowsFromCsv(run: ResolvedRun, source: string): Promise<RunResultAssignment[]> {
  let content: string
  if (source === '-') content = await readStdin()
  else {
    try {
      content = await fs.readFile(source, 'utf8')
    } catch (error) {
      emitErrorAndExit('BAD_REQUEST', `--from ${source}: ${(error as Error).message}`)
    }
  }
  const label = source === '-' ? '<stdin>' : source
  const parsed = parseResultFile(content, label)
  const fatal = parsed.diagnostics.filter(
    (diagnostic) =>
      diagnostic.severity === 'error' && diagnostic.code !== 'RESULT_SCHEMA_VERSION_MISSING',
  )
  if (!parsed.ok || fatal.length > 0)
    emitErrorAndExit(
      'BAD_REQUEST',
      `--from ${label} is not a valid result table: ${(fatal.length > 0 ? fatal : parsed.diagnostics).map((item) => `${item.line ? `line ${item.line}: ` : ''}${item.message}`).join('; ')}`,
      { diagnostics: parsed.diagnostics },
    )
  for (const row of parsed.reservedRows) {
    if (row.path !== RESULT_SCHEMA_VERSION_PATH)
      emitErrorAndExit('BAD_REQUEST', `--from ${label} line ${row.line}: ${row.path} is reserved`)
    const expected = await ownerVersion(run.projectRoot, run.runDir)
    if (expected !== null && row.value !== String(expected))
      emitErrorAndExit(
        'BAD_REQUEST',
        `--from ${label} records ${RESULT_SCHEMA_VERSION_PATH} ${row.value}, but the declaring Experiment is at version ${expected}; transform the input first`,
      )
  }
  return parsed.rows.map((row) => ({
    path: row.path,
    stat: row.stat === '' ? null : row.stat,
    value: row.value,
  }))
}

function exitWithWriteError(error: MutationError): never {
  const details = error.details
  if (error.reason === 'RESULT_SCHEMA_MISMATCH')
    emitErrorAndExit('RESULT_SCHEMA_MISMATCH', error.message, details)
  if (error.code === 'BAD_REQUEST' || error.code === 'FORBIDDEN')
    emitErrorAndExit('BAD_REQUEST', error.message, details)
  if (error.code === 'NOT_FOUND') emitErrorAndExit('NOT_FOUND', error.message, details)
  if (error.code === 'CONFLICT') emitErrorAndExit('CONFLICT', error.message, details)
  emitErrorAndExit(error.code === 'INTERNAL' ? 'GENERIC' : 'BAD_STATE', error.message, {
    ...(error.reason ? { reason: error.reason } : {}),
    ...details,
  })
}

export async function runRunResultSet(input: RunResultSetInput): Promise<void> {
  const assignments: RunResultAssignment[] = []
  const problems: string[] = []
  for (const text of input.assignments) {
    const parsed = parseResultAssignment(text)
    if (parsed.ok) assignments.push(parsed.value)
    else problems.push(parsed.message)
  }
  const unset: ResultPair[] = []
  for (const text of input.unset) {
    const parsed = parseResultPair(text)
    if (parsed.ok) unset.push(parsed.value)
    else problems.push(`--unset ${parsed.message}`)
  }
  if (problems.length > 0) emitErrorAndExit('BAD_REQUEST', problems.join('; '), { problems })
  if (assignments.length === 0 && unset.length === 0 && input.from === undefined)
    emitErrorAndExit(
      'BAD_REQUEST',
      'nothing to write; give <path>[:<stat>]=<value> assignments, --from <csv|-> or --unset <path>[:<stat>]',
    )
  if (input.expectedHash !== undefined && !/^[0-9a-f]{64}$/.test(input.expectedHash))
    emitErrorAndExit('BAD_REQUEST', '--expected-hash must be a sha256 hex digest (64 characters)')

  const run = await resolveRun(input)
  if (input.from !== undefined) assignments.push(...(await rowsFromCsv(run, input.from)))
  const seen = new Set<string>()
  for (const item of [...assignments, ...unset]) {
    const key = pairKey(item.path, item.stat)
    if (seen.has(key)) problems.push(`${pairLabel(item.path, item.stat)} is given more than once`)
    seen.add(key)
  }
  if (problems.length > 0) emitErrorAndExit('BAD_REQUEST', problems.join('; '), { problems })

  const runDirs = await runDirPatterns(run.projectRoot)
  let result: Awaited<ReturnType<typeof writeRunResult>>
  try {
    result = await writeRunResult({
      projectRoot: run.projectRoot,
      runDir: run.runDir,
      set: assignments,
      unset,
      ...(input.expectedHash === undefined ? {} : { expectedHash: input.expectedHash }),
      ...(runDirs ? { runDirs } : {}),
      index: cliIndexSink(run.projectRoot),
    })
  } catch (error) {
    if (error instanceof MutationError) exitWithWriteError(error)
    throw error
  }
  if (!result.changed) markJournalInvocationOutcome('noop')
  for (const warning of result.warnings) process.stderr.write(`${JSON.stringify({ warning })}\n`)
  const output = {
    ok: true,
    run: run.runPath,
    file: result.file,
    owner: result.owner,
    experimentSchemaVersion: result.experimentSchemaVersion,
    created: result.created,
    changed: result.changed,
    hash: result.hash,
    replaced: result.replaced,
    appended: result.appended,
    removed: result.removed,
    warnings: result.warnings,
    ...indexWarningFields(result),
  }
  if (input.format === 'human')
    process.stdout.write(
      `${result.changed ? (result.created ? 'created' : 'updated') : 'unchanged'} ${result.file} (${result.appended} appended, ${result.replaced} replaced, ${result.removed} removed)\nhash ${result.hash}\n${result.warnings.map((warning) => `[WARNING] ${warning.code}: ${warning.message}\n`).join('')}`,
    )
  else emitJson(output)
}

// ---------- lint ----------

async function ownerContext(
  projectRoot: string,
  runDir: string,
  file: string,
  diagnostics: ResultsDiagnostic[],
): Promise<{ owner: string; description: ExperimentDescription; runs: string[] } | null> {
  let owner: string | null
  try {
    owner = await declaredRunOwner(projectRoot, runDir)
  } catch (error) {
    diagnostics.push({
      code: 'RESULT_OWNER_AMBIGUOUS',
      severity: 'error',
      file,
      message: `${(error as Error).message}; reconcile the declarations with \`memon experiment unlink\` so exactly one Experiment declares the Run`,
    })
    return null
  }
  if (owner === null) {
    diagnostics.push({
      code: 'RESULT_OWNER_MISSING',
      severity: 'warning',
      file,
      message:
        'no Experiment declares this Run, so its values are summarized nowhere; declare it with `memon experiment link <experiment> <run>`',
    })
    return null
  }
  const folder = join(projectRoot, EXPERIMENTS_RELDIR, owner)
  const descriptionFile = `${EXPERIMENTS_RELDIR}/${owner}/${EXPERIMENT_DESCRIPTION_FILE}`
  const raw = await readOrNull(join(folder, EXPERIMENT_DESCRIPTION_FILE))
  if (raw === null) {
    diagnostics.push({
      code: 'MISSING_MANAGED_DOCUMENT',
      severity: 'warning',
      file: descriptionFile,
      message: `${descriptionFile} is missing, so declared types and the schema version cannot be checked`,
    })
    return null
  }
  const description = parseExperimentDescription(raw, descriptionFile).data
  if (!description) {
    diagnostics.push({
      code: 'INVALID_RESULTS',
      severity: 'warning',
      file: descriptionFile,
      message: `${descriptionFile} is invalid (see \`memon experiment doc lint ${owner}\`), so declared types cannot be checked`,
    })
    return null
  }
  const readme = await readOrNull(join(folder, 'README.md'))
  const runs = readme === null ? [] : [...parseExperimentReadme(readme, owner).frontMatter.runs]
  return { owner, description, runs }
}

export async function runRunResultLint(input: RunResultBaseInput): Promise<void> {
  const run = await resolveRun(input)
  const content = await readOrNull(join(run.runDir, RESULT_FILE_NAME))
  const diagnostics: ResultsDiagnostic[] = []
  if (content !== null) {
    const parsed = parseResultFile(content, run.file)
    diagnostics.push(...parsed.diagnostics)
    const context = await ownerContext(run.projectRoot, run.runDir, run.file, diagnostics)
    if (context) {
      const version = context.description.experimentSchemaVersion
      if (parsed.ok && parsed.schemaVersion !== null && parsed.schemaVersion !== version)
        diagnostics.push({
          code: 'RESULT_SCHEMA_MISMATCH',
          severity: 'error',
          file: run.file,
          message: `records experiment_schema_version ${parsed.schemaVersion}, ${context.owner} is at ${version}; run \`${schemaUpgradeCommand(context.owner, version)}\``,
        })
      if (parsed.ok) {
        diagnostics.push(
          ...checkResultFileTypes(
            parsed,
            new Map(context.description.columns.map((column) => [column.path, column])),
          ),
        )
        // Conflicts with the other member files that involve this file.
        const members = await readMemberResultFiles(run.projectRoot, context.runs)
        diagnostics.push(
          ...checkResultFilesConsistency(
            members
              .filter((member) => member.parsed.ok)
              .map((member) => ({ file: member.parsed.file, parsed: member.parsed })),
          ).filter((diagnostic) => diagnostic.message.includes(run.file)),
        )
      }
    }
    const ignored = await resultFileIgnoredWarning({
      projectRoot: run.projectRoot,
      run: run.runPath,
      ...(await runDirPatterns(run.projectRoot).then((patterns) =>
        patterns ? { runDirs: patterns } : {},
      )),
    }).catch(() => null)
    if (ignored) diagnostics.push(ignored)
  }
  emitLintDiagnostics(input.format, { run: run.runPath, file: run.file }, diagnostics)
}
