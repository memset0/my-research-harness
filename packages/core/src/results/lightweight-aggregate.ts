import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { writeFileAtomic } from '../atomic-write.js'
import { withFileWriterLock } from '../file-writer-lock.js'
import { parseRunMetadata, type RunMetadata, serializeRunMetadata } from '../runs/metadata.js'
import { createRunMetadata } from '../runs/metadata-mutations.js'
import { formatIsoLocal, formatRunStamp } from '../time.js'
import { parseExperimentDescription } from './description.js'
import {
  deriveLightweightVariants,
  EXPERIMENT_RESULTS_FILE,
  type ExperimentResultRow,
  isSmokeVariant,
  lightweightPublicationErrorPath,
  lightweightRunPath,
  parseExperimentResults,
  serializeExperimentResults,
  VARIANT_AGGREGATION_SCRIPT,
} from './lightweight.js'
import {
  checkResultFileTypes,
  encodeResultValue,
  formatResultRecord,
  parseResultFile,
  type ResultFileRowInput,
  type ResultValue,
} from './result-file.js'

function within(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !path.startsWith(sep))
}

async function contained(root: string, path: string): Promise<string> {
  const lexical = resolve(root, path)
  if (!within(root, lexical)) throw new Error(`Path escapes project: ${path}`)
  let physical: string
  try {
    physical = await fs.realpath(lexical)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = await contained(root, dirname(lexical))
    physical = join(parent, lexical.slice(dirname(lexical).length + 1))
  }
  if (!within(root, physical)) throw new Error(`Path escapes project through symlink: ${path}`)
  return lexical
}

interface InputSnapshot {
  path: string
  content: string | null
  mtime: number | null
}
async function snapshot(root: string, path: string): Promise<InputSnapshot> {
  const absolute = await contained(root, path)
  try {
    const before = await fs.stat(absolute)
    const content = await fs.readFile(absolute, 'utf8')
    const after = await fs.stat(absolute)
    if (before.mtimeMs !== after.mtimeMs || before.size !== after.size)
      throw new Error(`Input changed while reading ${path}`)
    return { path: absolute, content, mtime: after.mtimeMs }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { path: absolute, content: null, mtime: null }
    throw error
  }
}

function executeVariant(
  script: string,
  cwd: string,
  request: unknown,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [script], { cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: false })
    let stdout = Buffer.alloc(0),
      stderr = Buffer.alloc(0),
      failure: Error | null = null
    const fail = (error: Error) => {
      failure ??= error
      child.kill('SIGKILL')
    }
    const timer = setTimeout(
      () => fail(new Error(`${VARIANT_AGGREGATION_SCRIPT} timed out`)),
      timeoutMs,
    )
    child.stdout.on('data', (data: Buffer) => {
      stdout = Buffer.concat([stdout, data])
      if (stdout.length > 4 * 1024 * 1024)
        fail(new Error('Variant aggregation output exceeds 4 MiB'))
    })
    child.stderr.on('data', (data: Buffer) => {
      if (stderr.length < 65536) stderr = Buffer.concat([stderr, data]).subarray(0, 65536)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (failure) reject(failure)
      else if (code !== 0)
        reject(
          new Error(`${VARIANT_AGGREGATION_SCRIPT} exited ${code}: ${stderr.toString().trim()}`),
        )
      else resolve(stdout.toString())
    })
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify(request))
  })
}

function metadataValue(metadata: Record<string, unknown>, path: string): ResultValue {
  let value: unknown = metadata
  for (const key of path.slice(4).split('.')) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return null
    value = (value as Record<string, unknown>)[key]
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    Array.isArray(value)
  )
    return value
  throw new Error(`${path} refers to an object; select a scalar or list metadata field`)
}

export interface AggregateLightweightExperimentInput {
  projectRoot: string
  experimentId: string
  timeoutMs?: number
}
export interface AggregateLightweightExperimentResult {
  path: string
  content: string
  changed: boolean
  variants: number
}

export interface CreateLightweightVariantInput {
  projectRoot: string
  experimentId: string
  id?: string
  name?: string
  draft?: string | Record<string, unknown>
  params?: Record<string, unknown>
}

