import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../components/experiment-card-grid', () => ({
  ExperimentCardGrid: ({ project }: { project: unknown }) => (
    <pre data-testid="project-ref">{JSON.stringify(project)}</pre>
  ),
}))

import CentralProjectPage from './page'

describe('central Host-qualified Project page', () => {
  it('passes the exact Host+Project tuple into the data surface', async () => {
    render(
      await CentralProjectPage({
        params: Promise.resolve({ host: 'host-a', project: 'shared-project' }),
      }),
    )
    expect(screen.getByTestId('project-ref')).toHaveTextContent(
      JSON.stringify({ host: 'host-a', project: 'shared-project' }),
    )
  })
})
