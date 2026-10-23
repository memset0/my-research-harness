// @vitest-environment node
import { RESERVED_HOST_IDS as CORE_RESERVED_HOST_IDS } from '@memon/core'
import { describe, expect, it } from 'vitest'
import {
  artifactIdPrefix,
  artifactNumber,
  canonicalFromLegacy,
  canonicalNumberRedirect,
  codeReviewPath,
  experimentPath,
  isRoutableHost,
  parseProjectPath,
  projectOfPath,
  projectPagePath,
  RESERVED_HOST_IDS,
  reportPath,
  wikiPath,
} from './project-routes'

const target = { host: 'host-a', project: 'project-a' }

describe('project routes', () => {
  it('builds every canonical page', () => {
    expect(projectPagePath(target, { kind: 'overview' })).toBe('/host-a/project-a')
    expect(projectPagePath(target, { kind: 'experiments' })).toBe('/host-a/project-a/experiments')
    expect(experimentPath(target, 'E0010-inference-kernels')).toBe('/host-a/project-a/e/10')
    expect(experimentPath(target, 'E0010')).toBe('/host-a/project-a/e/10')
    expect(projectPagePath(target, { kind: 'wiki-list' })).toBe('/host-a/project-a/wiki')
    expect(wikiPath(target, 'W0012')).toBe('/host-a/project-a/w/12')
    expect(projectPagePath(target, { kind: 'reports' })).toBe('/host-a/project-a/reports')
    expect(reportPath(target, 'R0007')).toBe('/host-a/project-a/r/7')
    expect(projectPagePath(target, { kind: 'journal' })).toBe('/host-a/project-a/journal')
    expect(projectPagePath(target, { kind: 'code-reviews' })).toBe('/host-a/project-a/code-review')
    expect(codeReviewPath(target, 'code-review/2026-05-24-fsdp-comm-overlap')).toBe(
      '/host-a/project-a/cr/2026-05-24-fsdp-comm-overlap',
    )
    expect(
      codeReviewPath(
        target,
        'experiments/E0005-bf16-flow-matching/code-review/2026-05-22-bf16-precision-guard',
      ),
    ).toBe('/host-a/project-a/e/5/cr/2026-05-22-bf16-precision-guard')
  })

  it('rejects ids that do not match their kind', () => {
    expect(() => reportPath(target, 'W0001')).toThrow(TypeError)
    expect(() => wikiPath(target, 'W1')).toThrow(TypeError)
    expect(() => experimentPath(target, 'R0001')).toThrow(TypeError)
    expect(() => codeReviewPath(target, 'code-review/notes')).toThrow(TypeError)
  })

  it('parses canonical pages and rejects everything else', () => {
    expect(parseProjectPath('/host-a/project-a')).toEqual({ target, page: { kind: 'overview' } })
    expect(parseProjectPath('/host-a/project-a/')?.page).toEqual({ kind: 'overview' })
    expect(parseProjectPath('/host-a/project-a/e/10')?.page).toEqual({
      kind: 'experiment',
      number: 10,
    })
    expect(parseProjectPath('/host-a/project-a/w/4')?.page).toEqual({ kind: 'wiki', number: 4 })
    expect(parseProjectPath('/host-a/project-a/r/7')?.page).toEqual({ kind: 'report', number: 7 })
    expect(parseProjectPath('/host-a/project-a/cr/2026-05-24-fsdp')?.page).toEqual({
      kind: 'code-review',
      key: '2026-05-24-fsdp',
    })
    expect(parseProjectPath('/host-a/project-a/e/5/cr/2026-05-22-guard')?.page).toEqual({
      kind: 'code-review',
      key: '2026-05-22-guard',
      experiment: 5,
    })
    for (const path of [
      '/host-a/project-a/r/0010',
      '/host-a/project-a/r/R0010',
      '/host-a/project-a/e/E0010-x',
      '/host-a/project-a/e/10/runs',
      '/host-a/project-a/unknown',
      '/host-a/project-a/cr/notes',
      '/h/host-a/p/project-a',
      '/p/project-a/e/10',
      '/api/projects/e/1',
      '/login/x',
      '/host-a',
      '/Host-A/project-a',
      '/host-a/project%2Fa',
    ]) {
      expect(parseProjectPath(path), path).toBeNull()
    }
  })

  it('maps every legacy path to its canonical page', () => {
    const rows: Array<[string, string]> = [
      ['/h/host-a/p/project-a', '/host-a/project-a'],
      ['/h/host-a/p/project-a/', '/host-a/project-a'],
      ['/h/host-a/p/project-a/e/E0010-inference-kernels', '/host-a/project-a/e/10'],
      ['/h/host-a/p/project-a/e/E0010', '/host-a/project-a/e/10'],
      ['/h/host-a/p/project-a/wiki', '/host-a/project-a/wiki'],
      ['/h/host-a/p/project-a/wiki/W0004', '/host-a/project-a/w/4'],
      ['/h/host-a/p/project-a/reports', '/host-a/project-a/reports'],
      ['/h/host-a/p/project-a/reports/R0010', '/host-a/project-a/r/10'],
      ['/h/host-a/p/project-a/journal', '/host-a/project-a/journal'],
      ['/h/host-a/p/project-a/code-review', '/host-a/project-a/code-review'],
      [
        '/h/host-a/p/project-a/code-review/code-review/2026-05-24-fsdp-comm-overlap',
        '/host-a/project-a/cr/2026-05-24-fsdp-comm-overlap',
      ],
      [
        '/h/host-a/p/project-a/code-review/experiments/E0005-bf16-flow-matching/code-review/2026-05-22-bf16-precision-guard',
        '/host-a/project-a/e/5/cr/2026-05-22-bf16-precision-guard',
      ],
    ]
    for (const [legacy, canonical] of rows)
      expect(canonicalFromLegacy(legacy), legacy).toBe(canonical)
  })

  it('answers not-found for unknown legacy paths and ignores other paths', () => {
    for (const path of [
      '/h',
      '/h/host-a',
      '/h/host-a/p',
      '/h/host-a/p/project-a/unknown',
      '/h/host-a/p/project-a/reports/R10',
      '/h/host-a/p/project-a/wiki/W0004/extra',
      '/h/login/p/project-a',
    ]) {
      expect(canonicalFromLegacy(path), path).toBe('not-found')
    }
    expect(canonicalFromLegacy('/host-a/project-a')).toBeNull()
    expect(canonicalFromLegacy('/help')).toBeNull()
  })

  it('normalizes padded and prefixed numbers', () => {
    expect(canonicalNumberRedirect('/host-a/project-a/r/0010')).toBe('/host-a/project-a/r/10')
    expect(canonicalNumberRedirect('/host-a/project-a/r/R0010')).toBe('/host-a/project-a/r/10')
    expect(canonicalNumberRedirect('/host-a/project-a/w/W0007')).toBe('/host-a/project-a/w/7')
    expect(canonicalNumberRedirect('/host-a/project-a/e/E0010-inference-kernels')).toBe(
      '/host-a/project-a/e/10',
    )
    expect(canonicalNumberRedirect('/host-a/project-a/e/0005/cr/2026-05-22-guard')).toBe(
      '/host-a/project-a/e/5/cr/2026-05-22-guard',
    )
    for (const path of [
      '/host-a/project-a/r/10',
      '/host-a/project-a/r/W0010',
      '/host-a/project-a/w/abc',
      '/host-a/project-a/reports',
      '/p/project-a/r/0010',
    ]) {
      expect(canonicalNumberRedirect(path), path).toBeNull()
    }
  })

  it('knows numbers, prefixes and routable hosts', () => {
    expect(artifactNumber('E0010-x')).toBe(10)
    expect(artifactNumber('R0007')).toBe(7)
    expect(artifactNumber('code-review/x')).toBeNull()
    expect(artifactIdPrefix('E', 10)).toBe('E0010')
    expect(isRoutableHost('host-a')).toBe(true)
    for (const reserved of ['api', 'h', 'login', 'manage', 'p', 's', 'share'])
      expect(isRoutableHost(reserved)).toBe(false)
    expect(projectOfPath('/host-a/project-a/anything/here')).toEqual(target)
    expect(projectOfPath('/login')).toBeNull()
  })

  it('reserves the same Host ids as the config loader', () => {
    expect([...RESERVED_HOST_IDS]).toEqual([...CORE_RESERVED_HOST_IDS])
  })
})