/** Bounded write-time enumeration; website inventory reads use the published index. */
export async function readLightweightRunRecords(root: string, experimentId: string) {
  if (!/^E\d{4}(?:-[a-z0-9][a-z0-9-]*)?$/.test(experimentId))
    throw new Error('Invalid Experiment identifier')
  const directory = await contained(root, `logs/${experimentId.slice(0, 5)}`)
  const records: Record<string, RunMetadata> = {}
  const snapshots: InputSnapshot[] = []
  const variants = await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  for (const variant of variants) {
    if (!/^(V\d{4}|smoke)$/.test(variant.name)) continue
    const variantDir = await contained(root, join(directory, variant.name))
    if (variant.isSymbolicLink()) throw new Error('Variant directories must not be symlinks')
    if (!variant.isDirectory()) continue
    const runs = await fs.readdir(variantDir, { withFileTypes: true })
    for (const run of runs) {
      if (run.name.startsWith('.')) continue
      if (run.isSymbolicLink()) throw new Error('Run directories must not be symlinks')
      if (!run.isDirectory()) continue
      const path = lightweightRunPath(experimentId, variant.name, run.name)
      const record = await snapshot(root, `${path}/run.json`)
      if (record.content === null) continue
      const parsed = parseRunMetadata(record.content)
      if (!parsed.data || parsed.data.id !== run.name) throw new Error(`Invalid ${path}/run.json`)
      records[path] = parsed.data
      snapshots.push(record)
    }
  }
  return { records, snapshots }
}

/** Select by changing Run records only; directory membership never changes. */
export async function activateLightweightRun(input: {
  projectRoot: string
  experimentId: string
  variantId: string
  runId: string
  replace?: boolean
  allowMultiple?: boolean
}) {
  const root = await fs.realpath(input.projectRoot)
  return withFileWriterLock(root, async () => {
    const path = lightweightRunPath(input.experimentId, input.variantId, input.runId)
    const { records, snapshots } = await readLightweightRunRecords(root, input.experimentId)
    const target = records[path]
    if (!target) throw new Error(`Missing ${path}/run.json`)
    const peers = Object.keys(records).filter(
      (key) => dirname(key) === dirname(path) && key !== path && records[key]!.active,
    )
    const declaration = parseExperimentDescription(
      (await snapshot(root, `docs/experiments/${input.experimentId}/experiment.json`)).content ??
        '',
    ).data
    const multiple =
      input.variantId === 'smoke' ||
      (input.allowMultiple &&
        declaration?.variants.find((item) => item.id === input.variantId)?.aggregate)
    if (peers.length && !input.replace && !multiple)
      return { selected: target.active === true, changes: [] }
    const changes: { path: string; before: string | null; after: string }[] = []
    for (const key of [...(multiple && !input.replace ? [] : peers), path]) {
      const metadata = records[key]!
      const active = key === path
      if (metadata.active === active) continue
      metadata.active = active
      metadata.updated_at = formatIsoLocal(new Date())
      const before = snapshots.find((item) => item.path === join(root, key, 'run.json'))!
      const current = await snapshot(root, before.path)
      if (current.content !== before.content || current.mtime !== before.mtime)
        throw new Error('CONFLICT: Run changed during activation')
      const after = serializeRunMetadata(metadata)
      await writeFileAtomic(before.path, after, { fs })
      changes.push({ path: before.path, before: before.content, after })
    }
    return { selected: true, changes }
  })
}

/** Creating a Variant prepares its first Run instead of maintaining a second draft file. */
export async function createLightweightVariant(input: CreateLightweightVariantInput) {
  const root = await fs.realpath(input.projectRoot)
  return withFileWriterLock(root, async () => {
    const declaration = await snapshot(
      root,
      `docs/experiments/${input.experimentId}/experiment.json`,
    )
    const description = parseExperimentDescription(declaration.content ?? '').data
    if (description?.format !== 'lightweight') throw new Error('Expected lightweight Experiment')
    const { records } = await readLightweightRunRecords(root, input.experimentId)
    const ids = [
      ...Object.keys(records).map((path) => path.split('/')[2]!),
      ...description.variants.map((variant) => variant.id),
    ]
    const next =
      Math.max(0, ...ids.filter((id) => /^V\d{4}$/.test(id)).map((id) => Number(id.slice(1)))) + 1
    const id = input.id ?? `V${String(next).padStart(4, '0')}`
    if (!/^(V\d{4}|smoke)$/.test(id) || id === 'V0000')
      throw new Error('Use V followed by four digits, or smoke')
    if (ids.includes(id)) throw new Error(`Variant ${id} already exists`)
    const runId = `run-${randomUUID().slice(0, 8)}-${formatRunStamp(new Date())}`
    const metadata: RunMetadata = {
      id: runId,
      status: 'READY',
      active: true,
      created_at: formatIsoLocal(new Date()),
      ...(input.name ? { name: input.name } : {}),
      ...(typeof input.draft === 'string'
        ? { description: input.draft }
        : input.draft
          ? { params: input.draft }
          : {}),
    }
    if (input.params !== undefined) metadata.params = input.params
    const result = await createRunMetadata({
      projectRoot: root,
      runDir: join(root, lightweightRunPath(input.experimentId, id, runId)),
      metadata,
    })
    return { ...result, id, runId }
  })
}

