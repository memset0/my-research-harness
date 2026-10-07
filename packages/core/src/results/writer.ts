// The memon writer of per-Run result files: atomic upsert/unset of
// `(path, stat)` rows in `<runDir>/result.csv`.
//
// The Run must be declared by exactly one Experiment; that Experiment's
// `experiment.json` supplies the column types every value is validated
// against (before anything is written) and the `experiment_schema_version`
// a new file records and an existing file must record. Only the targeted rows
// change; the file is replaced atomically, one derived-index event is
// published, and a newly created file that the project's ignore rules
// exclude is still written with a `RESULT_FILE_IGNORED` warning — no ignore
// file is ever edited here.

import { join } from '@memon/file-protocol/paths'
import {
  type FileChange,
  type IndexWarnings,
  indexEventWarnings,
  type MutationBase,
  MutationError,
  nodeMutationFs,
  replaceDocumentAtomic,
} from '../experiments/mutations.js'
import { declaredRunOwner, projectRunPath } from '../experiments/run-path.js'
import { projectFs as nodeFs } from '../project-file-store.js'
import { EXPERIMENT_DESCRIPTION_FILE, parseExperimentDescription } from './description.js'
import type { ResultsDiagnostic } from './diagnostics.js'
import { type CheckIgnore, resolveRunRealPath, resultFileIgnoredWarning } from './ignore.js'
import { isReservedResultPath, resultPathError } from './paths.js'
import {
  editResultFileContent,
  encodeResultValue,
  interpretResultText,
  parseResultNumber,
  RESULT_FILE_NAME,
  ResultFileEditError,
  type ResultFileRowInput,
  type ResultPair,
  type ResultValue,
  resultContentHash,
} from './result-file.js'
import { schemaUpgradeCommand } from './summary.js'
import { parseStatKey } from './vocabulary.js'

export interface RunResultAssignment {
  path: string
  /** Empty or omitted for a scalar; a vocabulary statistic for a `stats` value. */
  stat?: string | null
  /** A string is the cell text; other values are encoded (`null` = explicitly missing). */
  value: ResultValue
}

export interface WriteRunResultInput extends Partial<MutationBase> {
  projectRoot: string
  /** Absolute Run directory. */
  runDir: string
  set?: readonly RunResultAssignment[]
  unset?: readonly ResultPair[]
  /** sha256 of the current file content; a mismatch writes nothing (`CONFLICT`). */
  expectedHash?: string
  /** Effective `run_dirs`, used to name the Run location in `RESULT_FILE_IGNORED`. */
  runDirs?: readonly string[]
  /** Check a newly created file with `git check-ignore` (default true). */
  checkIgnore?: boolean
  /** Injected `git check-ignore` (tests). */
  gitCheckIgnore?: CheckIgnore
}

export interface WriteRunResultResult extends IndexWarnings {
  /** Project-relative result file. */
  file: string
  /** Declaring Experiment. */
  owner: string
  experimentSchemaVersion: number
  created: boolean
  changed: boolean
  /** sha256 of the content now on disk. */
  hash: string
  content: string
  replaced: number
  appended: number
  removed: number
  changes: FileChange[]
  /** `RESULT_FILE_IGNORED` when a created file is excluded by the ignore rules. */
  warnings: ResultsDiagnostic[]
}

function invalid(problems: string[]): MutationError {
  return new MutationError('BAD_REQUEST', `invalid result values: ${problems.join('; ')}`, {
    reason: 'RESULT_VALUE_INVALID',
    details: { problems },
  })
}

