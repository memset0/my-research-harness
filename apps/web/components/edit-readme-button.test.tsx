import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentType } from 'react'
import { renderWithQuery } from '../test/utils'

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

vi.mock('next/dynamic', () => ({
  default: (_loader: unknown): ComponentType<unknown> => {
    return function DynamicStub() {
      return <div data-testid="dynamic-stub" />
    } as unknown as ComponentType<unknown>
  },
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('../lib/api', () => ({
  fetchReadme: vi.fn().mockResolvedValue({ content: '', mtime: 1, hash: 'h' }),
  putReadme: vi.fn(),
}))

// We control useIsDesktop from the test.
const isDesktopRef = { current: false as boolean }
vi.mock('@/hooks/use-is-desktop', () => ({
  useIsDesktop: () => isDesktopRef.current,
}))

import { EditReadmeButton } from './edit-readme-button'
import { ReadmeEditorProvider, useReadmeEditor } from './readme-editor-context'

beforeEach(() => {
  isDesktopRef.current = false
  localStorage.clear()
})

function ContextSnoop({ onCtx }: { onCtx: (v: ReturnType<typeof useReadmeEditor>) => void }) {
  const v = useReadmeEditor()
  onCtx(v)
  return null
}

describe('EditReadmeButton', () => {
  it('mobile/tablet: clicking opens a Dialog (no context required)', async () => {
    renderWithQuery(<EditReadmeButton path="/x" runId="e" />)
    await userEvent.click(screen.getByRole('button', { name: /edit readme/i }))
    // Dialog renders the Monaco editor inside.
    expect(await screen.findByTestId('monaco-editor')).toBeInTheDocument()
  })

  it('desktop: clicking toggles context.open instead of opening a Dialog', async () => {
    isDesktopRef.current = true
    const snooped: { current: ReturnType<typeof useReadmeEditor> | null } = { current: null }
    renderWithQuery(
      <ReadmeEditorProvider>
        <ContextSnoop
          onCtx={(v) => {
            snooped.current = v
          }}
        />
        <EditReadmeButton path="/x" runId="e" />
      </ReadmeEditorProvider>,
    )
    expect(snooped.current?.open).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: /edit readme/i }))
    expect(snooped.current?.open).toBe(true)
    // No Dialog mounted
    expect(screen.queryByTestId('monaco-editor')).not.toBeInTheDocument()
  })

  it('desktop: when panel is open and expanded, button reads "Hide editor"', async () => {
    isDesktopRef.current = true
    function Setup() {
      const ctx = useReadmeEditor()
      if (!ctx.open) ctx.setOpen(true)
      return null
    }
    renderWithQuery(
      <ReadmeEditorProvider>
        <Setup />
        <EditReadmeButton path="/x" runId="e" />
      </ReadmeEditorProvider>,
    )
    expect(await screen.findByRole('button', { name: /hide editor/i })).toBeInTheDocument()
  })
})
