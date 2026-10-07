import { resolveProjectExecution } from '@memon/backend'
// Process-wide instance configuration and primitive Store initialization.
// Legacy containers stay empty; requests use shared domain services.
//
// Lifecycle:
//   - Initialized lazily on first request (so importing the module is cheap)
//   - Configuration initialized at startup without project scans
//   - Shared across separately bundled routes and Next.js dev reloads
//
// Production model: `memon serve` spawns Next.js with MEMON_CONFIG_PATH set;
// in dev `pnpm --filter @memon/web dev` we walk up to find the repo's
// instance config.yml. The committed config.example.yml is never a runtime
// configuration source.

import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import {
  type AuthConfig,
  CODE_REVIEW_FILENAME_REGEX,
  type CodeReviewSummary,
  type Config,
  configureFileAgentAdapters,
  configureProjectFileCache,
  configureProjectFileStore,
  EXPERIMENT_DESCRIPTION_FILE,
  EXPERIMENT_DIR_REGEX,
  EXPERIMENT_FILENAME_REGEX,
  type Experiment,
  type ExperimentMembershipAnomaly,
  LEGACY_RESULTS_FILE,
  loadConfig,
  MANAGED_DOCUMENT_FILE_NAMES,
  type ParsedHypotheses,
  type ParsedJournal,
  Poller,
  parseHypotheses,
  parseJournal,
  projectRunPath,
  REPORT_FILENAME_REGEX,
  type ReportSummary,
  type Run,
  RunIndex,
} from '@memon/core'
import { basename, dirname, join } from '@memon/file-protocol/paths'
import { ensureAuthInitialised } from './auth/first-run'
import { DirCache } from './runtime/dir-cache'
import { FileCache } from './runtime/file-cache'
import { WikiCache } from './runtime/wiki-cache'
import { resolveRuntimeConfigPath } from './runtime-config-path'
import { probeSqueue } from './slurm/probe'

export interface ExperimentChangeEvent {
  type: 'set' | 'delete'
  experiment?: Run
  id: string
}

export interface SlurmRuntimeState {
  /** True iff `Config.slurm.totalNodes !== -1` AND the startup probe passed. */
  enabled: boolean
  /** Mirror of `Config.slurm.totalNodes` when enabled; `-1` otherwise. */
  totalNodes: number
  /** Probe outcome. False when the probe was skipped (feature disabled). */
  supported: boolean
}

/**
 * The Experiment that declares `run`, derived from Experiment `runs[]`
 * declarations only (FS v7: the Run README never carries ownership). A
 * canonical project-relative path matches directly; a legacy bare Run ID
 * matches only when no other Run in the project shares that base name. Zero
 * or several declaring Experiments yield null (the latter is a
 * MISMATCH_EXPERIMENT_REF anomaly, never a guessed parent).
 */
export function declaredParentExperimentId(
  experiments: Iterable<Experiment>,
  root: string,
  run: Run,
  projectRuns: readonly Run[],
): string | null {
  let reference: string
  try {
    reference = projectRunPath(root, run.path)
  } catch {
    return null
  }
  const legacyUnique = projectRuns.filter((candidate) => candidate.id === run.id).length <= 1
  const owners: string[] = []
  for (const experiment of experiments) {
    const runs = experiment.frontMatter.runs
    if (runs.includes(reference) || (legacyUnique && runs.includes(run.id)))
      owners.push(experiment.id)
  }
  return owners.length === 1 ? owners[0]! : null
}

export class Runtime {
  /** Set when init() resolves; used by /api/runtime/health */
  public warmupAt: number = Date.now()
  /** Most recent error during init or background refresh */
  public lastError: string | null = null

  constructor(
    public readonly config: Config,
    public readonly configPath: string,
    public readonly index: RunIndex,
    public readonly poller: Poller,
    public readonly events: EventEmitter,
    public readonly hypothesesCache: FileCache<ParsedHypotheses>,
    public readonly journalCache: FileCache<ParsedJournal>,
    public readonly reportsCache: DirCache<ReportSummary>,
    public readonly codeReviewsCache: DirCache<CodeReviewSummary>,
    public readonly wikiCache: WikiCache,
    public readonly auth: AuthConfig,
    /**
     * v3 experiment-doc index, keyed by `E<NNNN>-<slug>`. Shared by reference
     * with the poller closure so poll-driven mutations and API reads see the
     * same Map.
     */
    public readonly experiments: Map<string, Experiment>,
    /**
     * v3 anomaly snapshot per project name. Mutated by recomputeAnomalies();
     * /api/anomalies reads in O(1).
     */
    public readonly anomaliesByProject: Map<string, ExperimentMembershipAnomaly[]>,
    /**
     * Recompute closure shared with the poller (so both reference the same
     * `experiments` / `anomaliesByProject` maps and emit the same SSE
     * `anomaly` topic on each recompute).
     */
    public readonly recomputeAnomalies: (projectName: string) => Promise<void>,
    /**
     * Slurm feature state captured at init time. `/api/slurm/status` reads
     * this; when `enabled === false` the API short-circuits to
     * `{ enabled: false }` without spawning `squeue`.
     */
    public readonly slurm: SlurmRuntimeState,
  ) {}

