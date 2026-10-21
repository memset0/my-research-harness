// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('../lib/server/runtime', () => ({
  getRuntime: async () => ({ config: { gitStatus: { intervalMs: 10000 } } }),
}))

import { readSerializedRuntimeConfig } from './runtime-config-bootstrap'

afterEach(() => vi.unstubAllEnvs())

it.each([
  '1',
  '0',
  'true',
  undefined,
])('serializes only explicit translation enablement: %s', async (value) => {
  vi.stubEnv('MEMON_TRANSLATION_ENABLED', value)
  expect((await readSerializedRuntimeConfig()).translation).toEqual({ enabled: value === '1' })
})
