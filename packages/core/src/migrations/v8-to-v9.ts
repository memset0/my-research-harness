// FS convention v8 -> v9: the reviewed Results migration.
//
// Every Experiment's `results.yaml` splits into the description file
// `experiment.json` (columns as typed paths, annotations, Variant
// declarations with one merged `runs` list, declared plan/judgment statuses,
// planned parameter and env values, provenance, unknown keys) and per-Run
// `result.csv` files (the metrics of a Variant whose single adopted Run will
// be its evidence, plus converted per-Run sidecars). Values no Run directory
// can carry stay in the Variant's frozen block. Nothing else changes except
// the README `## Results` pointer, Run README `deprecated` flags and README
// `runs` additions chosen in reviewed resolutions, appended ignore-file allow
// rules (git mode), `.memon/version.json` and `.memon/index/`.
//
//   plan     read-only: lenient YAML read, mapping and value conversions,
//            blockers, the allow-rule plan and the expected lint/summary state
//   apply    back up every touched file (outside the project), write, rebuild
//            the index and all summaries, verify, then marker 9 and (git) one
//            commit of exactly the touched paths; a failed check restores
//            every file and leaves marker 8
//   verify   marker 9, no results.yaml, a description file per bundle, every
//            summary ok, a drift-free index, ignore rules (git)
//   rollback git revert of the migration commit (or the backed-up bytes) and
//            the pre-migration index
//
// Receipts carry counts and project-relative paths; the plan file holds the
// planned contents and lives outside the project with mode 0600.

import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import yaml from 'js-yaml'
import { rebuildIndex } from '../derived-index/rebuild.js'
import { verifyIndex } from '../derived-index/validate.js'
import {
  LEGACY_RESULTS_FILE,
  LEGACY_RESULTS_POINTER,
  lintExperimentDocument,
  MANAGED_SECTION_POINTERS,
  readExperimentManagedDocuments,
} from '../experiments/documents.js'
import { buildExperimentRecord, parseExperimentReadme } from '../experiments/parse.js'
import {
  execFileGitCommand,
  type GitCommandRunner,
  gitCommandStdoutText,
  isGitCommandFailure,
  toGitExecFailure,
} from '../git/command.js'
import { isRunPath } from '../ids.js'
import { type EffectiveRunDirs, resolveEffectiveRunDirs } from '../project-declaration/load.js'
import { ProjectDeclarationError } from '../project-declaration/schema.js'
import { patchRunFrontMatter } from '../readme/frontmatter-patch.js'
import {
  type DescriptionColumn,
  type DescriptionFrozenValue,
  type DescriptionVariant,
  EXPERIMENT_DESCRIPTION_FILE,
  type ExperimentDescription,
  emptyExperimentDescription,
  parseExperimentDescription,
  serializeExperimentDescription,
} from '../results/description.js'
import {
  type AllowRuleTarget,
  gitCheckIgnore,
  planResultAllowRules,
  resolveRunRealPath,
} from '../results/ignore.js'
import {
  encodeResultValue,
  parseResultFile,
  RESULT_FILE_NAME,
  type ResultValue,
  serializeResultFile,
} from '../results/result-file.js'
import {
  generateResultsSummary,
  type ResultsSummary,
  type SummaryRunRecord,
} from '../results/summary.js'
import {
  loadResultsSummary,
  rebuildResultsSummaries,
  summaryRunRecord,
} from '../results/summary-cache.js'
import { isStatName } from '../results/vocabulary.js'
import { formatIsoLocal } from '../time.js'
import { EXPERIMENT_DIR_REGEX, VARIANT_STATUS_VALUES, type VariantStatus } from '../types.js'
import {
  type ClassifiedCell,
  type ColumnConversion,
  type ConvertedRow,
  classifyV8Cell,
  columnConversion,
  convertedRows,
  STAT_ALIASES,
  sanitizeSegment,
  v8KeyPath,
} from './v8-to-v9-values.js'

export const V8_TO_V9_COMMIT_MESSAGE = 'chore(memon): migrate FS convention v8 -> v9'

const MARKER = '.memon/version.json'
const INDEX = '.memon/index'
const EXPERIMENTS = 'docs/experiments'
const DECLARABLE = new Set(['PLANNED', 'BLOCKED', 'DROPPED', 'INCONCLUSIVE'])
const GIT_TIMEOUT_MS = 60_000
const GIT_MAX_BUFFER = 64 * 1024 * 1024

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
/** Git's blob id of a text, so frozen values name their exact source. */
const gitBlobId = (text: string) => {
  const bytes = Buffer.from(text, 'utf8')
  return createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]))
    .digest('hex')
}

// ---------- plan shape ----------

export type ResultsMigrationBlockerCode =
  | 'FINISHED_ATTEMPT'
  | 'RUN_IN_TWO_VARIANTS'
  | 'VARIANT_RUN_NOT_MEMBER'
  | 'RESULT_FILE_EXISTS'
  | 'RESULTS_YAML_UNREADABLE'
  | 'SIDECAR_VARIANT_CONFLICT'
  | 'DESCRIPTION_FILE_EXISTS'
  /** A declared Run resolves through a symbolic link to a path outside the project root. */
  | 'RUN_PATH_OUTSIDE_PROJECT'
  /** Two declared Run paths with planned writes resolve to the same real directory. */
  | 'RUN_PATH_ALIASED'
  /** A `deprecate` resolution would edit a Run README that Git ignores. */
  | 'RUN_README_IGNORED'
  /** Marker, worktree or project declaration not ready (fix by hand, plan again). */
  | 'PROJECT_NOT_READY'

export interface ResultsMigrationBlocker {
  /** `<code>:<experiment>:<subject>`; the key of its entry in the resolutions file. */
  id: string
  code: ResultsMigrationBlockerCode
  experiment: string
  run?: string
  message: string
  /** Allowed resolutions; empty when only a manual fix resolves it. */
  choices: string[]
  /** The applied resolution, when the resolutions file has one. */
  resolution?: string
}

export interface ResultsMigrationNotice {
  code: string
  experiment?: string
  variant?: string
  path?: string
  run?: string
  message: string
}

export interface ResultsMigrationFile {
  /** Project-relative path. */
  path: string
  action: 'create' | 'replace' | 'delete' | 'append'
  before: string | null
  after: string | null
  /** sha256 of `before` (null for a new file). */
  beforeHash: string | null
}

/** What the regenerated summary must show for one v8 cell. */
export type CellExpectation =
  | { kind: 'scalar'; value: ResultValue }
  | { kind: 'stats'; stats: Record<string, number> }

export interface ExpectedCell {
  variant: string
  path: string
  expect: CellExpectation
}

export interface ResultsMigrationExperiment {
  id: string
  resultsYaml: boolean
  variants: number
  columns: number
  resultFiles: number
  frozenVariants: number
  pointerRewritten: boolean
}

export interface ResultsMigrationPlan {
  version: 1
  migration: 'v8-to-v9'
  root: string
  from: number | null
  alreadyMigrated: boolean
  marker: { before: string | null; hash: string | null }
  git: boolean
  allowDirty: boolean
  sidecarName: string | null
  runDirs: EffectiveRunDirs | null
  experiments: ResultsMigrationExperiment[]
  files: ResultsMigrationFile[]
  allowRules: AllowRuleTarget[]
  counts: Record<string, number>
  notices: ResultsMigrationNotice[]
  blockers: ResultsMigrationBlocker[]
  /** Blocker ids without a resolution; apply refuses while any remain. */
  unresolved: string[]
  resolutions: Record<string, string>
  expected: {
    /** Lint errors the migrated bundles are expected to report, as `code|file|field` keys. */
    lint: Record<string, string[]>
    /** v8 cells the summary is expected to show, per Experiment. */
    cells: Record<string, ExpectedCell[]>
    /** `experiment|variant|path` keys of reported summary differences (conversions). */
    summaryDifferences: string[]
  }
  /** `git ls-files --others --exclude-standard` before apply (git mode). */
  untrackedBefore: string[] | null
}

export interface PlanResultsMigrationOptions {
  allowDirty?: boolean
  cliRunDirs?: string[]
  /** Operator-supplied per-Run sidecar file name (never walked for). */
  sidecarName?: string
  /** Reviewed resolutions keyed by blocker id. */
  resolutions?: Record<string, string>
  git?: GitCommandRunner
}

// ---------- small helpers ----------

async function readText(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') return null
    throw error
  }
}

async function isDirectory(path: string): Promise<boolean> {
  return fs.stat(path).then(
    (stat) => stat.isDirectory(),
    () => false,
  )
}

function markerVersion(raw: string | null): number | null {
  if (raw === null) return null
  try {
    const value = (JSON.parse(raw) as { fs_convention_version?: unknown }).fs_convention_version
    return typeof value === 'number' && Number.isInteger(value) ? value : null
  } catch {
    return null
  }
}

async function runGit(git: GitCommandRunner, root: string, args: string[]) {
  return git('git', args, { cwd: root, timeoutMs: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER })
}