  /**
   * Stamp `run` with the parent derived from the current Experiment
   * declarations (the in-memory `frontMatter.experiment` is a projection,
   * never the file's legacy field) and return it.
   */
  withDeclaredParent(run: Run): string | null {
    const project = this.config.projects.find((candidate) => candidate.name === run.project)
    const parent = project
      ? declaredParentExperimentId(
          Array.from(this.experiments.values()).filter(
            (experiment) => experiment.project === project.name,
          ),
          project.root,
          run,
          this.index.list({ project: project.name, includeDeprecated: true }),
        )
      : null
    run.frontMatter.experiment = parent
    return parent
  }

  /** Reset poll backoff for the experiment whose path matches `path`. */
  pokeByPath(path: string): void {
    this.poller.resetBackoff(path)
  }

  pokeById(id: string): void {
    const exp = this.index.get(id)
    if (exp) this.poller.resetBackoff(exp.path)
  }

  /** Find the project that owns the given absolute path (or null). */
  projectFor(absolutePath: string): { name: string; root: string } | null {
    for (const p of this.config.projects) {
      if (absolutePath === p.root || absolutePath.startsWith(`${p.root}/`)) {
        return { name: p.name, root: p.root }
      }
    }
    return null
  }

  /** Path to <project>/docs/hypotheses.md for the given project name (or null). */
  hypothesesPath(project: string): string | null {
    const p = this.config.projects.find((x) => x.name === project)
    return p ? join(p.root, 'docs', 'hypotheses.md') : null
  }

  /** Path to <project>/docs/journal.md for the given project name (or null). */
  journalPath(project: string): string | null {
    const p = this.config.projects.find((x) => x.name === project)
    return p ? join(p.root, 'docs', 'journal.md') : null
  }

  /** Path to <project>/docs/reports/ for the given project (or null). */
  reportsDir(project: string): string | null {
    const p = this.config.projects.find((x) => x.name === project)
    return p ? join(p.root, 'docs', 'reports') : null
  }

  /**
   * Aggregated code-reviews for a project across the flat docs/code-review/
   * dir and every docs/experiments/E-slug/code-review/ dir, sorted by date
   * desc (ties broken by id desc).
   */
  getCodeReviewsList(project: string): CodeReviewSummary[] {
    const p = this.config.projects.find((x) => x.name === project)
    if (!p) return []
    const prefix = join(p.root, 'docs') + '/'
    return this.codeReviewsCache
      .getAllList()
      .filter((s) => s.path.startsWith(prefix))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
  }

  /**
   * Absolute path for a code-review id (the docs-relative path without the
   * .md extension) in a project. Returns null for an unknown project. The
   * caller MUST still validate via assertWithinProjectRoots().
   */
  codeReviewPath(project: string, id: string): string | null {
    const p = this.config.projects.find((x) => x.name === project)
    if (!p) return null
    return join(p.root, 'docs', `${id}.md`)
  }
}

// Next can bundle this module separately for multiple routes. Startup config
// and the shared Store/cache state must still be initialized once.
const RUNTIME_KEY = Symbol.for('memon.web-runtime.v1')

export async function getRuntime(): Promise<Runtime> {
  const shared = globalThis as typeof globalThis & { [RUNTIME_KEY]?: Promise<Runtime> }
  shared[RUNTIME_KEY] ??= init()
  return shared[RUNTIME_KEY]
}

