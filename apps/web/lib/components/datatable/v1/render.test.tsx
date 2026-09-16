import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Render } from './render'

vi.mock('next/dynamic', () => ({
  default: () => ({ model }: { model: { series: string[] } }) => <div data-plot-series={model.series.join(',')} />,
}))

const block = {
  type: 'datatable', version: 1, id: 'chart', line: 1, payload: '', executable: false, document: null,
  resourceUrl: () => null,
}

describe('datatable@1 renderer', () => {
  it('switches views, filters series, resets select on tab change, and reports skipped rows', async () => {
    render(
      <Render
        block={block}
        data={{
          columns: ['experiment', 'metric', 'run', 'step', 'value'],
          data: [
            ['E1', 'loss', 'a', 2, 4], ['E1', 'loss', 'a', 1, 5], ['E1', 'fid', 'b', 1, 9],
            ['E2', 'fid', 'c', 1, 8], ['E2', 'loss', 'd', 1, 'n/a'],
          ],
          views: [{ type: 'table' }, { type: 'line', x: 'step', y: 'value', series: 'run', tabs: 'experiment', select: 'metric' }],
        }}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'line' }))
    expect(screen.getByRole('tab', { name: 'E1' })).toHaveAttribute('data-state', 'active')
    expect(document.querySelector('[data-plot-series]')).toHaveAttribute('data-plot-series', 'a')
    const trigger = document.querySelector('[data-datatable-select="metric"]') as HTMLElement
    await userEvent.click(trigger)
    await userEvent.click(await screen.findByRole('option', { name: 'fid' }))
    await waitFor(() => expect(document.querySelector('[data-plot-series]')).toHaveAttribute('data-plot-series', 'b'))
    await userEvent.click(screen.getByRole('tab', { name: 'E2' }))
    await waitFor(() => expect(document.querySelector('[data-plot-series]')).toHaveAttribute('data-plot-series', 'c'))
    expect(screen.queryByText(/rows skipped/)).not.toBeInTheDocument()
    await userEvent.click(document.querySelector('[data-datatable-select="metric"]') as HTMLElement)
    await userEvent.click(await screen.findByRole('option', { name: 'loss' }))
    expect(await screen.findByText('1 row skipped (non-numeric y)')).toBeInTheDocument()
  })
})