async function gitMode(git: GitCommandRunner, root: string): Promise<boolean> {
  const toplevel = await runGit(git, root, ['rev-parse', '--show-toplevel']).catch(() => null)
  if (toplevel === null || isGitCommandFailure(toplevel)) return false
  return (await fs.realpath(gitCommandStdoutText(toplevel).trim()).catch(() => '')) === root
}

async function gitOk(git: GitCommandRunner, root: string, args: string[]): Promise<string> {
  const result = await runGit(git, root, args)
  if (isGitCommandFailure(result))
    throw new Error(`git ${args[0]} failed: ${toGitExecFailure(result).err.message}`)
  return gitCommandStdoutText(result)
}

async function untrackedFiles(git: GitCommandRunner, root: string): Promise<string[]> {
  return (await gitOk(git, root, ['ls-files', '--others', '--exclude-standard']))
    .split('\n')
    .filter(Boolean)
    .sort()
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function sameScalar(left: unknown, right: unknown): boolean {
  if (typeof left === 'number' && typeof right === 'number') return left === right
  const text = (value: unknown) => encodeResultValue((value ?? null) as ResultValue)
  if (typeof left === 'number' || typeof right === 'number') {
    const a = Number(text(left))
    const b = Number(text(right))
    if (text(left) !== '' && text(right) !== '' && Number.isFinite(a) && Number.isFinite(b))
      return a === b
  }
  return text(left) === text(right)
}

/** Rewrite the exact v8 Results pointer line under `## Results`; null when absent. */
export function rewriteResultsPointer(readme: string): string | null {
  const lines = readme.split('\n')
  let inResults = false
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    if (/^## /.test(line)) {
      inResults = line.replace(/\r$/, '').trim() === '## Results'
      continue
    }
    if (!inResults) continue
    const trimmed = line.replace(/\r$/, '').trim()
    if (trimmed === '') continue
    if (trimmed !== LEGACY_RESULTS_POINTER) return null
    lines[index] = line.replace(LEGACY_RESULTS_POINTER, MANAGED_SECTION_POINTERS.results)
    return lines.join('\n')
  }
  return null
}

// ---------- v8 model (lenient) ----------

interface V8Column {
  key: string
  label: string
  group: 'parameter' | 'metric'
  type: string
  options?: Array<string | number | boolean>
}

interface V8Variant {
  id: string
  name: string
  status: string | null
  description?: string
  parameters: Record<string, unknown>
  metrics: Record<string, unknown>
  runs: string[]
  attempts: string[]
  provenance: Record<string, unknown> | null
  extra: Record<string, unknown>
}

interface V8Results {
  columns: V8Column[]
  annotations: Record<string, { description?: string; value_descriptions?: Record<string, string> }>
  variants: V8Variant[]
  extra: Record<string, unknown>
}

const V8_VARIANT_KEYS = new Set([
  'id',
  'name',
  'status',
  'description',
  'parameters',
  'metrics',
  'runs',
  'attempts',
  'provenance',
])

function readV8Results(loaded: Record<string, unknown>): V8Results {
  const columns: V8Column[] = []
  for (const raw of Array.isArray(loaded.columns) ? loaded.columns : []) {
    const column = record(raw)
    if (typeof column.key !== 'string' || column.key === '') continue
    columns.push({
      key: column.key,
      label: typeof column.label === 'string' && column.label ? column.label : column.key,
      group: column.group === 'parameter' ? 'parameter' : 'metric',
      type: typeof column.type === 'string' ? column.type : 'string',
      ...(Array.isArray(column.options)
        ? {
            options: column.options.filter((option): option is string | number | boolean =>
              ['string', 'number', 'boolean'].includes(typeof option),
            ),
          }
        : {}),
    })
  }
  const annotations: V8Results['annotations'] = {}
  for (const [key, raw] of Object.entries(record(loaded.column_annotations))) {
    const entry = record(raw)
    annotations[key] = {
      ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
      ...(entry.value_descriptions && typeof entry.value_descriptions === 'object'
        ? {
            value_descriptions: Object.fromEntries(
              Object.entries(record(entry.value_descriptions)).filter(
                (pair): pair is [string, string] => typeof pair[1] === 'string',
              ),
            ),
          }
        : {}),
    }
  }
  const variants: V8Variant[] = []
  for (const raw of Array.isArray(loaded.variants) ? loaded.variants : []) {
    const variant = record(raw)
    if (typeof variant.id !== 'string') continue
    variants.push({
      id: variant.id,
      name: typeof variant.name === 'string' && variant.name ? variant.name : variant.id,
      status: typeof variant.status === 'string' ? variant.status : null,
      ...(typeof variant.description === 'string' ? { description: variant.description } : {}),
      parameters: record(variant.parameters),
      metrics: record(variant.metrics),
      runs: stringList(variant.runs),
      attempts: stringList(variant.attempts),
      provenance: variant.provenance === undefined ? null : record(variant.provenance),
      extra: Object.fromEntries(
        Object.entries(variant).filter(([key]) => !V8_VARIANT_KEYS.has(key)),
      ),
    })
  }
  const extra = Object.fromEntries(
    Object.entries(loaded).filter(
      ([key]) => !['schema_version', 'column_annotations', 'columns', 'variants'].includes(key),
    ),
  )
  return { columns, annotations, variants, extra }
}

// ---------- sidecars ----------

interface SidecarRows {
  variant: string | null
  parameters: Record<string, unknown>
  metrics: Record<string, unknown>
  statistics: Record<string, Record<string, unknown>>
  env: Record<string, unknown>
}

/** The two legacy per-Run JSON shapes, or null for an unknown shape. */
function readSidecar(content: string): SidecarRows | null {
  let loaded: Record<string, unknown>
  try {
    loaded = record(JSON.parse(content))
  } catch {
    return null
  }
  if (typeof loaded.variant_id === 'string') {
    const role = typeof loaded.role === 'string' ? loaded.role : 'baseline'
    const snapshot = record(loaded[role] ?? loaded.baseline)
    return {
      variant: loaded.variant_id,
      parameters: record(snapshot.parameters),
      metrics: record(snapshot.metrics),
      statistics: {},
      env: record(record(snapshot.provenance).env),
    }
  }
  if (
    typeof loaded.variant === 'string' &&
    (loaded.definition || loaded.statistics || loaded.metrics)
  ) {
    return {
      variant: loaded.variant,
      parameters: record(record(loaded.definition).parameters),
      metrics: record(loaded.metrics),
      statistics: Object.fromEntries(
        Object.entries(record(loaded.statistics)).map(([key, value]) => [key, record(value)]),
      ),
      env: {},
    }
  }
  return null
}

// ---------- planning ----------

interface ExperimentWork {
  id: string
  dir: string
  readme: string
  readmeAfter: string
  readmeRuns: string[]
  description: ExperimentDescription
  descriptionBefore: string | null
  /** Run → planned result rows (null: leave the existing file alone). */
  resultRows: Map<string, ConvertedRow[]>
  deprecate: Set<string>
  deleteResultsYaml: boolean
  expectedCells: ExpectedCell[]
  /** Variant id → its v8 status (for VARIANT_STATUS_CHANGED). */
  v8Statuses: Map<string, string>
  summary: ExperimentSummaryState
}

interface ExperimentSummaryState {
  resultsYaml: boolean
  pointerRewritten: boolean
  frozenVariants: number
}

function blockerId(code: ResultsMigrationBlockerCode, experiment: string, subject: string): string {
  return `${code}:${experiment}:${subject}`
}

/**
 * Read-only plan of the v8 -> v9 step. Blockers stay unresolved until the
 * resolutions name a choice for each of them; apply refuses until then.
 */
