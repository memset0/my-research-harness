import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '../components/session-provider'
import type {
  ExperimentResultsView,
  ExperimentResultsViewDefinition,
} from './experiment-results-views'
import { useExperimentResultsViews } from './use-experiment-results-views'

const INITIAL = definition([])
const PROJECT = { host: 'host-a', project: 'research' } as never
const EXPERIMENT = 'E0001-demo'

function Harness() {
  const state = useExperimentResultsViews(PROJECT, EXPERIMENT, INITIAL)
  return (
    <>
      <output aria-label="active-name">{state.activeView?.name ?? 'none'}</output>
      <output aria-label="hidden">{state.definition.hiddenColumnIds.join(',')}</output>
      <output aria-label="count">{state.views.length}</output>
      <button
        type="button"
        onClick={() =>
          state.updateDefinition((current) => ({
            ...current,
            hiddenColumnIds: [...current.hiddenColumnIds, 'schema:loss'],
          }))
        }
      >
        Hide loss
      </button>
      <button type="button" onClick={() => state.selectView('view-b')}>
        Select B
      </button>
    </>
  )
}

beforeEach(() => window.localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('useExperimentResultsViews', () => {
  it('keeps a causal owner edit made before server hydration and writes it to the shared View', async () => {
    let resolveGet!: (response: Response) => void
    const pendingGet = new Promise<Response>((resolve) => {
      resolveGet = resolve
    })
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as {
          definition: ExperimentResultsViewDefinition
        }
        return Promise.resolve(json({ view: view('view-a', 'Default', body.definition, 2) }))
      }
      return pendingGet
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Hide loss' }))
    expect(screen.getByLabelText('hidden')).toHaveTextContent('schema:loss')

    resolveGet(json({ views: [view('view-a', 'Default', definition([]))], canMutate: true }))
    await waitFor(() => expect(patchCalls(fetchMock)).toHaveLength(1))
    expect(screen.getByLabelText('hidden')).toHaveTextContent('schema:loss')
    expect(JSON.parse(String(patchCalls(fetchMock)[0]?.[1]?.body))).toMatchObject({
      definition: { hiddenColumnIds: ['schema:loss'] },
    })
  })

  it('lets a viewer select every shared View without issuing a mutation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json({
        views: [
          view('view-a', 'Default', definition([])),
          view('view-b', 'Review', definition(['schema:accuracy'])),
        ],
        canMutate: false,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(
      <SessionProvider
        value={{
          role: 'viewer',
          scopeProjects: [],
          scopeProjectRefs: [PROJECT],
        }}
      >
        <Harness />
      </SessionProvider>,
    )

    await waitFor(() => expect(screen.getByLabelText('count')).toHaveTextContent('2'))
    fireEvent.click(screen.getByRole('button', { name: 'Select B' }))
    expect(screen.getByLabelText('active-name')).toHaveTextContent('Review')
    expect(screen.getByLabelText('hidden')).toHaveTextContent('schema:accuracy')
    fireEvent.click(screen.getByRole('button', { name: 'Hide loss' }))
    expect(screen.getByLabelText('hidden')).toHaveTextContent('schema:accuracy')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('imports an owner browser legacy value when the central collection is empty', async () => {
    window.localStorage.setItem(
      'memon:results-table:host-a:research:E0001-demo:preferences',
      JSON.stringify(definition(['schema:legacy'])),
    )
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as {
          name: string
          definition: ExperimentResultsViewDefinition
        }
        return Promise.resolve(json({ view: view('view-a', body.name, body.definition) }, 201))
      }
      return Promise.resolve(json({ views: [], canMutate: true }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<Harness />)
    await waitFor(() => expect(screen.getByLabelText('active-name')).toHaveTextContent('Default'))
    await waitFor(() => expect(postCalls(fetchMock)).toHaveLength(1))
    expect(JSON.parse(String(postCalls(fetchMock)[0]?.[1]?.body))).toMatchObject({
      name: 'Default',
      definition: { hiddenColumnIds: ['schema:legacy'] },
    })
    expect(screen.getByLabelText('hidden')).toHaveTextContent('schema:legacy')
  })
})

function view(
  id: string,
  name: string,
  value: ExperimentResultsViewDefinition,
  revision = 1,
): ExperimentResultsView {
  return {
    id,
    scope: { host: 'host-a', project: 'research', experimentId: EXPERIMENT },
    name,
    definition: value,
    revision,
    createdAt: 1,
    updatedAt: revision,
  }
}

function definition(hiddenColumnIds: string[]): ExperimentResultsViewDefinition {
  return {
    hiddenColumnIds,
    columnOrderIds: ['variant', 'status', 'schema:loss', 'schema:accuracy'],
    maxLines: 1,
    defaultSortRules: [],
    pinnedColumnIds: { left: [], right: [] },
    rowFilters: [],
    rowOverrides: {},
    sotaModes: {},
    decimalPlaces: {},
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function patchCalls(mock: ReturnType<typeof vi.fn>) {
  return mock.mock.calls.filter(([, init]) => init?.method === 'PATCH')
}

function postCalls(mock: ReturnType<typeof vi.fn>) {
  return mock.mock.calls.filter(([, init]) => init?.method === 'POST')
}
