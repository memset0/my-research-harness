// @vitest-environment node

import {
  buildExperimentRecord,
  type Experiment,
  type ExperimentManagedDocuments,
  generateResultsSummary,
  parseExperimentDescription,
  parseExperimentReadme,
  parseImplementationYaml,
  parseInvestigationYaml,
  type ResultsSummary,
  renderResultsSummaryMarkdown,
} from '@memon/core'
import { describe, expect, it } from 'vitest'
import { buildExperimentDocumentView } from './experiment-sections'

const POINTERS = {
  Implementation:
    '> Managed in [implementation.yaml](./implementation.yaml); read and update that file directly.',
  Investigation:
    '> Managed in [investigation.yaml](./investigation.yaml); read and update that file directly.',
  Results:
    "> Columns and Variants are managed in [experiment.json](./experiment.json); the Results table is generated from each member Run's result.csv.",
}

function experiment(options: { implementationBody?: string; extra?: string } = {}): Experiment {
  const readme = `---
id: E0001-example
slug: example
title: Example
status: OPEN
archived: false
runs: [logs/precision-260810-010000]
hypotheses: []
tags: []
created_at: 2026-08-10T00:00:00+00:00
updated_at: 2026-08-10T00:00:00+00:00
---

## Motivation

Why.

## Design

Controlled comparison.

## Implementation

${options.implementationBody ?? POINTERS.Implementation}

## Investigation

${POINTERS.Investigation}

## Results

${POINTERS.Results}

## Findings

Pending.

## Limitations

None yet.

## Conclusion


## Warnings

${options.extra ?? ''}
`
  const parsed = parseExperimentReadme(readme, 'E0001-example')
  return buildExperimentRecord(parsed, {
    id: 'E0001-example',
    project: 'research',
    path: '/project/docs/experiments/E0001-example/README.md',
    mtime: 1,
    documents: documents(),
  })
}

const DESCRIPTION = JSON.stringify({
  experiment_schema_version: 1,
  groups: {},
  columns: [
    {
      path: 'params.precision',
      label: 'Precision',
      type: 'enum',
      options: ['fp32', 'bf16'],
    },
  ],
  variants: [
    {
      id: 'V0001',
      name: 'BF16',
      values: { 'params.precision': 'bf16' },
      runs: ['logs/precision-260810-010000'],
    },
  ],
})

function documents(): ExperimentManagedDocuments {
  return {
    implementation: parseImplementationYaml(`schema_version: 1
items:
  - id: IMP0001
    title: Add launcher
    status: DONE
`),
    investigation: parseInvestigationYaml(`schema_version: 1
items:
  - id: INV0001
    title: Compare precision
    status: IN_PROGRESS
`),
    results: {
      kind: 'results',
      fileName: 'results.yaml',
      path: '/project/docs/experiments/E0001-example/results.yaml',
      exists: false,
      raw: null,
      data: null,
      parseErrors: [],
      parseWarnings: [],
    },
    description: parseExperimentDescription(
      DESCRIPTION,
      '/project/docs/experiments/E0001-example/experiment.json',
    ),
  }
}

/** The generated summary of the fixture: one finished member Run with a result file. */
function summary(): ResultsSummary {
  return generateResultsSummary({
    experimentId: 'E0001-example',
    experimentDir: 'docs/experiments/E0001-example',
    description: documents().description!,
    members: [
      {
        path: 'logs/precision-260810-010000',
        record: { status: 'FINISHED', deprecated: false, stop_reason: null },
        result: 'path,stat,value\n$experiment_schema_version,,1\nparams.precision,,bf16\n',
      },
    ],
    inputs: {},
    newestInputMtime: null,
    generatedAt: '2026-08-10T00:00:00+00:00',
    generator: { release: 'test', role: 'standalone' },
  })
}

describe('Experiment compatibility display projection', () => {
  it('renders valid managed sections through the shared Core Markdown renderer', () => {
    const runs = {
      'logs/precision-260810-010000': {
        documentUrl: '/p/research/e/E0001-example?run=logs%2Fprecision-260810-010000',
        wandbUrl: 'https://wandb.ai/research/precision/runs/abc',
      },
    }
    const view = buildExperimentDocumentView(experiment(), { runs, summary: summary() })

    const implementation = view.sections.find((section) => section.heading === 'Implementation')
    const results = view.sections.find((section) => section.heading === 'Results')
    expect(implementation?.source).toBe('yaml')
    expect(implementation?.body).toContain('IMP0001')
    expect(implementation?.body).not.toContain('Managed in')
    expect(results?.source).toBe('yaml')
    // The Web section is the CLI's projection of the same generated summary.
    expect(results?.body).toBe(renderResultsSummaryMarkdown(summary(), { runs }))
    expect(results?.body).toContain('| Variant | Status | Precision |')
    expect(results?.body).toContain('| Runs | Other Runs |')
    expect(results?.body).toContain(
      '[`logs/precision-260810-010000`](/p/research/e/E0001-example?run=logs%2Fprecision-260810-010000)',
    )
    expect(results?.body).toContain('[W&B](https://wandb.ai/research/precision/runs/abc)')
  })

  it('renders a failed summary as its error instead of a table', () => {
    const failed = generateResultsSummary({
      experimentId: 'E0001-example',
      experimentDir: 'docs/experiments/E0001-example',
      description: documents().description!,
      members: [
        {
          path: 'logs/precision-260810-010000',
          record: { status: 'FINISHED', deprecated: false, stop_reason: null },
          result: 'path,stat,value\n$experiment_schema_version,,2\n',
        },
      ],
      inputs: {},
      newestInputMtime: null,
      generatedAt: '2026-08-10T00:00:00+00:00',
      generator: { release: 'test', role: 'standalone' },
    })
    const results = buildExperimentDocumentView(experiment(), { summary: failed }).sections.find(
      (section) => section.heading === 'Results',
    )
    expect(results?.body).toContain('RESULT_SCHEMA_MISMATCH')
    expect(results?.body).toContain('memon experiment schema upgrade E0001-example --to 1')
    expect(results?.body).not.toContain('| Variant |')
  })

  it('shows literal README content when a managed pointer conflicts with the schema', () => {
    const view = buildExperimentDocumentView(
      experiment({ implementationBody: '- [x] Old implementation task that must not be hidden' }),
    )
    const implementation = view.sections.find((section) => section.heading === 'Implementation')

    expect(implementation?.source).toBe('readme')
    expect(implementation?.body).toContain('Old implementation task')
    expect(implementation?.body).not.toContain('IMP0001')
    expect(
      implementation?.diagnostics.some(
        (diagnostic) => diagnostic.code === 'MANAGED_SECTION_NOT_STUB',
      ),
    ).toBe(true)
    expect(view.readOnly).toBe(true)
  })

  it('preserves and flags unsupported headings instead of filtering them', () => {
    const exp = experiment()
    exp.rawSections!.splice(2, 0, {
      heading: 'Legacy Notes',
      body: 'Important old evidence.',
      index: 2,
      occurrence: 1,
      supported: false,
      managed: false,
      pointerValid: null,
    })
    const view = buildExperimentDocumentView(exp)
    const legacy = view.sections.find((section) => section.heading === 'Legacy Notes')

    expect(legacy?.body).toBe('Important old evidence.')
    expect(legacy?.supported).toBe(false)
    expect(legacy?.diagnostics.some((diagnostic) => diagnostic.code === 'UNKNOWN_H2_SECTION')).toBe(
      true,
    )
  })
})