export async function planResultsMigration(
  projectRoot: string,
  options: PlanResultsMigrationOptions = {},
): Promise<ResultsMigrationPlan> {
  const git = options.git ?? execFileGitCommand
  const root = await fs.realpath(projectRoot)
  const markerRaw = await readText(join(root, MARKER))
  const from = markerVersion(markerRaw)
  const resolutions = { ...(options.resolutions ?? {}) }
  const plan: ResultsMigrationPlan = {
    version: 1,
    migration: 'v8-to-v9',
    root,
    from,
    alreadyMigrated: from === 9,
    marker: { before: markerRaw, hash: markerRaw === null ? null : sha256(markerRaw) },
    git: await gitMode(git, root),
    allowDirty: options.allowDirty ?? false,
    sidecarName: options.sidecarName ?? null,
    runDirs: null,
    experiments: [],
    files: [],
    allowRules: [],
    counts: {},
    notices: [],
    blockers: [],
    unresolved: [],
    resolutions,
    expected: { lint: {}, cells: {}, summaryDifferences: [] },
    untrackedBefore: null,
  }
  const count = (key: string, by = 1) => {
    plan.counts[key] = (plan.counts[key] ?? 0) + by
  }
  const notice = (entry: ResultsMigrationNotice) => plan.notices.push(entry)
  if (markerRaw === null) {
    plan.blockers.push({
      id: 'MARKER:project:.memon/version.json',
      code: 'PROJECT_NOT_READY',
      experiment: '(project)',
      message: `${MARKER} is missing; the project is not at FS v8`,
      choices: [],
    })
  } else if (from === null) {
    plan.blockers.push({
      id: 'MARKER:project:.memon/version.json',
      code: 'PROJECT_NOT_READY',
      experiment: '(project)',
      message: `${MARKER} is not a valid FS marker`,
      choices: [],
    })
  } else if (from !== 8 && from !== 9) {
    plan.blockers.push({
      id: 'MARKER:project:.memon/version.json',
      code: 'PROJECT_NOT_READY',
      experiment: '(project)',
      message: `${MARKER} records FS v${from}; this step migrates v8 -> v9 only`,
      choices: [],
    })
  }
  if (plan.git && !plan.allowDirty) {
    const status = await gitOk(git, root, ['status', '--porcelain', '--untracked-files=normal'])
    if (status.trim())
      plan.blockers.push({
        id: 'DIRTY:project:worktree',
        code: 'PROJECT_NOT_READY',
        experiment: '(project)',
        message:
          'the Git worktree is dirty; commit or stash your own edits, or re-plan with --allow-dirty after scoped approval',
        choices: [],
      })
  }
  if (plan.git) plan.untrackedBefore = await untrackedFiles(git, root)
  try {
    plan.runDirs = await resolveEffectiveRunDirs({
      root,
      ...(options.cliRunDirs && options.cliRunDirs.length > 0
        ? { cliRunDirs: options.cliRunDirs }
        : {}),
    })
  } catch (error) {
    if (!(error instanceof ProjectDeclarationError)) throw error
    plan.blockers.push({
      id: 'DECLARATION:project:.memon/project.yml',
      code: 'PROJECT_NOT_READY',
      experiment: '(project)',
      message: `${error.message}; fix .memon/project.yml and plan again`,
      choices: [],
    })
  }
  if (plan.alreadyMigrated) {
    finalizeBlockers(plan)
    return plan
  }

  const records = new Map<string, SummaryRunRecord | null>()
  const readmes = new Map<string, string | null>()
  const runRecord = async (run: string) => {
    if (!records.has(run)) {
      const content = isRunPath(run)
        ? await readText(join(root, ...run.split('/'), 'README.md'))
        : null
      readmes.set(run, content)
      records.set(run, content === null ? null : summaryRunRecord(content))
    }
    return records.get(run) ?? null
  }

  let entries: string[] = []
  try {
    entries = (await fs.readdir(join(root, EXPERIMENTS)))
      .filter((name) => EXPERIMENT_DIR_REGEX.test(name))
      .sort()
  } catch {}
  const works: ExperimentWork[] = []
  const declaredRuns = new Set<string>()
  for (const id of entries) {
    const dir = `${EXPERIMENTS}/${id}`
    const folder = join(root, ...dir.split('/'))
    if (!(await isDirectory(folder))) continue
    const readme = await readText(join(folder, 'README.md'))
    if (readme === null) {
      notice({
        code: 'MISSING_README',
        experiment: id,
        message: `${dir}/README.md is missing; the bundle is skipped`,
      })
      continue
    }
    const readmeRuns = [...parseExperimentReadme(readme, id).frontMatter.runs]
    for (const run of readmeRuns) if (isRunPath(run)) declaredRuns.add(run)
    const yamlRaw = await readText(join(folder, LEGACY_RESULTS_FILE))
    const descriptionBefore = await readText(join(folder, EXPERIMENT_DESCRIPTION_FILE))
    if (descriptionBefore !== null && yamlRaw === null) continue // already v9
    if (descriptionBefore !== null && yamlRaw !== null) {
      plan.blockers.push({
        id: blockerId('DESCRIPTION_FILE_EXISTS', id, EXPERIMENT_DESCRIPTION_FILE),
        code: 'DESCRIPTION_FILE_EXISTS',
        experiment: id,
        message: `${dir} holds both ${LEGACY_RESULTS_FILE} and ${EXPERIMENT_DESCRIPTION_FILE}; keep one by hand and plan again`,
        choices: [],
      })
      continue
    }
    const pointer = rewriteResultsPointer(readme)
    const work: ExperimentWork = {
      id,
      dir,
      readme,
      readmeAfter: pointer ?? readme,
      readmeRuns,
      description: emptyExperimentDescription(),
      descriptionBefore,
      resultRows: new Map(),
      deprecate: new Set(),
      deleteResultsYaml: yamlRaw !== null,
      expectedCells: [],
      v8Statuses: new Map(),
      summary: {
        resultsYaml: yamlRaw !== null,
        pointerRewritten: pointer !== null,
        frozenVariants: 0,
      },
    }
    works.push(work)
    if (yamlRaw === null) continue
    let loaded: unknown
    try {
      loaded = yaml.load(yamlRaw, { schema: yaml.JSON_SCHEMA })
    } catch (error) {
      loaded = undefined
      plan.blockers.push({
        id: blockerId('RESULTS_YAML_UNREADABLE', id, LEGACY_RESULTS_FILE),
        code: 'RESULTS_YAML_UNREADABLE',
        experiment: id,
        message: `${dir}/${LEGACY_RESULTS_FILE} is not valid YAML (${(error as Error).message.split('\n')[0]}); fix it by hand and plan again`,
        choices: [],
      })
    }
    if (loaded === undefined) continue
    if (loaded === null || typeof loaded !== 'object' || Array.isArray(loaded)) {
      plan.blockers.push({
        id: blockerId('RESULTS_YAML_UNREADABLE', id, LEGACY_RESULTS_FILE),
        code: 'RESULTS_YAML_UNREADABLE',
        experiment: id,
        message: `${dir}/${LEGACY_RESULTS_FILE} is not a YAML mapping; fix it by hand and plan again`,
        choices: [],
      })
      continue
    }
    await planExperiment(
      plan,
      work,
      readV8Results(loaded as Record<string, unknown>),
      gitBlobId(yamlRaw),
      {
        root,
        resolutions,
        runRecord,
        sidecarName: options.sidecarName ?? null,
        count,
        notice,
      },
    )
  }

  // Run README deprecations chosen in resolutions.
  const runReadmeAfter = new Map<string, string>()
  for (const work of works)
    for (const run of work.deprecate) {
      const before =
        readmes.get(run) ?? (await readText(join(root, ...run.split('/'), 'README.md')))
      if (before === null) continue
      runReadmeAfter.set(run, patchRunFrontMatter(before, { deprecated: true }))
    }

  // Real Run paths: a declared Run may be (or lie below) a symbolic link.
  // Writes, `git add` and `git check-ignore` use the real project-relative
  // path; a target outside the project root is a blocker.
  const realRuns = new Map<string, string>()
  const realRun = async (experiment: string, run: string): Promise<string | null> => {
    if (!isRunPath(run)) return run
    const resolved = await resolveRunRealPath(root, run)
    if (resolved.kind === 'missing') return run
    if (resolved.kind === 'inside') {
      if (resolved.real !== run) realRuns.set(run, resolved.real)
      return resolved.real
    }
    const id = blockerId('RUN_PATH_OUTSIDE_PROJECT', experiment, run)
    if (!plan.blockers.some((blocker) => blocker.id === id))
      plan.blockers.push({
        id,
        code: 'RUN_PATH_OUTSIDE_PROJECT',
        experiment,
        run,
        message: `${run} resolves through a symbolic link to ${resolved.target}, outside the project root; move the Run into the project or unlink it, then plan again`,
        choices: [],
      })
    return null
  }
  for (const work of works)
    for (const run of new Set([...work.readmeRuns, ...work.resultRows.keys(), ...work.deprecate]))
      await realRun(work.id, run)
  if (realRuns.size > 0) count('symlinkedRuns', realRuns.size)
  const plannedTargets = new Map<string, string>()
  const claim = (experiment: string, run: string, path: string): boolean => {
    const holder = plannedTargets.get(path)
    if (holder === undefined) {
      plannedTargets.set(path, run)
      return true
    }
    if (holder === run) return false
    plan.blockers.push({
      id: blockerId('RUN_PATH_ALIASED', experiment, run),
      code: 'RUN_PATH_ALIASED',
      experiment,
      run,
      message: `${run} and ${holder} resolve to the same directory (${path.split('/').slice(0, -1).join('/')}); declare the Run by one path only and plan again`,
      choices: [],
    })
    return false
  }

  // Planned files.
  for (const work of works) {
    const folder = `${work.dir}`
    if (work.readmeAfter !== work.readme)
      plan.files.push({
        path: `${folder}/README.md`,
        action: 'replace',
        before: work.readme,
        after: work.readmeAfter,
        beforeHash: sha256(work.readme),
      })
    plan.files.push({
      path: `${folder}/${EXPERIMENT_DESCRIPTION_FILE}`,
      action: 'create',
      before: null,
      after: serializeExperimentDescription(work.description),
      beforeHash: null,
    })
    for (const [run, rows] of work.resultRows) {
      const real = await realRun(work.id, run)
      if (real === null) continue
      const path = `${real}/${RESULT_FILE_NAME}`
      if (!claim(work.id, run, path)) continue
      const before = await readText(join(root, ...path.split('/')))
      plan.files.push({
        path,
        action: before === null ? 'create' : 'replace',
        before,
        after: serializeResultFile(
          1,
          rows.map((row) => ({
            path: row.path,
            stat: row.stat ?? '',
            value: encodeResultValue(row.value),
          })),
        ),
        beforeHash: before === null ? null : sha256(before),
      })
    }
    if (work.deleteResultsYaml) {
      const before =
        (await readText(join(root, ...`${folder}/${LEGACY_RESULTS_FILE}`.split('/')))) ?? ''
      plan.files.push({
        path: `${folder}/${LEGACY_RESULTS_FILE}`,
        action: 'delete',
        before,
        after: null,
        beforeHash: sha256(before),
      })
    }
    plan.experiments.push({
      id: work.id,
      resultsYaml: work.summary.resultsYaml,
      variants: work.description.variants.length,
      columns: work.description.columns.length,
      resultFiles: work.resultRows.size,
      frozenVariants: work.summary.frozenVariants,
      pointerRewritten: work.summary.pointerRewritten,
    })
  }
  const readmeOwners = new Map<string, string>()
  for (const work of works) for (const run of work.deprecate) readmeOwners.set(run, work.id)
  const plannedReadmes: { experiment: string; run: string; path: string }[] = []
  for (const [run, after] of runReadmeAfter) {
    const before = readmes.get(run)!
    const experiment = readmeOwners.get(run) ?? '(project)'
    const real = await realRun(experiment, run)
    if (real === null) continue
    const path = `${real}/README.md`
    if (!claim(experiment, run, path)) continue
    plannedReadmes.push({ experiment, run, path })
    plan.files.push({
      path,
      action: 'replace',
      before,
      after,
      beforeHash: sha256(before),
    })
  }

  // A deprecation edits a Run README the migration commit must include.
  if (plan.git && plannedReadmes.length > 0) {
    const ignoredReadmes = new Set(
      (
        await gitCheckIgnore(
          root,
          plannedReadmes.map((entry) => entry.path),
        )
      )
        .filter((decision) => decision.ignored)
        .map((decision) => decision.path),
    )
    for (const entry of plannedReadmes) {
      if (!ignoredReadmes.has(entry.path)) continue
      plan.blockers.push({
        id: blockerId('RUN_README_IGNORED', entry.experiment, entry.run),
        code: 'RUN_README_IGNORED',
        experiment: entry.experiment,
        run: entry.run,
        message: `${entry.path} is ignored by Git, so the \`deprecate\` resolution cannot be committed; resolve the attempt with \`adopt\`, or have the user track the README, then plan again`,
        choices: [],
      })
    }
  }

  // Allow rules for ignored result files (git mode): every declared Run.
  if (plan.git) {
    for (const work of works)
      for (const run of work.readmeRuns) if (isRunPath(run)) declaredRuns.add(run)
    const allow = await planResultAllowRules({
      projectRoot: root,
      runs: [...declaredRuns],
      ...(plan.runDirs ? { runDirs: plan.runDirs.patterns } : {}),
    })
    plan.allowRules = allow?.targets ?? []
    for (const target of plan.allowRules) {
      const before = await readText(join(root, ...target.file.split('/')))
      const prefix = before === null || before === '' || before.endsWith('\n') ? '' : '\n'
      plan.files.push({
        path: target.file,
        action: before === null ? 'create' : 'append',
        before,
        after: `${before ?? ''}${prefix}${target.lines.join('\n')}\n`,
        beforeHash: before === null ? null : sha256(before),
      })
      count('allowRuleFiles')
      count('allowRules', target.lines.length - 1)
    }
  }

  // Expected post-migration state, computed from the planned contents.
  const planned = new Map(plan.files.map((file) => [file.path, file]))
  const contentAfter = async (path: string): Promise<string | null> => {
    const slash = path.lastIndexOf('/')
    const run = path.slice(0, slash)
    const real = realRuns.get(run)
    const file = planned.get(real === undefined ? path : `${real}${path.slice(slash)}`)
    if (file) return file.after
    return readText(join(root, ...path.split('/')))
  }
  for (const work of works) {
    const summary = await expectedSummary(root, work, contentAfter)
    const lint = await expectedLint(root, work, contentAfter)
    plan.expected.lint[work.id] = lint
    plan.expected.cells[work.id] = work.expectedCells
    for (const difference of compareCells(work.id, work.expectedCells, summary)) {
      plan.expected.summaryDifferences.push(difference.key)
      notice({
        code: 'SUMMARY_DIFFERS_FROM_V8',
        experiment: work.id,
        message: difference.message,
      })
    }
    for (const variant of summary.variants) {
      const v8Status = work.v8Statuses.get(variant.id) ?? null
      if (v8Status && v8Status !== variant.status) {
        count('statusChanged')
        notice({
          code: 'VARIANT_STATUS_CHANGED',
          experiment: work.id,
          variant: variant.id,
          message: `${variant.id} was ${v8Status} in results.yaml and derives ${variant.status} from its Run records`,
        })
      }
    }
  }
  count('experiments', works.length)
  finalizeBlockers(plan)
  return plan
}

