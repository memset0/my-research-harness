import { describe, expect, it } from 'vitest'
import { BackendResultsDocumentSchema } from '../backend-protocol.js'
import { parseExperimentDescription } from '../results/description.js'
import { parseResultFile } from '../results/result-file.js'
import { generateResultsSummary } from '../results/summary.js'
import type { ParsedManagedDocument, ResultsDocument } from '../types.js'
import { VARIANT_STATUS_VALUES } from '../types.js'
import {
  LEGACY_RESULTS_POINTER,
  lintExperimentDocument,
  MANAGED_SECTION_POINTERS,
  parseImplementationYaml,
  parseInvestigationYaml,
  parseResultsYaml,
  renderExperimentManagedSection,
  renderImplementationMarkdown,
  renderResultsMarkdown,
  serializeResultsYaml,
  upsertResultColumnAnnotationYaml,
  validateExperimentManagedDocuments,
} from './documents.js'
import { buildExperimentRecord, parseExperimentReadme } from './parse.js'
import { serializeExperimentReadme } from './serialize.js'
import { buildExperimentDocumentView } from './view.js'

const FRONTMATTER = `---
id: E0001-foo
slug: foo
title: Foo
status: OPEN
archived: false
runs: []
hypotheses: []
tags: []
created_at: '2026-08-10T00:00:00+00:00'
updated_at: '2026-08-10T00:00:00+00:00'
---`

function canonicalReadme(
  overrides: Partial<Record<'implementation' | 'investigation' | 'results', string>> = {},
) {
  return `${FRONTMATTER}

## Motivation

Why.

## Design

Controlled comparison.

## Implementation

${overrides.implementation ?? MANAGED_SECTION_POINTERS.implementation}

## Investigation

${overrides.investigation ?? MANAGED_SECTION_POINTERS.investigation}

## Results

${overrides.results ?? MANAGED_SECTION_POINTERS.results}

## Findings

## Limitations

## Conclusion

## Warnings
`
}

const implementation = parseImplementationYaml(`
schema_version: 1
items:
  - id: IMP0001
    title: Precision support
    status: IN_PROGRESS
    acceptance_criteria:
      - bf16 trains for 100 steps
    children:
      - id: IMP0002
        title: Add autocast
        status: DONE
        outcome: Smoke test passed
`)

const investigation = parseInvestigationYaml(`
schema_version: 1
items:
  - id: INV0001
    title: Compare precision
    status: IN_PROGRESS
    depends_on: [IMP0002]
    variant_ids: [V0001]
`)

const results = parseResultsYaml(`
schema_version: 1
column_annotations:
  precision:
    description: Controls **numeric precision** during training.
    value_descriptions:
      bf16: Uses **bfloat16** arithmetic.
columns:
  - key: precision
    label: Precision
    group: parameter
    type: enum
    options: [fp32, bf16, fp8]
  - key: final_loss
    label: Final loss
    group: metric
    type: number
variants:
  - id: V0001
    name: BF16
    status: COMPLETED
    parameters: {precision: bf16}
    metrics: {final_loss: 2.5}
    runs: [foo-260810-010000]
    attempts: [foo-260810-000000]
`)

/** FS v9: `results.yaml` is never read; only its presence is reported. */
function legacyResults(exists = false): ParsedManagedDocument<ResultsDocument> {
  return {
    kind: 'results',
    fileName: 'results.yaml',
    path: '/tmp/E0001-foo/results.yaml',
    exists,
    raw: null,
    data: null,
    parseErrors: exists ? [{ severity: 'error', message: 'LEGACY_RESULTS_YAML: retired' }] : [],
    parseWarnings: [],
  }
}

const DESCRIPTION = {
  experiment_schema_version: 1,
  columns: [
    {
      path: 'params.precision',
      label: 'Precision',
      type: 'enum',
      options: ['fp32', 'bf16', 'fp8'],
      description: 'Controls **numeric precision** during training.',
      value_descriptions: { bf16: 'Uses **bfloat16** arithmetic.' },
    },
    { path: 'metrics.final_loss', label: 'Final loss', type: 'number' },
  ],
  variants: [
    {
      id: 'V0001',
      name: 'BF16',
      values: { 'params.precision': 'bf16' },
      runs: ['logs/foo-260810-010000', 'logs/foo-260810-000000'],
    },
  ],
}

