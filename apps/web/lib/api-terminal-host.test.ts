import { ProjectRefSchema } from '@memon/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  attachTerminal,
  checkTerminal,
  createTmuxSession,
  getTmuxSession,
  installTerminal,
  killTmuxSession,
  listTerminals,
  listTmuxSessions,
  renameTmuxSession,
  startTerminal,
  stopTerminal,
} from './api'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('Host-qualified terminal API helpers', () => {
  it('puts the exact Host on every lifecycle endpoint without changing standalone calls', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/check')) return Response.json({ available: true })
      if (url.includes('/install')) {
        return Response.json({ ok: true, version: '1.7.7', durationMs: 1 })
      }
      if (url.includes('/list')) return Response.json({ sessions: [] })
      if (url.includes('/stop')) return Response.json({ stopped: true })
      if (url.includes('/tmux-sessions')) {
        if (_init?.method === 'DELETE') {
          return Response.json({ ok: true, host: 'host-a', sessionName: 'memon-manual-same' })
        }
        if (url.includes('/rename')) {
          return Response.json({ ok: true, host: 'host-a', sessionName: 'memon-manual-renamed' })
        }
        if (_init?.method === 'POST') {
          return Response.json({
            ok: true,
            host: 'host-a',
            sessionName: 'memon-manual-same',
            alreadyExisted: false,
          })
        }
        if (url.endsWith('host=host-a') && url.includes('/memon-')) {
          return Response.json({ row: {} })
        }
        return Response.json({ sessions: [] })
      }
      return Response.json({
        host: 'host-a',
        sessionName: 'memon-codex-project-a--project--root',
        url: '/api/terminal/proxy/host-a/memon-codex-project-a--project--root/',
        startedAt: '2026-08-26T19:00:00.000Z',
        warnings: [],
      })
    })
    globalThis.fetch = fetchMock as typeof fetch
    const target = ProjectRefSchema.parse({ host: 'host-a', project: 'project-a' })

    await checkTerminal({ host: target.host })
    await installTerminal({ host: target.host })
    await startTerminal({ project: target, scope: 'project', slug: 'root', agent: 'codex' })
    await attachTerminal({ host: target.host, sessionName: 'memon-manual-same' })
    await stopTerminal({ host: target.host, sessionName: 'memon-manual-same' })
    await listTerminals({ host: target.host })
    await listTmuxSessions({ host: target.host })
    await getTmuxSession('memon-manual-same', { host: target.host })
    await createTmuxSession({ host: target.host, name: 'same' })
    await renameTmuxSession({
      host: target.host,
      name: 'memon-manual-same',
      newName: 'memon-manual-renamed',
    })
    await killTmuxSession('memon-manual-renamed', { host: target.host })
    await checkTerminal()

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/terminal/check?host=host-a',
      '/api/terminal/install?host=host-a',
      '/api/terminal/start?host=host-a&project=project-a',
      '/api/terminal/attach?host=host-a',
      '/api/terminal/stop?host=host-a',
      '/api/terminal/list?host=host-a',
      '/api/tmux-sessions?host=host-a',
      '/api/tmux-sessions/memon-manual-same?host=host-a',
      '/api/tmux-sessions?host=host-a',
      '/api/tmux-sessions/memon-manual-same/rename?host=host-a',
      '/api/tmux-sessions/memon-manual-renamed?host=host-a',
      '/api/terminal/check',
    ])
    const startInit = fetchMock.mock.calls[2]?.[1] as RequestInit
    expect(JSON.parse(String(startInit.body))).toMatchObject({ project: 'project-a' })
  })
})
