import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Render } from './render'

vi.mock('next/dynamic', () => ({
  default:
    () =>
    ({ model }: { model: { series: string[] } }) => (
      <div data-plot-series={model.series.join(',')} />
    ),
}))

const block = {
  type: 'datatable',
  version: 1,
  id: 'chart',
  line: 1,
  payload: '',
  executable: false,
  document: null,
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
            ['E1', 'loss', 'a', 2, 4],
            ['E1', 'loss', 'a', 1, 5],
            ['E1', 'fid', 'b', 1, 9],
            ['E2', 'fid', 'c', 1, 8],
            ['E2', 'loss', 'd', 1, 'n/a'],
          ],
          views: [
            { type: 'table' },
            {
              type: 'line',
              x: 'step',
              y: 'value',
              series: 'run',
              tabs: 'experiment',
              select: 'metric',
            },
          ],
        }}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'line' }))
    expect(screen.getByRole('tab', { name: 'E1' })).toHaveAttribute('data-state', 'active')
    expect(document.querySelector('[data-plot-series]')).toHaveAttribute('data-plot-series', 'a')
    const trigger = document.querySelector('[data-datatable-select="metric"]') as HTMLElement
    await userEvent.click(trigger)
    await userEvent.click(await screen.findByRole('option', { name: 'fid' }))
    await waitFor(() =>
      expect(document.querySelector('[data-plot-series]')).toHaveAttribute('data-plot-series', 'b'),
    )
    await userEvent.click(screen.getByRole('tab', { name: 'E2' }))
    await waitFor(() =>
      expect(document.querySelector('[data-plot-series]')).toHaveAttribute('data-plot-series', 'c'),
    )
    expect(screen.queryByText(/rows skipped/)).not.toBeInTheDocument()
    await userEvent.click(document.querySelector('[data-datatable-select="metric"]') as HTMLElement)
    await userEvent.click(await screen.findByRole('option', { name: 'loss' }))
    expect(await screen.findByText('1 row skipped (non-numeric y)')).toBeInTheDocument()
  })

  const filtered = {
    columns: ['run', 'fid'],
    data: [
      ['bf16', 14],
      ['bf16', 16],
      ['fp32', 13],
      ['fp32', 17],
    ],
  }
  const rowCount = () => document.querySelector('[data-datatable-rowcount]')?.textContent
  const bodyRuns = () =>
    Array.from(document.querySelectorAll('tbody tr')).map((row) => row.textContent)

  it('applies a default filter in one mode, switches, and clears with All', async () => {
    render(
      <Render
        block={block}
        data={{
          ...filtered,
          views: [
            {
              type: 'table',
              filter_mode: 'one',
              filters: [
                { label: 'fid < 15', where: { fid: { lt: 15 } }, default: true },
                { label: 'bf16 only', where: { run: 'bf16' } },
              ],
            },
          ],
        }}
      />,
    )
    expect(screen.getByRole('button', { name: 'fid < 15' })).toHaveAttribute('aria-pressed', 'true')
    expect(rowCount()).toBe('2 of 4 rows')
    expect(bodyRuns()).toEqual(['bf1614', 'fp3213'])
    await userEvent.click(screen.getByRole('button', { name: 'bf16 only' }))
    expect(screen.getByRole('button', { name: 'fid < 15' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(bodyRuns()).toEqual(['bf1614', 'bf1616'])
    await userEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(rowCount()).toBe('4 of 4 rows')
  })

  it('combines filters in any mode and reports no match', async () => {
    render(
      <Render
        block={block}
        data={{
          ...filtered,
          views: [
            {
              type: 'table',
              filters: [
                { label: 'fid < 15', where: { fid: { lt: 15 } } },
                { label: 'bf16 only', where: { run: 'bf16' } },
                { label: 'huge', where: { fid: { gt: 100 } } },
              ],
            },
          ],
        }}
      />,
    )
    expect(screen.queryByRole('button', { name: 'All' })).not.toBeInTheDocument()
    expect(rowCount()).toBe('4 of 4 rows')
    await userEvent.click(screen.getByRole('button', { name: 'fid < 15' }))
    await userEvent.click(screen.getByRole('button', { name: 'bf16 only' }))
    expect(bodyRuns()).toEqual(['bf1614'])
    await userEvent.click(screen.getByRole('button', { name: 'huge' }))
    expect(screen.getByText('No rows match the active filters.')).toBeInTheDocument()
    for (const name of ['fid < 15', 'bf16 only', 'huge'])
      await userEvent.click(screen.getByRole('button', { name }))
    expect(rowCount()).toBe('4 of 4 rows')
  })

  it('shows no filter chips on an unfiltered table', () => {
    render(<Render block={block} data={{ ...filtered, views: [{ type: 'table' }] }} />)
    expect(document.querySelector('[data-datatable-filters]')).toBeNull()
    expect(bodyRuns()).toHaveLength(4)
  })

  it('mounts a scatter view and reports skipped rows', async () => {
    render(
      <Render
        block={block}
        data={{
          columns: ['lr', 'fid', 'run'],
          data: [
            [0.001, 14, 'a'],
            [0.001, 15, 'b'],
            ['n/a', 12, 'b'],
          ],
          views: [{ type: 'table' }, { type: 'scatter', x: 'lr', y: 'fid', series: 'run' }],
        }}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'scatter' }))
    expect(document.querySelector('[data-datatable-plot="scatter"]')).not.toBeNull()
    expect(document.querySelector('[data-plot-series]')).toHaveAttribute('data-plot-series', 'a,b')
    expect(screen.getByText('1 row skipped (non-numeric x or y)')).toBeInTheDocument()
  })
})
