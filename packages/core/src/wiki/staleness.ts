// Evidence resolution: `sources` -> project artifacts -> staleness + backlinks.
//
// A source is one of `E<NNNN>[-<slug>]`, `E<NNNN>[-<slug>]/V<NNNN>` (a Variant
// row of that Experiment's results.yaml), `H<NNNN>`, `W<NNNN>`, or a run
// directory base name. Each resolved source has a last-change time — the
// Experiment's effective updated time (frontmatter joined with its member
// runs, mirroring the experiment detail projection), the hypotheses file
// mtime, the cited page's `updated_at`, or the run's `updated_at` (README
// mtime when absent). A page is stale when any resolved source changed after
// its own `updated_at`; a deprecated page never goes stale.

import type { Experiment, Run } from '../types.js'
import { WIKI_ID_REGEX } from './types.js'

/** `E<NNNN>`, optional `-<slug>`, optional `/V<NNNN>`. */
const EXPERIMENT_SOURCE_REGEX = /^(E\d{4})(?:-([a-z0-9][a-z0-9-]*))?(?:\/(V\d{4}))?$/
const HYPOTHESIS_SOURCE_REGEX = /^H\d{4}$/
/** Run directory base name: `<slug>-<YYMMDD>-<HHMMSS>`. */
const RUN_SOURCE_REGEX = /^[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*-\d{6}-\d{6}$/

export type WikiSourceKind = 'experiment' | 'variant' | 'hypothesis' | 'wiki' | 'run'

/** Classify source syntax without looking up the referenced target. */
export function wikiSourceKind(source: string): WikiSourceKind | null {
  const experiment = EXPERIMENT_SOURCE_REGEX.exec(source)
  if (experiment) return experiment[3] === undefined ? 'experiment' : 'variant'
  if (HYPOTHESIS_SOURCE_REGEX.test(source)) return 'hypothesis'
  if (WIKI_ID_REGEX.test(source)) return 'wiki'
  if (RUN_SOURCE_REGEX.test(source)) return 'run'
  return null
}

/** The artifact lookups a set of declared `sources` actually needs. */
export interface WikiSourceReferences {
  /** Numeric `E<NNNN>` prefix of every cited Experiment or Variant. */
  experiments: string[]
  /** Cited Run directory base names. */
  runs: string[]
}

/**
 * Partition declared sources into the lookups `resolveWikiSources` performs,
 * so a caller can load metadata for exactly the cited targets instead of
 * every Experiment and Run in the project. Hypotheses and wiki pages are
 * absent by design: those resolve against one file's mtime and the pages the
 * caller already holds.
 */
export function collectWikiSourceReferences(sources: Iterable<string>): WikiSourceReferences {
  const experiments = new Set<string>()
  const runs = new Set<string>()
  for (const source of sources) {
    const experiment = EXPERIMENT_SOURCE_REGEX.exec(source)
    if (experiment) {
      experiments.add(experiment[1]!)
      continue
    }
    if (RUN_SOURCE_REGEX.test(source)) runs.add(source)
  }
  return { experiments: [...experiments], runs: [...runs] }
}

export interface WikiSourceContext {
  experiments: readonly Experiment[]
  runs: readonly Run[]
  /** `docs/hypotheses.md` mtime in epoch ms; null when the file is absent. */
  hypothesesMtime: number | null
  /**
   * Hypothesis ids declared in `docs/hypotheses.md`. When omitted every
   * well-formed `H<NNNN>` resolves (the file mtime is the only signal a
   * Backend without a parsed hypotheses index has).
   */
  hypothesisIds?: readonly string[]
}

/** A `memon-data` block's declared provenance, addressed as `data[<index>]`. */
export interface WikiDataBlockSources {
  index: number
  sources: readonly string[]
  /** ISO8601 capture time the block's rows were collected at. */
  capturedAt: string | null
}

export interface WikiSourcePage {
  id: string
  slug: string
  kind: string
  sources: readonly string[]
  updatedAt: string
  deprecated?: boolean
  dataBlocks?: readonly WikiDataBlockSources[]
}

export interface WikiSourceResolution {
  /** The entry exactly as declared, used as the `staleSources` token. */
  source: string
  kind: WikiSourceKind | null
  /** Canonical artifact key (`E0017-fused-attention`, `V` form kept), or null. */
  artifact: string | null
  /** Last-change time in epoch ms; null when unresolved or untimed. */
  lastChangedAt: number | null
  /** The source changed after the page's `updated_at`. */
  changedAfterPage: boolean
}

export interface WikiPageStaleness {
  id: string
  stale: boolean
  /** Offending entries in declaration order; `data[<n>]:<source>` for blocks. */
  staleSources: string[]
  /** Entries that resolved to nothing, in declaration order. */
  unresolvedSources: string[]
  resolutions: WikiSourceResolution[]
}

export interface WikiSourceIndex {
  /** Page id -> staleness projection. */
  pages: Map<string, WikiPageStaleness>
  /**
   * Artifact key -> citing page ids, newest `updated_at` first. Experiments
   * are indexed under both the bare id and the id-with-slug form, and a
   * Variant citation also indexes its Experiment.
   */
  backlinks: Map<string, string[]>
}

/**
 * Resolve every page's `sources` (and `memon-data` block sources) against the
 * project's Experiments, Runs, Hypotheses, and wiki pages.
 */
export function resolveWikiSources(
  pages: readonly WikiSourcePage[],
  ctx: WikiSourceContext,
): WikiSourceIndex {
  const runsById = new Map(ctx.runs.map((run) => [run.id, run]))
  const experimentsByNumericId = new Map<string, Experiment>()
  for (const experiment of ctx.experiments) {
    const numeric = experiment.id.slice(0, 5)
    if (!experimentsByNumericId.has(numeric)) experimentsByNumericId.set(numeric, experiment)
  }
  const pagesById = new Map(pages.map((page) => [page.id, page]))
  const hypothesisIds = ctx.hypothesisIds ? new Set(ctx.hypothesisIds) : null
  const experimentUpdated = new Map<string, number | null>()

  const result: WikiSourceIndex = { pages: new Map(), backlinks: new Map() }
  const backlinkSets = new Map<string, Set<string>>()

  for (const page of pages) {
    const pageUpdatedAt = toEpochMs(page.updatedAt)
    const resolutions: WikiSourceResolution[] = []
    const staleSources: string[] = []
    const unresolvedSources: string[] = []

    const consider = (source: string, token: string, referenceAt: number | null): void => {
      const resolution = resolveSource(source, {
        experimentsByNumericId,
        experimentUpdated,
        runsById,
        pagesById,
        hypothesisIds,
        hypothesesMtime: ctx.hypothesesMtime,
      })
      if (!resolution.kind) {
        unresolvedSources.push(token)
        resolutions.push({ ...resolution, source: token, changedAfterPage: false })
        return
      }
      if (resolution.artifact) {
        for (const key of backlinkKeys(resolution)) {
          let set = backlinkSets.get(key)
          if (!set) {
            set = new Set<string>()
            backlinkSets.set(key, set)
          }
          set.add(page.id)
        }
      }
      const changedAfterPage =
        referenceAt !== null &&
        resolution.lastChangedAt !== null &&
        resolution.lastChangedAt > referenceAt
      if (changedAfterPage) staleSources.push(token)
      resolutions.push({ ...resolution, source: token, changedAfterPage })
    }

    for (const source of page.sources) consider(source, source, pageUpdatedAt)
    for (const block of page.dataBlocks ?? []) {
      const capturedAt = block.capturedAt === null ? pageUpdatedAt : toEpochMs(block.capturedAt)
      for (const source of block.sources) {
        consider(source, `data[${block.index}]:${source}`, capturedAt)
      }
    }

    // A deprecated page is not expected to track its evidence any more.
    const deprecated = page.deprecated === true
    result.pages.set(page.id, {
      id: page.id,
      stale: !deprecated && staleSources.length > 0,
      staleSources: deprecated ? [] : staleSources,
      unresolvedSources,
      resolutions,
    })
  }

  for (const [artifact, ids] of backlinkSets) {
    const ordered = [...ids].sort((a, b) => {
      const left = toEpochMs(pagesById.get(a)?.updatedAt ?? '') ?? 0
      const right = toEpochMs(pagesById.get(b)?.updatedAt ?? '') ?? 0
      if (left !== right) return right - left
      return a < b ? -1 : 1
    })
    result.backlinks.set(artifact, ordered)
  }
  return result
}

interface ResolveDeps {
  experimentsByNumericId: Map<string, Experiment>
  experimentUpdated: Map<string, number | null>
  runsById: Map<string, Run>
  pagesById: Map<string, WikiSourcePage>
  hypothesisIds: Set<string> | null
  hypothesesMtime: number | null
}

function resolveSource(
  source: string,
  deps: ResolveDeps,
): Omit<WikiSourceResolution, 'changedAfterPage'> {
  const unresolved = { source, kind: null, artifact: null, lastChangedAt: null } as const

  const experimentMatch = EXPERIMENT_SOURCE_REGEX.exec(source)
  if (experimentMatch) {
    const numericId = experimentMatch[1]!
    const slug = experimentMatch[2]
    const variantId = experimentMatch[3]
    const experiment = deps.experimentsByNumericId.get(numericId)
    if (!experiment) return unresolved
    // `E0017-wrong-slug` names a different document than the one on disk.
    if (slug !== undefined && experiment.id !== `${numericId}-${slug}`) return unresolved
    if (variantId !== undefined && !experimentHasVariant(experiment, variantId)) return unresolved
    let lastChangedAt = deps.experimentUpdated.get(experiment.id)
    if (lastChangedAt === undefined) {
      lastChangedAt = experimentEffectiveUpdatedAtMs(experiment, deps.runsById)
      deps.experimentUpdated.set(experiment.id, lastChangedAt)
    }
    return {
      source,
      kind: variantId === undefined ? 'experiment' : 'variant',
      artifact: variantId === undefined ? experiment.id : `${experiment.id}/${variantId}`,
      lastChangedAt,
    }
  }

  if (HYPOTHESIS_SOURCE_REGEX.test(source)) {
    if (deps.hypothesisIds && !deps.hypothesisIds.has(source)) return unresolved
    if (!deps.hypothesisIds && deps.hypothesesMtime === null) return unresolved
    return {
      source,
      kind: 'hypothesis',
      artifact: source,
      lastChangedAt: deps.hypothesesMtime,
    }
  }

  if (WIKI_ID_REGEX.test(source)) {
    const target = deps.pagesById.get(source)
    if (!target) return unresolved
    return {
      source,
      kind: 'wiki',
      artifact: source,
      lastChangedAt: toEpochMs(target.updatedAt),
    }
  }

  if (RUN_SOURCE_REGEX.test(source)) {
    const run = deps.runsById.get(source)
    if (!run) return unresolved
    return {
      source,
      kind: 'run',
      artifact: source,
      lastChangedAt: runLastChangedAtMs(run),
    }
  }

  return unresolved
}

/**
 * Experiment effective updated time in epoch ms: the document's `updated_at`
 * joined with every member run's, matching `citedBy`/detail projections.
 */
export function experimentEffectiveUpdatedAtMs(
  experiment: Experiment,
  runsById: ReadonlyMap<string, Run>,
): number | null {
  let newest = toEpochMs(experiment.frontMatter.updatedAt)
  for (const runId of experiment.frontMatter.runs) {
    const run = runsById.get(runId)
    if (!run) continue
    const runUpdated = runLastChangedAtMs(run)
    if (runUpdated !== null && (newest === null || runUpdated > newest)) newest = runUpdated
  }
  return newest
}

/** Run `updated_at`, falling back to the README mtime when it is absent. */
export function runLastChangedAtMs(run: Run): number | null {
  const declared = toEpochMs(run.frontMatter.updatedAt)
  if (declared !== null) return declared
  const mtime = run.readmeMtime || run.mtime
  return mtime > 0 ? mtime : null
}

function experimentHasVariant(experiment: Experiment, variantId: string): boolean {
  const variants = experiment.documents?.results.data?.variants
  if (!variants) return false
  return variants.some((variant) => variant.id === variantId)
}

function backlinkKeys(resolution: Omit<WikiSourceResolution, 'changedAfterPage'>): string[] {
  const artifact = resolution.artifact
  if (!artifact) return []
  if (resolution.kind !== 'experiment' && resolution.kind !== 'variant') return [artifact]
  const experimentId = artifact.split('/')[0]!
  const keys = new Set<string>([artifact, experimentId, experimentId.slice(0, 5)])
  return [...keys]
}

function toEpochMs(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}