async function init(): Promise<Runtime> {
  const configPath = await resolveRuntimeConfigPath({
    cwd: process.cwd(),
    explicitPath: process.env.MEMON_CONFIG_PATH,
  })
  if (!configPath) {
    throw new Error(
      'memon: no instance config found. Copy config.example.yml to config.yml, ' +
        'set MEMON_CONFIG_PATH, or place config.yml in the repo root',
    )
  }
  const config = await loadConfig({ explicitPath: configPath, cwd: process.cwd() })
  if (!config) {
    throw new Error(`memon: failed to load config at ${configPath}`)
  }

  // First-run init: if config.yml has no auth.password_hash, generate one,
  // write the hash back, print the plaintext once. Idempotent on subsequent
  // boots.
  const auth = await ensureAuthInitialised(configPath, config)

  // Slurm capability probe. When the user opts in via `slurm.total_nodes`,
  // we MUST be able to run `squeue --me` — refuse to start otherwise so the
  // failure surfaces at deploy time, not buried in a 500 nobody reads.
  let slurm: SlurmRuntimeState
  if (config.slurm.totalNodes === -1) {
    slurm = { enabled: false, totalNodes: -1, supported: false }
  } else {
    const target = config.projects.find((project) => project.execution !== undefined)
    if (!target)
      throw new Error(
        'memon: Slurm requires a configured execution target; set slurm.total_nodes: -1 to disable it',
      )
    const probe = await probeSqueue(resolveProjectExecution(target))
    if (!probe.supported) {
      throw new Error(
        `memon: squeue probe failed (${probe.reason ?? 'unknown'}). ` +
          `The slurm-status widget requires \`squeue --me\` to work. ` +
          `Set \`slurm.total_nodes: -1\` in ${configPath} to disable the feature.`,
      )
    }
    slurm = { enabled: true, totalNodes: config.slurm.totalNodes, supported: true }
  }

  // Startup-only scheduler configuration for the project file store. Saved
  // settings apply at boot; nothing hot-applies mid-process.
  configureProjectFileStore(config.fileAccess ?? {})
  await configureProjectFileCache(config.fileCache)

  configureFileAgentAdapters(config.fileAgents ?? {}, config.projects)
  // Compatibility containers are empty: startup never scans project storage.
  // All live readers compose shared backend services over the primitive Store.
  const index = new RunIndex()
  const events = new EventEmitter()
  events.setMaxListeners(50)
  const hypothesesCache = new FileCache<ParsedHypotheses>({
    name: 'hypotheses',
    paths: [],
    parse: parseHypotheses,
  })
  const journalCache = new FileCache<ParsedJournal>({
    name: 'journal',
    paths: [],
    parse: parseJournal,
  })
  const reportsCache = new DirCache<ReportSummary>({
    name: 'reports',
    dirs: [],
    fileNameRegex: REPORT_FILENAME_REGEX,
    parseFile: () => {
      throw new Error('Legacy cache is inactive')
    },
  })
  const codeReviewsCache = new DirCache<CodeReviewSummary>({
    name: 'code-reviews',
    dirs: [],
    fileNameRegex: CODE_REVIEW_FILENAME_REGEX,
    parseFile: () => {
      throw new Error('Legacy cache is inactive')
    },
  })
  const wikiCache = new WikiCache({
    onChange: () => {},
    onReviewChange: () => {},
    projects: [],
    context: () => ({
      experiments: [],
      runs: [],
      hypothesisIds: [],
      hypothesesMtime: null,
      reportIds: [],
    }),
  })
  const poller = new Poller(
    {
      minIntervalMs: config.poll.minIntervalMs,
      maxIntervalMs: config.poll.maxIntervalMs,
      backoffFactor: config.poll.backoffFactor,
    },
    async () => {},
  )
  return new Runtime(
    config,
    configPath,
    index,
    poller,
    events,
    hypothesesCache,
    journalCache,
    reportsCache,
    codeReviewsCache,
    wikiCache,
    auth,
    new Map(),
    new Map(),
    async () => {},
    slurm,
  )
}

async function dirMtimeOrZero(dir: string): Promise<number> {
  try {
    const stat = await fs.stat(dir)
    return stat.mtimeMs
  } catch {
    return 0
  }
}

async function fileMtimeOrZero(path: string): Promise<number> {
  try {
    const stat = await fs.stat(path)
    return stat.mtimeMs
  } catch {
    return 0
  }
}

/**
 * Bundle files watched beside README.md: the two YAML sidecars, the FS v9
 * description file `experiment.json` (the Results source) and a leftover
 * `results.yaml`, whose presence alone lint reports (`LEGACY_RESULTS_YAML`).
 * Member Runs' `result.csv` files are not watched here: the Results summary
 * notices them through its input fingerprints.
 */
const MANAGED_EXPERIMENT_FILE_NAMES = [
  MANAGED_DOCUMENT_FILE_NAMES.implementation,
  MANAGED_DOCUMENT_FILE_NAMES.investigation,
  EXPERIMENT_DESCRIPTION_FILE,
  LEGACY_RESULTS_FILE,
]

export function experimentIdForWatchedPath(
  projectRoot: string,
  watchedPath: string,
): string | null {
  const experimentsRoot = join(projectRoot, 'docs', 'experiments')
  if (!watchedPath.startsWith(`${experimentsRoot}/`)) return null
  const filename = basename(watchedPath)
  if (EXPERIMENT_DIR_REGEX.test(filename) && dirname(watchedPath) === experimentsRoot) {
    return filename
  }
  if (filename === 'README.md' || MANAGED_EXPERIMENT_FILE_NAMES.includes(filename)) {
    const parent = basename(dirname(watchedPath))
    return EXPERIMENT_DIR_REGEX.test(parent) ? parent : null
  }
  const legacy = EXPERIMENT_FILENAME_REGEX.exec(filename)
  return legacy && dirname(watchedPath) === experimentsRoot ? filename.replace(/\.md$/, '') : null
}

export async function watchExperimentBundle(poller: Poller, experiment: Experiment): Promise<void> {
  poller.watch(experiment.path, experiment.readmeMtime)
  if (basename(experiment.path) !== 'README.md') return
  const directory = dirname(experiment.path)
  poller.watch(directory, await dirMtimeOrZero(directory))
  for (const fileName of MANAGED_EXPERIMENT_FILE_NAMES) {
    const sidecar = join(directory, fileName)
    poller.watch(sidecar, await fileMtimeOrZero(sidecar))
  }
}
