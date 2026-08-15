// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  closeUiPreferencesStores,
  getUiPreferencesStore,
  UI_PREFERENCES_DB_FILENAME,
  uiPreferencesDatabasePath,
} from './ui-preferences-store'

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'memon-ui-preferences-'))
})

afterEach(async () => {
  await closeUiPreferencesStores()
  await rm(directory, { recursive: true, force: true })
})

describe('UiPreferencesStore', () => {
  it('places the SQLite database beside config.yml', () => {
    expect(uiPreferencesDatabasePath(join(directory, 'config.yml'))).toBe(
      join(directory, UI_PREFERENCES_DB_FILENAME),
    )
  })

  it('distinguishes a missing row from an explicitly saved empty filter list', async () => {
    const store = getUiPreferencesStore(join(directory, 'config.yml'))
    const key = 'memon:results-table:research:E0001:preferences'

    await expect(store.get('alice', key)).resolves.toEqual({ found: false })

    await store.set('alice', key, { rowFilters: [] })
    await expect(store.get('alice', key)).resolves.toMatchObject({
      found: true,
      value: { rowFilters: [] },
    })
  })

  it('keeps the same preference key isolated by username', async () => {
    const store = getUiPreferencesStore(join(directory, 'config.yml'))
    await store.set('alice', 'shared-key', { maxLines: 3 })

    await expect(store.get('alice', 'shared-key')).resolves.toMatchObject({
      found: true,
      value: { maxLines: 3 },
    })
    await expect(store.get('bob', 'shared-key')).resolves.toEqual({ found: false })
  })
})
