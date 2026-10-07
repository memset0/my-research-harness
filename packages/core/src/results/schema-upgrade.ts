// Experiment result-schema upgrades (FS v9).
//
// `experiment_schema_version` versions one Experiment's recorded result
// values. An upgrade from N to N+1 is one file in the Experiment's
// `schema-upgrades/` directory:
//
//   <N>-to-<N+1>.json   declarative: rename / move / scale / delete / default
//   <N>-to-<N+1>.py     python3 <script> <input.csv> <output.csv>
//
// `planSchemaUpgrade` reads the description file and every member result
// file, applies the consecutive steps in memory and returns per-file
// before/after content and row differences (a dry run writes nothing).
// `applySchemaUpgrade` refuses while a member Run is RUNNING, backs up every
// file it changes under `.memon/backups/schema-upgrade/`, replaces each file
// atomically after re-checking that nobody changed it since the plan,
// verifies the result and restores every file from the backup on any
// failure.

import { spawn } from 'node:child_process'
import { promises as nodeFs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from '@memon/file-protocol/paths'
import { z } from 'zod'
import { atomicTempPath } from '../atomic-write.js'
import {
  type PersistedFingerprint,
  sameFingerprint,
  takeFingerprint,
} from '../derived-index/fingerprint.js'
import { MutationError } from '../experiments/mutations.js'
import { formatIsoLocal } from '../time.js'
import {
  type DescriptionFrozenValue,
  EXPERIMENT_DESCRIPTION_FILE,
  type ExperimentDescription,
  parseExperimentDescription,
  SCHEMA_UPGRADES_DIRECTORY,
  serializeExperimentDescription,
} from './description.js'
import {
  isResultPathWithin,
  replaceResultPathPrefix,
  resultGroupPathError,
  resultPathError,
} from './paths.js'
import {
  encodeResultValue,
  parseResultFile,
  parseResultNumber,
  RESULT_FILE_NAME,
  type ResultFileRowInput,
  type ResultValue,
  readInferredResultValue,
  resultContentHash,
  serializeResultFile,
} from './result-file.js'
import {
  generateResultsSummaryFromDisk,
  readResultsSummaryInputSet,
  summaryRunRecord,
  takeResultsInputFingerprints,
} from './summary-cache.js'
import { parseStatKey, type StatName } from './vocabulary.js'

export const SCHEMA_UPGRADE_BACKUP_RELDIR = '.memon/backups/schema-upgrade'

// ---------- declarative transforms ----------

const ValuePath = z.string().superRefine((path, context) => {
  const error = resultPathError(path)
  if (error !== null) context.addIssue({ code: z.ZodIssueCode.custom, message: error })
})
const GroupPath = z.string().superRefine((path, context) => {
  const error = resultGroupPathError(path)
  if (error !== null) context.addIssue({ code: z.ZodIssueCode.custom, message: error })
})

const OperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('rename'), from: ValuePath, to: ValuePath }).strict(),
  z.object({ op: z.literal('move'), from: GroupPath, to: GroupPath }).strict(),
  z
    .object({
      op: z.literal('scale'),
      path: ValuePath,
      factor: z.number().finite().positive(),
      offset: z.number().finite().optional(),
      unit: z.string().min(1).optional(),
    })
    .strict(),
  z.object({ op: z.literal('delete'), path: GroupPath }).strict(),
  z
    .object({
      op: z.literal('default'),
      path: ValuePath,
      stat: z.string().nullable().optional(),
      value: z.union([
        z.string(),
        z.number().finite(),
        z.boolean(),
        z.null(),
        z.array(z.unknown()),
      ]),
    })
    .strict(),
])

const TransformSchema = z
  .object({
    from: z.number().int().positive(),
    to: z.number().int().positive(),
    operations: z.array(OperationSchema),
  })
  .strict()

export type SchemaUpgradeOperation = z.infer<typeof OperationSchema>
export type SchemaUpgradeTransform = z.infer<typeof TransformSchema>

