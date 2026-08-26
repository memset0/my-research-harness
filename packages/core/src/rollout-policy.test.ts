import { describe, expect, it } from 'vitest'
import { planMinorRollout, preflightCentralRollback } from './rollout-policy.js'

const REVISION = '0123456789abcdef'

describe('fleet rollout policy', () => {
  it('plans central first and pins every Backend to one exact target', () => {
    const plan = planMinorRollout({
      currentCentralRelease: '6.1.7',
      targetRelease: '6.2.0',
      targetRevision: REVISION,
      backends: [
        { host: 'host-a', release: '6.1.0', revision: 'old-a' },
        { host: 'host-b', release: '6.0.9', revision: 'old-b' },
      ],
    })
    expect(plan.steps).toEqual([
      { order: 1, target: 'central', release: '6.2.0', revision: REVISION },
      { order: 2, target: 'backend', host: 'host-a', release: '6.2.0', revision: REVISION },
      { order: 3, target: 'backend', host: 'host-b', release: '6.2.0', revision: REVISION },
    ])
    expect(new Set(plan.steps.map((step) => step.revision))).toEqual(new Set([REVISION]))
  })

  it.each([
    ['6.1.8', /one Minor/],
    ['6.2.1', /reset Patch/],
    ['6.3.0', /one Minor/],
    ['7.0.0', /one Minor/],
  ])('rejects invalid normal rollout target %s', (targetRelease, message) => {
    expect(() =>
      planMinorRollout({
        currentCentralRelease: '6.1.7',
        targetRelease,
        targetRevision: REVISION,
        backends: [],
      }),
    ).toThrow(message)
  })

  it('rejects duplicate and already-incompatible pre-rollout Hosts', () => {
    expect(() =>
      planMinorRollout({
        currentCentralRelease: '6.2.0',
        targetRelease: '6.3.0',
        targetRevision: REVISION,
        backends: [
          { host: 'host-a', release: '6.2.0', revision: 'a' },
          { host: 'host-a', release: '6.1.0', revision: 'b' },
        ],
      }),
    ).toThrow(/duplicate/)
    expect(() =>
      planMinorRollout({
        currentCentralRelease: '6.2.0',
        targetRelease: '6.3.0',
        targetRevision: REVISION,
        backends: [{ host: 'host-a', release: '6.0.0', revision: 'a' }],
      }),
    ).toThrow(/compatibility window/)
  })
})

describe('central rollback policy', () => {
  it('allows rollback only while every Backend remains current or previous Minor', () => {
    expect(
      preflightCentralRollback({
        targetCentralRelease: '6.1.4',
        targetCentralRevision: REVISION,
        backends: [
          { host: 'host-a', release: '6.1.0', revision: 'a' },
          { host: 'host-b', release: '6.0.8', revision: 'b' },
        ],
      }),
    ).toMatchObject({ allowed: true, backendRollbacksRequired: [] })
  })

  it('lists Backends that must roll back before central during a partial rollout', () => {
    const preflight = preflightCentralRollback({
      targetCentralRelease: '6.1.4',
      targetCentralRevision: REVISION,
      backends: [
        { host: 'host-a', release: '6.2.0', revision: 'new' },
        { host: 'host-b', release: '6.1.0', revision: 'old' },
      ],
    })
    expect(preflight.allowed).toBe(false)
    expect(preflight.backendRollbacksRequired).toEqual([
      {
        host: 'host-a',
        backendRelease: '6.2.0',
        compatibility: 'central_update_required',
      },
    ])
  })

  it('also blocks a cross-Major rollback', () => {
    expect(
      preflightCentralRollback({
        targetCentralRelease: '6.9.0',
        targetCentralRevision: REVISION,
        backends: [{ host: 'host-a', release: '7.0.0', revision: 'new' }],
      }),
    ).toMatchObject({
      allowed: false,
      backendRollbacksRequired: [
        expect.objectContaining({ compatibility: 'filesystem_migration_required' }),
      ],
    })
  })
})
