// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetTranslationReadinessForTests,
  FAILURE_TTL_MS,
  READY_TTL_MS,
  translationReadiness,
} from './readiness'

let clock = 0
const now = () => clock

beforeEach(() => {
  __resetTranslationReadinessForTests()
  clock = 1_000_000
})

describe('translation readiness memo', () => {
  it('shares one probe and remembers a failure for a minute', async () => {
    const probe = vi.fn(async () => {
      throw new Error('PROVIDER_FAILED')
    })
    await Promise.all([
      expect(translationReadiness(probe, now)).rejects.toThrow('PROVIDER_FAILED'),
      expect(translationReadiness(probe, now)).rejects.toThrow('PROVIDER_FAILED'),
    ])
    expect(probe).toHaveBeenCalledTimes(1)
    clock += FAILURE_TTL_MS - 1
    await expect(translationReadiness(probe, now)).rejects.toThrow('PROVIDER_FAILED')
    expect(probe).toHaveBeenCalledTimes(1)
    clock += 1
    await expect(translationReadiness(probe, now)).rejects.toThrow('PROVIDER_FAILED')
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('remembers success for ten minutes', async () => {
    const probe = vi.fn(async () => undefined)
    await translationReadiness(probe, now)
    clock += READY_TTL_MS - 1
    await translationReadiness(probe, now)
    expect(probe).toHaveBeenCalledTimes(1)
    clock += 1
    await translationReadiness(probe, now)
    expect(probe).toHaveBeenCalledTimes(2)
  })
})
