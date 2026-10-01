import { describe, expect, it } from 'vitest'
import {
  assertReleaseMajorMatchesFsConvention,
  FS_CONVENTION_VERSION,
  MEMON_RELEASE,
  MEMON_RELEASE_METADATA,
  MEMON_REVISION,
  parseMemonReleaseMajor,
  VERSION,
} from './version.js'

describe('memon release metadata', () => {
  it('publishes the filesystem-aligned 7.3.0 release from one source', () => {
    expect(MEMON_RELEASE).toBe('7.3.0')
    expect(parseMemonReleaseMajor(MEMON_RELEASE)).toBe(FS_CONVENTION_VERSION)
    expect(VERSION).toBe(MEMON_RELEASE)
    expect(MEMON_RELEASE_METADATA).toEqual({
      release: MEMON_RELEASE,
      revision: MEMON_REVISION,
    })
    expect(Object.isFrozen(MEMON_RELEASE_METADATA)).toBe(true)
  })

  it('rejects a release Major that differs from FS_CONVENTION_VERSION', () => {
    const mismatchedMajor = FS_CONVENTION_VERSION + 1

    expect(() => assertReleaseMajorMatchesFsConvention(`${mismatchedMajor}.0.0`)).toThrow(
      `memon release Major ${mismatchedMajor} must equal FS_CONVENTION_VERSION ${FS_CONVENTION_VERSION}`,
    )
  })

  it.each(['6', '6.0', 'v6.0.0', '6.0.0-next'])('rejects non-canonical release %s', (release) => {
    expect(() => assertReleaseMajorMatchesFsConvention(release)).toThrow(
      /expected MAJOR\.MINOR\.PATCH/,
    )
  })
})
