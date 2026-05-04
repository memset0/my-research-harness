import { describe, it, expect } from 'vitest'
import { buildAgentPrompt, buildCdSnippet } from './agent-prompt'
import type { FullExperiment, JournalEvent } from './api'

function makeExp(overrides: Partial<FullExperiment['frontMatter']> = {}): FullExperiment {
  return {
    id: 'foo-260501-100000',
    path: '/p/a/logs/foo-260501-100000',
    mtime: 0,
    hasReadme: true,
    stale: false,
    parseErrors: [],
    parseWarnings: [],
    sections: {
      motivation: '',
      setup: '',
      method: '',
      result: '',
      conclusion: '',
      caveats: '',
      artifacts: [],
      newHypotheses: null,
    },
    body: '',
    resources: null,
    frontMatter: {
      name: 'foo',
      project: 'a',
      status: 'FINISHED',
      createdAt: '2026-05-01T10:00:00+08:00',
      finishedAt: '2026-05-01T11:00:00+08:00',
      host: null,
      pid: null,
      gpus: [],
      entry: '',
      command: '',
      tags: [],
      hypotheses: ['H0001', 'H0003'],
      wandb: null,
      ...overrides,
    },
  } as FullExperiment
}

function makeEvent(o: Partial<JournalEvent> = {}): JournalEvent {
  return {
    timestamp: '2026-05-01T11:00:00+08:00',
    tag: 'NOTE',
    experimentId: 'foo-260501-100000',
    body: 'first observation',
    ...o,
  } as JournalEvent
}

describe('buildAgentPrompt', () => {
  it('embeds experiment id, path, README path, status, hypotheses', () => {
    const out = buildAgentPrompt({
      experiment: makeExp(),
      recentJournalEvents: [],
      projectRoot: '/repos/a',
    })
    expect(out).toContain('foo-260501-100000')
    expect(out).toContain('/p/a/logs/foo-260501-100000/README.md')
    expect(out).toContain('FINISHED')
    expect(out).toContain('H0001, H0003')
    expect(out).toContain('/repos/a/HYPOTHESES.md')
  })

  it('"(none linked)" when no hypotheses', () => {
    const out = buildAgentPrompt({
      experiment: makeExp({ hypotheses: [] }),
      recentJournalEvents: [],
      projectRoot: '/r',
    })
    expect(out).toContain('(none linked)')
  })

  it('"(no related events)" when no journal events for this experiment', () => {
    const out = buildAgentPrompt({
      experiment: makeExp(),
      recentJournalEvents: [makeEvent({ experimentId: 'other-id' })],
      projectRoot: '/r',
    })
    expect(out).toContain('(no related events)')
  })

  it('caps to 10 events', () => {
    const events = Array.from({ length: 15 }, (_, i) =>
      makeEvent({ body: `msg-${i}` }),
    )
    const out = buildAgentPrompt({
      experiment: makeExp(),
      recentJournalEvents: events,
      projectRoot: '/r',
    })
    // First 10 included; 11th and beyond not
    expect(out).toContain('msg-0')
    expect(out).toContain('msg-9')
    expect(out).not.toContain('msg-10')
    expect(out).not.toContain('msg-14')
  })

  it('filters events by experimentId match', () => {
    const out = buildAgentPrompt({
      experiment: makeExp(),
      recentJournalEvents: [
        makeEvent({ body: 'mine', experimentId: 'foo-260501-100000' }),
        makeEvent({ body: 'theirs', experimentId: 'bar-260502-150000' }),
      ],
      projectRoot: '/r',
    })
    expect(out).toContain('mine')
    expect(out).not.toContain('theirs')
  })

  it('asks for Chinese response', () => {
    const out = buildAgentPrompt({
      experiment: makeExp(),
      recentJournalEvents: [],
      projectRoot: '/r',
    })
    expect(out).toMatch(/中文/)
  })
})

describe('buildCdSnippet', () => {
  it('formats cd <root> && claude', () => {
    expect(buildCdSnippet('/repos/a')).toBe('cd /repos/a && claude')
  })
})
