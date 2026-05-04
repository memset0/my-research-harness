import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, type ComponentType, type ReactNode } from 'react'
import { renderWithQuery } from '../test/utils'

vi.mock('@monaco-editor/react', () => ({
  default: function MonacoStub(props: { value?: string; onChange?: (v: string | undefined) => void }) {
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

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('../lib/api', () => ({
  fetchReadme: vi.fn().mockResolvedValue({ content: '', mtime: 1, hash: 'h' }),
  putReadme: vi.fn(),
}))

import { ReadmeEditorProvider, useReadmeEditor } from './readme-editor-context'
import { ReadmeSidePanel } from './readme-side-panel'

function withProvider(node: ReactNode, init: { open?: boolean; collapsed?: boolean; width?: number } = {}) {
  function Setup() {
    const ctx = useReadmeEditor()
    // Apply initial state ONCE on mount; do not re-coerce on later re-renders,
    // otherwise user-driven state changes get clobbered.
    useEffect(() => {
      if (init.open !== undefined) ctx.setOpen(init.open)
      if (init.collapsed !== undefined) ctx.setCollapsed(init.collapsed)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return null
  }
  return (
    <ReadmeEditorProvider>
      <Setup />
      {node}
    </ReadmeEditorProvider>
  )
}

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440, writable: true })
})

describe('ReadmeSidePanel — render states', () => {
  it('renders nothing when context.open=false', () => {
    renderWithQuery(withProvider(<ReadmeSidePanel path="/x/README.md" experimentId="e" />))
    expect(screen.queryByTestId('readme-side-panel')).not.toBeInTheDocument()
  })

  it('renders expanded state with data-state="expanded" when open', async () => {
    renderWithQuery(withProvider(<ReadmeSidePanel path="/x/README.md" experimentId="e" />, { open: true }))
    const panel = await screen.findByTestId('readme-side-panel')
    expect(panel).toHaveAttribute('data-state', 'expanded')
    expect(screen.getByTestId('readme-side-panel-drag-handle')).toBeInTheDocument()
  })

  it('renders collapsed state with handle when collapsed=true', async () => {
    renderWithQuery(
      withProvider(<ReadmeSidePanel path="/x/README.md" experimentId="e" />, {
        open: true,
        collapsed: true,
      }),
    )
    const panel = await screen.findByTestId('readme-side-panel')
    expect(panel).toHaveAttribute('data-state', 'collapsed')
    expect(
      screen.getByRole('button', { name: /expand readme editor/i }),
    ).toBeInTheDocument()
  })

  it('toggles between collapsed and expanded via the handle button', async () => {
    renderWithQuery(
      withProvider(<ReadmeSidePanel path="/x/README.md" experimentId="e" />, {
        open: true,
        collapsed: true,
      }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: /expand readme editor/i }),
    )
    await waitFor(() =>
      expect(screen.getByTestId('readme-side-panel')).toHaveAttribute('data-state', 'expanded'),
    )
  })
})

describe('ReadmeSidePanel — drag to resize', () => {
  it('persists new width to localStorage on mouseup', async () => {
    renderWithQuery(
      withProvider(<ReadmeSidePanel path="/x/README.md" experimentId="e" />, { open: true }),
    )
    const handle = await screen.findByTestId('readme-side-panel-drag-handle')

    fireEvent.mouseDown(handle, { clientX: 800 })
    // Drag 100px to the left → width should grow by 100
    fireEvent.mouseMove(document, { clientX: 700 })
    fireEvent.mouseUp(document)

    await waitFor(() => {
      const stored = localStorage.getItem('memon:readme-editor:width')
      expect(stored).not.toBeNull()
      expect(Number(stored)).toBeGreaterThan(0)
    })
  })
})