function finalizeBlockers(plan: ResultsMigrationPlan): void {
  plan.unresolved = []
  for (const blocker of plan.blockers) {
    const resolution = plan.resolutions[blocker.id]
    if (resolution !== undefined && blocker.choices.includes(resolution))
      blocker.resolution = resolution
    else plan.unresolved.push(blocker.id)
  }
}

interface PlanContext {
  root: string
  resolutions: Record<string, string>
  runRecord: (run: string) => Promise<SummaryRunRecord | null>
  sidecarName: string | null
  count: (key: string, by?: number) => void
  notice: (entry: ResultsMigrationNotice) => void
}

async function planExperiment(
  plan: ResultsMigrationPlan,
  work: ExperimentWork,
  v8: V8Results,
  blobId: string,
  context: PlanContext,
): Promise<void> {
  const { id } = work
  const members = new Set(work.readmeRuns)
  const resolve = (
    code: ResultsMigrationBlockerCode,
    subject: string,
    message: string,
    choices: string[],
    run?: string,
  ) => {
    const blocker: ResultsMigrationBlocker = {
      id: blockerId(code, id, subject),
      code,
      experiment: id,
      ...(run ? { run } : {}),
      message,
      choices,
    }
    plan.blockers.push(blocker)
    const resolution = context.resolutions[blocker.id]
    return resolution !== undefined && choices.includes(resolution) ? resolution : undefined
  }

  // Runs listed by several Variants → the chosen Variant keeps them.
  const listing = new Map<string, string[]>()
  for (const variant of v8.variants)
    for (const run of [...variant.runs, ...variant.attempts]) {
      const owners = listing.get(run) ?? []
      if (!owners.includes(variant.id)) owners.push(variant.id)
      listing.set(run, owners)
    }
  const keeper = new Map<string, string | null>()
  for (const [run, owners] of listing) {
    if (owners.length < 2) {
      keeper.set(run, owners[0] ?? null)
      continue
    }
    const choice = resolve(
      'RUN_IN_TWO_VARIANTS',
      run,
      `${run} is listed by ${owners.join(' and ')}; choose the Variant that keeps it`,
      owners,
      run,
    )
    keeper.set(run, choice ?? null)
  }
  // Variant Runs the README does not declare → link or drop.
  const linked: string[] = []
  const dropped = new Set<string>()
  for (const run of listing.keys()) {
    if (members.has(run)) continue
    const choice = resolve(
      'VARIANT_RUN_NOT_MEMBER',
      run,
      `${run} is listed by ${listing.get(run)!.join(', ')} but the README runs do not declare it; link it or drop it from the Variant`,
      ['link', 'drop'],
      run,
    )
    if (choice === 'link') linked.push(run)
    if (choice === 'drop') dropped.add(run)
  }
  // Finished, non-deprecated attempts → deprecate or adopt.
  for (const variant of v8.variants)
    for (const run of variant.attempts) {
      if (variant.runs.includes(run)) continue
      const recordValue = await context.runRecord(run)
      if (recordValue?.status !== 'FINISHED' || recordValue.deprecated) continue
      const choice = resolve(
        'FINISHED_ATTEMPT',
        run,
        `${run} is a FINISHED attempt of ${variant.id}; FS v9 counts every FINISHED, non-deprecated Run as evidence — deprecate it or adopt it`,
        ['deprecate', 'adopt'],
        run,
      )
      if (choice === 'deprecate') work.deprecate.add(run)
    }
  if (linked.length > 0) {
    work.readmeRuns = [
      ...work.readmeRuns,
      ...linked.filter((run) => !work.readmeRuns.includes(run)),
    ]
    work.readmeAfter = patchRunFrontMatter(work.readmeAfter, {
      runs: `[${work.readmeRuns.map((run) => JSON.stringify(run)).join(', ')}]`,
    })
  }
  const effectiveRecord = async (run: string): Promise<SummaryRunRecord | null> => {
    const value = await context.runRecord(run)
    if (!value) return null
    return work.deprecate.has(run) ? { ...value, deprecated: true } : value
  }

  // Sidecars of listed Runs.
  const sidecars = new Map<string, SidecarRows>()
  if (context.sidecarName) {
    for (const run of listing.keys()) {
      if (!isRunPath(run)) continue
      const content = await readText(join(context.root, ...run.split('/'), context.sidecarName))
      if (content === null) continue
      const sidecar = readSidecar(content)
      if (!sidecar) {
        context.notice({
          code: 'SIDECAR_UNKNOWN_SHAPE',
          experiment: id,
          run,
          message: `${run}/${context.sidecarName} has neither legacy shape; it is left untouched`,
        })
        continue
      }
      const owner = keeper.get(run) ?? listing.get(run)![0]!
      if (sidecar.variant && sidecar.variant !== owner) {
        const choices = [
          owner,
          ...(v8.variants.some((variant) => variant.id === sidecar.variant)
            ? [sidecar.variant]
            : []),
        ]
        const choice = resolve(
          'SIDECAR_VARIANT_CONFLICT',
          run,
          `${run}/${context.sidecarName} names ${sidecar.variant} but ${owner} lists the Run; choose the Variant`,
          choices,
          run,
        )
        if (choice && choice !== owner) keeper.set(run, choice)
      }
      sidecars.set(run, sidecar)
    }
  }
  // Existing result files of listed Runs → keep or replace.
  const keepExisting = new Set<string>()
  for (const run of listing.keys()) {
    if (!isRunPath(run) || dropped.has(run)) continue
    const existing = await readText(join(context.root, ...run.split('/'), RESULT_FILE_NAME))
    if (existing === null) continue
    const choice = resolve(
      'RESULT_FILE_EXISTS',
      run,
      `${run}/${RESULT_FILE_NAME} already exists and was not planned by memon; keep it or replace it with the migrated rows`,
      ['keep', 'replace'],
      run,
    )
    if (choice === 'keep') keepExisting.add(run)
    if (choice === undefined) keepExisting.add(run)
    if (choice === 'keep') {
      const parsed = parseResultFile(existing)
      if (!parsed.ok || parsed.schemaVersion !== 1)
        context.notice({
          code: 'RESULT_FILE_KEPT_INVALID',
          experiment: id,
          run,
          message: `${run}/${RESULT_FILE_NAME} is kept but is not a version-1 result table; the summary will fail until it is fixed`,
        })
    }
  }

  // Columns and their conversions.
  const description = work.description
  const metricCells = new Map<string, ClassifiedCell[]>()
  for (const variant of v8.variants)
    for (const [key, value] of Object.entries(variant.metrics)) {
      const list = metricCells.get(key) ?? []
      list.push(classifyV8Cell(value))
      metricCells.set(key, list)
    }
  const conversion = new Map<string, ColumnConversion>()
  for (const [key, cells] of metricCells) {
    const decided = columnConversion(cells)
    conversion.set(key, decided)
    if (decided === 'verbatim' && cells.some((cell) => cell.kind === 'stats'))
      context.notice({
        code: 'RESULT_STATS_NOT_CONVERTED',
        experiment: id,
        path: `metrics.${key}`,
        message: `metrics.${key} mixes statistics strings with other values; every value is kept verbatim`,
      })
  }
  const declared = new Set<string>()
  const pathOf = (partition: 'params' | 'metrics', key: string) => {
    const mapped = v8KeyPath(partition, key)
    if (mapped.sanitized) {
      context.count('pathsSanitized')
      context.notice({
        code: 'RESULT_PATH_SANITIZED',
        experiment: id,
        path: mapped.path,
        message: `v8 key "${key}" becomes ${mapped.path}`,
      })
    }
    return mapped.path
  }
  for (const column of v8.columns) {
    const partition = column.group === 'parameter' ? 'params' : 'metrics'
    const path = pathOf(partition, column.key)
    declared.add(`${column.group}:${column.key}`)
    const annotation = v8.annotations[column.key] ?? {}
    const decided =
      partition === 'metrics' ? (conversion.get(column.key) ?? 'verbatim') : 'verbatim'
    if (decided === 'group') {
      description.groups[path] = {
        label: column.label,
        ...(annotation.description ? { description: annotation.description } : {}),
      }
      context.count('jsonGroupColumns')
      continue
    }
    const type =
      decided === 'stats'
        ? 'stats'
        : decided === 'list'
          ? 'list'
          : (['string', 'number', 'boolean', 'enum'] as const).includes(column.type as 'string')
            ? (column.type as DescriptionColumn['type'])
            : 'string'
    const entry: DescriptionColumn = { path, label: column.label, type }
    if (type === 'enum')
      entry.options = column.options && column.options.length > 0 ? column.options : ['']
    if (annotation.description) entry.description = annotation.description
    if (annotation.value_descriptions && Object.keys(annotation.value_descriptions).length > 0)
      entry.valueDescriptions = annotation.value_descriptions
    description.columns.push(entry)
  }
  for (const [key, annotation] of Object.entries(v8.annotations))
    if (
      !v8.columns.some((column) => column.key === key) &&
      (annotation.description || annotation.value_descriptions)
    )
      context.notice({
        code: 'ANNOTATION_WITHOUT_COLUMN',
        experiment: id,
        message: `column_annotations.${key} annotates no declared column and is not carried over`,
      })
  for (const variant of v8.variants) {
    for (const key of Object.keys(variant.parameters))
      if (!declared.has(`parameter:${key}`)) context.count('undeclaredKeys')
    for (const key of Object.keys(variant.metrics))
      if (!declared.has(`metric:${key}`)) context.count('undeclaredKeys')
  }

  // Env columns (hidden by default through the env partition).
  const envNames = new Set<string>()
  for (const variant of v8.variants)
    for (const name of Object.keys(record(variant.provenance?.env))) envNames.add(name)
  for (const name of [...envNames].sort()) {
    const path = `env.${sanitizeSegment(name)}`
    if (!description.columns.some((column) => column.path === path))
      description.columns.push({ path, label: name, type: 'string' })
  }
  if (Object.keys(v8.extra).length > 0) description.extra = { ...v8.extra }

  // Variants.
  for (const variant of v8.variants) {
    const runs = [...new Set([...variant.runs, ...variant.attempts])].filter(
      (run) => !dropped.has(run) && (keeper.get(run) ?? variant.id) === variant.id,
    )
    const values: Record<string, ResultValue> = {}
    for (const [key, value] of Object.entries(variant.parameters))
      values[pathOf('params', key)] = (value ?? null) as ResultValue
    for (const [name, value] of Object.entries(record(variant.provenance?.env))) {
      const text = typeof value === 'string' ? value : value === null ? '' : String(value)
      if (typeof value !== 'string') {
        context.count('envCoerced')
        context.notice({
          code: 'RESULTS_ENV_VALUE_COERCED',
          experiment: id,
          variant: variant.id,
          path: `env.${name}`,
          message: `${variant.id} env.${name} ${JSON.stringify(value)} becomes the string ${JSON.stringify(text)}`,
        })
      }
      values[`env.${sanitizeSegment(name)}`] = text
    }
    const provenance = record(variant.provenance)
    const extraProvenance = Object.fromEntries(
      Object.entries(provenance).filter(
        ([key]) => !['repo', 'commit', 'entry', 'recipe', 'env'].includes(key),
      ),
    )
    const next: DescriptionVariant = {
      id: variant.id,
      name: variant.name,
      ...(variant.description !== undefined ? { description: variant.description } : {}),
      ...(variant.status && DECLARABLE.has(variant.status)
        ? { status: variant.status as VariantStatus }
        : {}),
      values,
      ...(variant.provenance
        ? {
            provenance: {
              ...(typeof provenance.repo === 'string' ? { repo: provenance.repo } : {}),
              ...(typeof provenance.commit === 'string' ? { commit: provenance.commit } : {}),
              ...(typeof provenance.entry === 'string' ? { entry: provenance.entry } : {}),
              ...(typeof provenance.recipe === 'string' ? { recipe: provenance.recipe } : {}),
              ...(Object.keys(extraProvenance).length > 0 ? { extra: extraProvenance } : {}),
            },
          }
        : {}),
      runs,
      ...(Object.keys(variant.extra).length > 0 ? { extra: { ...variant.extra } } : {}),
    }
    if (variant.status) work.v8Statuses.set(variant.id, variant.status)

    // Metric rows of this Variant.
    const rows: ConvertedRow[] = []
    for (const [key, value] of Object.entries(variant.metrics)) {
      const path = pathOf('metrics', key)
      const converted = convertedRows(
        path,
        classifyV8Cell(value),
        conversion.get(key) ?? 'verbatim',
      )
      for (const code of converted.conversions) context.count(code)
      for (const code of converted.conversions.filter((item) => item.startsWith('RESULT_')))
        context.notice({
          code,
          experiment: id,
          variant: variant.id,
          path,
          message: `${variant.id} ${path} keeps its v8 text ${JSON.stringify(value)}`,
        })
      rows.push(...converted.rows)
      work.expectedCells.push(...expectations(variant.id, converted.rows))
    }
    for (const [key, value] of Object.entries(variant.parameters))
      work.expectedCells.push({
        variant: variant.id,
        path: pathOf('params', key),
        expect: { kind: 'scalar', value: (value ?? null) as ResultValue },
      })
    for (const [name, value] of Object.entries(record(variant.provenance?.env)))
      work.expectedCells.push({
        variant: variant.id,
        path: `env.${sanitizeSegment(name)}`,
        expect: {
          kind: 'scalar',
          value: typeof value === 'string' ? value : value === null ? '' : String(value),
        },
      })

    // Attribution: the single adopted Run when it will be evidence; else frozen.
    const adopted = variant.runs.filter((run) => runs.includes(run))
    let target: string | null = null
    if (variant.runs.length === 1 && adopted.length === 1 && isRunPath(adopted[0]!)) {
      const run = adopted[0]!
      const recordValue = await effectiveRecord(run)
      const exists = await isDirectory(join(context.root, ...run.split('/')))
      if (
        exists &&
        recordValue?.status === 'FINISHED' &&
        !recordValue.deprecated &&
        !keepExisting.has(run)
      )
        target = run
    }
    const frozen: DescriptionFrozenValue[] = []
    if (target) {
      const existing = work.resultRows.get(target) ?? []
      work.resultRows.set(target, [...existing, ...rows])
    } else {
      for (const row of rows) frozen.push({ path: row.path, stat: row.stat, value: row.value })
    }
    const listedMembers = runs.filter((run) => work.readmeRuns.includes(run))
    const derivedV8 = variant.status && !DECLARABLE.has(variant.status)
    if (frozen.length > 0 || (listedMembers.length === 0 && derivedV8)) {
      next.frozen = {
        ...(variant.status && (VARIANT_STATUS_VALUES as readonly string[]).includes(variant.status)
          ? { status: variant.status as VariantStatus }
          : {}),
        runs: [...variant.runs],
        source: `${LEGACY_RESULTS_FILE}@${blobId}`,
        values: frozen,
      }
      work.summary.frozenVariants += 1
      context.count('frozenValues', frozen.length)
    }
    description.variants.push(next)
    context.count('variants')
  }

  // Sidecar rows.
  for (const [run, sidecar] of sidecars) {
    if (keepExisting.has(run) || dropped.has(run)) continue
    const owner = keeper.get(run) ?? listing.get(run)![0]!
    const variant = description.variants.find((candidate) => candidate.id === owner)
    if (!variant) continue
    const rows = work.resultRows.get(run) ?? []
    const has = (path: string, stat: string | null) =>
      rows.find((row) => row.path === path && (row.stat ?? null) === (stat ?? null))
    const add = (row: ConvertedRow) => {
      const existing = has(row.path, row.stat)
      if (!existing) rows.push(row)
      else if (!sameScalar(existing.value, row.value))
        context.notice({
          code: 'SIDECAR_VALUE_CONFLICT',
          experiment: id,
          run,
          path: row.path,
          message: `${run}: the sidecar records ${row.path}${row.stat ? `:${row.stat}` : ''} = ${JSON.stringify(row.value)}; results.yaml's ${JSON.stringify(existing.value)} is kept`,
        })
    }
    for (const [key, value] of Object.entries(sidecar.parameters)) {
      const path = v8KeyPath('params', key).path
      if (Object.hasOwn(variant.values, path) && sameScalar(variant.values[path], value)) continue
      add({ path, stat: null, value: (value ?? null) as ResultValue })
    }
    for (const [name, value] of Object.entries(sidecar.env)) {
      const path = `env.${sanitizeSegment(name)}`
      const text = typeof value === 'string' ? value : String(value)
      if (Object.hasOwn(variant.values, path) && sameScalar(variant.values[path], text)) continue
      add({ path, stat: null, value: text })
    }
    for (const [key, value] of Object.entries(sidecar.metrics)) {
      const path = v8KeyPath('metrics', key).path
      if (sidecar.statistics[key]) {
        const stats = sidecar.statistics[key]!
        if (typeof value === 'number' && typeof stats.mean === 'number' && stats.mean === value)
          continue
        add({ path: `${path}_value`, stat: null, value: (value ?? null) as ResultValue })
        continue
      }
      const decided = conversion.get(key) ?? 'verbatim'
      const cell = classifyV8Cell(value)
      const converted = convertedRows(
        path,
        cell,
        decided === 'verbatim' && v8.columns.every((column) => column.key !== key)
          ? cell.kind === 'stats'
            ? 'stats'
            : cell.kind === 'group'
              ? 'group'
              : cell.kind === 'list'
                ? 'list'
                : 'verbatim'
          : decided,
      )
      for (const row of converted.rows) add(row)
    }
    for (const [key, stats] of Object.entries(sidecar.statistics)) {
      const path = v8KeyPath('metrics', key).path
      for (const [name, value] of Object.entries(stats)) {
        const stat = (STAT_ALIASES[name] ?? name) as string
        if (isStatName(stat) && typeof value === 'number') add({ path, stat, value })
        else
          add({
            path: `${path}_${sanitizeSegment(name)}`,
            stat: null,
            value: (value ?? null) as ResultValue,
          })
      }
    }
    if (rows.length > 0) work.resultRows.set(run, rows)
    context.count('sidecarsConverted')
  }
  // Result files of kept existing files are never written.
  for (const run of keepExisting) work.resultRows.delete(run)
}

