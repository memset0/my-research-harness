// `memon show <id> [--format json|human]`
//
// In `human` mode (default for terminal use) we emit the raw README markdown
// — that's the most useful thing for a person reading on the command line.
// In `json` mode we emit a structured `{ frontMatter, body, sections }`.

import {
  mergedIndexView,
  readDerivedIndex,
  readRunDir,
  resolveRunReference,
  serializeRunMetadata,
} from '@memon/core'
import type { Command } from 'commander'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { effectiveRunDirs, runWalkOptions } from '../lib/discovery-options.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { emitHuman, emitJson, type OutputFormat } from '../lib/output.js'
import type { Globals } from '../lib/program.js'
import { resolveConfig } from '../lib/resolver.js'
import { runExperimentShow } from './experiment-doc.js'
import { runExperimentDocumentShow } from './experiment-document.js'
import { runExperimentResults, runExperimentResultsSummary } from './experiment-results.js'
import { runRunResultGet } from './run-result.js'
import { runWikiShow } from './wiki.js'

export interface ShowOptions {
  id?: string
  format: OutputFormat
  projectRoot?: string
  cwd: string
  kind?: string
  includeHistory?: boolean
  status?: string
  results?: boolean
  shape?: boolean
  section?: string
  variant?: string
  column?: string
  group?: string
  output?: string
  researchVersion?: string
}

export function registerShowCommand(program: Command, globals: () => Globals): void {
  program
    .command('show [target]')
    .description('read published inventory, or one Experiment / Run / Wiki page')
    .option('--kind <kind>', 'experiment | run | wiki (also disambiguates a slug)')
    .option('--include-history', 'include retired/archived/inactive records in inventory')
    .option('--status <statuses>', 'comma-separated status filter for inventory or Results')
    .option('--results', 'read the selected Experiment table or Run result.csv')
    .option('--shape', 'read Experiment columns and Variant identities without cell values')
    .option('--section <section>', 'read optional implementation | investigation | results')
    .option('--variant <ids>', 'Results Variant filter, comma-separated')
    .option('--column <paths>', 'Results column paths or group prefixes, comma-separated')
    .option('--group <group>', 'Results columns: parameter | metric | all')
    .option('--output <format>', 'Results format: json | human | csv | markdown | yaml')
    .option('--research-version <number>', 'inspect a historical Results version')
    .action(async (id: string | undefined, options: Omit<ShowOptions, keyof Globals | 'id'>) => {
      await runShow({ ...globals(), ...options, id })
    })
}

export async function runShow(opts: ShowOptions): Promise<void> {
  if (opts.kind && !['experiment', 'run', 'wiki'].includes(opts.kind))
    emitErrorAndExit('BAD_REQUEST', '--kind must be experiment, run or wiki')
  if ([opts.results, opts.shape, !!opts.section].filter(Boolean).length > 1)
    emitErrorAndExit('BAD_REQUEST', 'Choose only one of --results, --shape or --section')
  const hasResultOptions =
    opts.variant || opts.column || opts.group || opts.output || opts.researchVersion
  if (hasResultOptions && !opts.results && !opts.shape)
    emitErrorAndExit('BAD_REQUEST', 'Result filters require --results or --shape')
  if (!opts.id) {
    if (opts.results || opts.shape || opts.section)
      emitErrorAndExit('BAD_REQUEST', 'Select a target to read results or a section')
    return showInventory(opts)
  }
  const id = opts.id
  const experimentPath = /^docs\/experiments\/(E\d{4}-[a-z0-9-]+)(?:\/README\.md|\.md)?$/.exec(id)
  const kind =
    opts.kind ??
    (experimentPath || /^E\d/.test(id) ? 'experiment' : /^W\d/.test(id) ? 'wiki' : 'run')
  if (kind === 'experiment') {
    const idOrSlug = experimentPath?.[1] ?? id
    if (idOrSlug.includes('/') || idOrSlug.includes('\\') || idOrSlug === '..')
      emitErrorAndExit('BAD_REQUEST', 'Use an Experiment ID or slug inside the selected project')
    const input = { ...opts, idOrSlug }
    if (opts.section) return runExperimentDocumentShow({ ...input, section: opts.section })
    const researchVersion =
      opts.researchVersion === undefined ? undefined : Number(opts.researchVersion)
    if (opts.shape)
      return runExperimentResultsSummary({
        ...input,
        researchVersion,
        output: opts.output ?? opts.format,
      })
    if (opts.results)
      return runExperimentResults({
        ...input,
        researchVersion,
        variants: opts.variant,
        statuses: opts.status,
        columns: opts.column,
        columnGroup: opts.group ?? 'all',
        output: opts.output ?? opts.format,
      })
    return runExperimentShow(input)
  }
  if (opts.shape || opts.section || hasResultOptions)
    emitErrorAndExit('BAD_REQUEST', 'These options require an Experiment target')
  if (kind === 'wiki') {
    if (opts.results) emitErrorAndExit('BAD_REQUEST', '--results requires a Run or Experiment')
    return runWikiShow({ ...opts, page: id })
  }
  if (opts.results) return runRunResultGet({ ...opts, run: id })
  return showRun({ ...opts, id })
}

