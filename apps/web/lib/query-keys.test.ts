// @vitest-environment node

import { ProjectRefSchema } from '@memon/core'
import { describe, expect, it } from 'vitest'
import type { ProjectTarget } from './project-target'
import { queryKeys } from './query-keys'

// Shape locks for every query key constructor (web-lib-layering D2). These
// values are the runtime contract between prefetches, reads and
// invalidations; update a snapshot only for a deliberate, reviewed key change.

const STANDALONE: ProjectTarget = 'project-a'
const HOSTED: ProjectTarget = ProjectRefSchema.parse({ host: 'host-a', project: 'project-a' })

describe('queryKeys', () => {
  it('has a shape lock for every constructor', () => {
    expect(Object.keys(queryKeys).sort()).toMatchInlineSnapshot(`
      [
        "allRuns",
        "codePreview",
        "codeReview",
        "codeReviews",
        "codeReviewsInventory",
        "commitMarks",
        "docAsset",
        "experiment",
        "experiments",
        "experimentsInventory",
        "fileAccess",
        "gitBranches",
        "gitCommit",
        "gitCommitAtRoot",
        "gitDiff",
        "gitLog",
        "gitRange",
        "gitStatus",
        "gitStatusFiles",
        "hosts",
        "hypotheses",
        "journal",
        "journalCount",
        "journalHistory",
        "logFiles",
        "projectShares",
        "projects",
        "report",
        "reports",
        "reportsInventory",
        "run",
        "runFiles",
        "runs",
        "slurmStatus",
        "submodules",
        "tabCollection",
        "wiki",
        "wikiBacklinks",
        "wikiInventory",
        "wikiPage",
        "wikiReview",
      ]
    `)
  })

  it('projects', () => {
    expect(queryKeys.projects()).toMatchInlineSnapshot(`
      [
        "projects",
      ]
    `)
  })

  it('hosts', () => {
    expect(queryKeys.hosts()).toMatchInlineSnapshot(`
      [
        "hosts",
      ]
    `)
  })

  it('slurmStatus', () => {
    expect(queryKeys.slurmStatus()).toMatchInlineSnapshot(`
      [
        "slurm-status",
      ]
    `)
  })

  it('fileAccess', () => {
    expect(queryKeys.fileAccess(86_400_000)).toMatchInlineSnapshot(`
      [
        "file-access",
        86400000,
      ]
    `)
  })

  it('allRuns', () => {
    expect(queryKeys.allRuns()).toMatchInlineSnapshot(`
      [
        "runs",
      ]
    `)
  })

  it('runs', () => {
    expect(queryKeys.runs(STANDALONE)).toMatchInlineSnapshot(`
      [
        "runs",
        "project-a",
      ]
    `)
    expect(queryKeys.runs(HOSTED)).toMatchInlineSnapshot(`
      [
        "runs",
        "host-a",
        "project-a",
      ]
    `)
  })

  it('run', () => {
    expect(queryKeys.run(STANDALONE, 'run-a')).toMatchInlineSnapshot(`
      [
        "run",
        "project-a",
        "run-a",
      ]
    `)
    expect(queryKeys.run(HOSTED, 'run-a')).toMatchInlineSnapshot(`
      [
        "run",
        "host-a",
        "project-a",
        "run-a",
      ]
    `)
  })

  it('runFiles', () => {
    expect(queryKeys.runFiles(STANDALONE, 'run-a')).toMatchInlineSnapshot(`
      [
        "run-files",
        "project-a",
        "run-a",
      ]
    `)
    expect(queryKeys.runFiles(HOSTED, 'run-a')).toMatchInlineSnapshot(`
      [
        "run-files",
        "host-a",
        "project-a",
        "run-a",
      ]
    `)
  })

  it('experiments', () => {
    expect(queryKeys.experiments(STANDALONE)).toMatchInlineSnapshot(`
      [
        "experiments",
        "project-a",
      ]
    `)
    expect(queryKeys.experiments(HOSTED)).toMatchInlineSnapshot(`
      [
        "experiments",
        "host-a",
        "project-a",
      ]
    `)
  })

  it('experiment', () => {
    expect(queryKeys.experiment(STANDALONE, 'E0001-alpha')).toMatchInlineSnapshot(`
      [
        "experiment",
        "project-a",
        "E0001-alpha",
      ]
    `)
    expect(queryKeys.experiment(HOSTED, 'E0001-alpha')).toMatchInlineSnapshot(`
      [
        "experiment",
        "host-a",
        "project-a",
        "E0001-alpha",
      ]
    `)
  })

  it('experimentsInventory', () => {
    expect(queryKeys.experimentsInventory(STANDALONE)).toMatchInlineSnapshot(`
      [
        "experiments-inventory",
        "project-a",
      ]
    `)
    expect(queryKeys.experimentsInventory(HOSTED)).toMatchInlineSnapshot(`
      [
        "experiments-inventory",
        "host-a",
        "project-a",
      ]
    `)
  })

  it('hypotheses', () => {
    expect(queryKeys.hypotheses(STANDALONE)).toMatchInlineSnapshot(`
      [
        "hypotheses",
        "project-a",
      ]
    `)
    expect(queryKeys.hypotheses(HOSTED)).toMatchInlineSnapshot(`
      [
        "hypotheses",
        "host-a",
        "project-a",
      ]
    `)
  })

  it('journal', () => {
    expect(queryKeys.journal(STANDALONE)).toMatchInlineSnapshot(`
      [
        "journal",
        "project-a",
      ]
    `)
    expect(queryKeys.journal(HOSTED)).toMatchInlineSnapshot(`
      [
        "journal",
        "host-a",
        "project-a",
      ]
    `)
  })

  it('journalHistory', () => {
    expect(queryKeys.journalHistory(STANDALONE)).toMatchInlineSnapshot(`
      [
        "journal-history",
        "project-a",
      ]
    `)
    expect(queryKeys.journalHistory(HOSTED)).toMatchInlineSnapshot(`
      [
        "journal-history",
        "host-a",
        "project-a",
      ]
    `)
  })

  it('journalCount', () => {
    expect(queryKeys.journalCount(STANDALONE)).toMatchInlineSnapshot(`
      [
        "journal-count",
        "project-a",
      ]
    `)
    expect(queryKeys.journalCount(HOSTED)).toMatchInlineSnapshot(`
      [
        "journal-count",
        "host-a",
        "project-a",
      ]
    `)
  })

  it('reports', () => {
    expect(queryKeys.reports(STANDALONE)).toMatchInlineSnapshot(`
      [
        "reports",
        "project-a",
      ]
    `)
    expect(queryKeys.reports(HOSTED)).toMatchInlineSnapshot(`
      [
        "reports",
        "host-a",
        "project-a",
      ]
    `)
  })

  it('report', () => {
    expect(queryKeys.report(STANDALONE, 'report-a')).toMatchInlineSnapshot(`
      [
        "report",
        "project-a",
        "report-a",
      ]
    `)
    expect(queryKeys.report(HOSTED, 'report-a')).toMatchInlineSnapshot(`
      [
        "report",
        "host-a",
        "project-a",
        "report-a",
      ]
    `)
  })

  it('reportsInventory', () => {
    expect(queryKeys.reportsInventory(STANDALONE)).toMatchInlineSnapshot(`
      [
        "reports-inventory",
        "project-a",
      ]
    `)
    expect(queryKeys.reportsInventory(HOSTED)).toMatchInlineSnapshot(`
      [
        "reports-inventory",
        "host-a",
        "project-a",
      ]
    `)
  })

  it('codeReviews', () => {
    expect(queryKeys.codeReviews(STANDALONE)).toMatchInlineSnapshot(`
      [
        "code-reviews",
        "project-a",
      ]
    `)
    expect(queryKeys.codeReviews(HOSTED)).toMatchInlineSnapshot(`
      [
        "code-reviews",
        "host-a",
        "project-a",
      ]
    `)
  })

  it('codeReview', () => {
    expect(queryKeys.codeReview(STANDALONE, 'review-a')).toMatchInlineSnapshot(`
      [
        "code-review",
        "project-a",
        "review-a",
      ]
    `)
    expect(queryKeys.codeReview(HOSTED, 'review-a')).toMatchInlineSnapshot(`
      [
        "code-review",
        "host-a",
        "project-a",
        "review-a",
      ]
    `)
  })

  it('codeReviewsInventory', () => {
    expect(queryKeys.codeReviewsInventory(STANDALONE)).toMatchInlineSnapshot(`
      [
        "code-reviews-inventory",
        "project-a",
      ]
    `)
    expect(queryKeys.codeReviewsInventory(HOSTED)).toMatchInlineSnapshot(`
      [
        "code-reviews-inventory",
        "host-a",
        "project-a",
      ]
    `)
  })

  it('codePreview', () => {
    expect(
      queryKeys.codePreview(STANDALONE, 'https://example.com/blob/main/a.ts#L1'),
    ).toMatchInlineSnapshot(`
      [
        "code-preview",
        "project-a",
        "https://example.com/blob/main/a.ts#L1",
      ]
    `)
    expect(
      queryKeys.codePreview(HOSTED, 'https://example.com/blob/main/a.ts#L1'),
    ).toMatchInlineSnapshot(`
      [
        "code-preview",
        "host-a",
        "project-a",
        "https://example.com/blob/main/a.ts#L1",
      ]
    `)
  })

  it('wiki', () => {
    expect(queryKeys.wiki(STANDALONE)).toMatchInlineSnapshot(`
      [
        "wiki",
        "project-a",
      ]
    `)
    expect(queryKeys.wiki(HOSTED)).toMatchInlineSnapshot(`
      [
        "wiki",
        "host-a",
        "project-a",
      ]
    `)
  })

  it('wikiPage', () => {
    expect(queryKeys.wikiPage(STANDALONE, 'W0001')).toMatchInlineSnapshot(`
      [
        "wiki-page",
        "project-a",
        "W0001",
      ]
    `)
    expect(queryKeys.wikiPage(HOSTED, 'W0001')).toMatchInlineSnapshot(`
      [
        "wiki-page",
        "host-a",
        "project-a",
        "W0001",
      ]
    `)
  })

  it('wikiInventory', () => {
    expect(queryKeys.wikiInventory(STANDALONE)).toMatchInlineSnapshot(`
      [
        "wiki-inventory",
        "project-a",
      ]
    `)
    expect(queryKeys.wikiInventory(HOSTED)).toMatchInlineSnapshot(`
      [
        "wiki-inventory",
        "host-a",
        "project-a",
      ]
    `)
  })

  it('wikiReview', () => {
    expect(queryKeys.wikiReview(STANDALONE)).toMatchInlineSnapshot(`
      [
        "wiki-review",
        "project-a",
      ]
    `)
    expect(queryKeys.wikiReview(HOSTED)).toMatchInlineSnapshot(`
      [
        "wiki-review",
        "host-a",
        "project-a",
      ]
    `)
  })

  it('wikiBacklinks', () => {
    expect(queryKeys.wikiBacklinks(STANDALONE, 'E0001-alpha')).toMatchInlineSnapshot(`
      [
        "wiki-backlinks",
        "project-a",
        "E0001-alpha",
      ]
    `)
    expect(queryKeys.wikiBacklinks(HOSTED, 'E0001-alpha')).toMatchInlineSnapshot(`
      [
        "wiki-backlinks",
        "host-a",
        "project-a",
        "E0001-alpha",
      ]
    `)
  })

  it('gitStatus', () => {
    expect(queryKeys.gitStatus(STANDALONE)).toMatchInlineSnapshot(`
      [
        "git-status",
        "project-a",
      ]
    `)
    expect(queryKeys.gitStatus(HOSTED)).toMatchInlineSnapshot(`
      [
        "git-status",
        "host-a",
        "project-a",
      ]
    `)
  })

  it('gitStatusFiles', () => {
    expect(queryKeys.gitStatusFiles(STANDALONE)).toMatchInlineSnapshot(`
      [
        "git-status-files",
        "project-a",
      ]
    `)
    expect(queryKeys.gitStatusFiles(HOSTED)).toMatchInlineSnapshot(`
      [
        "git-status-files",
        "host-a",
        "project-a",
      ]
    `)
  })

  it('gitDiff', () => {
    expect(
      queryKeys.gitDiff(
        STANDALONE,
        'src/a.ts',
        'commit',
        'abc123',
        undefined,
        undefined,
        undefined,
      ),
    ).toMatchInlineSnapshot(`
      [
        "git-diff",
        "project-a",
        "src/a.ts",
        "commit",
        "abc123",
        undefined,
        undefined,
        undefined,
      ]
    `)
    expect(
      queryKeys.gitDiff(HOSTED, 'src/a.ts', 'commit', 'abc123', undefined, undefined, undefined),
    ).toMatchInlineSnapshot(`
      [
        "git-diff",
        "host-a",
        "project-a",
        "src/a.ts",
        "commit",
        "abc123",
        undefined,
        undefined,
        undefined,
      ]
    `)
  })

  it('gitRange', () => {
    expect(queryKeys.gitRange(STANDALONE, 'vendor/lib', 'aaa', 'bbb')).toMatchInlineSnapshot(`
      [
        "git-range",
        "project-a",
        "vendor/lib",
        "aaa",
        "bbb",
      ]
    `)
    expect(queryKeys.gitRange(HOSTED, 'vendor/lib', 'aaa', 'bbb')).toMatchInlineSnapshot(`
      [
        "git-range",
        "host-a",
        "project-a",
        "vendor/lib",
        "aaa",
        "bbb",
      ]
    `)
  })

  it('submodules', () => {
    expect(queryKeys.submodules(STANDALONE)).toMatchInlineSnapshot(`
      [
        "submodules",
        "project-a",
      ]
    `)
    expect(queryKeys.submodules(HOSTED)).toMatchInlineSnapshot(`
      [
        "submodules",
        "host-a",
        "project-a",
      ]
    `)
  })

  it('gitBranches', () => {
    expect(queryKeys.gitBranches(STANDALONE, '')).toMatchInlineSnapshot(`
      [
        "git-branches",
        "project-a",
        "",
      ]
    `)
    expect(queryKeys.gitBranches(HOSTED, '')).toMatchInlineSnapshot(`
      [
        "git-branches",
        "host-a",
        "project-a",
        "",
      ]
    `)
  })

  it('gitLog', () => {
    expect(queryKeys.gitLog(STANDALONE, '', 'main')).toMatchInlineSnapshot(`
      [
        "git-log",
        "project-a",
        "",
        "main",
      ]
    `)
    expect(queryKeys.gitLog(HOSTED, '', 'main')).toMatchInlineSnapshot(`
      [
        "git-log",
        "host-a",
        "project-a",
        "",
        "main",
      ]
    `)
  })

  it('gitCommit', () => {
    expect(queryKeys.gitCommit(STANDALONE, '', 'abc123')).toMatchInlineSnapshot(`
      [
        "git-commit",
        "project-a",
        "",
        "abc123",
      ]
    `)
    expect(queryKeys.gitCommit(HOSTED, '', 'abc123')).toMatchInlineSnapshot(`
      [
        "git-commit",
        "host-a",
        "project-a",
        "",
        "abc123",
      ]
    `)
  })

  it('gitCommitAtRoot', () => {
    expect(queryKeys.gitCommitAtRoot(STANDALONE, 'abc123')).toMatchInlineSnapshot(`
      [
        "git-commit",
        "project-a",
        "abc123",
      ]
    `)
    expect(queryKeys.gitCommitAtRoot(HOSTED, 'abc123')).toMatchInlineSnapshot(`
      [
        "git-commit",
        "host-a",
        "project-a",
        "abc123",
      ]
    `)
  })

  it('commitMarks', () => {
    expect(queryKeys.commitMarks(STANDALONE)).toMatchInlineSnapshot(`
      [
        "commit-marks",
        "project-a",
      ]
    `)
    expect(queryKeys.commitMarks(HOSTED)).toMatchInlineSnapshot(`
      [
        "commit-marks",
        "host-a",
        "project-a",
      ]
    `)
  })

  it('logFiles', () => {
    expect(queryKeys.logFiles(STANDALONE, 'run-a')).toMatchInlineSnapshot(`
      [
        "log-files",
        "project-a",
        "run-a",
      ]
    `)
    expect(queryKeys.logFiles(HOSTED, 'run-a')).toMatchInlineSnapshot(`
      [
        "log-files",
        "host-a",
        "project-a",
        "run-a",
      ]
    `)
  })

  it('projectShares', () => {
    expect(queryKeys.projectShares(STANDALONE)).toMatchInlineSnapshot(`
      [
        "project-shares",
        "project-a",
      ]
    `)
    expect(queryKeys.projectShares(HOSTED)).toMatchInlineSnapshot(`
      [
        "project-shares",
        "host-a",
        "project-a",
      ]
    `)
  })

  it('docAsset', () => {
    expect(
      queryKeys.docAsset('project-a', null, 'docs/wiki/note/W0001__assets/chart.json'),
    ).toMatchInlineSnapshot(`
      [
        "doc-asset",
        "project-a",
        null,
        "docs/wiki/note/W0001__assets/chart.json",
      ]
    `)
  })

  it('tabCollection', () => {
    expect(queryKeys.tabCollection('wiki', STANDALONE)).toMatchInlineSnapshot(`
      [
        "wiki-inventory",
        "project-a",
      ]
    `)
    expect(queryKeys.tabCollection('wiki', HOSTED)).toMatchInlineSnapshot(`
      [
        "wiki-inventory",
        "host-a",
        "project-a",
      ]
    `)
  })

  it('omits the Project segment when no Project is in scope', () => {
    expect(queryKeys.run(undefined, 'run-a')).toMatchInlineSnapshot(`
      [
        "run",
        "run-a",
      ]
    `)
    expect(queryKeys.experiments(undefined)).toMatchInlineSnapshot(`
      [
        "experiments",
      ]
    `)
  })

  it('appends the submodule to git-status-files only when given', () => {
    expect(queryKeys.gitStatusFiles(STANDALONE, 'vendor/lib')).toMatchInlineSnapshot(`
      [
        "git-status-files",
        "project-a",
        "vendor/lib",
      ]
    `)
  })

  it('maps every tab to its collection key', () => {
    expect(
      (['experiments', 'hypotheses', 'journal', 'reports', 'code-review'] as const).map((kind) =>
        queryKeys.tabCollection(kind, STANDALONE),
      ),
    ).toMatchInlineSnapshot(`
      [
        [
          "experiments-inventory",
          "project-a",
        ],
        [
          "hypotheses",
          "project-a",
        ],
        [
          "journal-count",
          "project-a",
        ],
        [
          "reports-inventory",
          "project-a",
        ],
        [
          "code-reviews-inventory",
          "project-a",
        ],
      ]
    `)
  })
})
