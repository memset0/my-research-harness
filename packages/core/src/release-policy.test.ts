import { describe, expect, it } from 'vitest'
import { validateInitialRelease, validateReleaseTransition } from './release-policy.js'

describe('memon release policy', () => {
  it('accepts the FS v6 baseline as 6.0.0 only', () => {
    expect(validateInitialRelease('6.0.0', 6)).toBe('initial')
    expect(() => validateInitialRelease('6.1.0', 6)).toThrow(/initial release/)
    expect(() => validateInitialRelease('7.0.0', 6)).toThrow(/initial release/)
  })

  it('allows only central changes in a Patch release', () => {
    expect(
      validateReleaseTransition({
        previousRelease: '6.1.2',
        nextRelease: '6.1.3',
        previousFsConvention: 6,
        nextFsConvention: 6,
        changedSurfaces: ['central'],
      }),
    ).toBe('central-patch')
    for (const changedSurfaces of [
      ['central', 'backend'],
      ['central', 'cli'],
      ['backend'],
      ['cli'],
    ] as const) {
      expect(() =>
        validateReleaseTransition({
          previousRelease: '6.1.2',
          nextRelease: '6.1.3',
          previousFsConvention: 6,
          nextFsConvention: 6,
          changedSurfaces,
        }),
      ).toThrow(/Backend\/CLI release/)
    }
  })

  it('requires Backend or CLI changes to increment Minor and reset Patch', () => {
    for (const changedSurfaces of [['backend'], ['cli'], ['central', 'backend', 'cli']] as const) {
      expect(
        validateReleaseTransition({
          previousRelease: '6.1.7',
          nextRelease: '6.2.0',
          previousFsConvention: 6,
          nextFsConvention: 6,
          changedSurfaces,
        }),
      ).toBe('backend-cli-minor')
    }
    expect(() =>
      validateReleaseTransition({
        previousRelease: '6.1.7',
        nextRelease: '6.2.1',
        previousFsConvention: 6,
        nextFsConvention: 6,
        changedSurfaces: ['backend'],
      }),
    ).toThrow(/reset Patch/)
  })

  it('requires a one-step filesystem migration and next Major .0.0', () => {
    expect(
      validateReleaseTransition({
        previousRelease: '6.9.4',
        nextRelease: '7.0.0',
        previousFsConvention: 6,
        nextFsConvention: 7,
        changedSurfaces: ['filesystem', 'backend', 'cli', 'central'],
      }),
    ).toBe('filesystem-major')
    expect(() =>
      validateReleaseTransition({
        previousRelease: '6.9.4',
        nextRelease: '7.1.0',
        previousFsConvention: 6,
        nextFsConvention: 7,
        changedSurfaces: ['filesystem'],
      }),
    ).toThrow(/next Major at \.0\.0/)
    expect(() =>
      validateReleaseTransition({
        previousRelease: '6.9.4',
        nextRelease: '8.0.0',
        previousFsConvention: 6,
        nextFsConvention: 8,
        changedSurfaces: ['filesystem'],
      }),
    ).toThrow(/exactly one/)
  })

  it('supports multiple release boundaries while one change remains active', () => {
    expect(
      validateReleaseTransition({
        previousRelease: '6.0.0',
        nextRelease: '6.0.1',
        previousFsConvention: 6,
        nextFsConvention: 6,
        changedSurfaces: ['central'],
      }),
    ).toBe('central-patch')
    expect(
      validateReleaseTransition({
        previousRelease: '6.0.1',
        nextRelease: '6.1.0',
        previousFsConvention: 6,
        nextFsConvention: 6,
        changedSurfaces: ['central', 'backend', 'cli'],
      }),
    ).toBe('backend-cli-minor')
    expect(
      validateReleaseTransition({
        previousRelease: '6.1.0',
        nextRelease: '6.1.1',
        previousFsConvention: 6,
        nextFsConvention: 6,
        changedSurfaces: ['central'],
      }),
    ).toBe('central-patch')
  })

  it('rejects malformed versions, duplicate no-op axes, and Major drift', () => {
    expect(() =>
      validateReleaseTransition({
        previousRelease: '6.0',
        nextRelease: '6.0.1',
        previousFsConvention: 6,
        nextFsConvention: 6,
        changedSurfaces: ['central'],
      }),
    ).toThrow(/canonical/)
    expect(() =>
      validateReleaseTransition({
        previousRelease: '6.0.0',
        nextRelease: '7.0.0',
        previousFsConvention: 6,
        nextFsConvention: 6,
        changedSurfaces: ['central'],
      }),
    ).toThrow(/Major/)
    expect(() =>
      validateReleaseTransition({
        previousRelease: '6.0.0',
        nextRelease: '6.0.1',
        previousFsConvention: 6,
        nextFsConvention: 6,
        changedSurfaces: [],
      }),
    ).toThrow(/at least one/)
  })
})
