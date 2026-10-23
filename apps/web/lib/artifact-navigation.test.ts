// @vitest-environment node

import { type ProjectRef, ProjectRefSchema } from '@memon/core'
import { describe, expect, it } from 'vitest'
import {
  artifactHref,
  canonicalCodeReviewHref,
  canonicalExperimentHref,
  canonicalReportHref,
  canonicalWikiHref,
} from './artifact-navigation'

const project = ProjectRefSchema.parse({ host: 'host-a', project: 'project-a' })

describe('artifact navigation', () => {
  it('encodes project names as path segments and drops slugs and zero padding', () => {
    const spaced = { host: 'host-a', project: 'project a' } as unknown as ProjectRef
    expect(canonicalExperimentHref(spaced, 'E0017-kernel run')).toBe('/host-a/project%20a/e/17')
    expect(canonicalReportHref(spaced, 'R0007')).toBe('/host-a/project%20a/r/7')
    expect(canonicalWikiHref(project, 'W0004')).toBe('/host-a/project-a/w/4')
  })

  it('opens every target kind on its own full page', () => {
    expect(artifactHref(project, { kind: 'experiment', id: 'E0018-next' })).toBe(
      '/host-a/project-a/e/18',
    )
    expect(artifactHref(project, { kind: 'report', id: 'R0003' })).toBe('/host-a/project-a/r/3')
    expect(artifactHref(project, { kind: 'wiki', id: 'W0021' })).toBe('/host-a/project-a/w/21')
  })

  it('opens code reviews on their canonical page and falls back to the review list', () => {
    expect(canonicalCodeReviewHref(project, 'code-review/2026-05-24-x')).toBe(
      '/host-a/project-a/cr/2026-05-24-x',
    )
    expect(
      canonicalCodeReviewHref(project, 'experiments/E0005-bf16/code-review/2026-05-22-guard'),
    ).toBe('/host-a/project-a/e/5/cr/2026-05-22-guard')
    expect(canonicalCodeReviewHref(project, 'not-a-review')).toBe('/host-a/project-a/code-review')
  })

  it('rejects malformed IDs', () => {
    expect(() => canonicalReportHref(project, 'R12')).toThrow(TypeError)
    expect(() => canonicalWikiHref(project, 'R0007')).toThrow(TypeError)
    expect(() => canonicalExperimentHref(project, 'E0001/../x')).toThrow(TypeError)
  })

  it('has no page route for a hostless Project', () => {
    expect(() => canonicalReportHref('project-a', 'R0007')).toThrow(
      'Project project-a has no Host, so it has no page route',
    )
  })
})