function expectations(variant: string, rows: readonly ConvertedRow[]): ExpectedCell[] {
  const byPath = new Map<string, ConvertedRow[]>()
  for (const row of rows) byPath.set(row.path, [...(byPath.get(row.path) ?? []), row])
  const out: ExpectedCell[] = []
  for (const [path, list] of byPath) {
    const stats = list.filter((row) => row.stat !== null && typeof row.value === 'number')
    if (stats.length > 0)
      out.push({
        variant,
        path,
        expect: {
          kind: 'stats',
          stats: Object.fromEntries(stats.map((row) => [row.stat!, row.value as number])),
        },
      })
    else out.push({ variant, path, expect: { kind: 'scalar', value: list[0]!.value } })
  }
  return out
}

async function expectedSummary(
  root: string,
  work: ExperimentWork,
  contentAfter: (path: string) => Promise<string | null>,
): Promise<ResultsSummary> {
  const description = parseExperimentDescription(
    serializeExperimentDescription(work.description),
    `${work.dir}/${EXPERIMENT_DESCRIPTION_FILE}`,
  )
  const members = []
  for (const run of [...new Set(work.readmeRuns.filter((reference) => isRunPath(reference)))]) {
    const readme = await contentAfter(`${run}/README.md`)
    members.push({
      path: run,
      record: readme === null ? null : summaryRunRecord(readme),
      result: await contentAfter(`${run}/${RESULT_FILE_NAME}`),
    })
  }
  void root
  return generateResultsSummary({
    experimentId: work.id,
    experimentDir: work.dir,
    description,
    members,
    inputs: {},
    newestInputMtime: null,
    generatedAt: formatIsoLocal(new Date(0)),
    generator: { release: 'migration', role: 'migration' },
  })
}

