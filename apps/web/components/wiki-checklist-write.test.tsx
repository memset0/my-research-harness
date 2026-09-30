import { waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { WikiPageDetail, WikiPutResponse } from '../lib/api'
import { renderWithQuery } from '../test/utils'
import { WikiDocumentView } from './wiki-shell'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, fetchWiki: vi.fn(), fetchWikiPage: vi.fn(), putWikiPage: vi.fn() }
})
vi.mock('../lib/use-user-preference-state', () => ({
  useUserPreferenceState: () => [true, vi.fn()],
}))
const session = { owner: true }
vi.mock('./session-provider', () => ({
  useIsOwner: () => session.owner,
  useSession: () => ({ role: session.owner ? 'owner' : 'viewer', scopeProjects: [] }),
}))
vi.mock('./document-artifact-link-provider', () => ({
  DocumentArtifactLinkProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('./body-translation', () => ({
  BodyTranslation: ({ children }: { children: ReactNode }) => <>{children}</>,
  TranslatedLiteral: ({ children }: { children: ReactNode }) => <>{children}</>,
  TranslationText: ({ children }: { children: ReactNode }) => <>{children}</>,
  useBodyTranslation: () => null,
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { ApiError, putWikiPage } from '../lib/api'
import { toast } from 'sonner'

const content = [
  '---',
  'id: W0010',
  'kind: note',
  'title: Plan',
  '---',
  '# Plan',
  '',
  '```yaml checklist@1 #plan',
  'items:',
  '  - title: Parent',
  '    children:',
  '      - title: Child',
  '```',
  '',
].join('\n')

function page(): WikiPageDetail {
  return {
    id: 'W0010',
    slug: 'plan',
    kind: 'note',
    title: 'Plan',
    description: null,
    status: null,
    date: null,
    language: 'en',
    tags: [],
    sources: [],
    legacyId: null,
    entry: null,
    deprecated: null,
    deprecatedSections: [],
    stale: false,
    staleSources: [],
    review: null,
    format: 'markdown',
    path: 'docs/wiki/note/W0010-plan.md',
    project: 'project-a',
    mtime: 1000,
    createdAt: '2026-09-11T09:00:00+00:00',
    updatedAt: '2026-09-11T09:00:00+00:00',
    diagnostics: [],
    content,
    hash: 'a'.repeat(40),
    components: [],
  }
}

describe('wiki checklist writes', () => {
  it('rewrites only the toggled flag through the page write lock and adopts the saved page', async () => {
    session.owner = true
    const saved = { ...page(), mtime: 2000, hash: 'b'.repeat(40) }
    vi.mocked(putWikiPage).mockImplementation(
      async (_project, _id, input): Promise<WikiPutResponse> => {
        saved.content = input.content
        return {
          ok: true,
          mtime: saved.mtime,
          hash: saved.hash,
          page: saved,
          finalContent: input.content,
        }
      },
    )
    const { container } = renderWithQuery(
      <WikiDocumentView project="project-a" page={page()} sourceSurface="full-wiki" />,
    )
    const child = container.querySelector('[data-wiki-checklist-item="1.1"]')!
    const box = child.querySelector(
      '[data-wiki-checklist-field="human_acknowledged"]',
    ) as HTMLElement
    expect(box).not.toHaveAttribute('disabled')
    await userEvent.click(box)
    await waitFor(() => expect(putWikiPage).toHaveBeenCalledTimes(1))
    const call = vi.mocked(putWikiPage).mock.calls[0]!
    expect(call[2].expectedMtime).toBe(1000)
    expect(call[2].expectedHash).toBe('a'.repeat(40))
    expect(call[2].content).toBe(
      content.replace(
        '      - title: Child',
        '      - title: Child\n        status:\n          human_acknowledged: true',
      ),
    )
  })

  it('leaves the checkbox unchanged and offers reload on a conflict', async () => {
    session.owner = true
    vi.mocked(putWikiPage).mockRejectedValue(new ApiError(409, 'CONFLICT', 'CONFLICT'))
    const { container } = renderWithQuery(
      <WikiDocumentView project="project-a" page={page()} sourceSurface="side-wiki" />,
    )
    const box = container.querySelector(
      '[data-wiki-checklist-item="1"] [data-wiki-checklist-field="human_reviewed"]',
    ) as HTMLElement
    await userEvent.click(box)
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(box).toHaveAttribute('data-state', 'unchecked')
    const [, options] = vi.mocked(toast.error).mock.calls.at(-1)!
    expect(options?.action).toMatchObject({ label: 'Reload' })
  })

  it('reports a read-only backend rejection as a failure, not a conflict', async () => {
    session.owner = true
    vi.mocked(putWikiPage).mockRejectedValue(
      new ApiError(
        409,
        'Backend does not support required capability mutations',
        'UNSUPPORTED_CAPABILITY',
      ),
    )
    const { container } = renderWithQuery(
      <WikiDocumentView project="project-a" page={page()} sourceSurface="full-wiki" />,
    )
    const box = container.querySelector(
      '[data-wiki-checklist-item="1"] [data-wiki-checklist-field="agent_completed"]',
    ) as HTMLElement
    await userEvent.click(box)
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    const [message, options] = vi.mocked(toast.error).mock.calls.at(-1)!
    expect(message).toContain('required capability mutations')
    expect(options?.action).toBeUndefined()
    expect(box).toHaveAttribute('data-state', 'unchecked')
  })

  it('disables every control for a viewer', () => {
    session.owner = false
    const { container } = renderWithQuery(
      <WikiDocumentView project="project-a" page={page()} sourceSurface="full-wiki" />,
    )
    const boxes = container.querySelectorAll('[data-wiki-checklist-field]')
    expect(boxes.length).toBe(6)
    expect(Array.from(boxes).every((box) => box.hasAttribute('disabled'))).toBe(true)
  })
})
