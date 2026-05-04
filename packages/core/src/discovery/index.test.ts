import { describe, expect, it } from 'vitest'
import type { Experiment, ExperimentFrontMatter, ExperimentSections } from '../types.js'
import { ExperimentIndex } from './index.js'

function makeExp(overrides: Partial<ExperimentFrontMatter> = {}): Experiment {
  const fm: ExperimentFrontMatter = {
    id: 'foo-260503-082800',
    name: 'foo',
    project: 'p',
    status: 'RUNNING',
    createdAt: '2026-05-03T08:28:00+08:00',
    finishedAt: null,
    host: null,
    pid: null,
    gpus: [],
    entry: '',
    command: '',
    wandb: null,
    hypotheses: [],
    tags: [],
    ...overrides,
  }
  const sections: ExperimentSections = {
    motivation: null,
    setup: null,
    method: null,
    result: null,
    conclusion: null,
    caveats: null,
    artifacts: [],
    newHypotheses: null,
  }
  return {
    id: fm.id,
    path: `/tmp/${fm.id}`,
    mtime: 0,
    hasReadme: true,
    frontMatter: fm,
    sections,
    body: '',
    parseErrors: [],
    parseWarnings: [],
  }
}

describe('ExperimentIndex', () => {
  it('set/get/delete/size', () => {
    const idx = new ExperimentIndex()
    expect(idx.size()).toBe(0)
    const a = makeExp({ id: 'a-260501-100000' })
    idx.set(a)
    expect(idx.size()).toBe(1)
    expect(idx.get('a-260501-100000')).toEqual(a)
    expect(idx.has('a-260501-100000')).toBe(true)
    expect(idx.delete('a-260501-100000')).toBe(true)
    expect(idx.size()).toBe(0)
  })

  it('list sorts by createdAt desc', () => {
    const idx = new ExperimentIndex()
    idx.set(makeExp({ id: 'a-260501-100000', createdAt: '2026-05-01T10:00:00+08:00' }))
    idx.set(makeExp({ id: 'b-260503-100000', createdAt: '2026-05-03T10:00:00+08:00' }))
    idx.set(makeExp({ id: 'c-260502-100000', createdAt: '2026-05-02T10:00:00+08:00' }))
    expect(idx.list().map((e) => e.id)).toEqual([
      'b-260503-100000',
      'c-260502-100000',
      'a-260501-100000',
    ])
  })

  it('list filters by project', () => {
    const idx = new ExperimentIndex()
    idx.set(makeExp({ id: 'a-260501-100000', project: 'alpha' }))
    idx.set(makeExp({ id: 'b-260502-100000', project: 'beta' }))
    expect(idx.list({ project: 'alpha' }).map((e) => e.id)).toEqual(['a-260501-100000'])
  })

  it('search matches across name, tags, and hypotheses by default', () => {
    const idx = new ExperimentIndex()
    idx.set(makeExp({ id: 'a-260501-100000', name: 'overlap-test', tags: ['moe'] }))
    idx.set(makeExp({ id: 'b-260502-100000', name: 'rt-bench', hypotheses: ['H0007'] }))

    expect(idx.search('moe').map((e) => e.id)).toEqual(['a-260501-100000'])
    expect(idx.search('H0007').map((e) => e.id)).toEqual(['b-260502-100000'])
  })

  it('search scope=body searches body only', () => {
    const idx = new ExperimentIndex()
    const e = makeExp({ id: 'a-260501-100000', name: 'foo' })
    e.body = 'mentions overlap explicitly'
    idx.set(e)
    expect(idx.search('overlap', 'body').map((x) => x.id)).toEqual(['a-260501-100000'])
    expect(idx.search('foo', 'body')).toEqual([])
  })
})