const description = (value: unknown = DESCRIPTION) =>
  parseExperimentDescription(JSON.stringify(value), 'experiment.json')

function experiment(readme = canonicalReadme(), value: unknown = DESCRIPTION) {
  const parsed = parseExperimentReadme(readme, 'E0001-foo')
  return buildExperimentRecord(parsed, {
    id: 'E0001-foo',
    project: 'p',
    path: '/tmp/E0001-foo/README.md',
    mtime: 1,
    documents: {
      implementation,
      investigation,
      results: legacyResults(),
      description: description(value),
    },
  })
}

const MEMBERS_README = canonicalReadme().replace(
  'runs: []',
  'runs: [logs/foo-260810-010000, logs/foo-260810-000000]',
)

function summaryOf(value: unknown = DESCRIPTION) {
  return generateResultsSummary({
    experimentId: 'E0001-foo',
    experimentDir: 'docs/experiments/E0001-foo',
    description: description(value),
    members: [
      {
        path: 'logs/foo-260810-010000',
        record: { status: 'FINISHED', deprecated: false, stop_reason: null },
        result: 'path,stat,value\n$experiment_schema_version,,1\nmetrics.final_loss,,2.5\n',
      },
      {
        path: 'logs/foo-260810-000000',
        record: { status: 'FAILED', deprecated: false, stop_reason: null },
        result: null,
      },
    ],
    inputs: {},
    newestInputMtime: null,
    generatedAt: '2026-10-02T12:00:00+08:00',
    generator: { release: '9.0.0', role: 'cli' },
  })
}

