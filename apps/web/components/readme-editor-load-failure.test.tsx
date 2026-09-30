import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import type { ComponentType } from 'react'
import { renderWithQuery } from '../test/utils'

// Force the dynamic import of @monaco-editor/react to reject — this exercises
// the auto-fallback path in <ReadmeMonaco>.
vi.mock('@monaco-editor/react', () => {
  throw new Error('mocked: chunk fetch failed')
})

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
  fetchReadme: vi.fn().mockResolvedValue({ content: 'original', mtime: 1000, hash: 'h1' }),
  putReadme: vi.fn(),
}))

import { ReadmeEditor } from './readme-editor'
import { toast } from 'sonner'

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

describe('ReadmeEditor — Monaco load failure auto-fallback', () => {
  it('falls back to plain textarea and shows a toast', async () => {
    renderWithQuery(<ReadmeEditor path="/x/README.md" runId="exp" onClose={vi.fn()} />)

    expect(await screen.findByTestId('readme-plain-textarea')).toBeInTheDocument()
    await waitFor(() => expect(toast.error).toHaveBeenCalled())

    // Preference is NOT persisted on transient failure — next session should
    // try Monaco again.
    expect(localStorage.getItem('memon:readme-editor:plain')).toBeNull()
  })
})
