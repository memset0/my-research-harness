import {
  type Experiment,
  type ExperimentDocumentDiagnostic,
  lintExperimentDocument,
  MANAGED_EXPERIMENT_SECTIONS,
  MANAGED_SECTION_HEADINGS,
  type ManagedExperimentSection,
  type ResultsRenderContext,
  renderExperimentManagedSection,
} from '@memon/core'

export interface WebExperimentSection {
  heading: string
  /** Human-readable Markdown for display. */
  body: string
  /** Literal README body, retained even when `body` is a YAML projection. */
  rawBody: string
  index: number
  occurrence: number
  supported: boolean
  managed: boolean
  pointerValid: boolean | null
  source: 'readme' | 'yaml' | 'diagnostic'
  diagnostics: ExperimentDocumentDiagnostic[]
}

export interface WebExperimentDocumentView {
  sections: WebExperimentSection[]
  diagnostics: ExperimentDocumentDiagnostic[]
  /** Compatibility documents stay readable but generic README writes are unsafe. */
  readOnly: boolean
}

/**
 * Build a tolerant display projection. Unsupported and duplicate source
 * sections are never filtered. A managed section delegates to YAML only
 * when Core reports an exact unique pointer; conflicts display each literal
 * README occurrence in its original position.
 */
export function buildExperimentDocumentView(
  experiment: Experiment,
  resultsContext?: ResultsRenderContext,
): WebExperimentDocumentView {
  if (!experiment.rawSections) return buildLegacyProjection(experiment)
  const lintDiagnostics = lintExperimentDocument(experiment)
  const managedByHeading = new Map<string, ManagedExperimentSection>(
    MANAGED_EXPERIMENT_SECTIONS.map((kind) => [MANAGED_SECTION_HEADINGS[kind], kind]),
  )
  const renderedManaged = new Map(
    MANAGED_EXPERIMENT_SECTIONS.map((kind) => [
      kind,
      renderExperimentManagedSection(
        experiment,
        kind,
        kind === 'results' ? resultsContext : undefined,
      ),
    ]),
  )
  const headingCounts = new Map<string, number>()
  for (const section of experiment.rawSections) {
    headingCounts.set(section.heading, (headingCounts.get(section.heading) ?? 0) + 1)
  }

  const sections = experiment.rawSections.map((section): WebExperimentSection => {
    const kind = managedByHeading.get(section.heading)
    const sectionDiagnostics = diagnosticsForSection(lintDiagnostics, section.heading)
    if (!kind) {
      return {
        ...section,
        body: section.body,
        rawBody: section.body,
        source: 'readme',
        diagnostics: sectionDiagnostics,
      }
    }

    const rendered = renderedManaged.get(kind)!
    const unique = headingCounts.get(section.heading) === 1
    // Core's `readme` result combines duplicate occurrences so CLI users do
    // not lose any text. The Web has the richer ordered raw view, therefore
    // it renders this occurrence verbatim and highlights the same conflict.
    const canUseProjection = unique && section.pointerValid && rendered.source !== 'readme'
    return {
      ...section,
      body: canUseProjection ? rendered.markdown : section.body,
      rawBody: section.body,
      source: canUseProjection ? rendered.source : 'readme',
      diagnostics: mergeDiagnostics(sectionDiagnostics, rendered.diagnostics),
    }
  })

  const readOnly =
    experiment.documents === null ||
    lintDiagnostics.some((diagnostic) => diagnostic.severity === 'error') ||
    sections.some(
      (section) =>
        !section.supported ||
        section.occurrence > 1 ||
        (section.managed && (!section.pointerValid || section.source === 'diagnostic')),
    )

  return { sections, diagnostics: lintDiagnostics, readOnly }
}

function buildLegacyProjection(experiment: Experiment): WebExperimentDocumentView {
  const bodies: Array<[string, string | null, boolean]> = [
    ['Motivation', experiment.sections.motivation, true],
    ['Method', experiment.sections.method, false],
    ['Plan', experiment.sections.plan, false],
    ['Conclusion', experiment.sections.conclusion, true],
    ['Caveats', experiment.sections.caveats, false],
    ['Warnings', experiment.warningsRaw, true],
  ]
  return {
    readOnly: true,
    diagnostics: [],
    sections: bodies.map(([heading, body, supported], index) => ({
      heading,
      body: body ?? '',
      rawBody: body ?? '',
      index,
      occurrence: 1,
      supported,
      managed: false,
      pointerValid: null,
      source: 'readme',
      diagnostics: supported
        ? []
        : [
            {
              code: 'UNKNOWN_H2_SECTION',
              severity: 'error',
              file: 'README.md',
              field: `section.${heading}`,
              message: `heading "## ${heading}" is not supported by the current Experiment schema; content is preserved`,
            },
          ],
    })),
  }
}

function diagnosticsForSection(
  diagnostics: ExperimentDocumentDiagnostic[],
  heading: string,
): ExperimentDocumentDiagnostic[] {
  const field = `section.${heading}`
  return diagnostics.filter((diagnostic) => diagnostic.field === field)
}

function mergeDiagnostics(
  first: ExperimentDocumentDiagnostic[],
  second: ExperimentDocumentDiagnostic[],
): ExperimentDocumentDiagnostic[] {
  const merged = new Map<string, ExperimentDocumentDiagnostic>()
  for (const diagnostic of [...first, ...second]) {
    merged.set(
      `${diagnostic.code}\0${diagnostic.file}\0${diagnostic.field ?? ''}\0${diagnostic.message}`,
      diagnostic,
    )
  }
  return Array.from(merged.values())
}
