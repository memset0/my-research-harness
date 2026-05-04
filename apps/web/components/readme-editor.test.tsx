import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentType } from 'react'
import { renderWithQuery } from '../test/utils'

// Stub @monaco-editor/react with a synchronous textarea so the editor surface
// is observable in jsdom. Its dynamic import inside readme-monaco resolves to
// this module.
vi.mock('@monaco-editor/react', () => ({
  default: function MonacoStub(props: {
    value?: string
    onChange?: (v: string | undefined) => void
  }) {
    return (
      <textarea
        data-testid="monaco-editor"
        value={props.value ?? ''}
        onChange={(e) => props.onChange?.(e.target.value)}
      />
    )
  },
}))

// next/dynamic is still used for react-diff-viewer-continued in the conflict
// branch. Stub it so that DiffViewer renders something inert.
vi.mock('next/dynamic', () => ({
  default: (_loader: unknown, _opts?: unknown): ComponentType<unknown> => {
    return function DynamicStub() {
      return <div data-testid="dynamic-stub" />
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
import { ReadmeEditor, ReadmeEditorBody } from './readme-editor'
import { toast } from 'sonner'

const PATH = '/p/a/logs/exp/README.md'

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.mocked(fetchReadme).mockResolvedValue({
    content: 'original',
    mtime: 1000,
    hash: 'h1',
  } as never)
})

describe('ReadmeEditor (Dialog) — save and conflict paths', () => {
  it('load → save 200 → success toast + onClose', async () => {
    vi.mocked(putReadme).mockResolvedValue({ mtime: 2000 } as never)
    const onClose = vi.fn()

    renderWithQuery(
      <ReadmeEditor path={PATH} experimentId="exp" onClose={onClose} />,
    )

    const editor = await screen.findByTestId('monaco-editor')
    expect(editor).toHaveValue('original')

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

  it('load → save 409 → conflict view appears', async () => {
    vi.mocked(putReadme).mockResolvedValue({
      error: { code: 'CONFLICT', message: 'mtime mismatch' },
      content: 'newer disk version',
      mtime: 5000,
    } as never)

    renderWithQuery(
      <ReadmeEditor path={PATH} experimentId="exp" onClose={vi.fn()} />,
    )

    const editor = await screen.findByTestId('monaco-editor')
    await userEvent.clear(editor)
    await userEvent.type(editor, 'mine')

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    expect(
      await screen.findByText(/disk changed since you opened/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /keep mine/i })).toBeInTheDocument()
  })

  it('draft recovery prompt appears for substantive draft difference', async () => {
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

describe('ReadmeEditor toolbar — plain toggle', () => {
  it('toggles to plain mode and persists preference', async () => {
    const { unmount } = renderWithQuery(
      <ReadmeEditor path={PATH} experimentId="exp" onClose={vi.fn()} />,
    )
    await screen.findByTestId('monaco-editor')

    const toggle = screen.getByRole('button', { name: /switch to plain editor/i })
    await userEvent.click(toggle)

    // After toggle: textarea, not Monaco, and pref persisted
    expect(await screen.findByTestId('readme-plain-textarea')).toBeInTheDocument()
    expect(localStorage.getItem('memon:readme-editor:plain')).toBe('1')

    // Re-render: should default to plain now
    unmount()
    renderWithQuery(
      <ReadmeEditor path={PATH} experimentId="exp" onClose={vi.fn()} />,
    )
    expect(await screen.findByTestId('readme-plain-textarea')).toBeInTheDocument()
    expect(screen.queryByTestId('monaco-editor')).not.toBeInTheDocument()
  })
})

describe('ReadmeEditor toolbar — copy markdown', () => {
  it('writes content to clipboard on success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    renderWithQuery(
      <ReadmeEditor path={PATH} experimentId="exp" onClose={vi.fn()} />,
    )

    const editor = await screen.findByTestId('monaco-editor')
    await userEvent.clear(editor)
    await userEvent.type(editor, 'hello world')

    await userEvent.click(screen.getByRole('button', { name: /copy markdown/i }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('hello world'))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
  })

  it('falls back to text selection when clipboard rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('blocked'))
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    renderWithQuery(
      <ReadmeEditor path={PATH} experimentId="exp" onClose={vi.fn()} />,
    )

    await screen.findByTestId('monaco-editor')
    // Switch to plain so the .select() fallback hits a real textarea.
    await userEvent.click(
      screen.getByRole('button', { name: /switch to plain editor/i }),
    )
    const textarea = await screen.findByTestId('readme-plain-textarea')
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'fallback content')

    const selectSpy = vi.spyOn(
      textarea as HTMLTextAreaElement,
      'select',
    )
    await userEvent.click(screen.getByRole('button', { name: /copy markdown/i }))

    await waitFor(() => expect(writeText).toHaveBeenCalled())
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(selectSpy).toHaveBeenCalled()
  })
})

describe('ReadmeEditorBody — panel containerKind does not auto-close on save', () => {
  it('stays open after successful save', async () => {
    vi.mocked(putReadme).mockResolvedValue({ mtime: 2000 } as never)
    const onClose = vi.fn()

    render(
      <BodyHarness>
        <ReadmeEditorBody
          path={PATH}
          experimentId="exp"
          onClose={onClose}
          containerKind="panel"
        />
      </BodyHarness>,
    )

    const editor = await screen.findByTestId('monaco-editor')
    await userEvent.clear(editor)
    await userEvent.type(editor, 'changed')

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
    // Editor still mounted
    expect(screen.queryByTestId('monaco-editor')).toBeInTheDocument()
  })
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
function BodyHarness({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}
