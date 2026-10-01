// "Still referenceable": every name discovery accepts must stay accepted by
// each reference-side check that `ids.ts` now centralizes.

import { describe, expect, it } from 'vitest'
import { computeMembership } from './experiments/membership.js'
import { parseExperimentReadme } from './experiments/parse.js'
import { isRunPath as runPathIsRunPath } from './experiments/run-path.js'
import { parseExperimentRefList } from './hypotheses/parse.js'
import {
  EXPERIMENT_DIR_REGEX,
  EXPERIMENT_REF_REGEX,
  extractRunMentions,
  isRunDirName,
  isRunPath,
  isSlug,
  RUN_DIR_REGEX,
  runSlugFromDirName,
  SLUG_STRICT_REGEX,
} from './ids.js'
import { parseSlugFromRunDir } from './time.js'
import type { Experiment, Run } from './types.js'
import { parseWikiFrontmatter } from './wiki/frontmatter.js'
import { lintWikiPage, resolvesWikiReference } from './wiki/lint.js'
import { collectWikiSourceReferences, wikiSourceKind } from './wiki/staleness.js'

/** Run base names discovery identifies (`^.+-\d{6}-\d{6}$`, no `/`). */
const DISCOVERABLE_RUNS = [
  'foo-260501-100000',
  'x_y-z-260501-100000',
  'model.v2-260501-100000',
  '模型-260501-100000',
  'a+b-260501-100000',
  '--260501-100000',
]
/** Experiment folders discovery identifies, one-character slug included. */
const DISCOVERABLE_EXPERIMENTS = ['E0001-foo', 'E0002-a', 'E0003-a-', 'E0004-x9-y']

describe('discovery corpus sanity', () => {
  it('every corpus name is discoverable', () => {
    for (const name of DISCOVERABLE_RUNS) expect(RUN_DIR_REGEX.test(name)).toBe(true)
    for (const name of DISCOVERABLE_EXPERIMENTS) expect(EXPERIMENT_DIR_REGEX.test(name)).toBe(true)
  })
})

describe('ids.ts validators accept the discovery corpus', () => {
  it('isRunDirName / runSlugFromDirName / parseSlugFromRunDir', () => {
    for (const name of DISCOVERABLE_RUNS) {
      expect(isRunDirName(name)).toBe(true)
      expect(runSlugFromDirName(name)).toBe(name.replace(/-\d{6}-\d{6}$/, ''))
      expect(parseSlugFromRunDir(name)).toBe(runSlugFromDirName(name))
    }
    expect(isRunDirName('logs/foo-260501-100000')).toBe(false)
  })

  it('isRunPath (ids and experiments/run-path re-export)', () => {
    for (const name of DISCOVERABLE_RUNS) {
      if (name === '--260501-100000') continue
      expect(isRunPath(`logs/sub/${name}`)).toBe(true)
      expect(runPathIsRunPath(`outputs/${name}`)).toBe(true)
    }
    expect(isRunPath('logs/../foo-260501-100000')).toBe(false)
  })

  it('slug rules: default accepts every discoverable slug, strict only guards creation', () => {
    for (const id of DISCOVERABLE_EXPERIMENTS) {
      const slug = EXPERIMENT_DIR_REGEX.exec(id)![2]!
      expect(isSlug(slug)).toBe(true)
      expect(EXPERIMENT_REF_REGEX.test(id)).toBe(true)
    }
    // The previous rename / run-rename pattern accepted exactly the same set.
    const previous = /^[a-z0-9][a-z0-9-]*[a-z0-9]?$/
    for (const slug of ['a', 'a-', 'ab', 'a-b', 'a--b', '9']) {
      expect(isSlug(slug)).toBe(previous.test(slug))
    }
    expect(SLUG_STRICT_REGEX.test('a')).toBe(false)
    expect(isSlug('ab', { strict: true })).toBe(true)
  })
})

