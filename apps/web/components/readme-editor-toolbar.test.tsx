import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ReadmeEditorToolbar } from './readme-editor-toolbar'

const baseProps = {
  path: '/x/README.md',
  dirty: false,
  saving: false,
  plain: false,
  onPlainChange: vi.fn(),
  onCopy: vi.fn(),
  onSave: vi.fn(),
  onCancel: vi.fn(),
}

describe('ReadmeEditorToolbar', () => {
  it('renders the path and Save disabled when not dirty', () => {
    render(<ReadmeEditorToolbar {...baseProps} />)
    expect(screen.getByText('/x/README.md')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()
  })

  it('Save enables when dirty', () => {
    render(<ReadmeEditorToolbar {...baseProps} dirty />)
    expect(screen.getByRole('button', { name: /^save$/i })).not.toBeDisabled()
  })

  it('plain toggle invokes onPlainChange with the inverse value', async () => {
    const onPlainChange = vi.fn()
    render(<ReadmeEditorToolbar {...baseProps} onPlainChange={onPlainChange} />)
    await userEvent.click(screen.getByRole('button', { name: /switch to plain editor/i }))
    expect(onPlainChange).toHaveBeenCalledWith(true)
  })

  it('copy invokes onCopy', async () => {
    const onCopy = vi.fn()
    render(<ReadmeEditorToolbar {...baseProps} onCopy={onCopy} />)
    await userEvent.click(screen.getByRole('button', { name: /copy markdown/i }))
    expect(onCopy).toHaveBeenCalledOnce()
  })

  it('saving=true disables every action', () => {
    render(<ReadmeEditorToolbar {...baseProps} saving dirty />)
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /switch to plain editor/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /copy markdown/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled()
  })

  it('shows "Close" label when closeAs="close"', () => {
    render(<ReadmeEditorToolbar {...baseProps} closeAs="close" />)
    expect(screen.getByRole('button', { name: /^close$/i })).toBeInTheDocument()
  })
})
