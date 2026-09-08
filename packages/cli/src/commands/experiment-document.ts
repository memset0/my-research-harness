import {
  lintExperimentDocument,
  MANAGED_EXPERIMENT_SECTIONS,
  type ManagedExperimentSection,
  readExperimentDoc,
  renderExperimentManagedSection,
  resolveExperimentId,
} from '@memon/core'

import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { emitJson, emitLintDiagnostics, type OutputFormat } from '../lib/output.js'
import { loadResultsEligibility, type ResultsEligibility } from '../lib/results-eligibility.js'

interface ExperimentDocumentBaseInput {
  projectRoot?: string
  cwd: string
  idOrSlug: string
  format: OutputFormat
}

export interface ExperimentDocumentSectionInput extends ExperimentDocumentBaseInput {
  section: string
}

export async function runExperimentDocumentShow(
  input: ExperimentDocumentSectionInput,
): Promise<void> {
  const { experiment, section, projectRoot } = await resolveInput(input)
  const parsed = experiment.documents?.[section] ?? null
  const eligibility =
    section === 'results'
      ? await loadResultsEligibility(projectRoot, experiment.documents?.results.data ?? null)
      : null
  const rendered = renderExperimentManagedSection(experiment, section, eligibility ?? undefined)
  if (input.format === 'human') {
    process.stdout.write(rendered.markdown)
    return
  }
  emitJson({
    experimentId: experiment.id,
    section,
    document: parsed,
    renderedSource: rendered.source,
    diagnostics: rendered.diagnostics,
    ...eligibilityFields(eligibility),
  })
}

export async function runExperimentDocumentRender(
  input: ExperimentDocumentSectionInput,
): Promise<void> {
  const { experiment, section, projectRoot } = await resolveInput(input)
  const eligibility =
    section === 'results'
      ? await loadResultsEligibility(projectRoot, experiment.documents?.results.data ?? null)
      : null
  const rendered = renderExperimentManagedSection(experiment, section, eligibility ?? undefined)
  const markdown = rendered.markdown
  if (input.format === 'human') {
    process.stdout.write(markdown)
    return
  }
  emitJson({
    experimentId: experiment.id,
    section,
    markdown,
    source: rendered.source,
    diagnostics: rendered.diagnostics,
    ...eligibilityFields(eligibility),
  })
}

/**
 * One lint workflow: README structure, managed pointers, YAML schemas and
 * cross-references, including the schema validation the removed
 * `experiment doc validate` used to perform on its own. Format and structure
 * only — a well-formed document that cites a deprecated Run is valid, so
 * research state never reaches lint output.
 */
export async function runExperimentDocumentLint(input: ExperimentDocumentBaseInput): Promise<void> {
  const { experiment } = await resolveInput(input)
  emitLintDiagnostics(
    input.format,
    { experimentId: experiment.id },
    lintExperimentDocument(experiment),
  )
}

function eligibilityFields(eligibility: ResultsEligibility | null): {
  variantEligibility?: ResultsEligibility['variants']
  deprecatedRuns?: string[]
} {
  if (eligibility === null) return {}
  return {
    variantEligibility: eligibility.variants,
    deprecatedRuns: eligibility.deprecatedRuns,
  }
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