describe('v6 managed Experiment YAML', () => {
  it('normalizes recursive trees and renders shared human-readable Markdown', () => {
    expect(implementation.parseErrors).toEqual([])
    expect(implementation.data?.items[0]?.children[0]?.id).toBe('IMP0002')
    const markdown = renderImplementationMarkdown(implementation.data!)
    expect(markdown).toContain('**IMP0001** `[IN_PROGRESS]`')
    expect(markdown).toContain('  - **IMP0002** `[DONE]`')
    expect(markdown).toContain('Acceptance criteria')
  })

  it('requires enum options but does not require every option to appear in rows', () => {
    expect(results.parseErrors).toEqual([])
    expect(
      validateExperimentManagedDocuments({
        implementation,
        investigation,
        results: legacyResults(),
        description: description(),
      }),
    ).toEqual([])

    const invalid = parseResultsYaml(`
schema_version: 1
columns:
  - key: precision
    label: Precision
    group: parameter
    type: enum
variants: []
`)
    expect(invalid.data).toBeNull()
    expect(
      invalid.parseErrors.some((issue) => issue.message.includes('enum columns require')),
    ).toBe(true)
  })

  it('parses sparse Markdown column annotations without constraining future values', () => {
    expect(results.parseErrors).toEqual([])
    expect(results.data?.columnAnnotations).toEqual({
      precision: {
        description: 'Controls **numeric precision** during training.',
        valueDescriptions: { bf16: 'Uses **bfloat16** arithmetic.' },
      },
    })

    const futureValue = parseResultsYaml(`
schema_version: 1
column_annotations:
  precision:
    value_descriptions:
      fp4: Planned **future** format.
columns:
  - key: precision
    label: Precision
    group: parameter
    type: enum
    options: [fp32, bf16]
variants: []
`)
    expect(futureValue.parseErrors).toEqual([])
    expect(
      validateExperimentManagedDocuments({
        implementation: parseImplementationYaml('schema_version: 1\nitems: []\n'),
        investigation: parseInvestigationYaml('schema_version: 1\nitems: []\n'),
        results: legacyResults(),
        description: description({
          experiment_schema_version: 1,
          columns: [
            {
              path: 'params.precision',
              label: 'Precision',
              type: 'enum',
              options: ['fp32', 'bf16'],
              value_descriptions: { fp4: 'Planned **future** format.' },
            },
          ],
        }),
      }),
    ).toEqual([])
  })

  it('serializes annotations near the top and upserts descriptions while retaining unknown keys', () => {
    const serialized = serializeResultsYaml(results.data!)
    expect(serialized.indexOf('column_annotations:')).toBeGreaterThan(
      serialized.indexOf('schema_version:'),
    )
    expect(serialized.indexOf('column_annotations:')).toBeLessThan(serialized.indexOf('columns:'))

    const source = `schema_version: 1
column_annotations:
  precision:
    description: Old text
columns:
  - key: precision
    label: Precision
    group: parameter
    type: enum
    options: [fp32, bf16]
variants: []
future_top_level: keep-me
`
    const column = upsertResultColumnAnnotationYaml(source, 'precision', 'New **Markdown** text')
    expect(column.replaced).toBe(true)
    expect(column.changed).toBe(true)
    expect(column.content).toContain('future_top_level: keep-me')
    expect(parseResultsYaml(column.content).data?.columnAnnotations?.precision?.description).toBe(
      'New **Markdown** text',
    )

    const value = upsertResultColumnAnnotationYaml(
      column.content,
      'precision',
      'May be added later.',
      'fp4',
    )
    expect(value.replaced).toBe(false)
    expect(
      parseResultsYaml(value.content).data?.columnAnnotations?.precision?.valueDescriptions,
    ).toEqual({ fp4: 'May be added later.' })
  })

  it('reports file schema versions as FS-managed compatibility errors', () => {
    const missing = parseImplementationYaml('items: []\n')
    const ahead = parseInvestigationYaml('schema_version: 2\nitems: []\n')
    expect(missing.parseErrors[0]?.message).toContain('MISSING_YAML_SCHEMA_VERSION')
    expect(ahead.parseErrors[0]?.message).toContain('YAML_SCHEMA_TOO_NEW')
  })

  it('rejects a terminal parent with unfinished children', () => {
    const conflicting = parseImplementationYaml(`
schema_version: 1
items:
  - id: IMP0001
    title: Parent
    status: DONE
    children:
      - id: IMP0002
        title: Child
        status: TODO
`)
    const diagnostics = validateExperimentManagedDocuments({
      implementation: conflicting,
      investigation: parseInvestigationYaml('schema_version: 1\nitems: []\n'),
      results: legacyResults(),
      description: description({ experiment_schema_version: 1 }),
    })
    expect(diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PARENT_STATUS_CONFLICT' })]),
    )
  })

  it('renders Results as a Markdown table with accepted Runs and separate Attempts', () => {
    const markdown = renderResultsMarkdown(results.data!)
    expect(markdown).toContain('### Column annotations')
    expect(markdown).toContain('Controls **numeric precision** during training.')
    expect(markdown).toContain('- `bf16`: Uses **bfloat16** arithmetic.')
    expect(markdown).toContain(
      '| Variant | Status | Precision | Final loss | Entry | Recipe | Commit | Runs | Attempts |',
    )
    expect(markdown).toContain('`foo-260810-010000`')
    expect(markdown).toContain('`foo-260810-000000`')
    expect(markdown).not.toContain('[`foo-260810-010000`](')
    expect(markdown).not.toContain('[`foo-260810-000000`](')
  })

  it('optionally links evidence and other Runs to memon documents and W&B', () => {
    const rendered = renderExperimentManagedSection(experiment(MEMBERS_README), 'results', {
      summary: summaryOf(),
      runs: {
        'logs/foo-260810-010000': {
          documentUrl: '/p/demo/r/foo(accepted)',
          wandbUrl: 'https://wandb.ai/acme/project/runs/accepted run',
        },
        'foo-260810-000000': {
          documentUrl: '/p/demo/r/foo-attempt',
          wandbUrl: 'https://wandb.ai/acme/project/runs/attempt',
        },
      },
    })
    expect(rendered.source).toBe('yaml')
    expect(rendered.markdown).toContain(
      '[`logs/foo-260810-010000`](/p/demo/r/foo(accepted)) · [W&B](https://wandb.ai/acme/project/runs/accepted run)',
    )
    expect(rendered.markdown).toContain(
      '[`logs/foo-260810-000000`](/p/demo/r/foo-attempt) · [W&B](https://wandb.ai/acme/project/runs/attempt) `FAILED`',
    )
  })

  it('links entry and recipe to immutable Git blobs only for HTTP(S) repositories', () => {
    const withProvenance = parseResultsYaml(`
schema_version: 1
columns: []
variants:
  - id: V0001
    name: linked
    status: COMPLETED
    runs: []
    attempts: []
    provenance:
      repo: https://github.com/acme/training.git/
      commit: abc123
      entry: ./src/train loop.py
      recipe: recipes/bf16.yaml
  - id: V0002
    name: ssh fallback
    status: PLANNED
    runs: []
    attempts: []
    provenance:
      repo: git@github.com:acme/training.git
      commit: def456
      entry: src/fallback.py
`)

    const markdown = renderResultsMarkdown(withProvenance.data!)
    expect(markdown).toContain(
      '[`./src/train loop.py`](https://github.com/acme/training/blob/abc123/src/train%20loop.py)',
    )
    expect(markdown).toContain(
      '[`recipes/bf16.yaml`](https://github.com/acme/training/blob/abc123/recipes/bf16.yaml)',
    )
    expect(markdown).toContain('`src/fallback.py`')
    expect(markdown).not.toContain('[`src/fallback.py`](')
  })
})

