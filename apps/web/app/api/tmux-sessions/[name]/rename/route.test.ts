// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../lib/runtime', () => ({
  getRuntime: vi.fn().mockResolvedValue({
    config: { terminal: { tmuxEnabled: true } },
  }),
}))

vi.mock('../../../../../lib/terminal/tmux-discover', async () => {
  const actual = await vi.importActual<typeof import('../../../../../lib/terminal/tmux-discover')>(
    '../../../../../lib/terminal/tmux-discover',
  )
  return {
    ...actual,
    renameTmuxSession: vi.fn(),
  }
})

import { renameTmuxSession } from '../../../../../lib/terminal/tmux-discover'
import { POST } from './route'

function mkCtx(name: string): { params: Promise<{ name: string }> } {
  return { params: Promise.resolve({ name }) }
}

function mkReq(body: unknown): Request {
  return new Request('http://localhost/api/tmux-sessions/x/rename', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('POST /api/tmux-sessions/[name]/rename', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('200 on successful rename', async () => {
    vi.mocked(renameTmuxSession).mockResolvedValueOnce(undefined)
    const res = await POST(
      mkReq({ newName: 'memon-manual-new' }) as never,
      mkCtx('memon-manual-old'),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, sessionName: 'memon-manual-new' })
    expect(renameTmuxSession).toHaveBeenCalledWith({
      oldName: 'memon-manual-old',
      newName: 'memon-manual-new',
    })
  })

  it('400 when path name does not match regex', async () => {
    const res = await POST(
      mkReq({ newName: 'memon-manual-new' }) as never,
      mkCtx('not-a-memon-prefix'),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('BAD_REQUEST')
    expect(renameTmuxSession).not.toHaveBeenCalled()
  })

  it('400 when newName is missing', async () => {
    const res = await POST(mkReq({}) as never, mkCtx('memon-manual-old'))
    expect(res.status).toBe(400)
    expect(renameTmuxSession).not.toHaveBeenCalled()
  })

  it('400 when newName does not match regex', async () => {
    const res = await POST(mkReq({ newName: 'nopfx' }) as never, mkCtx('memon-manual-old'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.message).toMatch(/memon-/)
    expect(renameTmuxSession).not.toHaveBeenCalled()
  })

  it('400 when newName equals oldName', async () => {
    const res = await POST(
      mkReq({ newName: 'memon-manual-foo' }) as never,
      mkCtx('memon-manual-foo'),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.message).toMatch(/differ from oldName/)
    expect(renameTmuxSession).not.toHaveBeenCalled()
  })

  it('400 on invalid JSON body', async () => {
    const res = await POST(mkReq('not json') as never, mkCtx('memon-manual-old'))
    expect(res.status).toBe(400)
    expect(renameTmuxSession).not.toHaveBeenCalled()
  })

  it('404 when old session not found', async () => {
    vi.mocked(renameTmuxSession).mockRejectedValueOnce(
      Object.assign(new Error('old session not found'), { code: 'NOT_FOUND' as const }),
    )
    const res = await POST(
      mkReq({ newName: 'memon-manual-new' }) as never,
      mkCtx('memon-manual-old'),
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('409 when new session already exists', async () => {
    vi.mocked(renameTmuxSession).mockRejectedValueOnce(
      Object.assign(new Error('tmux session memon-manual-bar already exists'), {
        code: 'CONFLICT' as const,
      }),
    )
    const res = await POST(
      mkReq({ newName: 'memon-manual-bar' }) as never,
      mkCtx('memon-manual-foo'),
    )
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error.code).toBe('CONFLICT')
    expect(body.error.message).toMatch(/already exists/)
  })

  it('500 on unexpected execTmux failure', async () => {
    vi.mocked(renameTmuxSession).mockRejectedValueOnce(
      new Error('tmux rename-session exited 1: oops'),
    )
    const res = await POST(
      mkReq({ newName: 'memon-manual-new' }) as never,
      mkCtx('memon-manual-old'),
    )
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error.message).toMatch(/exited 1/)
  })

  it('URL-decodes the path param before validation', async () => {
    vi.mocked(renameTmuxSession).mockResolvedValueOnce(undefined)
    const encoded = encodeURIComponent('memon-claude-project-a--run--foo-260101-000000')
    const res = await POST(mkReq({ newName: 'memon-manual-decoded' }) as never, mkCtx(encoded))
    expect(res.status).toBe(200)
    expect(renameTmuxSession).toHaveBeenCalledWith({
      oldName: 'memon-claude-project-a--run--foo-260101-000000',
      newName: 'memon-manual-decoded',
    })
  })
})
