import { afterEach, describe, expect, it, vi } from 'vitest'
import { emitWarningDeprecationBanner, WARNING_CLI_DEPRECATION } from './deprecations.js'

describe('warning CLI deprecation', () => {
  afterEach(() => {
    delete process.env.MEMON_QUIET_DEPRECATIONS
    vi.restoreAllMocks()
  })

  it('prints exactly one permanent notice even when other deprecations are quieted', () => {
    process.env.MEMON_QUIET_DEPRECATIONS = '1'
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    emitWarningDeprecationBanner()

    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith(WARNING_CLI_DEPRECATION)
    expect(WARNING_CLI_DEPRECATION).not.toMatch(/remove|future release|next major/i)
  })
})
