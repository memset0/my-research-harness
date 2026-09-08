// @vitest-environment node

import { ProjectRefSchema } from '@memon/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bindExperimentRun,
  createExperimentDoc,
  deleteExperimentDoc,
  fetchCodeReviewsInventory,
  fetchDigestsInventory,
  fetchExperimentsInventory,
  fetchCodePreview,
  fetchExpDocReadme,
  fetchGitDiff,
  fetchGitStatus,
  fetchGitStatusFiles,
  fetchJournal,
  fetchLog,
  fetchLogFiles,
  fetchReport,
  fetchWiki,
  fetchWikiPage,
  fetchWikiReview,
  fetchReports,
  fetchReportsInventory,
  fetchRunsInventory,
  fetchRunReadme,
  logStreamUrl,
  projectHost,
  projectName,
  projectQueryKey,
  projectSearchParams,
  projectWebPath,
  setCommitMark,
  markWikiReview,
  putWikiPage,
  fetchWikiInventory,
  unmarkWikiReview,
} from './api'

const target = ProjectRefSchema.parse({ host: 'host-a', project: 'project-x' })
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>(async () => Response.json({}))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function lastCall(): [input: string | URL | Request, init?: RequestInit] {
  const call = fetchMock.mock.calls.at(-1)
  if (!call) throw new Error('fetch was not called')
  return call
}

describe('ProjectTarget helpers', () => {
  it('preserves standalone identity and produces Host-qualified central identity', () => {
    expect(projectName('project-x')).toBe('project-x')
    expect(projectHost('project-x')).toBeNull()
    expect(projectSearchParams('project-x').toString()).toBe('project=project-x')
    expect(projectQueryKey('project-x')).toEqual(['project-x'])
    expect(projectWebPath('project-x')).toBe('/p/project-x')

    expect(projectName(target)).toBe('project-x')
    expect(projectHost(target)).toBe('host-a')
    expect(projectSearchParams(target).toString()).toBe('host=host-a&project=project-x')
    expect(projectQueryKey(target)).toEqual(['host-a', 'project-x'])
    expect(projectWebPath(target, '/reports/R0001')).toBe('/h/host-a/p/project-x/reports/R0001')
    expect(() => projectWebPath(target, 'reports')).toThrow('start with /')
  })
})

describe('standalone ProjectTarget URL compatibility', () => {
  it('keeps query-scoped and path-scoped GET URLs unchanged', async () => {
    await fetchJournal('project-x', { limit: 5, before: '2026-08-26T12:00:00Z' })
    expect(String(lastCall()[0])).toBe(
      '/api/journal?project=project-x&limit=5&before=2026-08-26T12%3A00%3A00Z',
    )

    await fetchReport('project-x', 'R0001')
    expect(String(lastCall()[0])).toBe('/api/reports/R0001?project=project-x')

    await fetchWiki('project-x')
    expect(String(lastCall()[0])).toBe('/api/wiki?project=project-x')

    await fetchWikiPage('project-x', 'W0001')
    expect(String(lastCall()[0])).toBe('/api/wiki/W0001?project=project-x')

    await fetchWikiReview('project-x')
    expect(String(lastCall()[0])).toBe('/api/wiki/review?project=project-x')

    await fetchGitStatus('project-x')
    expect(String(lastCall()[0])).toBe('/api/projects/project-x/git-status')

    await fetchGitStatusFiles('project-x', 'sub module')
    expect(String(lastCall()[0])).toBe(
      '/api/projects/project-x/git-status/files?submodule=sub+module',
    )

    await fetchCodePreview('project-x', 'https://example.test/a b~')
    expect(String(lastCall()[0])).toBe(
      '/api/code-preview?project=project-x&url=https%3A%2F%2Fexample.test%2Fa%20b~',
    )

    await fetchLogFiles('project-x', 'runs/run-a/README.md', '/srv/project-x/runs/run-a')
    expect(String(lastCall()[0])).toBe('/api/log-files?expPath=%2Fsrv%2Fproject-x%2Fruns%2Frun-a')
    await fetchLog('project-x', 'runs/run-a/train.log', '/srv/project-x/runs/run-a/train.log', {
      count: 10,
    })
    expect(String(lastCall()[0])).toBe(
      '/api/log?path=%2Fsrv%2Fproject-x%2Fruns%2Frun-a%2Ftrain.log&count=10',
    )

    await setCommitMark('project-x', 'abcdef', { status: 'verified' }, 'sub module')
    expect(String(lastCall()[0])).toBe(
      '/api/projects/project-x/commit-marks/abcdef?submodule=sub%20module',
    )
  })
})

