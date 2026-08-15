import type { ImplementationDocument, InvestigationDocument } from '@memon/core'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ExperimentManagedSection } from './experiment-managed-section'

const IMPLEMENTATION: ImplementationDocument = {
  schemaVersion: 1,
  items: [
    {
      id: 'IMP0001',
      title: 'Add configurable precision',
      status: 'IN_PROGRESS',
      description: 'Teach the launcher to accept **BF16**.',
      dependsOn: [],
      acceptanceCriteria: ['BF16 reaches 100 steps without NaN'],
      files: ['src/training/precision.py'],
      commits: [
        {
          repo: '.',
          sha: '1234567890abcdef',
          url: 'https://github.com/example/repo/commit/1234567890abcdef',
        },
      ],
      codeReviews: ['code-review/2026-08-13-precision.md'],
      children: [
        {
          id: 'IMP0002',
          title: 'Cover the precision parser',
          status: 'DONE',
          dependsOn: ['IMP0001'],
          acceptanceCriteria: [],
          files: [],
          commits: [],
          codeReviews: [],
          outcome: 'Parser tests now cover invalid modes.',
          children: [],
        },
      ],
    },
  ],
}

const INVESTIGATION: InvestigationDocument = {
  schemaVersion: 1,
  items: [
    {
      id: 'INV0001',
      title: 'Measure BF16 convergence',
      status: 'ANSWERED',
      description: 'Compare the selected baselines.',
      dependsOn: ['IMP0001'],
      question: 'Does BF16 materially degrade final loss?',
      rationale: 'BF16 may improve throughput.',
      successCriteria: ['Final loss stays within the agreed tolerance'],
      variantIds: ['V0001', 'V0002'],
      outcome: 'BF16 stays within tolerance and is **accepted**.',
      children: [],
    },
  ],
}

describe('ExperimentManagedSection', () => {
  it('renders implementation hierarchy and engineering evidence', () => {
    const { container } = render(
      <ExperimentManagedSection
        kind="implementation"
        document={IMPLEMENTATION}
        project="research"
        experimentId="E0001-structured"
      />,
    )

    expect(container.querySelector('[data-slot="document-summary"]')).toHaveTextContent(
      '2 items across 1 workstream',
    )
    expect(screen.getByRole('heading', { name: 'Add configurable precision' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Cover the precision parser' })).toBeInTheDocument()
    expect(screen.getByText('1/1 child items settled')).toBeInTheDocument()
    expect(screen.getByText('BF16 reaches 100 steps without NaN')).toBeInTheDocument()
    expect(screen.getByText('src/training/precision.py')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '12345678' })).toHaveAttribute(
      'href',
      'https://github.com/example/repo/commit/1234567890abcdef',
    )
    expect(
      screen.getByRole('link', { name: 'code-review/2026-08-13-precision.md' }),
    ).toHaveAttribute(
      'href',
      '/p/research/code-review/experiments/E0001-structured/code-review/2026-08-13-precision',
    )
    expect(container.querySelector('[data-item-id="IMP0002"]')).toBeInTheDocument()
    expect(container.querySelector('[data-depth="1"]')).toBeInTheDocument()
  })

  it('renders investigation question, criteria, variants, and outcome separately', () => {
    const { container } = render(
      <ExperimentManagedSection
        kind="investigation"
        document={INVESTIGATION}
        project="research"
        experimentId="E0001-structured"
      />,
    )

    const document = container.querySelector<HTMLElement>('[data-slot="investigation-document"]')
    expect(document).not.toBeNull()
    expect(document!.querySelector('[data-slot="document-summary"]')).toHaveTextContent(
      '1 item across 1 workstream',
    )
    expect(within(document!).getByRole('heading', { name: 'Question' })).toBeInTheDocument()
    expect(
      within(document!).getByText('Does BF16 materially degrade final loss?'),
    ).toBeInTheDocument()
    expect(within(document!).getByRole('heading', { name: 'Success criteria' })).toBeInTheDocument()
    expect(within(document!).getByText('V0001')).toBeInTheDocument()
    expect(within(document!).getByText('V0002')).toBeInTheDocument()
    expect(within(document!).getByRole('heading', { name: 'Outcome' })).toBeInTheDocument()
    expect(within(document!).getByText('accepted')).toBeInTheDocument()
  })
})