describe('v6 README tolerant read and strict lint', () => {
  it('promotes README frontmatter parse errors and retains non-duplicated parse warnings', () => {
    const malformed = experiment(
      canonicalReadme().replace('title: Foo\n', '').replace('archived: false\n', ''),
    )
    const diagnostics = lintExperimentDocument(malformed)

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'README_PARSE_ERROR',
          severity: 'error',
          file: 'README.md',
          field: 'title',
        }),
        expect.objectContaining({
          code: 'MISSING_ARCHIVED_FIELD',
          severity: 'warning',
          file: 'README.md',
          field: 'archived',
        }),
      ]),
    )
  })

  it('projects the Results summary only when the section is the exact one-line pointer', () => {
    const rendered = renderExperimentManagedSection(experiment(MEMBERS_README), 'results', {
      summary: summaryOf(),
    })
    expect(rendered.source).toBe('yaml')
    expect(rendered.markdown).toContain('| Variant |')
    expect(rendered.markdown).toContain('| **V0001** BF16 | `COMPLETED` | bf16 | 2.5 |')
    const unloaded = renderExperimentManagedSection(experiment(MEMBERS_README), 'results')
    expect(unloaded.source).toBe('yaml')
    expect(unloaded.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'RESULTS_SUMMARY_NOT_LOADED',
    ])
    const legacy = experiment(canonicalReadme({ results: LEGACY_RESULTS_POINTER }))
    expect(renderExperimentManagedSection(legacy, 'results', { summary: summaryOf() }).source).toBe(
      'readme',
    )
    expect(
      lintExperimentDocument(legacy).find(
        (diagnostic) => diagnostic.code === 'MANAGED_SECTION_NOT_STUB',
      )?.message,
    ).toContain('FS v8 results.yaml pointer')
  })

  it('renders a failed summary as its error instead of a table', () => {
    const failed = generateResultsSummary({
      experimentId: 'E0001-foo',
      experimentDir: 'docs/experiments/E0001-foo',
      description: description({ ...DESCRIPTION, experiment_schema_version: 2 }),
      members: [
        {
          path: 'logs/foo-260810-010000',
          record: { status: 'FINISHED', deprecated: false, stop_reason: null },
          result: 'path,stat,value\n$experiment_schema_version,,1\n',
        },
      ],
      inputs: {},
      newestInputMtime: null,
      generatedAt: '2026-10-02T12:00:00+08:00',
      generator: { release: '9.0.0', role: 'cli' },
    })
    const rendered = renderExperimentManagedSection(experiment(MEMBERS_README), 'results', {
      summary: failed,
    })
    // A Results-data failure keeps the section a projection: the README stays editable.
    expect(rendered.source).toBe('yaml')
    expect(rendered.diagnostics[0]).toMatchObject({ code: 'RESULT_SCHEMA_MISMATCH' })
    expect(rendered.markdown).toContain('memon experiment schema upgrade E0001-foo --to 2')
    expect(rendered.markdown).not.toContain('| Variant |')
  })

  it('CLI and Web views project the same Results Markdown', () => {
    const exp = experiment(MEMBERS_README)
    const context = { summary: summaryOf() }
    const view = buildExperimentDocumentView(exp, context)
    const section = view.sections.find((candidate) => candidate.heading === 'Results')!
    expect(section.source).toBe('yaml')
    expect(section.body).toBe(renderExperimentManagedSection(exp, 'results', context).markdown)
  })

  it('renders conflicting README content rather than hiding it behind YAML', () => {
    const exp = experiment(canonicalReadme({ investigation: '- [ ] Run the old baseline' }))
    const rendered = renderExperimentManagedSection(exp, 'investigation')
    expect(rendered.source).toBe('readme')
    expect(rendered.markdown).toContain('MANAGED_SECTION_NOT_STUB')
    expect(rendered.markdown).toContain('Run the old baseline')
  })

  it('retains duplicate and unsupported H2 occurrences in source order while linting them', () => {
    const readme = `${canonicalReadme()}\n## Notes\nfirst\n\n## Notes\nsecond\n`
    const exp = experiment(readme)
    const notes = exp.rawSections?.filter((section) => section.heading === 'Notes') ?? []
    expect(notes.map((section) => [section.occurrence, section.body.trim()])).toEqual([
      [1, 'first'],
      [2, 'second'],
    ])
    const diagnostics = lintExperimentDocument(exp)
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'UNKNOWN_H2_SECTION')).toBe(true)
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'DUPLICATE_H2_SECTION')).toBe(true)
  })

  it('metadata-only serialization preserves the exact legacy body, including preamble and duplicates', () => {
    const readme = `${FRONTMATTER}\n\n# Legacy title\n\n## Notes\nfirst\n\n## Notes\nsecond\n`
    const parsed = parseExperimentReadme(readme, 'E0001-foo')
    parsed.frontMatter.title = 'Changed title'
    const serialized = serializeExperimentReadme({
      frontMatter: parsed.frontMatter,
      sections: parsed.sections,
      warningsRaw: parsed.warningsRaw,
      rawSections: parsed.rawSections,
      rawBody: parsed.body,
    })
    expect(serialized.slice(serialized.indexOf('---', 4) + 3)).toBe(parsed.body)
    expect(serialized).toContain('title: Changed title')
  })

  it('requires every Experiment Run to be assigned to exactly one Variant', () => {
    const readme = canonicalReadme().replace(
      'runs: []',
      'runs: [logs/foo-260810-010000, logs/orphan-260810-020000]',
    )
    const exp = experiment(readme, {
      experiment_schema_version: 1,
      variants: [
        { id: 'V0001', name: 'one', runs: ['logs/foo-260810-010000'] },
        {
          id: 'V0002',
          name: 'two',
          runs: ['logs/foo-260810-010000', 'logs/foreign-260810-030000'],
        },
      ],
    })
    const codes = lintExperimentDocument(exp).map((diagnostic) => diagnostic.code)
    expect(codes).toContain('RUN_ASSIGNED_TO_MULTIPLE_VARIANTS')
    expect(codes).toContain('VARIANT_RUN_NOT_EXPERIMENT_MEMBER')
    expect(codes).toContain('UNASSIGNED_EXPERIMENT_RUN')
  })

  it('keeps same-basename Runs under different paths distinct in Variant runs', () => {
    const readme = canonicalReadme().replace('runs: []', 'runs: [logs/a/dup-260810-010000]')
    const exp = experiment(readme, {
      experiment_schema_version: 1,
      variants: [
        {
          id: 'V0001',
          name: 'declared',
          runs: ['logs/a/dup-260810-010000', 'outputs/b/dup-260810-010000', 'dup-260810-010000'],
        },
      ],
    })
    const members = lintExperimentDocument(exp).filter(
      (diagnostic) => diagnostic.code === 'VARIANT_RUN_NOT_EXPERIMENT_MEMBER',
    )
    // The sibling path and the bare base name are not the declared member,
    // even though both share its base name; neither is silently matched.
    expect(members.map((diagnostic) => diagnostic.message)).toEqual([
      expect.stringContaining('outputs/b/dup-260810-010000'),
      expect.stringContaining('references dup-260810-010000,'),
    ])
    expect(lintExperimentDocument(exp).map((diagnostic) => diagnostic.code)).not.toContain(
      'UNASSIGNED_EXPERIMENT_RUN',
    )
  })

  it('warns about legacy bare Run IDs but not project-relative paths', () => {
    const exp = experiment(
      canonicalReadme().replace('runs: []', 'runs: [logs/a/foo-260810-010000, bar-260810-020000]'),
    )
    const legacy = lintExperimentDocument(exp).filter(
      (diagnostic) => diagnostic.code === 'LEGACY_RUN_ID_REF',
    )
    expect(legacy).toEqual([
      expect.objectContaining({ severity: 'warning', field: 'runs', file: 'README.md' }),
    ])
    expect(legacy[0]!.message).toContain('"bar-260810-020000"')
  })

  it('allows a planned Variant with zero Runs', () => {
    const exp = experiment(canonicalReadme(), {
      experiment_schema_version: 1,
      variants: [{ id: 'V0001', name: 'planned', status: 'PLANNED', runs: [] }],
    })
    exp.documents!.investigation = parseInvestigationYaml('schema_version: 1\nitems: []\n')
    expect(lintExperimentDocument(exp)).toEqual([])
  })

  it('reports a missing description file, a leftover results.yaml and README duplicates', () => {
    const missing = experiment()
    missing.documents!.description = undefined
    missing.documents!.results = legacyResults(true)
    const codes = lintExperimentDocument(missing).map((diagnostic) => diagnostic.code)
    expect(codes).toContain('MISSING_MANAGED_DOCUMENT')
    expect(codes).toContain('LEGACY_RESULTS_YAML')
    const duplicated = experiment(canonicalReadme(), {
      experiment_schema_version: 1,
      status: 'OPEN',
      variants: [{ id: 'V0001', name: 'x', status: 'COMPLETED', runs: [] }],
    })
    duplicated.documents!.investigation = parseInvestigationYaml('schema_version: 1\nitems: []\n')
    expect(lintExperimentDocument(duplicated).map((diagnostic) => diagnostic.code)).toEqual([
      'DESCRIPTION_DUPLICATES_README',
      'DERIVED_STATUS_DECLARED',
    ])
  })

  it('lints member result files against the description file', () => {
    const exp = experiment(MEMBERS_README)
    const file = (run: string, content: string) => ({
      run,
      parsed: parseResultFile(content, `${run}/result.csv`),
    })
    const diagnostics = lintExperimentDocument(exp, {
      resultFiles: [
        file(
          'logs/foo-260810-010000',
          'path,stat,value\n$experiment_schema_version,,1\nparams.precision,,fp4\nmetrics.final_loss,,2.5\n',
        ),
        file(
          'logs/foo-260810-000000',
          'path,stat,value\n$experiment_schema_version,,2\nmetrics.x,mean,1\n',
        ),
      ],
    })
    expect(
      diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.file, diagnostic.line]),
    ).toEqual([
      ['RESULT_VALUE_TYPE_MISMATCH', 'logs/foo-260810-010000/result.csv', 3],
      ['RESULT_SCHEMA_MISMATCH', 'logs/foo-260810-000000/result.csv', undefined],
    ])
    expect(diagnostics[1]!.message).toContain('memon experiment schema upgrade E0001-foo --to 1')
  })
})