const lintKey = (diagnostic: { code: string; file: string; field?: string }) =>
  `${diagnostic.code}|${diagnostic.file}|${diagnostic.field ?? ''}`

async function bundleLintErrors(
  root: string,
  id: string,
  readme: string,
  descriptionContent: string,
  resultContent: (run: string) => Promise<string | null>,
): Promise<string[]> {
  const folder = join(root, EXPERIMENTS, id)
  const parsed = parseExperimentReadme(readme, id)
  const documents = await readExperimentManagedDocuments(folder)
  documents.results = { ...documents.results, exists: false, parseErrors: [] }
  documents.description = parseExperimentDescription(
    descriptionContent,
    join(folder, EXPERIMENT_DESCRIPTION_FILE),
  )
  const experiment = buildExperimentRecord(parsed, {
    id,
    project: '(migration)',
    path: join(folder, 'README.md'),
    mtime: 0,
    documents,
  })
  const resultFiles = []
  for (const run of [
    ...new Set(parsed.frontMatter.runs.filter((reference) => isRunPath(reference))),
  ]) {
    const content = await resultContent(run)
    if (content !== null)
      resultFiles.push({ run, parsed: parseResultFile(content, `${run}/${RESULT_FILE_NAME}`) })
  }
  return lintExperimentDocument(experiment, { resultFiles })
    .filter((diagnostic) => diagnostic.severity === 'error')
    .map(lintKey)
    .sort()
}

