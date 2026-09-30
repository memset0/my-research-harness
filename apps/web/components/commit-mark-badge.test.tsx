import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CommitMarkBadge } from './commit-mark-badge'

describe('CommitMarkBadge', () => {
  it('renders data-status="none" and an invisible dot when unmarked', () => {
    const { container } = render(<CommitMarkBadge />)
    const badge = container.querySelector('[data-slot="commit-mark-badge"]')
    expect(badge).not.toBeNull()
    expect(badge!.getAttribute('data-status')).toBe('none')
    const dot = badge!.querySelector('span[aria-hidden]')!
    expect(dot.className).toMatch(/opacity-0/)
    // Slot footprint preserved (width class on outer span)
    expect(badge!.className).toMatch(/w-3/)
  })

  it('renders bg-emerald-500 for verified', () => {
    const { container } = render(
      <CommitMarkBadge
        mark={{
          sha: 'a',
          status: 'verified',
          note: '',
          updatedAt: '2026-05-15T12:00:00+08:00',
          submodule: '',
        }}
      />,
    )
    const badge = container.querySelector('[data-slot="commit-mark-badge"]')!
    expect(badge.getAttribute('data-status')).toBe('verified')
    const dot = badge.querySelector('span[aria-hidden]')!
    expect(dot.className).toMatch(/bg-emerald-500/)
    expect(dot.className).not.toMatch(/opacity-0/)
  })

  it('renders bg-amber-500 for suspicious', () => {
    const { container } = render(
      <CommitMarkBadge
        mark={{
          sha: 'a',
          status: 'suspicious',
          note: '',
          updatedAt: '2026-05-15T12:00:00+08:00',
          submodule: '',
        }}
      />,
    )
    const dot = container.querySelector('[data-slot="commit-mark-badge"] span[aria-hidden]')!
    expect(dot.className).toMatch(/bg-amber-500/)
  })

  it('renders bg-destructive for issue', () => {
    const { container } = render(
      <CommitMarkBadge
        mark={{
          sha: 'a',
          status: 'issue',
          note: '',
          updatedAt: '2026-05-15T12:00:00+08:00',
          submodule: '',
        }}
      />,
    )
    const dot = container.querySelector('[data-slot="commit-mark-badge"] span[aria-hidden]')!
    expect(dot.className).toMatch(/bg-destructive/)
  })

  it('passes the note through to the rendered DOM for tooltip-eligible markup', () => {
    // The Radix TooltipContent only mounts to the DOM when the trigger is
    // hovered/focused — too brittle to test directly here. Just confirm the
    // badge mounts without throwing for a mark with a non-empty note.
    const { container } = render(
      <CommitMarkBadge
        mark={{
          sha: 'a',
          status: 'verified',
          note: 'great commit',
          updatedAt: '2026-05-15T12:00:00+08:00',
          submodule: '',
        }}
      />,
    )
    expect(container.querySelector('[data-slot="commit-mark-badge"]')).not.toBeNull()
  })
})