/** Parse a declarative transform file; throws `BAD_REQUEST` with the problem. */
export function parseSchemaUpgradeTransform(content: string, file: string): SchemaUpgradeTransform {
  let loaded: unknown
  try {
    loaded = JSON.parse(content)
  } catch (error) {
    throw new MutationError(
      'BAD_REQUEST',
      `${file} is not valid JSON: ${(error as Error).message}`,
      {
        reason: 'SCHEMA_UPGRADE_INVALID',
        details: { file },
      },
    )
  }
  const parsed = TransformSchema.safeParse(loaded)
  if (!parsed.success)
    throw new MutationError(
      'BAD_REQUEST',
      `${file} is not a valid schema upgrade: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ')}`,
      { reason: 'SCHEMA_UPGRADE_INVALID', details: { file } },
    )
  for (const operation of parsed.data.operations)
    if (operation.op === 'default' && operation.stat && parseStatKey(operation.stat) === null)
      throw new MutationError(
        'BAD_REQUEST',
        `${file}: default ${operation.path}: "${operation.stat}" is not a vocabulary statistic`,
        { reason: 'SCHEMA_UPGRADE_INVALID', details: { file } },
      )
  if (parsed.data.to !== parsed.data.from + 1)
    throw new MutationError(
      'BAD_REQUEST',
      `${file}: a step upgrades exactly one version (from N to N+1)`,
      {
        reason: 'SCHEMA_UPGRADE_INVALID',
        details: { file },
      },
    )
  return parsed.data
}

/** One row of a result table during a transform. */
export interface UpgradeRow {
  path: string
  /** Empty for a scalar. */
  stat: string
  /** Cell text. */
  value: string
  /** Index of the input row this row derives from (null for an added row). */
  origin: number | null
}

type StatClass = 'location' | 'spread' | 'variance' | 'sum' | 'count'

function statClass(stat: StatName): StatClass {
  if (stat === 'std' || stat === 'sem') return 'spread'
  if (stat === 'var') return 'variance'
  if (stat === 'sum') return 'sum'
  if (stat === 'n') return 'count'
  return 'location'
}

/** The affine map `x → alpha·x + beta` a statistic of class `cls` undergoes under `x → a·x + b`. */
function affine(
  cls: StatClass,
  a: number,
  b: number,
  count: number | null,
): [number, number] | null {
  switch (cls) {
    case 'location':
      return [a, b]
    case 'spread':
      return [Math.abs(a), 0]
    case 'variance':
      return [a * a, 0]
    case 'count':
      return [1, 0]
    case 'sum':
      if (b === 0) return [a, 0]
      return count === null ? null : [a, b * count]
  }
}

function round(value: number): number {
  return Number(value.toPrecision(15))
}

/**
 * Scale one statistic (or a scalar when `stat` is empty) under `x → factor·x
 * + offset`. Returns null when the statistic cannot be transformed exactly
 * (a sum with an offset and no count).
 */
export function scaleResultStatistic(
  stat: string,
  value: number,
  factor: number,
  offset: number,
  count: number | null = null,
): number | null {
  if (stat === '') return round(value * factor + offset)
  const key = parseStatKey(stat)
  if (!key) return null
  const inner = affine(statClass(key.inner), factor, offset, key.outer === null ? count : null)
  if (!inner) return null
  if (key.outer === null) return round(value * inner[0] + inner[1])
  const outer = affine(statClass(key.outer), inner[0], inner[1], null)
  return outer ? round(value * outer[0] + outer[1]) : null
}

/** Apply declarative operations to the rows of one result table. */
export function applyUpgradeOperations(
  rows: readonly UpgradeRow[],
  operations: readonly SchemaUpgradeOperation[],
  file: string,
): { rows: UpgradeRow[]; warnings: string[] } {
  let current = rows.map((row) => ({ ...row }))
  const warnings: string[] = []
  for (const operation of operations) {
    switch (operation.op) {
      case 'rename':
        current = current.map((row) =>
          row.path === operation.from ? { ...row, path: operation.to } : row,
        )
        break
      case 'move':
        current = current.map((row) => ({
          ...row,
          path: replaceResultPathPrefix(row.path, operation.from, operation.to),
        }))
        break
      case 'delete':
        current = current.filter((row) => !isResultPathWithin(row.path, operation.path))
        break
      case 'default': {
        const stat = operation.stat ?? ''
        if (!current.some((row) => row.path === operation.path && row.stat === stat))
          current.push({
            path: operation.path,
            stat,
            value: encodeResultValue(operation.value as ResultValue),
            origin: null,
          })
        break
      }
      case 'scale': {
        const countRow = current.find((row) => row.path === operation.path && row.stat === 'n')
        const count = countRow ? parseResultNumber(countRow.value) : null
        current = current.map((row) => {
          if (row.path !== operation.path || row.value === '') return row
          const number = parseResultNumber(row.value)
          if (number === null) {
            warnings.push(
              `${file}: ${row.path}${row.stat ? `:${row.stat}` : ''} is not a number and was not scaled`,
            )
            return row
          }
          const scaled = scaleResultStatistic(
            row.stat,
            number,
            operation.factor,
            operation.offset ?? 0,
            count,
          )
          if (scaled === null)
            throw new MutationError(
              'BAD_REQUEST',
              `${file}: ${row.path}:${row.stat} cannot be scaled with an offset without an n statistic`,
              { reason: 'SCHEMA_UPGRADE_INVALID', details: { file } },
            )
          return { ...row, value: encodeResultValue(scaled) }
        })
        break
      }
    }
  }
  return { rows: current, warnings }
}