function oneVariantResults(variantYaml: string) {
  return parseResultsYaml(`
schema_version: 1
columns: []
variants:
  - id: V0001
    name: first
${variantYaml}
`)
}

describe('Variant status vocabulary', () => {
  it('lists the statuses in canonical lifecycle order, BLOCKED after PLANNED', () => {
    expect(VARIANT_STATUS_VALUES).toEqual([
      'PLANNED',
      'BLOCKED',
      'RUNNING',
      'COMPLETED',
      'FAILED',
      'INCONCLUSIVE',
      'DROPPED',
    ])
  })

  it('parses, lints and renders a BLOCKED Variant without diagnostics', () => {
    const blocked = oneVariantResults(`    status: BLOCKED
    description: Waits for the parent Variant's step-500 checkpoint.
    runs: []
    attempts: []`)
    expect(blocked.parseErrors).toEqual([])
    expect(blocked.parseWarnings).toEqual([])
    expect(blocked.data?.variants[0]?.status).toBe('BLOCKED')
    expect(renderResultsMarkdown(blocked.data!)).toContain('| **V0001** first | `BLOCKED` |')

    const value = {
      experiment_schema_version: 1,
      variants: [
        {
          id: 'V0001',
          name: 'first',
          status: 'BLOCKED',
          description: "Waits for the parent Variant's step-500 checkpoint.",
          runs: [],
        },
      ],
    }
    const exp = experiment(canonicalReadme(), value)
    exp.documents!.investigation = parseInvestigationYaml('schema_version: 1\nitems: []\n')
    expect(lintExperimentDocument(exp)).toEqual([])
    const summary = generateResultsSummary({
      experimentId: 'E0001-foo',
      experimentDir: 'docs/experiments/E0001-foo',
      description: description(value),
      members: [],
      inputs: {},
      newestInputMtime: null,
      generatedAt: '2026-10-02T12:00:00+08:00',
      generator: { release: '9.0.0', role: 'cli' },
    })
    expect(renderExperimentManagedSection(exp, 'results', { summary }).markdown).toContain(
      '| **V0001** first | `BLOCKED` |',
    )
  })

  it('keeps an attempt on a BLOCKED Variant valid', () => {
    const blocked = oneVariantResults(`    status: BLOCKED
    runs: []
    attempts: [logs/foo-260810-000000]`)
    expect(blocked.parseErrors).toEqual([])
    expect(blocked.data?.variants[0]?.attempts).toEqual(['logs/foo-260810-000000'])
  })

  it('still rejects an unknown status and names the seven accepted statuses', () => {
    const waiting = oneVariantResults('    status: WAITING')
    expect(waiting.data).toBeNull()
    expect(waiting.parseErrors).toHaveLength(1)
    expect(waiting.parseErrors[0]).toMatchObject({
      field: 'variants.0.status',
      severity: 'error',
    })
    expect(waiting.parseErrors[0]!.message).toMatch(/^INVALID_RESULTS_SCHEMA: /)
    for (const status of VARIANT_STATUS_VALUES) {
      expect(waiting.parseErrors[0]!.message).toContain(`'${status}'`)
    }
  })

  it('is accepted by the Backend protocol Results document', () => {
    const blocked = oneVariantResults('    status: BLOCKED')
    const { extra: _extra, ...variant } = blocked.data!.variants[0]!
    expect(
      BackendResultsDocumentSchema.parse({
        schemaVersion: 1,
        columns: [],
        variants: [variant],
      }).variants[0]?.status,
    ).toBe('BLOCKED')
    expect(() =>
      BackendResultsDocumentSchema.parse({
        schemaVersion: 1,
        columns: [],
        variants: [{ ...variant, status: 'WAITING' }],
      }),
    ).toThrow()
  })
})

