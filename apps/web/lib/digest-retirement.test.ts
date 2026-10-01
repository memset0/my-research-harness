// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveArtifactMarkdownHref, resolveBareArtifactReference } from './artifact-links'
import { API_ROUTE_MANIFEST } from './server/api-route-manifest'
import { wikiKinds } from './wiki-kinds'

describe('Digest retirement', () => {
  it('resolves old Digest file links through Wiki provenance', () => {
    expect(
      resolveArtifactMarkdownHref(
        '../digests/D0001-2026-05-04.md#summary',
        'docs/reports/R0001-notes.md',
        {
          project: 'project-a',
          experiments: [],
          reports: [],
          wiki: [{ id: 'W0008', path: 'docs/wiki/digest/W0008-period.md', legacyId: 'D0001' }],
        },
      ),
    ).toMatchObject({ kind: 'wiki', id: 'W0008', fragment: '#summary' })
  })
  it('retains D provenance as Wiki identity without a standalone surface', () => {
    expect(
      resolveBareArtifactReference('D0001', {
        project: 'project-a',
        experiments: [],
        reports: [],
        wiki: [{ id: 'W0008', path: 'docs/wiki/digest/W0008-period.md', legacyId: 'D0001' }],
      }),
    ).toEqual({ kind: 'wiki', id: 'W0008' })
    expect(wikiKinds.find((kind) => kind.id === 'digest')?.label).toBe('阶段摘要')
    expect(Object.keys(API_ROUTE_MANIFEST).some((path) => path.startsWith('digests/'))).toBe(false)
    for (const path of [
      'api/digests/route.ts',
      'p/[project]/digests/page.tsx',
      'h/[host]/p/[project]/digests/page.tsx',
    ]) {
      expect(existsSync(resolve('app', path))).toBe(false)
    }
    expect(readFileSync(resolve('components/app-bar.tsx'), 'utf8')).not.toContain("kind: 'digests'")
  })
})
