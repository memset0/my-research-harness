import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'

import { Markdown } from './markdown'
import { isGithubBlobPermalink } from './github-permalink-preview'
import { renderWithQuery } from '../test/utils'

describe('isGithubBlobPermalink', () => {
  it('accepts single-line and range blob permalinks', () => {
    expect(isGithubBlobPermalink('https://github.com/acme/demo/blob/abc123/src/foo.ts#L10')).toBe(
      true,
    )
    expect(isGithubBlobPermalink('https://github.com/acme/demo/blob/abc123/src/foo.ts#L5-L8')).toBe(
      true,
    )
  })

  it('accepts a permalink carrying a ?plain=1 query (core strips it server-side)', () => {
    expect(
      isGithubBlobPermalink('https://github.com/acme/demo/blob/abc123/src/foo.md?plain=1#L3'),
    ).toBe(true)
  })

  it('rejects non-line, non-blob, and non-github links', () => {
    // no #L anchor
    expect(isGithubBlobPermalink('https://github.com/acme/demo/blob/abc123/src/foo.ts')).toBe(false)
    // tree, not blob
    expect(isGithubBlobPermalink('https://github.com/acme/demo/tree/main/src#L1')).toBe(false)
    // not github
    expect(isGithubBlobPermalink('https://gitlab.com/a/b/blob/s/f.ts#L1')).toBe(false)
    // ordinary url
    expect(isGithubBlobPermalink('https://example.com/whatever')).toBe(false)
  })
})

describe('<Markdown> link handling', () => {
  const PERMALINK = 'https://github.com/acme/demo/blob/abc123/src/foo.ts#L10'

  it('routes a GitHub permalink through the hover-preview trigger when project is set', () => {
    const { container } = renderWithQuery(
      <Markdown project="project-a">{`See [foo](${PERMALINK}).`}</Markdown>,
    )
    const trigger = container.querySelector('a[data-slot="hover-card-trigger"]')
    expect(trigger).not.toBeNull()
    expect(trigger?.getAttribute('href')).toBe(PERMALINK)
  })

  it('renders a plain external anchor for a permalink when no project is set', () => {
    const { container } = render(<Markdown>{`See [foo](${PERMALINK}).`}</Markdown>)
    expect(container.querySelector('a[data-slot="hover-card-trigger"]')).toBeNull()
    const a = container.querySelector(`a[href="${PERMALINK}"]`)
    expect(a).not.toBeNull()
    expect(a?.getAttribute('target')).toBe('_blank')
    expect(a?.getAttribute('rel')).toContain('noreferrer')
  })

  it('does not wrap an ordinary (non-permalink) link even when project is set', () => {
    const { container } = renderWithQuery(
      <Markdown project="project-a">{`See [home](https://example.com).`}</Markdown>,
    )
    expect(container.querySelector('a[data-slot="hover-card-trigger"]')).toBeNull()
    expect(container.querySelector('a[href="https://example.com"]')).not.toBeNull()
  })
})
