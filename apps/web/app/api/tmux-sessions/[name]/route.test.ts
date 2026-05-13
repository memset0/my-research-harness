// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../../lib/runtime', () => ({
  getRuntime: vi.fn().mockResolvedValue({
    config: { projects: [] },
    index: { list: () => [] },
    experiments: new Map(),
  }),
}))

vi.mock('../../../../lib/terminal/tmux-discover', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../lib/terminal/tmux-discover')
  >('../../../../lib/terminal/tmux-discover')
  return {
    ...actual,
    getEnrichedSession: vi.fn(),
    killTmuxSessionByName: vi.fn().mockResolvedValue(undefined),
    tmuxHasSession: vi.fn(),
  }
})

import { GET, DELETE } from './route'
import {
  getEnrichedSession,
  killTmuxSessionByName,
  tmuxHasSession,
} from '../../../../lib/terminal/tmux-discover'

function mkCtx(name: string): { params: Promise<{ name: string }> } {
  return { params: Promise.resolve({ name }) }
}

describe('GET /api/tmux-sessions/[name]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('200 with row payload when getEnrichedSession returns a hit', async () => {
    vi.mocked(getEnrichedSession).mockResolvedValueOnce({
      sessionName: 'memon-manual-foo',
      parsed: {
        raw: 'memon-manual-foo',
        agent: null,
        project: null,
        scope: null,
        slug: null,
        legacy: false,
      },
      liveEntry: null,
      tmuxCreatedAt: '2026-05-13T00:00:00.000Z',
      tmuxLastActivity: '2026-05-13T00:01:00.000Z',
      matchable: false,
      staleReason: null,
      pane: {
        title: 'hello',
        currentCommand: 'bash',
        currentPath: '/repo',
      },
    })
    const res = await GET({} as never, mkCtx('memon-manual-foo'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.row.sessionName).toBe('memon-manual-foo')
    expect(body.row.pane).toEqual({
      title: 'hello',
      currentCommand: 'bash',
      currentPath: '/repo',
    })
  })

  it('404 when getEnrichedSession returns null', async () => {
    vi.mocked(getEnrichedSession).mockResolvedValueOnce(null)
    const res = await GET({} as never, mkCtx('memon-manual-doesnotexist'))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('400 when name does not match memon-* shape', async () => {
    const res = await GET({} as never, mkCtx('not-a-memon-prefix'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('BAD_REQUEST')
    expect(getEnrichedSession).not.toHaveBeenCalled()
  })

  it('400 when name has unsafe chars', async () => {
    const res = await GET({} as never, mkCtx('memon-foo bar'))
    expect(res.status).toBe(400)
    expect(getEnrichedSession).not.toHaveBeenCalled()
  })

  it('URL-decodes the param before validation', async () => {
    vi.mocked(getEnrichedSession).mockResolvedValueOnce(null)
    // Encoded "memon-manual-foo" → "memon-manual-foo" once decoded.
    const encoded = encodeURIComponent('memon-manual-foo')
    const res = await GET({} as never, mkCtx(encoded))
    expect(res.status).toBe(404) // shape valid → 404 from getEnrichedSession
    expect(getEnrichedSession).toHaveBeenCalledWith(expect.anything(), 'memon-manual-foo')
  })
})

describe('DELETE /api/tmux-sessions/[name]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('200 on existing session', async () => {
    vi.mocked(tmuxHasSession).mockResolvedValueOnce(true)
    const res = await DELETE({} as never, mkCtx('memon-claude-project-a--run--foo'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(killTmuxSessionByName).toHaveBeenCalledWith('memon-claude-project-a--run--foo')
  })

  it('404 on missing session', async () => {
    vi.mocked(tmuxHasSession).mockResolvedValueOnce(false)
    const res = await DELETE({} as never, mkCtx('memon-claude-project-a--run--gone'))
    expect(res.status).toBe(404)
    expect(killTmuxSessionByName).not.toHaveBeenCalled()
  })

  it('400 on name not starting with memon-', async () => {
    const res = await DELETE({} as never, mkCtx('not-memon'))
    expect(res.status).toBe(400)
    expect(tmuxHasSession).not.toHaveBeenCalled()
  })
})
