import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentType } from 'react'
import { renderWithQuery } from '../test/utils'

// `next/dynamic` runs the loader async; for tests, swallow the loader and
// render a synchronous stub. We pretend MDEditor is a textarea.
vi.mock('next/dynamic', () => ({
  default: (_loader: unknown, _opts?: unknown): ComponentType<unknown> => {
    return function MdStub(props: {
      value?: string
      onChange?: (v: string) => void
    }) {
      return (
        <textarea
          data-testid="md-editor"
          value={props.value ?? ''}
          onChange={(e) => props.onChange?.(e.target.value)}
        />
      )
    } as unknown as ComponentType<unknown>
  },
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('../lib/api', () => ({
  fetchReadme: vi.fn(),
  putReadme: vi.fn(),
}))

import { fetchReadme, putReadme } from '../lib/api'
import { ReadmeEditor } from './readme-editor'
import { toast } from 'sonner'

const PATH = '/p/a/logs/exp/README.md'

describe('ReadmeEditor save path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(fetchReadme).mockResolvedValue({
      content: 'original',
      mtime: 1000,
      hash: 'h1',
    } as never)
  })

  it('load → save 200 → success toast + onClose', async () => {
    vi.mocked(putReadme).mockResolvedValue({ mtime: 2000 } as never)
    const onClose = vi.fn()

    renderWithQuery(
      <ReadmeEditor path={PATH} experimentId="exp" onClose={onClose} />,
    )

    const editor = await screen.findByTestId('md-editor')
    expect(editor).toHaveValue('original')

    // Edit content
    await userEvent.clear(editor)
    await userEvent.type(editor, 'changed')

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(putReadme).toHaveBeenCalledWith(
        expect.objectContaining({
          path: PATH,
          content: 'changed',
          expectedMtime: 1000,
          expectedHash: 'h1',
        }),
      )
    })
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('load → save 409 → conflict diff view appears', async () => {
    vi.mocked(putReadme).mockResolvedValue({
      error: { code: 'CONFLICT', message: 'mtime mismatch' },
      content: 'newer disk version',
      mtime: 5000,
    } as never)

    renderWithQuery(
      <ReadmeEditor path={PATH} experimentId="exp" onClose={vi.fn()} />,
    )

    await screen.findByTestId('md-editor')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    // Conflict header text
    expect(
      await screen.findByText(/disk changed since you opened/i),
    ).toBeInTheDocument()
    // The "Keep mine (overwrite)" button is rendered
    expect(screen.getByRole('button', { name: /keep mine/i })).toBeInTheDocument()
  })

  it('draft recovery prompt appears when localStorage has a substantively different draft', async () => {
    // Pre-seed localStorage with a draft for path+mtime
    const draftKey = `memon:draft:${PATH}:1000`
    localStorage.setItem(
      draftKey,
      JSON.stringify({
        content: 'draft content quite different from disk',
        savedAt: new Date().toISOString(),
      }),
    )

    renderWithQuery(
      <ReadmeEditor path={PATH} experimentId="exp" onClose={vi.fn()} />,
    )

    expect(
      await screen.findByText(/unsaved draft found/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /restore my draft/i }),
    ).toBeInTheDocument()
  })
})
