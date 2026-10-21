// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { documentTargetFor, grantCovers } from './document-scope'
import type { ShareDocumentGrant } from './identity'

const target = (path: string) => {
  const url = new URL(path, 'https://memon.example.test')
  return documentTargetFor('GET', url.pathname, url.searchParams)
}
const wiki: ShareDocumentGrant = { host: 'host-a', project: 'project-x', kind: 'wiki', id: 'W0004' }
const report: ShareDocumentGrant = { ...wiki, kind: 'report', id: 'R0005' }
const experiment: ShareDocumentGrant = { ...wiki, kind: 'experiment', id: 'E0001-pipeline' }
const covers = (grant: ShareDocumentGrant, path: string) => {
  const resolved = target(path)
  return resolved !== null && grantCovers(grant, resolved)
}

describe('document-scoped targets', () => {
  it('admits the shared Wiki page, its detail, backlinks and bundle assets only', () => {
    for (const path of [
      '/h/host-a/p/project-x/wiki/W0004',
      '/api/wiki/W0004?host=host-a&project=project-x',
      '/api/wiki/backlinks/W0004?host=host-a&project=project-x',
      '/api/wiki-assets/project-x/W0004/figure.png?host=host-a',
      '/api/doc-assets/project-x/docs/wiki/note/W0004-roadmap/plot.png?host=host-a',
    ])
      expect(covers(wiki, path)).toBe(true)
    for (const path of [
      '/h/host-a/p/project-x/wiki/W0001',
      '/h/host-a/p/project-x/wiki',
      '/h/host-a/p/project-x',
      '/api/wiki?host=host-a&project=project-x',
      '/api/wiki/W0001?host=host-a&project=project-x',
      '/api/wiki/kinds',
      '/api/doc-assets/project-x/docs/wiki/note/W0040-other/plot.png',
      '/api/reports/R0005?host=host-a&project=project-x',
    ])
      expect(covers(wiki, path)).toBe(false)
  })

  it('admits a shared Report and its assets', () => {
    expect(covers(report, '/h/host-a/p/project-x/reports/R0005')).toBe(true)
    expect(covers(report, '/api/report-assets/project-x/R0005/index.html?host=host-a')).toBe(true)
    expect(covers(report, '/api/doc-assets/project-x/docs/reports/methods/R0005-tools/a.png')).toBe(
      true,
    )
    expect(covers(report, '/api/reports?host=host-a&project=project-x')).toBe(false)
    expect(covers(report, '/api/report-assets/project-x/R0004/index.html')).toBe(false)
  })

  it('admits an Experiment, its documents and its own run directory', () => {
    for (const path of [
      '/h/host-a/p/project-x/e/E0001-pipeline',
      '/api/experiments/E0001-pipeline?host=host-a&project=project-x',
      '/api/experiments/E0001-pipeline/results?host=host-a&project=project-x',
      '/api/experiments/E0001-pipeline/readme?host=host-a&project=project-x',
      '/api/wiki/backlinks/E0001-pipeline?host=host-a&project=project-x',
      '/api/readme?host=host-a&project=project-x&resource=docs/experiments/E0001-pipeline/README.md',
      '/api/log?host=host-a&project=project-x&resource=logs/E0001/V0001/run-1/train.log',
      '/api/log-files?host=host-a&project=project-x&resource=logs/E0001/V0001/run-1',
      '/api/doc-assets/project-x/docs/experiments/E0001-pipeline/plot.png',
    ])
      expect(covers(experiment, path)).toBe(true)
    for (const path of [
      '/api/experiments?host=host-a&project=project-x',
      '/api/experiments/E0002-other?host=host-a&project=project-x',
      '/api/experiments/E0001-pipeline/status?host=host-a&project=project-x',
      '/api/log?resource=logs/E0002/V0001/run-1/train.log',
      '/api/log?resource=logs/E0001/../E0002/V0001/run-1/train.log',
      '/api/log?resource=/etc/passwd',
      '/api/log?resource=logs/E0001/a&resource=logs/E0001/b',
      '/api/runs?host=host-a&project=project-x',
      '/api/code-reviews?host=host-a&project=project-x',
    ])
      expect(covers(experiment, path)).toBe(false)
  })

  it('leaves Run IDs for resolution', () => {
    expect(target('/api/runs/run-1?host=host-a&project=project-x')).toEqual({
      kind: 'run',
      id: 'run-1',
    })
    expect(target('/api/runs/run-1/files?host=host-a&project=project-x')).toEqual({
      kind: 'run',
      id: 'run-1',
    })
    expect(target('/api/runs/run-1/status')).toBeNull()
    expect(documentTargetFor('POST', '/api/wiki/W0004', new URLSearchParams())).toBeNull()
  })
})
