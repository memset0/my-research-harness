import {
  BackendResourceInventoryResponseSchema,
  BackendWikiInventoryResponseSchema,
} from '@memon/core'
import type * as ApiModule from '../lib/api'
import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '../test/utils'
import { TabBadge } from './tab-badge'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>()
  return {
    ...actual,
    fetchCodeReviewsInventory: vi.fn(),
    fetchDigestsInventory: vi.fn(),
    fetchExperimentsInventory: vi.fn(),
    fetchReportsInventory: vi.fn(),
    fetchWikiInventory: vi.fn(),
    fetchCodeReviews: vi.fn(),
    fetchDigests: vi.fn(),
    fetchExperimentDocs: vi.fn(),
    fetchReports: vi.fn(),
    fetchWiki: vi.fn(),
  }
})

import {
  fetchCodeReviews,
  fetchCodeReviewsInventory,
  fetchDigests,
  fetchDigestsInventory,
  fetchExperimentDocs,
  fetchExperimentsInventory,
  fetchReports,
  fetchReportsInventory,
  fetchWiki,
  fetchWikiInventory,
} from '../lib/api'

const INVENTORY = BackendResourceInventoryResponseSchema.parse({
  items: [
    { id: 'first', slug: 'first', resource: 'docs/first.md' },
    { id: 'second', slug: 'second', resource: 'docs/second.md' },
  ],
})

describe('TabBadge identity counts', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ['experiments', fetchExperimentsInventory],
    ['reports', fetchReportsInventory],
    ['digests', fetchDigestsInventory],
    ['code-review', fetchCodeReviewsInventory],
  ] as const)('counts the %s inventory', async (kind, fetchInventory) => {
    vi.mocked(fetchInventory).mockResolvedValue(INVENTORY)

    renderWithQuery(
      <span data-testid="count">
        <TabBadge kind={kind} project="project-a" />
      </span>,
    )

    await waitFor(() => {
      expect(within(screen.getByTestId('count')).getByText('2')).toBeInTheDocument()
    })
    expect(fetchInventory).toHaveBeenCalledWith('project-a')
    expect(fetchExperimentDocs).not.toHaveBeenCalled()
    expect(fetchReports).not.toHaveBeenCalled()
    expect(fetchDigests).not.toHaveBeenCalled()
    expect(fetchCodeReviews).not.toHaveBeenCalled()
  })

  it('counts the Wiki inventory without loading Wiki content while inactive', async () => {
    vi.mocked(fetchWikiInventory).mockResolvedValue(
      BackendWikiInventoryResponseSchema.parse({
        pages: [
          { id: 'W0001', resource: 'docs/wiki/W0001.md', legacyId: null },
          { id: 'W0002', resource: 'docs/wiki/W0002.md', legacyId: 'R0002' },
        ],
      }),
    )

    renderWithQuery(
      <span data-testid="wiki-count">
        <TabBadge kind="wiki" project="project-a" />
      </span>,
    )

    await waitFor(() => {
      expect(within(screen.getByTestId('wiki-count')).getByText('2')).toBeInTheDocument()
    })
    expect(fetchWikiInventory).toHaveBeenCalledWith('project-a')
    expect(fetchWiki).not.toHaveBeenCalled()
  })
})