async function expectedLint(
  root: string,
  work: ExperimentWork,
  contentAfter: (path: string) => Promise<string | null>,
): Promise<string[]> {
  return bundleLintErrors(
    root,
    work.id,
    work.readmeAfter,
    serializeExperimentDescription(work.description),
    (run) => contentAfter(`${run}/${RESULT_FILE_NAME}`),
  )
}

function compareCells(
  experiment: string,
  expected: readonly ExpectedCell[],
  summary: ResultsSummary,
): Array<{ key: string; message: string }> {
  const out: Array<{ key: string; message: string }> = []
  if (summary.outcome !== 'ok') {
    out.push({
      key: `${experiment}|*|*`,
      message: `${experiment}: the summary fails with ${summary.error?.code}: ${summary.error?.message}`,
    })
    return out
  }
  for (const cell of expected) {
    const variant = summary.variants.find((candidate) => candidate.id === cell.variant)
    const actual = variant?.cells[cell.path]
    let ok = false
    if (cell.expect.kind === 'scalar') {
      const want = cell.expect.value
      if (want === null) ok = !actual || (actual.kind === 'value' && actual.value === null)
      else if (actual?.kind === 'value') ok = sameScalar(actual.value, want)
      if (!ok && actual?.differs_from_plan) ok = sameScalar(actual.planned ?? null, want)
    } else if (actual?.kind === 'stats' && actual.over !== 'run') {
      const stats = cell.expect.stats
      ok = Object.entries(stats).every(([stat, value]) => actual.values[stat] === value)
    }
    if (!ok)
      out.push({
        key: `${experiment}|${cell.variant}|${cell.path}`,
        message: `${experiment} ${cell.variant} ${cell.path}: the summary shows ${actual ? JSON.stringify(actual.kind === 'value' ? actual.value : actual.kind === 'stats' ? actual.values : actual.per_run) : 'nothing'} instead of the v8 value ${JSON.stringify(cell.expect.kind === 'scalar' ? cell.expect.value : cell.expect.stats)}`,
      })
  }
  return out
}

// ---------- apply ----------

export interface ResultsMigrationReceipt {
  version: 1
  migration: 'v8-to-v9'
  root: string
  appliedAt: string
  markerBefore: string
  markerAfter: string
  indexExisted: boolean
  commit: string | null
  /** Touched project-relative paths and whether each existed before. */
  files: Array<{ path: string; existed: boolean }>
  counts: Record<string, number>
}

export interface ApplyResultsMigrationOptions {
  git?: GitCommandRunner
  /** Commit the touched paths in Git mode (default true). */
  commit?: boolean
  now?: () => Date
}