function frozenRows(values: readonly DescriptionFrozenValue[]): UpgradeRow[] {
  return values.map((entry, index) => ({
    path: entry.path,
    stat: entry.stat ?? '',
    value: encodeResultValue(entry.value),
    origin: index,
  }))
}

function frozenValues(rows: readonly UpgradeRow[]): DescriptionFrozenValue[] {
  return rows.map((row) => ({
    path: row.path,
    stat: row.stat === '' ? null : row.stat,
    value:
      row.stat === ''
        ? readInferredResultValue(row.value, inferType(row.value))
        : row.value === ''
          ? null
          : parseResultNumber(row.value),
  }))
}

function inferType(text: string): 'number' | 'boolean' | 'list' | 'string' {
  if (parseResultNumber(text) !== null) return 'number'
  if (text === 'true' || text === 'false') return 'boolean'
  if (text.startsWith('[')) {
    try {
      if (Array.isArray(JSON.parse(text))) return 'list'
    } catch {}
  }
  return 'string'
}

function plannedRows(values: Record<string, ResultValue>): UpgradeRow[] {
  return Object.entries(values).map(([path, value], index) => ({
    path,
    stat: '',
    value: encodeResultValue(value),
    origin: index,
  }))
}

function plannedValues(
  rows: readonly UpgradeRow[],
  previous: Record<string, ResultValue>,
): Record<string, ResultValue> {
  const out: Record<string, ResultValue> = {}
  const before = Object.values(previous)
  for (const row of rows) {
    if (row.stat !== '') continue
    const original = row.origin === null ? undefined : before[row.origin]
    // Keep the original JSON value when only the path changed.
    out[row.path] =
      original !== undefined && encodeResultValue(original) === row.value
        ? original
        : readInferredResultValue(row.value, inferType(row.value))
  }
  return out
}

/** Apply declarative operations to the description file (paths, planned and frozen values). */
export function applyUpgradeOperationsToDescription(
  description: ExperimentDescription,
  operations: readonly SchemaUpgradeOperation[],
  toVersion: number,
): { description: ExperimentDescription; warnings: string[] } {
  const next: ExperimentDescription = structuredClone(description)
  const warnings: string[] = []
  for (const operation of operations) {
    if (operation.op === 'rename' || operation.op === 'move') {
      const map = (path: string) =>
        operation.op === 'rename'
          ? path === operation.from
            ? operation.to
            : path
          : replaceResultPathPrefix(path, operation.from, operation.to)
      for (const column of next.columns) column.path = map(column.path)
      if (operation.op === 'move') {
        next.groups = Object.fromEntries(
          Object.entries(next.groups).map(([path, group]) => [map(path), group]),
        )
      }
    }
    if (operation.op === 'delete') {
      next.columns = next.columns.filter(
        (column) => !isResultPathWithin(column.path, operation.path),
      )
      next.groups = Object.fromEntries(
        Object.entries(next.groups).filter(([path]) => !isResultPathWithin(path, operation.path)),
      )
    }
    if (operation.op === 'scale' && operation.unit !== undefined)
      for (const column of next.columns)
        if (column.path === operation.path) column.unit = operation.unit
  }
  for (const variant of next.variants) {
    const planned = applyUpgradeOperations(
      plannedRows(variant.values),
      operations.filter((operation) => operation.op !== 'default'),
      `${EXPERIMENT_DESCRIPTION_FILE} ${variant.id}.values`,
    )
    warnings.push(...planned.warnings)
    variant.values = plannedValues(planned.rows, variant.values)
    if (variant.frozen) {
      const frozen = applyUpgradeOperations(
        frozenRows(variant.frozen.values),
        operations,
        `${EXPERIMENT_DESCRIPTION_FILE} ${variant.id}.frozen`,
      )
      warnings.push(...frozen.warnings)
      variant.frozen.values = frozenValues(frozen.rows)
    }
  }
  next.experimentSchemaVersion = toVersion
  return { description: next, warnings }
}

// ---------- steps ----------

export interface SchemaUpgradeStep {
  from: number
  to: number
  kind: 'json' | 'python'
  /** Project-relative transform file. */
  file: string
  transform?: SchemaUpgradeTransform
}

const STEP_FILE = /^(\d+)-to-(\d+)\.(json|py)$/

