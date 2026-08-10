import {
  type ExperimentDocumentDiagnostic,
  lintExperimentDocument,
  MANAGED_EXPERIMENT_SECTIONS,
  type ManagedExperimentSection,
  readExperimentDoc,
  renderExperimentManagedSection,
  resolveExperimentId,
  validateExperimentManagedDocuments,
} from '@memon/core'

import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { emitJson, type OutputFormat } from '../lib/output.js'

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
  const { experiment, section } = await resolveInput(input)
  const parsed = experiment.documents?.[section] ?? null
  const rendered = renderExperimentManagedSection(experiment, section)
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
  })
}

export async function runExperimentDocumentRender(
  input: ExperimentDocumentSectionInput,
): Promise<void> {
  const { experiment, section } = await resolveInput(input)
  const rendered = renderExperimentManagedSection(experiment, section)
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
  })
}

export async function runExperimentDocumentValidate(
  input: ExperimentDocumentBaseInput,
): Promise<void> {
  const { experiment } = await resolveInput(input)
  emitDiagnostics(
    input.format,
    experiment.id,
    'validate',
    validateExperimentManagedDocuments(experiment.documents ?? null),
  )
}

export async function runExperimentDocumentLint(input: ExperimentDocumentBaseInput): Promise<void> {
  const { experiment } = await resolveInput(input)
  emitDiagnostics(input.format, experiment.id, 'lint', lintExperimentDocument(experiment))
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
  return { experiment, section }
}

function emitDiagnostics(
  format: OutputFormat,
  experimentId: string,
  operation: 'validate' | 'lint',
  diagnostics: ExperimentDocumentDiagnostic[],
): void {
  const summary = {
    errors: diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length,
    warnings: diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length,
    info: diagnostics.filter((diagnostic) => diagnostic.severity === 'info').length,
  }
  if (format === 'human') {
    if (diagnostics.length === 0) {
      process.stdout.write(`${experimentId}: ${operation} passed\n`)
    } else {
      const lines = diagnostics.flatMap((diagnostic) => [
        `[${diagnostic.severity.toUpperCase()}] ${diagnostic.code} (${diagnostic.file}${diagnostic.field ? `:${diagnostic.field}` : ''})`,
        `  ${diagnostic.message}`,
      ])
      process.stdout.write(`${experimentId}: ${operation}\n${lines.join('\n')}\n`)
    }
  } else {
    emitJson({ ok: summary.errors === 0, experimentId, operation, diagnostics, summary })
  }
  if (summary.errors > 0) process.exitCode = 1
}