export interface ApplyResultsMigrationResult {
  status: 'migrated' | 'refreshed'
  commit: string | null
  backup: string | null
  changed: string[]
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  let mode: number | undefined
  try {
    mode = (await fs.stat(path)).mode & 0o7777
  } catch {}
  const temporary = join(dirname(path), `.memon-migrate-${randomUUID()}`)
  try {
    await fs.writeFile(temporary, content, { flag: 'wx', ...(mode === undefined ? {} : { mode }) })
    await fs.rename(temporary, path)
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

async function restoreIndex(root: string, backup: string, existed: boolean): Promise<void> {
  await fs.rm(join(root, INDEX), { recursive: true, force: true })
  if (existed) await fs.cp(join(backup, 'memon-index'), join(root, INDEX), { recursive: true })
}

async function restoreFiles(
  root: string,
  backup: string,
  receipt: ResultsMigrationReceipt,
): Promise<void> {
  for (const file of receipt.files) {
    const target = join(root, ...file.path.split('/'))
    if (file.existed)
      await writeAtomic(
        target,
        await fs.readFile(join(backup, 'files', ...file.path.split('/')), 'utf8'),
      )
    else await fs.rm(target, { force: true })
  }
}

/**
 * Apply a reviewed plan. Backs up every touched file and the index to
 * `backupDirectory` (outside the project), writes the planned files, rebuilds
 * the index and every summary, verifies, then writes marker 9 last and (git)
 * commits exactly the touched paths. A failed verification restores every
 * file and the index and leaves marker 8. On a migrated project it only
 * refreshes the index and the summaries.
 */
export async function applyResultsMigration(
  plan: ResultsMigrationPlan,
  backupDirectory: string | null,
  options: ApplyResultsMigrationOptions = {},
): Promise<ApplyResultsMigrationResult> {
  const git = options.git ?? execFileGitCommand
  const clock = options.now ?? (() => new Date())
  if (plan.version !== 1 || plan.migration !== 'v8-to-v9')
    throw new Error('Not a v8-to-v9 migration plan')
  if (plan.unresolved.length > 0)
    throw new Error(`Migration plan has unresolved blockers: ${plan.unresolved.join('; ')}`)
  const root = await fs.realpath(plan.root)
  if (root !== plan.root) throw new Error('Migration root mismatch')
  const markerRaw = await readText(join(root, MARKER))
  if (markerRaw === null || sha256(markerRaw) !== plan.marker.hash)
    throw new Error(`Stale migration plan: ${MARKER} changed since planning`)
  const cli = plan.runDirs?.source === 'cli' ? { cliRunDirs: plan.runDirs.patterns } : {}
  if (plan.alreadyMigrated) {
    const rebuilt = await rebuildIndex(root, { role: 'migration', ...cli })
    if (rebuilt.status !== 'rebuilt') throw new Error(`index rebuild failed (${rebuilt.status})`)
    await rebuildResultsSummaries(root, { role: 'migration' })
    return { status: 'refreshed', commit: null, backup: null, changed: [] }
  }
  if (backupDirectory === null) throw new Error('A backup directory is required')
  const backup = resolve(backupDirectory)
  if (backup === root || backup.startsWith(root + sep))
    throw new Error('Backup must be outside the project')
  if (plan.git && !plan.allowDirty) {
    const status = await gitOk(git, root, ['status', '--porcelain', '--untracked-files=normal'])
    if (status.trim())
      throw new Error('Dirty worktree; explicit scoped migration approval is required')
  }
  for (const file of plan.files) {
    const current = await readText(join(root, ...file.path.split('/')))
    const hash = current === null ? null : sha256(current)
    if (hash !== file.beforeHash)
      throw new Error(`Stale migration plan: ${file.path} changed since planning`)
  }

  await fs.mkdir(backup, { mode: 0o700 })
  const indexExisted = await isDirectory(join(root, INDEX))
  if (indexExisted) await fs.cp(join(root, INDEX), join(backup, 'memon-index'), { recursive: true })
  for (const file of plan.files) {
    if (file.before === null) continue
    const target = join(backup, 'files', ...file.path.split('/'))
    await fs.mkdir(dirname(target), { recursive: true })
    await fs.writeFile(target, file.before, { mode: 0o600, flag: 'wx' })
  }
  await fs.writeFile(join(backup, 'marker.json'), markerRaw, { mode: 0o600, flag: 'wx' })
  const marker = JSON.parse(markerRaw) as Record<string, unknown>
  marker.fs_convention_version = 9
  marker.last_migrated_at = formatIsoLocal(clock())
  const markerAfter = `${JSON.stringify(marker, null, 2)}\n`
  const receipt: ResultsMigrationReceipt = {
    version: 1,
    migration: 'v8-to-v9',
    root,
    appliedAt: marker.last_migrated_at as string,
    markerBefore: markerRaw,
    markerAfter,
    indexExisted,
    commit: null,
    files: plan.files.map((file) => ({ path: file.path, existed: file.before !== null })),
    counts: plan.counts,
  }
  const writeReceipt = () =>
    fs.writeFile(join(backup, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, {
      mode: 0o600,
    })
  await writeReceipt()

  let markerWritten = false
  try {
    for (const file of plan.files) {
      const target = join(root, ...file.path.split('/'))
      if (file.action === 'delete') await fs.rm(target, { force: true })
      else await writeAtomic(target, file.after!)
    }
    const rebuilt = await rebuildIndex(root, { role: 'migration', ...cli })
    if (rebuilt.status !== 'rebuilt')
      throw new Error(
        rebuilt.status === 'conflict'
          ? 'another process holds the derived-index lease; retry when it is released'
          : `index rebuild failed (${rebuilt.status})`,
      )
    await rebuildResultsSummaries(root, { role: 'migration' })
    const problems = await verifyApplied(root, plan, git)
    if (problems.length > 0)
      throw new Error(`migration verification failed: ${problems.join('; ')}`)
    if ((await readText(join(root, MARKER))) !== markerRaw)
      throw new Error(`Concurrent edit: ${MARKER}`)
    await writeAtomic(join(root, MARKER), markerAfter)
    markerWritten = true
    if (plan.git && options.commit !== false) {
      const paths = [...plan.files.map((file) => file.path), MARKER]
      await gitOk(git, root, ['add', '--all', '--', ...paths])
      await gitOk(git, root, ['commit', '--only', '-m', V8_TO_V9_COMMIT_MESSAGE, '--', ...paths])
      receipt.commit = (await gitOk(git, root, ['rev-parse', 'HEAD'])).trim()
    }
    await writeReceipt()
    return {
      status: 'migrated',
      commit: receipt.commit,
      backup,
      changed: plan.files.map((file) => file.path),
    }
  } catch (error) {
    if (markerWritten && receipt.commit === null) {
      await writeAtomic(join(root, MARKER), markerRaw)
      if (plan.git)
        await runGit(git, root, [
          'reset',
          '-q',
          '--',
          MARKER,
          ...plan.files.map((file) => file.path),
        ]).catch(() => null)
    }
    if (receipt.commit === null) {
      await restoreFiles(root, backup, receipt)
      await restoreIndex(root, backup, indexExisted)
    }
    throw error
  }
}

/** The post-write checks of apply (marker still 8). */
async function verifyApplied(
  root: string,
  plan: ResultsMigrationPlan,
  git: GitCommandRunner,
): Promise<string[]> {
  const problems: string[] = []
  for (const [id, expectedLint] of Object.entries(plan.expected.lint)) {
    const folder = join(root, EXPERIMENTS, id)
    const readme = await readText(join(folder, 'README.md'))
    const description = await readText(join(folder, EXPERIMENT_DESCRIPTION_FILE))
    if (readme === null || description === null) {
      problems.push(`${EXPERIMENTS}/${id}: README.md or ${EXPERIMENT_DESCRIPTION_FILE} is missing`)
      continue
    }
    const actual = await bundleLintErrors(root, id, readme, description, (run) =>
      readText(join(root, ...run.split('/'), RESULT_FILE_NAME)),
    )
    const remaining = [...expectedLint]
    for (const key of actual) {
      const index = remaining.indexOf(key)
      if (index >= 0) remaining.splice(index, 1)
      else problems.push(`${id}: new lint error ${key}`)
    }
    const loaded = await loadResultsSummary(root, id, { role: 'migration', write: false })
    if (!loaded) {
      problems.push(`${id}: the summary cannot be generated`)
      continue
    }
    for (const difference of compareCells(id, plan.expected.cells[id] ?? [], loaded.summary))
      if (!plan.expected.summaryDifferences.includes(difference.key))
        problems.push(difference.message)
  }
  if (plan.git) {
    const runs: string[] = []
    for (const id of Object.keys(plan.expected.lint)) {
      const readme = await readText(join(root, EXPERIMENTS, id, 'README.md'))
      if (readme === null) continue
      for (const run of parseExperimentReadme(readme, id).frontMatter.runs)
        if (isRunPath(run)) runs.push(run)
    }
    const resultFiles = await realResultFiles(root, runs, problems)
    for (const decision of await gitCheckIgnore(root, resultFiles))
      if (decision.ignored) problems.push(`${decision.path} is still ignored by Git`)
    const summaries = Object.keys(plan.expected.lint).map((id) => `${INDEX}/results/${id}.json`)
    for (const decision of await gitCheckIgnore(root, summaries))
      if (!decision.ignored) problems.push(`${decision.path} is not ignored by Git`)
    const before = new Set(plan.untrackedBefore ?? [])
    const planned = new Set(plan.files.map((file) => file.path))
    for (const path of await untrackedFiles(git, root))
      if (!before.has(path) && !planned.has(path))
        problems.push(`${path} became visible to Git without being planned`)
  }
  return problems
}

/**
 * Project-relative real paths of the declared Runs' result files that exist
 * (`git check-ignore` rejects a path beyond a symbolic link); a Run outside
 * the project root is reported as a problem instead.
 */
async function realResultFiles(
  root: string,
  runs: readonly string[],
  problems: string[],
): Promise<string[]> {
  const files = new Set<string>()
  for (const run of runs) {
    const resolved = await resolveRunRealPath(root, run)
    if (resolved.kind === 'missing') continue
    if (resolved.kind === 'outside') {
      problems.push(`${run} resolves outside the project root (${resolved.target})`)
      continue
    }
    if ((await readText(join(root, ...resolved.real.split('/'), RESULT_FILE_NAME))) !== null)
      files.add(`${resolved.real}/${RESULT_FILE_NAME}`)
  }
  return [...files].sort()
}

// ---------- verify / rollback ----------

export interface VerifyResultsMigrationResult {
  ok: boolean
  marker: number | null
  problems: string[]
}

/** Check a migrated project: marker 9, no results.yaml, every summary ok, a drift-free index. */
export async function verifyResultsMigration(
  projectRoot: string,
  options: { cliRunDirs?: string[]; git?: GitCommandRunner } = {},
): Promise<VerifyResultsMigrationResult> {
  const git = options.git ?? execFileGitCommand
  const root = await fs.realpath(projectRoot)
  const problems: string[] = []
  const marker = markerVersion(await readText(join(root, MARKER)))
  if (marker !== 9)
    problems.push(`${MARKER} records ${marker === null ? 'no version' : `v${marker}`}, not v9`)
  let ids: string[] = []
  try {
    ids = (await fs.readdir(join(root, EXPERIMENTS)))
      .filter((name) => EXPERIMENT_DIR_REGEX.test(name))
      .sort()
  } catch {}
  const runs: string[] = []
  for (const id of ids) {
    const folder = join(root, EXPERIMENTS, id)
    if (!(await isDirectory(folder))) continue
    const readme = await readText(join(folder, 'README.md'))
    if (readme === null) continue
    if ((await readText(join(folder, LEGACY_RESULTS_FILE))) !== null)
      problems.push(`${EXPERIMENTS}/${id}/${LEGACY_RESULTS_FILE} still exists`)
    if ((await readText(join(folder, EXPERIMENT_DESCRIPTION_FILE))) === null)
      problems.push(`${EXPERIMENTS}/${id}/${EXPERIMENT_DESCRIPTION_FILE} is missing`)
    const loaded = await loadResultsSummary(root, id, { role: 'migration', write: false })
    if (loaded && loaded.summary.outcome !== 'ok')
      problems.push(`${id}: the Results summary fails with ${loaded.summary.error?.code}`)
    for (const run of parseExperimentReadme(readme, id).frontMatter.runs)
      if (isRunPath(run)) runs.push(run)
  }
  try {
    const verified = await verifyIndex(
      root,
      options.cliRunDirs ? { cliRunDirs: options.cliRunDirs } : {},
    )
    if (verified.snapshotState !== 'ok')
      problems.push(`${INDEX}/snapshot.json is ${verified.snapshotState}`)
    if (verified.drift.length > 0)
      problems.push(`${verified.drift.length} INDEX_DRIFT record(s); run memon index rebuild`)
  } catch (error) {
    if (!(error instanceof ProjectDeclarationError)) throw error
    problems.push(error.message)
  }
  if (await gitMode(git, root)) {
    const resultFiles = await realResultFiles(root, runs, problems)
    for (const decision of await gitCheckIgnore(root, resultFiles))
      if (decision.ignored) problems.push(`${decision.path} is ignored by Git`)
  }
  return { ok: problems.length === 0, marker, problems }
}

/**
 * Undo an applied migration from its backup directory: `git revert` of the
 * migration commit while HEAD contains it, otherwise the backed-up bytes of
 * every touched file and the marker; the index is restored either way.
 */
export async function rollbackResultsMigration(
  backupDirectory: string,
  options: { git?: GitCommandRunner } = {},
): Promise<{ marker: 'reverted' | 'restored' | 'unchanged'; revertCommit: string | null }> {
  const git = options.git ?? execFileGitCommand
  const backup = resolve(backupDirectory)
  const receipt = JSON.parse(
    await fs.readFile(join(backup, 'receipt.json'), 'utf8'),
  ) as ResultsMigrationReceipt
  if (receipt.version !== 1 || receipt.migration !== 'v8-to-v9')
    throw new Error('Unsupported recovery receipt')
  const root = await fs.realpath(receipt.root)
  const current = await readText(join(root, MARKER))
  let state: 'reverted' | 'restored' | 'unchanged' = 'unchanged'
  let revertCommit: string | null = null
  if (current === receipt.markerBefore) {
    state = 'unchanged'
  } else if (current !== receipt.markerAfter) {
    throw new Error(`Concurrent edit blocks rollback: ${MARKER} changed since the migration`)
  } else if (receipt.commit !== null && (await gitMode(git, root))) {
    const contained = await runGit(git, root, [
      'merge-base',
      '--is-ancestor',
      receipt.commit,
      'HEAD',
    ])
    if (isGitCommandFailure(contained))
      throw new Error(`The migration commit ${receipt.commit} is not in HEAD; revert it by hand`)
    await gitOk(git, root, ['revert', '--no-edit', receipt.commit])
    revertCommit = (await gitOk(git, root, ['rev-parse', 'HEAD'])).trim()
    if ((await readText(join(root, MARKER))) !== receipt.markerBefore)
      throw new Error(`git revert did not restore ${MARKER}`)
    state = 'reverted'
  } else {
    await restoreFiles(root, backup, receipt)
    await writeAtomic(join(root, MARKER), receipt.markerBefore)
    state = 'restored'
  }
  await restoreIndex(root, backup, receipt.indexExisted)
  return { marker: state, revertCommit }
}
