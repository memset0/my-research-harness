// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ExperimentResultsViewDefinition } from '../experiment-results-views'
import {
  closeExperimentResultsViewsStores,
  getExperimentResultsViewsStore,
  ResultsViewConflictError,
} from './experiment-results-views-store'
import { closeUiPreferencesStores, getUiPreferencesStore } from './ui-preferences-store'

let directory: string
const configPath = () => join(directory, 'config.yml')
const scope = {
  host: 'host-a',
  project: 'research',
  experimentId: 'E0001-demo',
} as const

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'memon-results-views-'))
})

afterEach(async () => {
  await closeExperimentResultsViewsStores()
  await closeUiPreferencesStores()
  await rm(directory, { recursive: true, force: true })
})

describe('ExperimentResultsViewsStore', () => {
  it('shares CRUD state by Experiment without a username dimension', async () => {
    const store = getExperimentResultsViewsStore(configPath())
    const created = await store.create(scope, 'Review', definition(['schema:loss']))
    expect(await store.list(scope)).toEqual([created])
    expect(await store.list({ ...scope, experimentId: 'E0002-other' })).toEqual([])

    const updated = await store.update(scope, created.id, {
      definition: definition(['schema:accuracy']),
    })
    expect(updated.revision).toBe(2)
    expect(updated.definition.hiddenColumnIds).toEqual(['schema:accuracy'])

    await expect(store.create(scope, ' review ', definition([]))).rejects.toBeInstanceOf(
      ResultsViewConflictError,
    )
    await expect(
      store.create({ ...scope, experimentId: 'E0002-other' }, 'Review', definition([])),
    ).resolves.toMatchObject({ name: 'Review' })

    await store.delete(scope, created.id)
    await expect(store.list(scope)).resolves.toEqual([])
  })

  it('imports every distinct legacy definition and retains source rows', async () => {
    const legacy = getUiPreferencesStore(configPath())
    const key = 'memon:results-table:host-a:research:E0001-demo:preferences'
    const first = definition(['schema:loss'])
    const second = definition(['schema:accuracy'])
    await legacy.set('alice', key, first)
    await legacy.set('bob', key, second)
    await legacy.set('carol', key, first)
    await closeUiPreferencesStores()

    const store = getExperimentResultsViewsStore(configPath())
    const imported = await store.list(scope)
    expect(imported).toHaveLength(2)
    expect(imported.map((view) => view.name)).toEqual(['Default', 'Imported view 2'])
    expect(imported.map((view) => view.definition.hiddenColumnIds)).toEqual([
      ['schema:loss'],
      ['schema:accuracy'],
    ])

    const source = getUiPreferencesStore(configPath())
    await expect(source.get('alice', key)).resolves.toMatchObject({ found: true, value: first })
    await expect(source.get('bob', key)).resolves.toMatchObject({ found: true, value: second })
    await expect(source.get('carol', key)).resolves.toMatchObject({ found: true, value: first })
  })

  it('is idempotent across process restarts and leaves malformed legacy rows untouched', async () => {
    const legacy = getUiPreferencesStore(configPath())
    const validKey = 'memon:results-table:host-a:research:E0001-demo:preferences'
    const malformedKey = 'memon:results-table:ambiguous:extra:research:E0001-demo:preferences'
    await legacy.set('alice', validKey, definition([]))
    await legacy.set('alice', malformedKey, { old: true })
    await closeUiPreferencesStores()

    const firstStore = getExperimentResultsViewsStore(configPath())
    const first = await firstStore.list(scope)
    await closeExperimentResultsViewsStores()
    const second = await getExperimentResultsViewsStore(configPath()).list(scope)
    expect(second).toEqual(first)

    const source = getUiPreferencesStore(configPath())
    await expect(source.get('alice', malformedKey)).resolves.toMatchObject({
      found: true,
      value: { old: true },
    })
  })
})

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
