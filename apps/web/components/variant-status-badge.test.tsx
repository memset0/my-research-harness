import type { VariantStatus } from '@memon/core'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VARIANT_STATUS_RANK, variantStatusRank } from '../lib/experiment-results/status'
import { VARIANT_STATUS_CLASS, VariantStatusBadge } from './variant-status-badge'

const STATUSES = Object.keys(VARIANT_STATUS_RANK) as VariantStatus[]

describe('VariantStatusBadge', () => {
  it('renders every status name in a shadcn outline Badge with its own style', () => {
    for (const status of STATUSES) {
      const { container, unmount } = render(<VariantStatusBadge status={status} />)
      const badge = container.querySelector('[data-slot="badge"]')
      expect(badge, status).toHaveTextContent(status)
      expect(badge, status).toHaveAttribute('data-variant', 'outline')
      expect(badge, status).toHaveAttribute('data-status', status)
      for (const className of VARIANT_STATUS_CLASS[status].split(' ')) {
        expect(badge, `${status} ${className}`).toHaveClass(className)
      }
      unmount()
    }
    // Seven statuses, seven different looks.
    expect(new Set(STATUSES.map((status) => VARIANT_STATUS_CLASS[status])).size).toBe(7)
  })

  it('draws BLOCKED orange and dashed, apart from FAILED, INCONCLUSIVE and PLANNED', () => {
    const { container } = render(<VariantStatusBadge status="BLOCKED" />)
    const badge = container.querySelector('[data-slot="badge"]')
    expect(badge).toHaveClass('border-dashed', 'border-orange-400', 'text-orange-800')
    for (const other of ['FAILED', 'INCONCLUSIVE', 'PLANNED'] as const) {
      expect(VARIANT_STATUS_CLASS[other]).not.toContain('orange')
      expect(VARIANT_STATUS_CLASS[other]).not.toContain('border-dashed')
    }
  })

  it('keeps caller classes and falls back to the plain outline for an unknown status', () => {
    const { container } = render(
      <VariantStatusBadge status={'WAITING' as VariantStatus} className="ml-1" />,
    )
    const badge = container.querySelector('[data-slot="badge"]')
    expect(badge).toHaveTextContent('WAITING')
    expect(badge).toHaveClass('ml-1', 'font-medium')
  })
})

describe('variantStatusRank', () => {
  it('ranks the lifecycle order and puts unknown statuses last', () => {
    expect(STATUSES).toEqual([
      'PLANNED',
      'BLOCKED',
      'RUNNING',
      'COMPLETED',
      'FAILED',
      'INCONCLUSIVE',
      'DROPPED',
    ])
    expect(STATUSES.map(variantStatusRank)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(variantStatusRank('WAITING')).toBe(7)
    expect(variantStatusRank('toString')).toBe(7)
  })
})