async function showInventory(opts: ShowOptions): Promise<void> {
  const root = singleProjectRoot(await resolveContext(opts))
  const effective = await effectiveRunDirs(root)
  const read = await readDerivedIndex(root)
  const view = mergedIndexView(read, {
    runDirs: effective.patterns,
    runDirsSource: effective.source,
  })
  if (!view || read.snapshotState !== 'ok')
    emitErrorAndExit('BAD_STATE', `Inventory is ${read.snapshotState}; run memon refresh`, {
      state: read.snapshotState,
      message: read.snapshotMessage,
    })
  if (
    view.run_dirs.length !== effective.patterns.length ||
    !effective.patterns.every((pattern) => view.run_dirs.includes(pattern))
  )
    emitErrorAndExit(
      'BAD_STATE',
      'Inventory Run locations differ; run memon refresh with the same --run-dir options',
    )
  const statuses = opts.status?.split(',').map((s) => s.trim().toUpperCase())
  const accepts = (status: string | null) => !statuses || statuses.includes(status ?? '')
  const historicalExperiments = new Set(
    Object.values(view.experiments)
      .filter((e) => e.archived || ['ARCHIVED', 'RETIRED', 'ABANDONED'].includes(e.status))
      .map((e) => e.id),
  )
  const experiments = Object.entries(view.experiments)
    .filter(
      ([, e]) => (opts.includeHistory || !historicalExperiments.has(e.id)) && accepts(e.status),
    )
    .map(([path, e]) => ({ path, id: e.id, status: e.status, ...e.row, variants: e.variants }))
  const runs = Object.entries(view.runs)
    .filter(
      ([path, r]) =>
        (opts.includeHistory ||
          (!r.archived &&
            !r.deprecated &&
            (r.row.active !== false || /^logs\/E\d{4}\/smoke\//.test(path)) &&
            !historicalExperiments.has(r.owner ?? ''))) &&
        accepts(r.status),
    )
    .map(([path, r]) => ({
      path,
      status: r.status,
      owner: r.owner,
      archived: r.archived,
      deprecated: r.deprecated,
      created_at: r.created_at,
      updated_at: r.updated_at,
      ...r.row,
    }))
  const wiki = Object.entries(view.wiki)
    .filter(([, w]) => (opts.includeHistory || !w.deprecated) && accepts(w.status))
    .map(([path, w]) => ({ path, ...w }))
  const selected = {
    ...(!opts.kind || opts.kind === 'experiment' ? { experiments } : {}),
    ...(!opts.kind || opts.kind === 'run' ? { runs } : {}),
    ...(!opts.kind || opts.kind === 'wiki' ? { wiki } : {}),
  }
  const diagnostics = [...read.skipped, ...read.pending]
  if (opts.format === 'human') {
    emitHuman(
      [
        `Published inventory: ${view.generated_at}. Direct edits require memon refresh.`,
        ...Object.entries(selected).flatMap(([kind, entries]) => [
          `${kind}: ${entries.length}`,
          ...entries.map((entry) => `  ${entry.path}  ${entry.status ?? ''}`),
        ]),
        ...(diagnostics.length ? [`Index diagnostics: ${JSON.stringify(diagnostics)}`] : []),
      ].join('\n'),
    )
    return
  }
  emitJson({ source: 'published-index', generatedAt: view.generated_at, ...selected, diagnostics })
}

async function showRun(opts: ShowOptions & { id: string }): Promise<void> {
  const config = await resolveConfig({
    projectRoot: opts.projectRoot,
    cwd: opts.cwd,
  })
  const matches: Array<{ path: string; project: string }> = []
  for (const project of config.projects) {
    const path = await resolveRunReference({ ...project, ...runWalkOptions() }, opts.id)
    if (path) matches.push({ path, project: project.name })
  }
  if (matches.length === 0) emitErrorAndExit('NOT_FOUND', `Run "${opts.id}" not found`)
  if (matches.length > 1)
    emitErrorAndExit('BAD_REQUEST', `Run "${opts.id}" is ambiguous; select --project-root`, {
      paths: matches.map((match) => match.path),
    })
  const target = matches[0]!
  const exp = await readRunDir(target.path, target.project)

  if (opts.format === 'human') {
    if (exp.recordFormat === 'json' && exp.metadata) {
      emitHuman(serializeRunMetadata(exp.metadata).trimEnd())
      return
    }
    if (!exp.hasReadme) {
      emitHuman(`(no README.md at ${exp.path})`)
      return
    }
    // Emit the raw body with reconstructed front matter so the human can copy
    // out a file. Easiest: re-derive front matter from in-memory and emit body.
    // To keep things simple, just dump the body — front matter is shown by
    // JSON output below retains structured front matter.
    emitHuman(exp.body.trimEnd())
    return
  }

  emitJson({
    id: exp.id,
    path: exp.path,
    mtime: exp.mtime,
    hasReadme: exp.hasReadme,
    recordFormat: exp.recordFormat,
    recordPath: exp.recordPath,
    recordMtime: exp.recordMtime,
    metadata: exp.metadata,
    frontMatter: exp.frontMatter,
    sections: exp.sections,
    body: exp.body,
    parseErrors: exp.parseErrors,
    parseWarnings: exp.parseWarnings,
  })
}