/** Project params and explicitly requested metadata; preserve native measured rows. */
export function exportLightweightRunCsv(
  metadata: RunMetadata,
  content: string | null,
  columns: readonly { path: string }[],
): string {
  const parsed = parseResultFile(content ?? 'path,stat,value\n', 'result.csv', {
    lightweight: true,
    metadataPaths: true,
  })
  if (!parsed.ok || parsed.diagnostics.some((item) => item.severity === 'error'))
    throw new Error('Invalid Run result.csv; repair before exporting')
  const rows: ResultFileRowInput[] = parsed.rows.filter(
    (row) =>
      !row.path.startsWith('run.') &&
      !(metadata.params !== undefined && row.path.startsWith('params.')),
  )
  const flatten = (value: unknown, path: string) => {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) flatten(child, `${path}.${key}`)
    } else rows.push({ path, value: encodeResultValue(value as ResultValue) })
  }
  if (metadata.params)
    for (const [key, value] of Object.entries(metadata.params)) flatten(value, `params.${key}`)
  for (const column of columns.filter((column) => column.path.startsWith('run.')))
    rows.push({ path: column.path, value: encodeResultValue(metadataValue(metadata, column.path)) })
  const output = `path,stat,value\n${rows.map((row) => formatResultRecord(row.path, row.stat ?? '', String(row.value))).join('\n')}${rows.length ? '\n' : ''}`
  const checked = parseResultFile(output, 'result.csv', { lightweight: true, metadataPaths: true })
  if (!checked.ok || checked.diagnostics.some((item) => item.severity === 'error'))
    throw new Error('Invalid projected parameter or metadata result path')
  return output
}

/** Rebuildable publication state stays outside the pure tracked data table. */
export async function setLightweightPublicationError(
  projectRoot: string,
  experimentId: string,
  message: string | null,
) {
  const root = await fs.realpath(projectRoot)
  const path = await contained(root, lightweightPublicationErrorPath(experimentId))
  if (message === null) {
    await fs.rm(path, { force: true })
    return
  }
  await fs.mkdir(dirname(path), { recursive: true })
  await fs
    .writeFile(await contained(root, '.memon/index/.gitignore'), '*\n', { flag: 'wx' })
    .catch((error) => {
      if (error.code !== 'EEXIST') throw error
    })
  await writeFileAtomic(path, message, { fs })
}

