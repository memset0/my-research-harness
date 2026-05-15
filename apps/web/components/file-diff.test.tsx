import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { FileDiff } from './file-diff'
import {
  DIFF_VIEW_STORAGE_KEY,
} from '../lib/use-diff-view-mode'

beforeEach(() => {
  window.localStorage.clear()
})
afterEach(() => {
  window.localStorage.clear()
})

describe('FileDiff', () => {
  it('renders a skeleton when loading=true and does not mount RDV', () => {
    const { container } = render(
      <FileDiff
        filename="a.ts"
        status="modified"
        oldContent={null}
        newContent={null}
        loading
      />,
    )
    expect(container.querySelector('[data-slot="file-diff-loading"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="file-diff"]')).toBeNull()
  })

  it('renders errorMessage in text-destructive', () => {
    render(
      <FileDiff
        filename="a.ts"
        status="modified"
        oldContent={null}
        newContent={null}
        errorMessage="boom"
      />,
    )
    const el = screen.getByText('boom')
    expect(el.className).toMatch(/text-destructive/)
  })

  it('skipReason short-circuits RDV with the reason text', () => {
    const { container } = render(
      <FileDiff
        filename="big.txt"
        status="modified"
        oldContent={null}
        newContent={null}
        skipReason="too-large"
        skipSizeBytes={2 * 1024 * 1024}
        skipMaxBytes={1024 * 1024}
      />,
    )
    const skip = container.querySelector('[data-slot="file-diff-skip"]')
    expect(skip).not.toBeNull()
    expect(skip?.getAttribute('data-skip-reason')).toBe('too-large')
    expect(skip?.textContent).toMatch(/file too large/)
    expect(skip?.textContent).toMatch(/2\.00 MB/)
    expect(container.querySelector('[data-slot="file-diff"]')).toBeNull()
  })

  it('binary skipReason renders the right label', () => {
    const { container } = render(
      <FileDiff
        filename="img.png"
        status="modified"
        oldContent={null}
        newContent={null}
        skipReason="binary"
      />,
    )
    const skip = container.querySelector('[data-slot="file-diff-skip"]')
    expect(skip?.getAttribute('data-skip-reason')).toBe('binary')
    expect(skip?.textContent).toMatch(/binary file/)
  })

  it('mounts RDV with splitView=true when mode is split (default)', () => {
    const { container } = render(
      <FileDiff
        filename="a.ts"
        status="modified"
        oldContent="hello\n"
        newContent="world\n"
      />,
    )
    const root = container.querySelector('[data-slot="file-diff"]')
    expect(root).not.toBeNull()
    expect(root?.getAttribute('data-view-mode')).toBe('split')
  })

  it('mounts RDV with splitView=false when mode is inline', () => {
    window.localStorage.setItem(DIFF_VIEW_STORAGE_KEY, 'inline')
    const { container } = render(
      <FileDiff
        filename="a.ts"
        status="modified"
        oldContent="hello\n"
        newContent="world\n"
      />,
    )
    const root = container.querySelector('[data-slot="file-diff"]')
    expect(root?.getAttribute('data-view-mode')).toBe('inline')
  })

  it('normalises CRLF to LF on both sides before rendering', () => {
    // We can't easily inspect RDV's internal computed lines from the DOM,
    // but we can verify the wrapper is rendered (which means the props
    // didn't blow up) and that no spurious carriage-return characters
    // appear in the markup the consumer sees.
    const { container } = render(
      <FileDiff
        filename="a.ts"
        status="modified"
        oldContent={'line1\r\nline2\r\n'}
        newContent={'line1\nline2\n'}
      />,
    )
    expect(container.querySelector('[data-slot="file-diff"]')).not.toBeNull()
    expect(container.innerHTML).not.toMatch(/\r/)
  })
})
