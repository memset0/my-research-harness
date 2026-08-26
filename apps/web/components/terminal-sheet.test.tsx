// @vitest-environment jsdom

import { ProjectRefSchema } from '@memon/core'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const startTerminalMock = vi.hoisted(() => vi.fn())
const stopTerminalMock = vi.hoisted(() => vi.fn())

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return { ...actual, startTerminal: startTerminalMock, stopTerminal: stopTerminalMock }
})

import { TerminalSheet } from './terminal-sheet'

describe('TerminalSheet Host-qualified lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stopTerminalMock.mockResolvedValue({ stopped: true })
  })

  it('starts, renders, and stops only the selected Host session', async () => {
    const project = ProjectRefSchema.parse({ host: 'host-a', project: 'project-a' })
    startTerminalMock.mockResolvedValue({
      host: 'host-a',
      sessionName: 'memon-terminal-project-a--exp--E0001-alpha',
      url: '/api/terminal/proxy/host-a/memon-terminal-project-a--exp--E0001-alpha/',
      startedAt: '2026-08-26T19:00:00.000Z',
      warnings: [],
    })
    const view = render(
      <TerminalSheet
        open
        onOpenChange={() => undefined}
        project={project}
        scope="exp"
        slug="E0001-alpha"
        agent="none"
      />,
    )

    expect(await screen.findByTitle('none terminal')).toHaveAttribute(
      'src',
      '/api/terminal/proxy/host-a/memon-terminal-project-a--exp--E0001-alpha/',
    )
    expect(screen.getByTitle('none terminal')).toHaveAttribute(
      'allow',
      'clipboard-read; clipboard-write',
    )
    expect(startTerminalMock).toHaveBeenCalledWith({
      project,
      scope: 'exp',
      slug: 'E0001-alpha',
      agent: 'none',
    })

    view.rerender(
      <TerminalSheet
        open={false}
        onOpenChange={() => undefined}
        project={project}
        scope="exp"
        slug="E0001-alpha"
        agent="none"
      />,
    )
    await waitFor(() =>
      expect(stopTerminalMock).toHaveBeenCalledWith({
        host: 'host-a',
        sessionName: 'memon-terminal-project-a--exp--E0001-alpha',
      }),
    )
  })
})
