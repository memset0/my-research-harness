import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FrontmatterPanel } from './frontmatter-panel'

const CREATED = '2026-08-13T10:15:30+08:00'
const UPDATED_DATE = new Date('2026-08-14T03:45:00Z')
const REPORT_TIMESTAMP_KEYS = ['created_at', 'updated_at'] as const

function valueFor(key: string): HTMLElement {
  const label = screen.getByText(key)
  const value = label.nextElementSibling
  if (!(value instanceof HTMLElement)) throw new Error(`missing value for ${key}`)
  return value
}

describe('FrontmatterPanel timestamp presentation', () => {
  it('formats configured string and Date timestamps in the browser locale', async () => {
    render(
      <FrontmatterPanel
        data={{ created_at: CREATED, updated_at: UPDATED_DATE }}
        timestampKeys={REPORT_TIMESTAMP_KEYS}
      />,
    )

    await waitFor(() => {
      expect(valueFor('created_at')).toHaveTextContent(new Date(CREATED).toLocaleString())
    })
    expect(valueFor('created_at').querySelector('span')).toHaveAttribute('title', CREATED)

    const normalizedUpdated = UPDATED_DATE.toISOString()
    expect(valueFor('updated_at')).toHaveTextContent(UPDATED_DATE.toLocaleString())
    expect(valueFor('updated_at').querySelector('span')).toHaveAttribute('title', normalizedUpdated)
  })

  it('keeps invalid, empty, and non-time values on their existing paths', async () => {
    render(
      <FrontmatterPanel
        data={{
          created_at: 'not-a-date',
          updated_at: '',
          selector: CREATED,
          status: 'READY',
        }}
        timestampKeys={REPORT_TIMESTAMP_KEYS}
      />,
    )

    expect(valueFor('created_at')).toHaveTextContent('not-a-date')
    expect(valueFor('updated_at')).toHaveTextContent('—')
    expect(valueFor('selector')).toHaveTextContent(CREATED)
    expect(valueFor('status')).toHaveTextContent('READY')
  })

  it('does not reformat timestamp fields when the caller does not opt in', () => {
    render(<FrontmatterPanel data={{ created_at: CREATED, updated_at: CREATED }} />)

    expect(valueFor('created_at')).toHaveTextContent(CREATED)
    expect(valueFor('updated_at')).toHaveTextContent(CREATED)
    expect(valueFor('created_at').querySelector('span')).not.toHaveAttribute('title')
  })
})