/** Validate assignments against the declared columns and turn them into cell rows. */
function validatedRows(
  assignments: readonly RunResultAssignment[],
  columns: ReadonlyMap<
    string,
    { type: string; options?: Array<string | number | boolean>; over?: string }
  >,
): ResultFileRowInput[] {
  const problems: string[] = []
  const rows: ResultFileRowInput[] = []
  for (const assignment of assignments) {
    const stat = assignment.stat ?? ''
    const label = `${assignment.path}${stat ? `:${stat}` : ''}`
    if (isReservedResultPath(assignment.path)) {
      problems.push(`${label}: paths beginning with "$" are reserved for memon`)
      continue
    }
    const pathError = resultPathError(assignment.path)
    if (pathError !== null) {
      problems.push(`${label}: ${pathError}`)
      continue
    }
    let text: string
    try {
      text =
        typeof assignment.value === 'string'
          ? assignment.value
          : encodeResultValue(assignment.value)
    } catch (error) {
      problems.push(`${label}: ${(error as Error).message}`)
      continue
    }
    if (/[\r\n]/.test(text) && Array.isArray(assignment.value)) {
      problems.push(`${label}: a list must be written on one line`)
      continue
    }
    const column = columns.get(assignment.path)
    if (stat !== '') {
      const key = parseStatKey(stat)
      if (!key) {
        problems.push(`${label}: "${stat}" is not a vocabulary statistic`)
        continue
      }
      if (column && column.type !== 'stats') {
        problems.push(`${label}: ${assignment.path} is declared ${column.type}, not stats`)
        continue
      }
      if (column && (key.outer !== null) !== (column.over !== undefined)) {
        problems.push(
          column.over !== undefined
            ? `${label}: ${assignment.path} declares over: ${column.over}; write <inner>.<outer>`
            : `${label}: ${assignment.path} declares no outer dimension; write a one-level statistic`,
        )
        continue
      }
      if (text !== '' && parseResultNumber(text) === null) {
        problems.push(`${label}: statistics are numbers, found "${text}"`)
        continue
      }
    } else if (column) {
      if (column.type === 'stats') {
        problems.push(`${label}: ${assignment.path} is declared stats; set <path>:<stat>=<value>`)
        continue
      }
      const read = interpretResultText(text, column.type as never, column.options)
      if (!read.ok) {
        problems.push(`${label}: ${read.message} (declared ${column.type})`)
        continue
      }
    }
    rows.push({ path: assignment.path, stat, value: text })
  }
  if (problems.length > 0) throw invalid(problems)
  return rows
}

