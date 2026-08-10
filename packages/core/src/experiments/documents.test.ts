import { describe, expect, it } from 'vitest'
import {
  lintExperimentDocument,
  MANAGED_SECTION_POINTERS,
  parseImplementationYaml,
  parseInvestigationYaml,
  parseResultsYaml,
  renderExperimentManagedSection,
  renderImplementationMarkdown,
  renderResultsMarkdown,
  validateExperimentManagedDocuments,
} from './documents.js'
import { buildExperimentRecord, parseExperimentReadme } from './parse.js'
import { serializeExperimentReadme } from './serialize.js'

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

function experiment(readme = canonicalReadme()) {
  const parsed = parseExperimentReadme(readme, 'E0001-foo')
  return buildExperimentRecord(parsed, {
    id: 'E0001-foo',
    project: 'p',
    path: '/tmp/E0001-foo/README.md',
    mtime: 1,
    documents: { implementation, investigation, results },
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
    expect(validateExperimentManagedDocuments({ implementation, investigation, results })).toEqual(
      [],
    )

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
      results: parseResultsYaml('schema_version: 1\ncolumns: []\nvariants: []\n'),
    })
    expect(diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PARENT_STATUS_CONFLICT' })]),
    )
  })

  it('renders Results as a Markdown table with accepted Runs and separate Attempts', () => {
    const markdown = renderResultsMarkdown(results.data!)
    expect(markdown).toContain(
      '| Variant | Status | Precision | Final loss | Entry | Recipe | Commit | Runs | Attempts |',
    )
    expect(markdown).toContain('`foo-260810-010000`')
    expect(markdown).toContain('`foo-260810-000000`')
    expect(markdown).not.toContain('[`foo-260810-010000`](')
    expect(markdown).not.toContain('[`foo-260810-000000`](')
  })

  it('optionally links accepted Runs and Attempts to memon documents and W&B', () => {
    const rendered = renderExperimentManagedSection(experiment(), 'results', {
      runs: {
        'foo-260810-010000': {
          documentUrl: '/p/demo/r/foo(accepted)',
          wandbUrl: 'https://wandb.ai/acme/project/runs/accepted run',
        },
        'foo-260810-000000': {
          documentUrl: '/p/demo/r/foo-attempt',
          wandbUrl: 'https://wandb.ai/acme/project/runs/attempt',
        },
      },
    })

    expect(rendered.markdown).toContain(
      '[`foo-260810-010000`](/p/demo/r/foo%28accepted%29) · [W&B](https://wandb.ai/acme/project/runs/accepted%20run)',
    )
    expect(rendered.markdown).toContain(
      '[`foo-260810-000000`](/p/demo/r/foo-attempt) · [W&B](https://wandb.ai/acme/project/runs/attempt)',
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

  it('rejects overlap between accepted Runs and Attempts', () => {
    const overlap = parseResultsYaml(`
schema_version: 1
columns: []
variants:
  - id: V0001
    name: baseline
    status: FAILED
    runs: [foo-260810-010000]
    attempts: [foo-260810-010000]
`)
    const diagnostics = validateExperimentManagedDocuments({
      implementation,
      investigation,
      results: overlap,
    })
    expect(diagnostics.some((diagnostic) => diagnostic.code === 'RUN_ATTEMPT_OVERLAP')).toBe(true)
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

  it('uses YAML only when a managed section is the exact one-line pointer', () => {
    const rendered = renderExperimentManagedSection(experiment(), 'results')
    expect(rendered.source).toBe('yaml')
    expect(rendered.markdown).toContain('| Variant |')
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
      'runs: [foo-260810-010000, orphan-260810-020000]',
    )
    const duplicateResults = parseResultsYaml(`
schema_version: 1
columns: []
variants:
  - id: V0001
    name: one
    status: COMPLETED
    runs: [foo-260810-010000]
    attempts: []
  - id: V0002
    name: two
    status: FAILED
    runs: []
    attempts: [foo-260810-010000, foreign-260810-030000]
`)
    const exp = experiment(readme)
    exp.documents = { implementation, investigation, results: duplicateResults }
    const codes = lintExperimentDocument(exp).map((diagnostic) => diagnostic.code)
    expect(codes).toContain('RUN_ASSIGNED_TO_MULTIPLE_VARIANTS')
    expect(codes).toContain('VARIANT_RUN_NOT_EXPERIMENT_MEMBER')
    expect(codes).toContain('UNASSIGNED_EXPERIMENT_RUN')
  })

  it('allows a planned Variant with zero Runs', () => {
    const planned = parseResultsYaml(`
schema_version: 1
columns: []
variants:
  - id: V0001
    name: planned
    status: PLANNED
    runs: []
    attempts: []
`)
    const exp = experiment()
    exp.documents = {
      implementation,
      investigation: parseInvestigationYaml('schema_version: 1\nitems: []\n'),
      results: planned,
    }
    expect(lintExperimentDocument(exp)).toEqual([])
  })
})