/** The steps in `<experiment>/schema-upgrades/`, keyed by their `from` version. */
export async function readSchemaUpgradeSteps(
  projectRoot: string,
  experimentDir: string,
): Promise<Map<number, SchemaUpgradeStep>> {
  const directory = join(projectRoot, ...experimentDir.split('/'), SCHEMA_UPGRADES_DIRECTORY)
  let names: string[]
  try {
    names = await nodeFs.readdir(directory)
  } catch {
    return new Map()
  }
  const steps = new Map<number, SchemaUpgradeStep>()
  for (const name of names.sort()) {
    const match = STEP_FILE.exec(name)
    if (!match) continue
    const from = Number(match[1])
    const to = Number(match[2])
    const file = `${experimentDir}/${SCHEMA_UPGRADES_DIRECTORY}/${name}`
    if (to !== from + 1)
      throw new MutationError(
        'BAD_REQUEST',
        `${file}: a step upgrades exactly one version (N-to-N+1)`,
        {
          reason: 'SCHEMA_UPGRADE_INVALID',
          details: { file },
        },
      )
    if (steps.has(from))
      throw new MutationError(
        'BAD_REQUEST',
        `two transforms for step ${from}-to-${to}: ${steps.get(from)!.file} and ${file}; keep exactly one`,
        { reason: 'SCHEMA_UPGRADE_INVALID', details: { file } },
      )
    const kind = match[3] === 'json' ? 'json' : 'python'
    const step: SchemaUpgradeStep = { from, to, kind, file }
    if (kind === 'json') {
      const transform = parseSchemaUpgradeTransform(
        await nodeFs.readFile(join(directory, name), 'utf8'),
        file,
      )
      if (transform.from !== from || transform.to !== to)
        throw new MutationError(
          'BAD_REQUEST',
          `${file} declares from ${transform.from} to ${transform.to}; the file name says ${from}-to-${to}`,
          { reason: 'SCHEMA_UPGRADE_INVALID', details: { file } },
        )
      step.transform = transform
    }
    steps.set(from, step)
  }
  return steps
}

/** The consecutive steps from `from` to `to`; `BAD_REQUEST` naming the first missing step. */
export function resolveUpgradeChain(
  steps: ReadonlyMap<number, SchemaUpgradeStep>,
  from: number,
  to: number,
): SchemaUpgradeStep[] {
  const chain: SchemaUpgradeStep[] = []
  for (let version = from; version < to; version += 1) {
    const step = steps.get(version)
    if (!step)
      throw new MutationError(
        'BAD_REQUEST',
        `missing schema upgrade step ${version}-to-${version + 1} (add schema-upgrades/${version}-to-${version + 1}.json or .py)`,
        { reason: 'SCHEMA_UPGRADE_STEP_MISSING', details: { from: version, to: version + 1 } },
      )
    chain.push(step)
  }
  return chain
}

// ---------- Python transforms ----------

export type PythonTransformRunner = (input: {
  script: string
  inputFile: string
  outputFile: string
  from: number
  to: number
}) => Promise<void>

/** Run `python3 <script> <input.csv> <output.csv>` with MEMON_SCHEMA_FROM/TO in a scratch cwd. */
export function pythonTransformRunner(python = 'python3'): PythonTransformRunner {
  return ({ script, inputFile, outputFile, from, to }) =>
    new Promise((resolve, reject) => {
      const child = spawn(python, [script, inputFile, outputFile], {
        cwd: dirname(inputFile),
        env: { ...process.env, MEMON_SCHEMA_FROM: String(from), MEMON_SCHEMA_TO: String(to) },
        windowsHide: true,
      })
      const stderr: Buffer[] = []
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
      child.stdout.resume()
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) resolve()
        else
          reject(
            new Error(
              `${script} exited ${code}: ${Buffer.concat(stderr).toString('utf8').trim().slice(0, 2000)}`,
            ),
          )
      })
    })
}