describe('Variant provenance env values', () => {
  const numericEnv = `    status: COMPLETED
    provenance:
      entry: scripts/train.sh
      env:
        MODE: fast
        LR: 0.000008
        STEPS: 1000
        DEBUG: true`

  it('reads unquoted numbers and booleans as strings and warns once per value', () => {
    const parsed = oneVariantResults(numericEnv)
    expect(parsed.parseErrors).toEqual([])
    expect(parsed.data?.variants[0]?.provenance?.env).toEqual({
      MODE: 'fast',
      LR: '0.000008',
      STEPS: '1000',
      DEBUG: 'true',
    })
    expect(parsed.parseWarnings.map((issue) => issue.field)).toEqual([
      'variants.0.provenance.env.LR',
      'variants.0.provenance.env.STEPS',
      'variants.0.provenance.env.DEBUG',
    ])
    expect(parsed.parseWarnings.every((issue) => issue.severity === 'warning')).toBe(true)
    expect(parsed.parseWarnings[0]!.message).toMatch(
      /^RESULTS_ENV_VALUE_COERCED: V0001 provenance\.env\.LR is a number; read as the string "0\.000008"/,
    )
    expect(parsed.parseWarnings[2]!.message).toContain('is a boolean; read as the string "true"')
  })

  it('uses the shortest round-trip spelling for numbers', () => {
    const parsed = oneVariantResults(`    status: PLANNED
    provenance:
      env:
        TINY: 1e-7
        SCI: 1.0e-5`)
    expect(parsed.data?.variants[0]?.provenance?.env).toEqual({ TINY: '1e-7', SCI: '0.00001' })
  })

  it('keeps null, list and mapping env values as schema errors', () => {
    for (const value of ['null', '[1, 2]', '{a: 1}']) {
      const parsed = oneVariantResults(`    status: PLANNED
    provenance:
      env:
        LR: ${value}`)
      expect(parsed.data).toBeNull()
      expect(parsed.parseErrors).toHaveLength(1)
      expect(parsed.parseErrors[0]).toMatchObject({
        field: 'variants.0.provenance.env.LR',
        severity: 'error',
      })
      expect(parsed.parseErrors[0]!.message).toMatch(
        /^INVALID_RESULTS_SCHEMA: Expected string, received (null|array|object)$/,
      )
    }
  })

  it('reports the coercion as a bundle warning that leaves the Experiment editable', () => {
    const value = {
      experiment_schema_version: 1,
      variants: [{ id: 'V0001', name: 'first', status: 'PLANNED', values: { 'env.LR': 0.000008 } }],
    }
    const documents = {
      implementation,
      investigation: parseInvestigationYaml('schema_version: 1\nitems: []\n'),
      results: legacyResults(),
      description: description(value),
    }
    const diagnostics = validateExperimentManagedDocuments(documents)
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'RESULTS_ENV_VALUE_COERCED',
        severity: 'warning',
        file: 'experiment.json',
        field: 'variants.0.values.env.LR',
      }),
    ])
    const exp = experiment()
    exp.documents = documents
    expect(lintExperimentDocument(exp).filter((d) => d.severity === 'error')).toEqual([])
    expect(buildExperimentDocumentView(exp).readOnly).toBe(false)
  })

  it('serializes normalized env values as quoted strings that read back without a warning', () => {
    const parsed = oneVariantResults(numericEnv)
    const yaml = serializeResultsYaml(parsed.data!)
    expect(yaml).toContain("LR: '0.000008'")
    expect(yaml).toContain("STEPS: '1000'")
    expect(yaml).toContain("DEBUG: 'true'")
    const reparsed = parseResultsYaml(yaml)
    expect(reparsed.parseErrors).toEqual([])
    expect(reparsed.parseWarnings).toEqual([])
    expect(reparsed.data?.variants[0]?.provenance?.env).toEqual(
      parsed.data?.variants[0]?.provenance?.env,
    )
  })

  it('lets the annotation upsert run on a document with a coerced env value', () => {
    const raw = `schema_version: 1
columns:
  - key: lr
    label: LR
    group: parameter
    type: number
variants:
  - id: V0001
    name: first
    status: BLOCKED
    parameters: {lr: 0.1}
    provenance:
      env:
        LR: 0.000008
`
    const result = upsertResultColumnAnnotationYaml(raw, 'lr', 'Learning rate.')
    expect(result.changed).toBe(true)
    const reparsed = parseResultsYaml(result.content)
    expect(reparsed.parseErrors).toEqual([])
    expect(reparsed.data?.columnAnnotations?.lr?.description).toBe('Learning rate.')
    expect(reparsed.data?.variants[0]?.status).toBe('BLOCKED')
  })
})