/** Upsert and unset rows of one Run's `result.csv` (see the module comment). */
export async function writeRunResult(input: WriteRunResultInput): Promise<WriteRunResultResult> {
  const fs = input.fs ?? nodeMutationFs
  const base: MutationBase = {
    fs,
    ...(input.now ? { now: input.now } : {}),
    ...(input.index ? { index: input.index } : {}),
  }
  const runPath = projectRunPath(input.projectRoot, input.runDir)
  try {
    if (!(await fs.stat(input.runDir))) throw new Error('missing')
  } catch {
    throw new MutationError('NOT_FOUND', `Run directory ${runPath} does not exist`, {
      reason: 'MISSING_DOCUMENT',
      details: { path: runPath },
    })
  }
  // A Run reached through a symbolic link is written at its real location,
  // which must stay inside the project.
  const realRoot = await nodeFs.realpath(input.projectRoot).catch(() => null)
  const realRun = realRoot === null ? null : await resolveRunRealPath(realRoot, runPath)
  if (realRun?.kind === 'outside')
    throw new MutationError(
      'BAD_STATE',
      `${runPath} resolves through a symbolic link to ${realRun.target}, outside the project root; result files are only written inside the project`,
      { reason: 'RUN_PATH_OUTSIDE_PROJECT', details: { run: runPath } },
    )
  let owner: string | null
  try {
    owner = await declaredRunOwner(input.projectRoot, input.runDir)
  } catch (error) {
    throw new MutationError(
      'BAD_STATE',
      `${runPath} is declared by more than one Experiment; reconcile the declarations with \`memon experiment unlink\` first (${(error as Error).message})`,
      { reason: 'RESULT_OWNER_AMBIGUOUS', details: { run: runPath } },
    )
  }
  if (owner === null)
    throw new MutationError(
      'BAD_STATE',
      `${runPath} is declared by no Experiment; declare it with \`memon experiment link <experiment> ${runPath}\` before recording results`,
      { reason: 'RESULT_OWNER_MISSING', details: { run: runPath } },
    )
  const descriptionPath = join(
    input.projectRoot,
    'docs',
    'experiments',
    owner,
    EXPERIMENT_DESCRIPTION_FILE,
  )
  let descriptionRaw: string
  try {
    descriptionRaw = await fs.readFile(descriptionPath, 'utf8')
  } catch {
    throw new MutationError(
      'NOT_FOUND',
      `docs/experiments/${owner}/${EXPERIMENT_DESCRIPTION_FILE} does not exist; migrate the project to FS v9 (or create the description file) before recording results`,
      {
        reason: 'MISSING_DOCUMENT',
        details: { path: `docs/experiments/${owner}/${EXPERIMENT_DESCRIPTION_FILE}` },
      },
    )
  }
  const description = parseExperimentDescription(descriptionRaw).data
  if (!description)
    throw new MutationError(
      'BAD_STATE',
      `docs/experiments/${owner}/${EXPERIMENT_DESCRIPTION_FILE} is invalid; fix it (memon experiment doc lint ${owner}) before recording results`,
      { reason: 'INVALID_RESULTS', details: { experiment: owner } },
    )
  const version = description.experimentSchemaVersion
  const rows = validatedRows(
    input.set ?? [],
    new Map(description.columns.map((column) => [column.path, column])),
  )
  const unset = (input.unset ?? []).map((pair) => ({ path: pair.path, stat: pair.stat ?? '' }))

  const path = join(input.runDir, RESULT_FILE_NAME)
  const file = `${runPath}/${RESULT_FILE_NAME}`
  let before: string | null
  try {
    before = await fs.readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    before = null
  }
  if (input.expectedHash !== undefined) {
    const current = before === null ? null : resultContentHash(before)
    if (current !== input.expectedHash)
      throw new MutationError(
        'CONFLICT',
        before === null
          ? `${file} does not exist although an expected hash was given`
          : `${file} changed since it was read (content hash differs from the expected hash)`,
        { reason: 'STALE_LOCK', details: { stale: 'hash', currentHash: current } },
      )
  }
  let edit: ReturnType<typeof editResultFileContent>
  try {
    edit = editResultFileContent(before, { schemaVersion: version, set: rows, unset })
  } catch (error) {
    if (!(error instanceof ResultFileEditError)) throw error
    if (error.code === 'RESULT_SCHEMA_MISMATCH') {
      const command = schemaUpgradeCommand(owner, version)
      throw new MutationError(
        'BAD_STATE',
        `RESULT_SCHEMA_MISMATCH: ${file} records experiment_schema_version ${String(error.details.recorded ?? 'none')} but ${owner} is at ${version}; run \`${command}\``,
        {
          reason: 'RESULT_SCHEMA_MISMATCH',
          details: {
            file,
            recorded: error.details.recorded ?? null,
            expected: version,
            upgradeCommand: command,
          },
        },
      )
    }
    if (error.code === 'BAD_REQUEST') throw invalid([error.message])
    throw new MutationError('BAD_STATE', `${error.code}: ${file}: ${error.message}`, {
      reason:
        error.code === 'RESULT_DUPLICATE_ROW' ? 'RESULT_DUPLICATE_ROW' : 'RESULT_FILE_INVALID',
      details: { file, ...error.details },
    })
  }
  const result: WriteRunResultResult = {
    file,
    owner,
    experimentSchemaVersion: version,
    created: false,
    changed: false,
    hash: before === null ? resultContentHash('') : resultContentHash(before),
    content: before ?? '',
    replaced: 0,
    appended: 0,
    removed: 0,
    changes: [],
    warnings: [],
  }
  if (!edit.changed || (before === null && rows.length === 0)) return result
  await replaceDocumentAtomic(fs, path, edit.content)
  const changes: FileChange[] = [{ path, before, after: edit.content }]
  const warnings: ResultsDiagnostic[] = []
  if (edit.created && input.checkIgnore !== false) {
    const ignored = await resultFileIgnoredWarning({
      projectRoot: input.projectRoot,
      run: runPath,
      ...(input.runDirs ? { runDirs: input.runDirs } : {}),
      ...(input.gitCheckIgnore ? { checkIgnore: input.gitCheckIgnore } : {}),
    }).catch(() => null)
    if (ignored) warnings.push(ignored)
  }
  return {
    ...result,
    created: edit.created,
    changed: true,
    hash: resultContentHash(edit.content),
    content: edit.content,
    replaced: edit.replaced,
    appended: edit.appended,
    removed: edit.removed,
    changes,
    warnings,
    ...(await indexEventWarnings(base, 'run.result', changes)),
  }
}