async function runPythonStep(
  projectRoot: string,
  step: SchemaUpgradeStep,
  rows: readonly UpgradeRow[],
  runner: PythonTransformRunner,
  label: string,
): Promise<UpgradeRow[]> {
  const scratch = await nodeFs.mkdtemp(join(tmpdir(), 'memon-schema-upgrade-'))
  try {
    const inputFile = join(scratch, 'input.csv')
    const outputFile = join(scratch, 'output.csv')
    await nodeFs.writeFile(inputFile, serializeResultFile(step.from, rows))
    try {
      await runner({
        script: join(projectRoot, ...step.file.split('/')),
        inputFile,
        outputFile,
        from: step.from,
        to: step.to,
      })
    } catch (error) {
      throw new MutationError(
        'BAD_REQUEST',
        `${step.file} failed on ${label}: ${(error as Error).message}`,
        {
          reason: 'SCHEMA_UPGRADE_INVALID',
          details: { file: step.file },
        },
      )
    }
    let output: string
    try {
      output = await nodeFs.readFile(outputFile, 'utf8')
    } catch {
      throw new MutationError('BAD_REQUEST', `${step.file} wrote no output table for ${label}`, {
        reason: 'SCHEMA_UPGRADE_INVALID',
        details: { file: step.file },
      })
    }
    const parsed = parseResultFile(output, `${step.file} output for ${label}`)
    if (!parsed.ok)
      throw new MutationError(
        'BAD_REQUEST',
        `${step.file} wrote an unreadable table for ${label}: ${parsed.diagnostics.map((item) => item.message).join('; ')}`,
        { reason: 'SCHEMA_UPGRADE_INVALID', details: { file: step.file } },
      )
    return parsed.rows.map((row) => ({
      path: row.path,
      stat: row.stat,
      value: row.value,
      origin: null,
    }))
  } finally {
    await nodeFs.rm(scratch, { recursive: true, force: true })
  }
}

// ---------- planning ----------

export interface SchemaUpgradeRowDiff {
  change: 'added' | 'removed' | 'changed'
  path: string
  stat: string | null
  before?: string
  after?: string
}

export interface SchemaUpgradeFilePlan {
  /** Project-relative file. */
  path: string
  kind: 'result' | 'description'
  /** Version the file records before the upgrade. */
  from: number
  to: number
  before: string
  after: string
  changed: boolean
  /** Fingerprint and hash at planning time (rechecked before the replacement). */
  fingerprint: PersistedFingerprint | null
  hash: string
  rows: SchemaUpgradeRowDiff[]
  /** Problems the transformed file will have (e.g. duplicate pairs); apply then fails verification. */
  problems: string[]
}

export interface SchemaUpgradePlan {
  experimentId: string
  experimentDir: string
  to: number
  steps: Array<Omit<SchemaUpgradeStep, 'transform'>>
  files: SchemaUpgradeFilePlan[]
  /** Member Runs without a result file. */
  skipped: string[]
  warnings: string[]
}

export interface PlanSchemaUpgradeOptions {
  /** Python transform runner (default `python3`). */
  python?: PythonTransformRunner
}

function rowsOf(content: string): UpgradeRow[] {
  return parseResultFile(content).rows.map((row, index) => ({
    path: row.path,
    stat: row.stat,
    value: row.value,
    origin: index,
  }))
}

function diffRows(before: readonly UpgradeRow[], after: readonly UpgradeRow[], identity: boolean) {
  const diff: SchemaUpgradeRowDiff[] = []
  const stat = (row: UpgradeRow) => (row.stat === '' ? null : row.stat)
  if (identity) {
    const seen = new Set<number>()
    for (const row of after) {
      if (row.origin === null) {
        diff.push({ change: 'added', path: row.path, stat: stat(row), after: row.value })
        continue
      }
      seen.add(row.origin)
      const original = before[row.origin]!
      if (original.path !== row.path || original.stat !== row.stat || original.value !== row.value)
        diff.push({
          change: 'changed',
          path: row.path,
          stat: stat(row),
          before: `${original.path}${original.stat ? `:${original.stat}` : ''}=${original.value}`,
          after: `${row.path}${row.stat ? `:${row.stat}` : ''}=${row.value}`,
        })
    }
    before.forEach((row, index) => {
      if (!seen.has(index))
        diff.push({ change: 'removed', path: row.path, stat: stat(row), before: row.value })
    })
    return diff
  }
  const key = (row: UpgradeRow) => `${row.path}\u0000${row.stat}`
  const beforeMap = new Map(before.map((row) => [key(row), row]))
  const afterMap = new Map(after.map((row) => [key(row), row]))
  for (const row of after) {
    const original = beforeMap.get(key(row))
    if (!original) diff.push({ change: 'added', path: row.path, stat: stat(row), after: row.value })
    else if (original.value !== row.value)
      diff.push({
        change: 'changed',
        path: row.path,
        stat: stat(row),
        before: original.value,
        after: row.value,
      })
  }
  for (const row of before)
    if (!afterMap.has(key(row)))
      diff.push({ change: 'removed', path: row.path, stat: stat(row), before: row.value })
  return diff
}

function problemsOf(content: string): string[] {
  return parseResultFile(content).duplicates.map(
    (duplicate) =>
      `duplicate (${duplicate.path}, ${duplicate.stat || '<empty>'}) on lines ${duplicate.lines.join(', ')}`,
  )
}