describe('central ProjectTarget URL qualification', () => {
  it('requests portable inventories without dropping Host qualification', async () => {
    await fetchExperimentsInventory(target)
    expect(String(lastCall()[0])).toBe('/api/experiments?host=host-a&project=project-x&inventory=1')

    await fetchRunsInventory(target)
    expect(String(lastCall()[0])).toBe('/api/runs?host=host-a&project=project-x&inventory=1')

    await fetchReportsInventory(target)
    expect(String(lastCall()[0])).toBe('/api/reports?host=host-a&project=project-x&inventory=1')

    await fetchDigestsInventory(target)
    expect(String(lastCall()[0])).toBe('/api/digests?host=host-a&project=project-x&inventory=1')

    await fetchCodeReviewsInventory(target)
    expect(String(lastCall()[0])).toBe(
      '/api/code-reviews?host=host-a&project=project-x&inventory=1',
    )

    await fetchWikiInventory(target)
    expect(String(lastCall()[0])).toBe('/api/wiki?host=host-a&project=project-x&inventory=1')
  })

  it('adds Host and Project to query-scoped reads', async () => {
    await fetchReports(target)
    expect(String(lastCall()[0])).toBe('/api/reports?host=host-a&project=project-x')

    await fetchReport(target, 'R0001')
    expect(String(lastCall()[0])).toBe('/api/reports/R0001?host=host-a&project=project-x')

    await fetchWiki(target)
    expect(String(lastCall()[0])).toBe('/api/wiki?host=host-a&project=project-x')

    await fetchWikiPage(target, 'W0001')
    expect(String(lastCall()[0])).toBe('/api/wiki/W0001?host=host-a&project=project-x')

    await fetchWikiReview(target)
    expect(String(lastCall()[0])).toBe('/api/wiki/review?host=host-a&project=project-x')

    await fetchRunReadme(target, 'run-a')
    expect(String(lastCall()[0])).toBe('/api/runs/run-a/readme?host=host-a&project=project-x')

    await fetchExpDocReadme(target, 'E0001-exp')
    expect(String(lastCall()[0])).toBe(
      '/api/experiments/E0001-exp/readme?host=host-a&project=project-x',
    )

    await fetchLogFiles(target, 'runs/run-a/README.md')
    expect(String(lastCall()[0])).toBe(
      '/api/log-files?host=host-a&project=project-x&resource=runs%2Frun-a%2FREADME.md',
    )
    await fetchLog(target, 'runs/run-a/train.log', undefined, { count: 100 })
    expect(String(lastCall()[0])).toBe(
      '/api/log?host=host-a&project=project-x&resource=runs%2Frun-a%2Ftrain.log&count=100',
    )
    expect(logStreamUrl(target, 'runs/run-a/train.log')).toBe(
      '/api/log/stream?host=host-a&project=project-x&resource=runs%2Frun-a%2Ftrain.log',
    )
  })

  it('adds Host and Project to project-path reads and mutations', async () => {
    await fetchGitStatus(target)
    expect(String(lastCall()[0])).toBe(
      '/api/projects/project-x/git-status?host=host-a&project=project-x',
    )

    await fetchGitDiff(target, 'src/file.ts', 'unstaged', { submodule: 'library' })
    expect(String(lastCall()[0])).toBe(
      '/api/projects/project-x/git-diff?host=host-a&project=project-x&path=src%2Ffile.ts&side=unstaged&submodule=library',
    )

    await setCommitMark(target, 'abcdef', { status: 'verified' }, 'library')
    expect(String(lastCall()[0])).toBe(
      '/api/projects/project-x/commit-marks/abcdef?host=host-a&project=project-x&submodule=library',
    )

    await putWikiPage(target, 'W0001', {
      content: '# Finding',
      expectedMtime: 1,
      expectedHash: 'a'.repeat(40),
    })
    expect(String(lastCall()[0])).toBe('/api/wiki/W0001?host=host-a&project=project-x')

    await markWikiReview(target, 'next')
    expect(String(lastCall()[0])).toBe('/api/wiki/review/next?host=host-a&project=project-x')
    expect(lastCall()[1]?.method).toBe('POST')

    await unmarkWikiReview(target, 'abcdef')
    expect(String(lastCall()[0])).toBe('/api/wiki/review/abcdef?host=host-a&project=project-x')
    expect(lastCall()[1]?.method).toBe('DELETE')
  })

  it('keeps local Project names in qualified mutation payloads', async () => {
    await createExperimentDoc(target, { slug: 'created' })
    expect(String(lastCall()[0])).toBe('/api/experiments?host=host-a&project=project-x')
    expect(JSON.parse(String(lastCall()[1]?.body))).toEqual({
      project: 'project-x',
      slug: 'created',
    })

    const lock = {
      run: 'run-a',
      expectedMtime: 1,
      expectedHash: 'a'.repeat(40),
      expectedRunMtime: 2,
      expectedRunHash: 'b'.repeat(40),
    }
    await bindExperimentRun('link', target, 'E0001-created', lock)
    expect(String(lastCall()[0])).toBe(
      '/api/experiments/E0001-created/link?host=host-a&project=project-x',
    )

    await deleteExperimentDoc(target, 'E0001-created', {
      force: false,
      expectedMtime: 3,
      expectedHash: 'c'.repeat(40),
      runLocks: [],
    })
    expect(String(lastCall()[0])).toBe(
      '/api/experiments/E0001-created?host=host-a&project=project-x&force=false',
    )
  })
})
