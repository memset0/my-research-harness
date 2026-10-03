import {
  type Experiment,
  type LoadedResultsSummary,
  lintExperimentBundle,
  loadResultsSummary,
  MANAGED_EXPERIMENT_SECTIONS,
  type ManagedExperimentSection,
  readExperimentDoc,
  renderExperimentManagedSection,
  resolveExperimentId,
} from '@memon/core'

import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { effectiveRunDirs } from '../lib/discovery-options.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { emitJson, emitLintDiagnostics, type OutputFormat } from '../lib/output.js'

interface ExperimentDocumentBaseInput {
  projectRoot?: string
  cwd: string
  idOrSlug: string
  format: OutputFormat
}

export interface ExperimentDocumentSectionInput extends ExperimentDocumentBaseInput {
  section: string
}

/**
 * FS v9: the Results section is the projection of the generated Results
 * summary (regenerated when stale, stored best effort), or of its failure.
 * Only an exact Results pointer delegates to the summary, so it is loaded only
 * then; a conflicting README section renders the README itself.
 */
async function resultsSummaryFor(
  projectRoot: string,
  experiment: Experiment,
  section: ManagedExperimentSection,
): Promise<LoadedResultsSummary | null> {
  if (section !== 'results') return null
  const raw = (experiment.rawSections ?? []).filter((item) => item.heading === 'Results')
  if (raw.length !== 1 || !raw[0]!.pointerValid) return null
  return loadResultsSummary(projectRoot, experiment.id, { role: 'cli' })
}

function reportWarnings(loaded: LoadedResultsSummary | null): void {
  for (const warning of loaded?.warnings ?? [])
    process.stderr.write(`${JSON.stringify({ warning })}\n`)
}

export async function runExperimentDocumentShow(
  input: ExperimentDocumentSectionInput,
): Promise<void> {
  const { experiment, section, projectRoot } = await resolveInput(input)
  const loaded = await resultsSummaryFor(projectRoot, experiment, section)
  reportWarnings(loaded)
  const rendered = renderExperimentManagedSection(
    experiment,
    section,
    loaded ? { summary: loaded.summary } : undefined,
  )
  if (input.format === 'human') {
    process.stdout.write(rendered.markdown)
    return
  }
  emitJson({
    experimentId: experiment.id,
    section,
    document:
      section === 'results'
        ? (experiment.documents?.description ?? null)
        : (experiment.documents?.[section] ?? null),
    ...(section === 'results' ? { summary: loaded?.summary ?? null } : {}),
    renderedSource: rendered.source,
    diagnostics: rendered.diagnostics,
    ...(loaded && loaded.warnings.length > 0 ? { warnings: loaded.warnings } : {}),
  })
}

export async function runExperimentDocumentRender(
  input: ExperimentDocumentSectionInput,
): Promise<void> {
  const { experiment, section, projectRoot } = await resolveInput(input)
  const loaded = await resultsSummaryFor(projectRoot, experiment, section)
  reportWarnings(loaded)
  const rendered = renderExperimentManagedSection(
    experiment,
    section,
    loaded ? { summary: loaded.summary } : undefined,
  )
  if (input.format === 'human') {
    process.stdout.write(rendered.markdown)
    return
  }
  emitJson({
    experimentId: experiment.id,
    section,
    markdown: rendered.markdown,
    source: rendered.source,
    diagnostics: rendered.diagnostics,
    ...(loaded && loaded.warnings.length > 0 ? { warnings: loaded.warnings } : {}),
  })
}

/**
 * One lint workflow: README structure, managed pointers, the YAML schemas,
 * `experiment.json`, cross-references and every declared member's
 * `result.csv` (version agreement, duplicate pairs, declared types, cross-file
 * conflicts and, inside a Git work tree, `RESULT_FILE_IGNORED`). Format and
 * structure only — research state never reaches lint output.
 */
export async function runExperimentDocumentLint(input: ExperimentDocumentBaseInput): Promise<void> {
  const { experiment, projectRoot } = await resolveInput(input)
  // Declared Run paths outside the effective run_dirs (`--run-dir`, else
  // `.memon/project.yml`, else the v8 default) are `RUN_OUTSIDE_RUN_DIRS`.
  const runDirs = await effectiveRunDirs(projectRoot)
  emitLintDiagnostics(
    input.format,
    { experimentId: experiment.id },
    await lintExperimentBundle(projectRoot, experiment, { runDirs: runDirs.patterns }),
  )
}

async function resolveInput(input: ExperimentDocumentBaseInput & { section?: string }) {
  const context = await resolveContext(input)
  const projectRoot = singleProjectRoot(context)
  const projectName = context.config.projects[0]!.name
  const id = await resolveExperimentId(projectRoot, input.idOrSlug)
  if (!id) emitErrorAndExit('NOT_FOUND', `experiment "${input.idOrSlug}" not found`)
  const experiment = await readExperimentDoc(projectRoot, projectName, id)
  if (!experiment) emitErrorAndExit('NOT_FOUND', `experiment "${id}" not found`)
  let section: ManagedExperimentSection = 'implementation'
  if (input.section !== undefined) {
    const normalized = input.section.toLowerCase()
    if (!(MANAGED_EXPERIMENT_SECTIONS as readonly string[]).includes(normalized)) {
      emitErrorAndExit(
        'BAD_REQUEST',
        `section must be one of: ${MANAGED_EXPERIMENT_SECTIONS.join(', ')}`,
      )
    }
    section = normalized as ManagedExperimentSection
  }
  return { experiment, section, projectRoot }
}