/**
 * Plan an upgrade of `experimentId` to version `to` without writing anything:
 * every member result file and the description file are transformed from the
 * version they record. `BAD_REQUEST` for a missing step, a file ahead of `to`
 * or a file that records no version.
 */
export async function planSchemaUpgrade(
  projectRoot: string,
  experimentId: string,
  to: number,
  options: PlanSchemaUpgradeOptions = {},
): Promise<SchemaUpgradePlan> {
  const set = await readResultsSummaryInputSet(projectRoot, experimentId)
  if (!set)
    throw new MutationError('NOT_FOUND', `Experiment ${experimentId} does not exist`, {
      reason: 'MISSING_DOCUMENT',
      details: { experiment: experimentId },
    })
  const descriptionPath = join(projectRoot, ...set.descriptionKey.split('/'))
  let descriptionRaw: string
  try {
    descriptionRaw = await nodeFs.readFile(descriptionPath, 'utf8')
  } catch {
    throw new MutationError('NOT_FOUND', `${set.descriptionKey} does not exist`, {
      reason: 'MISSING_DOCUMENT',
      details: { path: set.descriptionKey },
    })
  }
  const description = parseExperimentDescription(descriptionRaw, set.descriptionKey).data
  if (!description)
    throw new MutationError(
      'BAD_STATE',
      `${set.descriptionKey} is invalid; fix it before upgrading`,
      {
        reason: 'INVALID_RESULTS',
        details: { path: set.descriptionKey },
      },
    )
  if (!Number.isInteger(to) || to < 1)
    throw new MutationError('BAD_REQUEST', `--to must be a positive integer, got ${to}`, {
      reason: 'SCHEMA_UPGRADE_INVALID',
    })
  const steps = await readSchemaUpgradeSteps(projectRoot, set.experimentDir)
  const runner = options.python ?? pythonTransformRunner()
  const plan: SchemaUpgradePlan = {
    experimentId,
    experimentDir: set.experimentDir,
    to,
    steps: [],
    files: [],
    skipped: [],
    warnings: [],
  }
  const used = new Map<string, Omit<SchemaUpgradeStep, 'transform'>>()
  const useChain = (from: number) => {
    const chain = resolveUpgradeChain(steps, from, to)
    for (const step of chain) {
      const { transform: _transform, ...rest } = step
      used.set(step.file, rest)
    }
    return chain
  }

  // Description file.
  const current = description.experimentSchemaVersion
  if (current > to)
    throw new MutationError(
      'BAD_REQUEST',
      `${set.descriptionKey} is already at version ${current}; an upgrade cannot go back to ${to}`,
      { reason: 'SCHEMA_UPGRADE_INVALID' },
    )
  let descriptionAfter = descriptionRaw
  let descriptionDiff: SchemaUpgradeRowDiff[] = []
  if (current < to) {
    let next = description
    for (const step of useChain(current)) {
      if (step.kind === 'json') {
        const applied = applyUpgradeOperationsToDescription(
          next,
          step.transform!.operations,
          step.to,
        )
        next = applied.description
        plan.warnings.push(...applied.warnings)
      } else {
        next = structuredClone(next)
        for (const variant of next.variants) {
          if (Object.keys(variant.values).length > 0) {
            const rows = await runPythonStep(
              projectRoot,
              step,
              plannedRows(variant.values),
              runner,
              `${variant.id} planned values`,
            )
            variant.values = plannedValues(rows, {})
          }
          if (variant.frozen && variant.frozen.values.length > 0) {
            const rows = await runPythonStep(
              projectRoot,
              step,
              frozenRows(variant.frozen.values),
              runner,
              `${variant.id} frozen values`,
            )
            variant.frozen.values = frozenValues(rows)
          }
        }
        next.experimentSchemaVersion = step.to
      }
    }
    descriptionAfter = serializeExperimentDescription(next)
    descriptionDiff = [
      {
        change: 'changed',
        path: 'experiment_schema_version',
        stat: null,
        before: String(current),
        after: String(to),
      },
    ]
  }
  plan.files.push({
    path: set.descriptionKey,
    kind: 'description',
    from: current,
    to,
    before: descriptionRaw,
    after: descriptionAfter,
    changed: descriptionAfter !== descriptionRaw,
    fingerprint: await takeFingerprint(descriptionPath),
    hash: resultContentHash(descriptionRaw),
    rows: descriptionDiff,
    problems: [],
  })

  // Member result files.
  for (const run of set.members) {
    const key = `${run}/${RESULT_FILE_NAME}`
    const path = join(projectRoot, ...key.split('/'))
    let before: string
    try {
      before = await nodeFs.readFile(path, 'utf8')
    } catch {
      plan.skipped.push(run)
      continue
    }
    const parsed = parseResultFile(before, key)
    if (!parsed.ok)
      throw new MutationError(
        'BAD_REQUEST',
        `${key} is not a readable result table; fix it first`,
        {
          reason: 'SCHEMA_UPGRADE_INVALID',
          details: { file: key },
        },
      )
    const version = parsed.schemaVersion
    if (version === null)
      throw new MutationError(
        'BAD_REQUEST',
        `${key} records no $experiment_schema_version; add the row for the version its values follow, then upgrade`,
        { reason: 'SCHEMA_UPGRADE_INVALID', details: { file: key } },
      )
    if (version > to)
      throw new MutationError(
        'BAD_REQUEST',
        `${key} is already at version ${version}, beyond ${to}`,
        {
          reason: 'SCHEMA_UPGRADE_INVALID',
          details: { file: key },
        },
      )
    let after = before
    let diff: SchemaUpgradeRowDiff[] = []
    if (version < to) {
      const original = rowsOf(before)
      let rows = original
      let identity = true
      for (const step of useChain(version)) {
        if (step.kind === 'json') {
          const applied = applyUpgradeOperations(rows, step.transform!.operations, key)
          rows = applied.rows
          plan.warnings.push(...applied.warnings)
        } else {
          rows = await runPythonStep(projectRoot, step, rows, runner, key)
          identity = false
        }
      }
      after = serializeResultFile(
        to,
        rows.map(
          (row): ResultFileRowInput => ({ path: row.path, stat: row.stat, value: row.value }),
        ),
      )
      diff = diffRows(original, rows, identity)
    }
    plan.files.push({
      path: key,
      kind: 'result',
      from: version,
      to,
      before,
      after,
      changed: after !== before,
      fingerprint: await takeFingerprint(path),
      hash: resultContentHash(before),
      rows: diff,
      problems: after === before ? [] : problemsOf(after),
    })
  }
  plan.steps = [...used.values()].sort(
    (left, right) => left.from - right.from || (left.file < right.file ? -1 : 1),
  )
  return plan
}