/** Explicit local CLI execution. Readers never invoke an experiment's Python code. */
export async function aggregateLightweightExperiment(
  input: AggregateLightweightExperimentInput,
): Promise<AggregateLightweightExperimentResult> {
  if (!/^E\d{4}-[a-z0-9][a-z0-9-]*$/.test(input.experimentId))
    throw new Error('Invalid Experiment identifier')
  const root = await fs.realpath(input.projectRoot)
  return withFileWriterLock(root, async () => {
    await setLightweightPublicationError(
      root,
      input.experimentId,
      'Refresh in progress; rerun memon experiment results rebuild if interrupted.',
    )
    try {
      const directory = await contained(root, `docs/experiments/${input.experimentId}`)
      const declaration = await snapshot(root, join(directory, 'experiment.json'))
      const parsed = parseExperimentDescription(declaration.content ?? '')
      if (!parsed.data || parsed.data.format !== 'lightweight')
        throw new Error(
          `Expected lightweight experiment.json: ${parsed.parseErrors.map((issue) => issue.message).join('; ')}`,
        )
      const description = parsed.data
      const discovered = await readLightweightRunRecords(root, input.experimentId)
      const runRecords = Object.fromEntries(
        Object.entries(discovered.records).map(([path, metadata]) => [
          path,
          { ...metadata, deprecated: !metadata.active, stop_reason: null },
        ]),
      )
      const variants = deriveLightweightVariants(
        input.experimentId,
        description,
        runRecords,
      ).filter((variant) => !isSmokeVariant(variant.id) && !variant.deprecated)
      for (const variant of variants)
        if ((variant.activeRuns?.length ?? 0) > 1 && !variant.aggregate)
          throw new Error(
            `${variant.id} has multiple active Runs; choose one or set aggregate to ${VARIANT_AGGREGATION_SCRIPT}`,
          )
      const target = await snapshot(root, join(directory, EXPERIMENT_RESULTS_FILE))
      const snapshots = [declaration, target, ...discovered.snapshots]
      const rows: ExperimentResultRow[] = []
      for (const variant of variants) {
        const selected = variant.activeRuns ?? []
        if (!selected.length) continue
        const runInputs = []
        for (const runId of selected) {
          const path = lightweightRunPath(input.experimentId, variant.id, runId)
          const runDirectory = await contained(root, path)
          const actual = await fs.realpath(runDirectory)
          // A symlink into another Variant inside the project is also a changed ownership.
          const variantRoot = resolve(root, `logs/${input.experimentId.slice(0, 5)}/${variant.id}`)
          if (!within(variantRoot, actual))
            throw new Error(`Selected Run escapes owning Variant: ${path}`)
          const record = await snapshot(root, `${path}/run.json`)
          if (record.content === null) throw new Error(`${path}/run.json does not exist`)
          const metadata = parseRunMetadata(record.content)
          if (!metadata.data)
            throw new Error(
              `Invalid ${path}/run.json: ${metadata.issues.map((issue) => issue.message).join('; ')}`,
            )
          if (metadata.data.id !== runId)
            throw new Error(`${path}/run.json identity does not match its Run directory`)
          const result = await snapshot(root, `${path}/result.csv`)
          const exported = exportLightweightRunCsv(
            metadata.data,
            result.content,
            description.columns,
          )
          if (exported !== result.content) {
            await writeFileAtomic(result.path, exported, { fs })
            Object.assign(result, await snapshot(root, result.path))
          }
          snapshots.push(record, result)
          const csv = parseResultFile(result.content ?? 'path,stat,value\n', `${path}/result.csv`, {
            lightweight: true,
            metadataPaths: true,
          })
          const diagnostics = [
            ...csv.diagnostics,
            ...checkResultFileTypes(
              csv,
              new Map(
                description.columns
                  .filter((column) => !column.path.startsWith('run.'))
                  .map((column) => [column.path, column]),
              ),
            ),
          ]
          if (!csv.ok || diagnostics.some((issue) => issue.severity === 'error'))
            throw new Error(
              `${variant.id}: ${diagnostics.map((issue) => issue.message).join('; ')}`,
            )
          const eligibleRows = csv.rows
            .filter(
              (row) =>
                !(
                  row.path.startsWith('metrics.') &&
                  (metadata.data!.status === 'READY' ||
                    metadata.data!.assessment?.kind === 'INVALID')
                ),
            )
            .map((row) => ({ path: row.path, stat: row.stat, value: row.value }))
          runInputs.push({
            id: runId,
            path,
            metadata: metadata.data,
            result_csv: `path,stat,value\n${eligibleRows.map((row) => `${formatResultRecord(row.path, row.stat, row.value)}\n`).join('')}`,
            rows: eligibleRows,
          })
        }
        let variantRows: ResultFileRowInput[]
        if (variant.aggregate) {
          const script = await snapshot(root, join(directory, VARIANT_AGGREGATION_SCRIPT))
          snapshots.push(script)
          if (script.content === null)
            throw new Error(`${VARIANT_AGGREGATION_SCRIPT} does not exist`)
          if (!within(await fs.realpath(directory), await fs.realpath(script.path)))
            throw new Error('Variant aggregation script must stay within the Experiment directory')
          const output = await executeVariant(
            script.path,
            root,
            {
              experiment: input.experimentId,
              variant: { id: variant.id, name: variant.name, draft: variant.draft },
              runs: runInputs,
              columns: description.columns,
            },
            input.timeoutMs ?? 30_000,
          )
          const csv = parseResultFile(output, `${VARIANT_AGGREGATION_SCRIPT}:${variant.id}`, {
            lightweight: true,
            metadataPaths: true,
          })
          const issues = [
            ...csv.diagnostics,
            ...checkResultFileTypes(
              csv,
              new Map(description.columns.map((column) => [column.path, column])),
            ),
          ]
          if (
            !csv.ok ||
            csv.reservedRows.length ||
            issues.some((issue) => issue.severity === 'error')
          )
            throw new Error(
              `${variant.id}: invalid custom aggregation CSV: ${issues.map((issue) => issue.message).join('; ')}`,
            )
          variantRows = csv.rows.map((row) => ({
            path: row.path,
            stat: row.stat,
            value: row.value,
          }))
        } else {
          const run = runInputs[0]!
          variantRows = [...run.rows]
        }
        for (const row of variantRows) rows.push({ variant: variant.id, ...row })
      }
      const content = serializeExperimentResults(rows)
      parseExperimentResults(content, { ...description, variants })
      for (const before of snapshots) {
        const after = await snapshot(root, before.path)
        if (before.content !== after.content || before.mtime !== after.mtime)
          throw Object.assign(
            new Error(
              `CONFLICT: ${relative(root, before.path)} changed during aggregation; results.csv was not updated`,
            ),
            { code: 'CONFLICT' },
          )
      }
      const changed = target.content !== content
      if (changed) await writeFileAtomic(target.path, content, { fs })
      await setLightweightPublicationError(root, input.experimentId, null)
      return { path: target.path, content, changed, variants: variants.length }
    } catch (error) {
      await setLightweightPublicationError(
        root,
        input.experimentId,
        `${(error as Error).message}; repair with memon experiment results rebuild ${input.experimentId}`,
      )
      throw error
    }
  })
}