describe('hypotheses references', () => {
  it('Runs lists name every discoverable Run', () => {
    for (const name of DISCOVERABLE_RUNS) {
      expect(parseExperimentRefList(`**Runs**: ${name}`).runs).toContain(
        // A name whose suffix is itself a legacy token keeps the legacy extraction.
        /[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*-\d{6}-\d{6}/.exec(name)?.[0] ?? name,
      )
    }
    expect(parseExperimentRefList('模型-260501-100000, `数据-260502-150000`').runs).toEqual([
      '模型-260501-100000',
      '数据-260502-150000',
    ])
  })

  it('keeps previously extracted prose tokens unchanged', () => {
    expect(
      parseExperimentRefList('foo-260501-100000 (data) → bar-260502-150000 (analysis)'),
    ).toEqual({ experiments: [], runs: ['foo-260501-100000', 'bar-260502-150000'] })
  })

  it('Experiments lists name one-character slugs', () => {
    expect(parseExperimentRefList('E0002-a, E0001-foo').experiments).toEqual([
      'E0002-a',
      'E0001-foo',
    ])
  })
})

describe('extractRunMentions', () => {
  it('only adds whole tokens where the legacy token found nothing', () => {
    expect(extractRunMentions('see (模型-260501-100000). and foo-260501-100000')).toEqual([
      '模型-260501-100000',
      'foo-260501-100000',
    ])
    expect(extractRunMentions('a.b-260501-100000')).toEqual(['b-260501-100000'])
  })
})

describe('wiki references', () => {
  it('sources classify every discoverable Run as a run', () => {
    for (const name of DISCOVERABLE_RUNS) {
      expect(wikiSourceKind(name)).toBe('run')
      expect(collectWikiSourceReferences([name]).runs).toEqual([name])
    }
    for (const id of DISCOVERABLE_EXPERIMENTS) expect(wikiSourceKind(id)).toBe('experiment')
  })

  it('`@` references resolve every discoverable Run by name and by path', () => {
    for (const name of DISCOVERABLE_RUNS) {
      const inventory = {
        wikiIds: [],
        wikiSlugs: [],
        experimentIds: [],
        runIds: [name, `logs/a/${name}`],
        hypothesisIds: [],
      }
      expect(resolvesWikiReference(name, inventory)).toBe(true)
      expect(resolvesWikiReference(`logs/a/${name}`, inventory)).toBe(true)
    }
  })

  it('a finding citing a non-ASCII Run in prose carries evidence', () => {
    const page = `---\nid: W0001\nkind: finding\ntitle: T\nstatus: TENTATIVE\nsources: [模型-260501-100000]\ncreated_at: "2026-09-01T09:00:00+08:00"\nupdated_at: "2026-09-02T09:00:00+08:00"\n---\n\n# T\n\n## Claim\n\nc\n\n## Evidence\n\nSee 模型-260501-100000.\n\n## Limits\n\nl\n`
    const parsed = parseWikiFrontmatter(page)
    const diagnostics = lintWikiPage({
      id: 'W0001',
      slug: 't',
      kind: 'finding',
      format: 'markdown',
      path: 'docs/wiki/finding/W0001-t.md',
      frontmatter: parsed.frontmatter,
      body: parsed.body,
    })
    expect(diagnostics.map((d) => d.code)).not.toContain('WIKI_CLAIM_WITHOUT_EVIDENCE')
  })
})

function experiment(slug: string, runs: string[]): Experiment {
  const id = `E0001-${slug}`
  return {
    id,
    project: 'p',
    path: `/tmp/${id}`,
    mtime: 0,
    readmeMtime: 0,
    frontMatter: {
      id,
      slug,
      title: slug,
      status: 'OPEN',
      archived: false,
      runs,
      hypotheses: [],
      tags: [],
      createdAt: '2026-05-01T00:00:00+08:00',
      updatedAt: '2026-05-01T00:00:00+08:00',
    },
    sections: { motivation: null, method: null, plan: null, conclusion: null, caveats: null },
    warnings: [],
  } as unknown as Experiment
}

function run(id: string): Run {
  return {
    id,
    project: 'p',
    path: `/tmp/runs/${id}`,
    mtime: 0,
    readmeMtime: 0,
    hasReadme: true,
    frontMatter: { id, name: id, experiment: null },
  } as unknown as Run
}

describe('membership slug check', () => {
  it('checks every discoverable Run, not only [A-Za-z0-9_] names', () => {
    for (const name of DISCOVERABLE_RUNS) {
      const { anomalies } = computeMembership({
        experiments: [experiment('zzz', [name])],
        runs: [run(name)],
        project: 'p',
      })
      expect(anomalies.map((a) => a.code)).toContain('RUN_SLUG_PREFIX_VIOLATION')
    }
  })
})

describe('Experiment runs[] references', () => {
  it('accepts every discoverable Run name', () => {
    const content = `---\nid: E0001-foo\nslug: foo\ntitle: Foo\nstatus: OPEN\nruns: ${JSON.stringify(DISCOVERABLE_RUNS)}\nhypotheses: []\ntags: []\ncreated_at: "2026-05-01T00:00:00+08:00"\nupdated_at: "2026-05-01T00:00:00+08:00"\n---\n\n## Motivation\n\nm\n`
    const parsed = parseExperimentReadme(content, 'E0001-foo')
    expect(parsed.frontMatter.runs).toEqual(DISCOVERABLE_RUNS)
  })
})