// ---------- applying ----------

export interface ApplySchemaUpgradeOptions {
  now?: () => Date
}

export interface ApplySchemaUpgradeResult {
  status: 'applied' | 'unchanged'
  /** Project-relative backup directory (null when nothing changed). */
  backup: string | null
  /** Project-relative files rewritten. */
  changed: string[]
}

function stamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getFullYear() % 100)}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

async function replaceAtomic(path: string, content: string): Promise<void> {
  let mode: number | undefined
  try {
    mode = (await nodeFs.stat(path)).mode & 0o7777
  } catch {}
  const temporary = atomicTempPath(path)
  try {
    await nodeFs.writeFile(temporary, content, {
      encoding: 'utf8',
      ...(mode === undefined ? {} : { mode }),
    })
    await nodeFs.rename(temporary, path)
  } catch (error) {
    await nodeFs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

async function ensureBackupRoot(projectRoot: string): Promise<void> {
  const backups = join(projectRoot, '.memon', 'backups')
  await nodeFs.mkdir(backups, { recursive: true })
  // Backups never belong in the tracked tree.
  await nodeFs.writeFile(join(backups, '.gitignore'), '*\n', { flag: 'wx' }).catch(() => undefined)
}

/**
 * Apply a plan made by `planSchemaUpgrade`. Refuses (`BAD_STATE`) while a
 * member Run is RUNNING; aborts and restores (`CONFLICT`) when a file changed
 * since the plan; restores every file and fails (`BAD_STATE`,
 * `SCHEMA_UPGRADE_VERIFY_FAILED`) when verification fails.
 */
export async function applySchemaUpgrade(
  projectRoot: string,
  plan: SchemaUpgradePlan,
  options: ApplySchemaUpgradeOptions = {},
): Promise<ApplySchemaUpgradeResult> {
  const set = await readResultsSummaryInputSet(projectRoot, plan.experimentId)
  if (!set)
    throw new MutationError('NOT_FOUND', `Experiment ${plan.experimentId} does not exist`, {
      reason: 'MISSING_DOCUMENT',
    })
  const running: string[] = []
  for (const run of set.members) {
    try {
      const readme = await nodeFs.readFile(
        join(projectRoot, ...run.split('/'), 'README.md'),
        'utf8',
      )
      if (summaryRunRecord(readme).status === 'RUNNING') running.push(run)
    } catch {}
  }
  if (running.length > 0)
    throw new MutationError(
      'BAD_STATE',
      `member Run${running.length === 1 ? '' : 's'} ${running.join(', ')} ${running.length === 1 ? 'is' : 'are'} RUNNING; upgrade after ${running.length === 1 ? 'it finishes' : 'they finish'}`,
      { reason: 'SCHEMA_UPGRADE_RUNNING', details: { runs: running } },
    )
  const changed = plan.files.filter((file) => file.changed)
  if (changed.length === 0) return { status: 'unchanged', backup: null, changed: [] }

  const now = (options.now ?? (() => new Date()))()
  const from = Math.min(...changed.map((file) => file.from))
  const backupRel = `${SCHEMA_UPGRADE_BACKUP_RELDIR}/${plan.experimentId}-${from}-to-${plan.to}-${stamp(now)}`
  const backup = join(projectRoot, ...backupRel.split('/'))
  await ensureBackupRoot(projectRoot)
  await nodeFs.mkdir(backup, { recursive: true })
  for (const file of changed) {
    const target = join(backup, ...file.path.split('/'))
    await nodeFs.mkdir(dirname(target), { recursive: true })
    await nodeFs.writeFile(target, file.before, { flag: 'wx' })
  }
  await nodeFs.writeFile(
    join(backup, 'manifest.json'),
    `${JSON.stringify(
      {
        experiment: plan.experimentId,
        to: plan.to,
        created_at: formatIsoLocal(now),
        files: changed.map((file) => ({ path: file.path, from: file.from, hash: file.hash })),
      },
      null,
      2,
    )}\n`,
    { flag: 'wx' },
  )

  const replaced: typeof changed = []
  const restore = async () => {
    for (const file of replaced.reverse())
      await replaceAtomic(join(projectRoot, ...file.path.split('/')), file.before)
  }
  for (const file of changed) {
    const path = join(projectRoot, ...file.path.split('/'))
    const fingerprint = await takeFingerprint(path)
    const current = await nodeFs.readFile(path, 'utf8').catch(() => null)
    if (
      !sameFingerprint(fingerprint, file.fingerprint) ||
      current === null ||
      resultContentHash(current) !== file.hash
    ) {
      await restore()
      throw new MutationError(
        'CONFLICT',
        `${file.path} changed since the upgrade was planned; every file was restored — plan the upgrade again`,
        { reason: 'SCHEMA_UPGRADE_CONFLICT', details: { file: file.path, backup: backupRel } },
      )
    }
    await replaceAtomic(path, file.after)
    replaced.push(file)
  }

  const problems: string[] = []
  for (const file of plan.files) {
    const content = await nodeFs
      .readFile(join(projectRoot, ...file.path.split('/')), 'utf8')
      .catch(() => null)
    if (content === null) {
      problems.push(`${file.path}: missing after the upgrade`)
      continue
    }
    if (file.kind === 'description') {
      const parsed = parseExperimentDescription(content, file.path)
      if (!parsed.data) problems.push(`${file.path}: does not parse`)
      else if (parsed.data.experimentSchemaVersion !== plan.to)
        problems.push(
          `${file.path}: records version ${parsed.data.experimentSchemaVersion}, not ${plan.to}`,
        )
      continue
    }
    const parsed = parseResultFile(content, file.path)
    if (!parsed.ok) problems.push(`${file.path}: not a readable result table`)
    else if (parsed.schemaVersion !== plan.to)
      problems.push(
        `${file.path}: records version ${parsed.schemaVersion ?? 'none'}, not ${plan.to}`,
      )
    for (const duplicate of parsed.duplicates)
      problems.push(
        `${file.path}: duplicate (${duplicate.path}, ${duplicate.stat || '<empty>'}) on lines ${duplicate.lines.join(', ')}`,
      )
  }
  if (problems.length === 0) {
    const verifySet = await readResultsSummaryInputSet(projectRoot, plan.experimentId)
    if (verifySet) {
      const summary = await generateResultsSummaryFromDisk(
        projectRoot,
        verifySet,
        await takeResultsInputFingerprints(projectRoot, verifySet.keys),
      )
      if (summary.outcome !== 'ok')
        problems.push(
          `the Results summary still fails: ${summary.error?.code} ${summary.error?.message}`,
        )
    }
  }
  if (problems.length > 0) {
    await restore()
    throw new MutationError(
      'BAD_STATE',
      `schema upgrade verification failed; every file was restored from ${backupRel}: ${problems.join('; ')}`,
      { reason: 'SCHEMA_UPGRADE_VERIFY_FAILED', details: { problems, backup: backupRel } },
    )
  }
  return { status: 'applied', backup: backupRel, changed: changed.map((file) => file.path) }
}
