import { describe, expect, it } from 'vitest'
import { BACKEND_API_MAJOR } from './backend-protocol.js'
import { evaluateReleaseCompatibility } from './release-compatibility.js'

function compatibility(
  centralRelease: unknown,
  backendRelease: unknown,
  centralApiMajor: unknown = BACKEND_API_MAJOR,
  backendApiMajor: unknown = BACKEND_API_MAJOR,
) {
  return evaluateReleaseCompatibility({
    centralRelease,
    centralApiMajor,
    backendRelease,
    backendApiMajor,
  })
}

describe('release compatibility matrix', () => {
  it.each([
    ['6.2.0', '6.2.0'],
    ['6.2.0', '6.2.999'],
    ['6.2.999', '6.2.0'],
  ])('treats current-Minor patches as online: central %s, Backend %s', (central, backend) => {
    expect(compatibility(central, backend)).toBe('online')
  })

  it.each([
    ['6.2.0', '6.1.0'],
    ['6.2.0', '6.1.999'],
    ['6.2.999', '6.1.0'],
  ])('keeps the immediately prior Minor usable regardless of Patch: central %s, Backend %s', (central, backend) => {
    expect(compatibility(central, backend)).toBe('update_available')
  })

  it('requires an older Backend to upgrade', () => {
    expect(compatibility('6.3.0', '6.1.999')).toBe('upgrade_required')
  })

  it('requires central to update before routing to a newer Backend', () => {
    expect(compatibility('6.1.999', '6.2.0')).toBe('central_update_required')
  })

  it.each([
    ['6.2.0', '7.2.0'],
    ['7.2.0', '6.2.0'],
  ])('requires filesystem migration across Majors: central %s, Backend %s', (central, backend) => {
    expect(compatibility(central, backend)).toBe('filesystem_migration_required')
  })

  it.each([
    ['6.2', '6.2.0', BACKEND_API_MAJOR, BACKEND_API_MAJOR],
    ['6.2.0', 'v6.2.0', BACKEND_API_MAJOR, BACKEND_API_MAJOR],
    ['6.2.0', '6.2.0-next', BACKEND_API_MAJOR, BACKEND_API_MAJOR],
    ['6.2.0', null, BACKEND_API_MAJOR, BACKEND_API_MAJOR],
    ['6.2.0', '6.2.0', '1', BACKEND_API_MAJOR],
    ['6.2.0', '6.2.0', BACKEND_API_MAJOR, BACKEND_API_MAJOR + 1],
    ['6.2.0', '6.2.0', BACKEND_API_MAJOR + 1, BACKEND_API_MAJOR + 1],
  ])('classifies malformed or unsupported metadata as misconfigured', (centralRelease, backendRelease, centralApiMajor, backendApiMajor) => {
    expect(compatibility(centralRelease, backendRelease, centralApiMajor, backendApiMajor)).toBe(
      'misconfigured',
    )
  })
})
