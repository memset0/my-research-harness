// @vitest-environment node

import { ProjectRefSchema } from '@memon/core'
import { describe, expect, it } from 'vitest'
import {
  artifactHref,
  canonicalExperimentHref,
  canonicalReportHref,
  canonicalWikiHref,
} from './artifact-navigation'

describe('artifact navigation', () => {
  it('encodes project names and canonical IDs as path segments', () => {
    expect(canonicalExperimentHref('project a', 'E0017-kernel run')).toBe(
      '/p/project%20a/e/E0017-kernel%20run',
    )
    expect(canonicalReportHref('project a', 'R0007')).toBe('/p/project%20a/reports/R0007')
    const central = ProjectRefSchema.parse({ host: 'host-a', project: 'project-a' })
    expect(canonicalWikiHref(central, 'W0004')).toBe('/h/host-a/p/project-a/wiki/W0004')
  })

  it('opens every target kind on its own full page', () => {
    const project = ProjectRefSchema.parse({ host: 'host-a', project: 'project-a' })
    expect(artifactHref(project, { kind: 'experiment', id: 'E0018-next' })).toBe(
      '/h/host-a/p/project-a/e/E0018-next',
    )
    expect(artifactHref(project, { kind: 'report', id: 'R0003' })).toBe(
      '/h/host-a/p/project-a/reports/R0003',
    )
    expect(artifactHref(project, { kind: 'wiki', id: 'W0021' })).toBe(
      '/h/host-a/p/project-a/wiki/W0021',
    )
  })

  it('rejects malformed IDs', () => {
    expect(() => canonicalReportHref('project-a', 'R12')).toThrow(TypeError)
    expect(() => canonicalWikiHref('project-a', 'R0007')).toThrow(TypeError)
    expect(() => canonicalExperimentHref('project-a', 'E0001/../x')).toThrow(TypeError)
  })
})
