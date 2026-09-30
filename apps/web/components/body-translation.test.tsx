import { webcrypto } from 'node:crypto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createTranslationManifest } from '../lib/translation/manifest'
import { BodyTranslation } from './body-translation'
import { Markdown } from './markdown'
import { SessionProvider } from './session-provider'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
const text =
  '# Body heading\n\nHello **world** with `code`.\n\n- List prose\n\n| Label |\n|---|\n| Table prose |\n\n## Findings\n\nMore evidence.'
const sources = [{ format: 'markdown' as const, text }]
const manifest = createTranslationManifest(sources)
function setup(role: 'owner' | 'viewer' = 'owner', sourceLanguage: 'en' | 'zh' = 'en') {
  vi.stubGlobal('crypto', webcrypto)
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes('/status')) return Response.json({ ready: true })
    if (!options?.method) return Response.json(manifest)
    const body = JSON.parse(String(options.body))
    return Response.json({
      revision: manifest.revision,
      results: body.segments.map((item: { id: string }) => {
        const segment = manifest.segments.find((entry) => entry.id === item.id)!
        return { ...segment, text: segment.text.replace(/[A-Za-z]+/g, '译文') }
      }),
    })
  })
  vi.stubGlobal('fetch', fetcher)
  const element = (body = text) => (
    <SessionProvider value={{ role, scopeProjects: [] }}>
      <BodyTranslation
        document={{ project: 'project-a', kind: 'wiki', id: 'W0001' }}
        sources={[{ format: 'markdown', text: body }]}
        sourceLanguage={sourceLanguage}
      >
        <Markdown tableOfContents={{ headingIdPrefix: 'fixture' }}>{body}</Markdown>
      </BodyTranslation>
    </SessionProvider>
  )
  return { ...render(element()), fetcher, element }
}

it('translates React-owned headings, paragraphs, lists and tables; restores originals', async () => {
  const { container, fetcher } = setup()
  const button = screen.getByRole('button', { name: 'Translate to Chinese' })
  await waitFor(() => expect(button).not.toBeDisabled())
  expect(fetcher).toHaveBeenCalledTimes(1)
  fireEvent.click(button)
  await waitFor(() =>
    expect(container.querySelectorAll('[data-slot="body-translation"]')).toHaveLength(
      manifest.segments.length,
    ),
  )
  expect(container.querySelector('h1 [lang="zh-CN"]')).toBeTruthy()
  expect(container.querySelector('li [lang="zh-CN"]')).toBeTruthy()
  expect(container.querySelector('td [lang="zh-CN"]')).toBeTruthy()
  expect(container.querySelectorAll('code')).toHaveLength(2)
  expect(container.querySelector('[lang="zh-CN"] script')).toBeNull()
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Processed'))
  fireEvent.click(screen.getByRole('button', { name: 'Show original' }))
  expect(container.querySelector('[data-slot="body-translation"]')).toBeNull()
  expect(screen.getByText('Body heading')).toBeInTheDocument()
  const requests = fetcher.mock.calls.length
  fireEvent.click(button)
  expect(container.querySelectorAll('[data-slot="body-translation"]')).toHaveLength(
    manifest.segments.length,
  )
  expect(fetcher).toHaveBeenCalledTimes(requests)
  expect(button).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText('Alt+T toggles translation / original')).toBeInTheDocument()
})

it('offers English for a Chinese page and asks the server for that direction', async () => {
  const { container, fetcher } = setup('owner', 'zh')
  const button = screen.getByRole('button', { name: 'Translate to English' })
  await waitFor(() => expect(button).not.toBeDisabled())
  fireEvent.click(button)
  await waitFor(() =>
    expect(container.querySelectorAll('[data-slot="body-translation"]')).toHaveLength(
      manifest.segments.length,
    ),
  )
  expect(container.querySelector('h1 [lang="en"][data-slot="body-translation"]')).toBeTruthy()
  expect(container.querySelector('[lang="zh-CN"]')).toBeNull()
  expect(
    container.querySelector('[data-slot="body-translation"]')?.getAttribute('aria-label'),
  ).toBe('Machine translation')
  const [manifestUrl] = fetcher.mock.calls.find(
    ([url, options]) => !options?.method && !url.includes('/status'),
  )!
  expect(String(manifestUrl)).toContain('targetLanguage=en')
  const posted = fetcher.mock.calls.filter(([, options]) => options?.method === 'POST')
  expect(posted).toHaveLength(1)
  expect(JSON.parse(String(posted[0]![1]!.body)).targetLanguage).toBe('en')
})

it('toggles with Alt+T and ignores editors, dialogs and repeated keys', async () => {
  const { container, fetcher } = setup()
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Translate to Chinese' })).not.toBeDisabled(),
  )
  const key = { key: 't', code: 'KeyT', altKey: true }
  fireEvent.keyDown(window, { ...key, repeat: true })
  fireEvent.keyDown(window, { ...key, isComposing: true })
  fireEvent.keyDown(window, { ...key, ctrlKey: true })
  const editor = document.createElement('textarea')
  container.append(editor)
  fireEvent.keyDown(editor, key)
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  container.append(dialog)
  fireEvent.keyDown(window, key)
  expect(fetcher).toHaveBeenCalledTimes(1)
  editor.remove()
  dialog.remove()
  fireEvent.keyDown(window, key)
  await waitFor(() =>
    expect(container.querySelector('[data-slot="body-translation"]')).toBeTruthy(),
  )
  fireEvent.keyDown(window, key)
  expect(container.querySelector('[data-slot="body-translation"]')).toBeNull()
})

it('cancels pending work via Alt+T and ignores its late response', async () => {
  const { container, fetcher } = setup()
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Translate to Chinese' })).not.toBeDisabled(),
  )
  let finish!: (response: Response) => void
  let signal!: AbortSignal
  fetcher.mockImplementationOnce(async () => Response.json(manifest))
  fetcher.mockImplementationOnce((_url, options) => {
    signal = options!.signal!
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  fireEvent.keyDown(window, { key: 't', altKey: true })
  await waitFor(() => expect(finish).toBeDefined())
  fireEvent.keyDown(window, { key: 't', altKey: true })
  expect(signal.aborted).toBe(true)
  finish(Response.json({ revision: manifest.revision, results: [] }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Show original' })).toBeNull())
  expect(container.querySelector('[data-slot="body-translation"]')).toBeNull()
})

it('handles Alt+T despite hidden dialogs and bubbling event handlers', async () => {
  const { container } = setup()
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Translate to Chinese' })).not.toBeDisabled(),
  )
  const hiddenDialog = document.createElement('div')
  hiddenDialog.setAttribute('role', 'dialog')
  hiddenDialog.style.display = 'none'
  container.append(hiddenDialog)
  const heading = container.querySelector('h1')!
  heading.addEventListener('keydown', (event) => event.stopPropagation())
  fireEvent.keyDown(heading, { key: 't', altKey: true })
  await waitFor(() =>
    expect(container.querySelector('[data-slot="body-translation"]')).toBeTruthy(),
  )
})

it('handles Alt+T for only the most recently interacted-with body', async () => {
  const first = setup()
  const second = setup()
  await waitFor(() =>
    screen.getAllByRole('button', { name: 'Translate to Chinese' }).forEach((button) => {
      expect(button).not.toBeDisabled()
    }),
  )
  fireEvent.pointerDown(second.container.querySelector('h1')!)
  fireEvent.keyDown(window, { key: 't', code: 'KeyT', altKey: true })
  await waitFor(() =>
    expect(second.container.querySelector('[data-slot="body-translation"]')).toBeTruthy(),
  )
  expect(first.container.querySelector('[data-slot="body-translation"]')).toBeNull()
  fireEvent.keyDown(window, { key: 't', code: 'KeyT', altKey: true })
  expect(second.container.querySelector('[data-slot="body-translation"]')).toBeNull()
})

it('targets a visible reading dialog rather than the obscured background body', async () => {
  const first = setup()
  const second = setup()
  second.container.setAttribute('role', 'dialog')
  await waitFor(() =>
    screen.getAllByRole('button', { name: 'Translate to Chinese' }).forEach((button) => {
      expect(button).not.toBeDisabled()
    }),
  )
  fireEvent.pointerDown(first.container.querySelector('h1')!)
  fireEvent.keyDown(window, { key: 't', altKey: true })
  await waitFor(() =>
    expect(second.container.querySelector('[data-slot="body-translation"]')).toBeTruthy(),
  )
  expect(first.container.querySelector('[data-slot="body-translation"]')).toBeNull()
})

it('skips a hidden previously selected reading root', async () => {
  const first = setup()
  const second = setup()
  await waitFor(() =>
    screen.getAllByRole('button', { name: 'Translate to Chinese' }).forEach((button) => {
      expect(button).not.toBeDisabled()
    }),
  )
  fireEvent.pointerDown(first.container.querySelector('h1')!)
  first.container.style.display = 'none'
  fireEvent.keyDown(window, { key: 't', altKey: true })
  await waitFor(() =>
    expect(second.container.querySelector('[data-slot="body-translation"]')).toBeTruthy(),
  )
  expect(first.container.querySelector('[data-slot="body-translation"]')).toBeNull()
})

it('does not offer or request translation for viewers', () => {
  const { fetcher } = setup('viewer')
  expect(screen.queryByRole('button')).toBeNull()
  expect(fetcher).not.toHaveBeenCalled()
})

it('renders a fully cached manifest without any translation POST', async () => {
  const { container, fetcher } = setup()
  const button = screen.getByRole('button', { name: 'Translate to Chinese' })
  await waitFor(() => expect(button).not.toBeDisabled())
  fetcher.mockImplementationOnce(async () =>
    Response.json({
      ...manifest,
      cachedResults: manifest.segments.map(({ id, sourceHash, text }) => ({
        id,
        sourceHash,
        text,
      })),
    }),
  )
  fireEvent.click(button)
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Processed'))
  expect(container.querySelectorAll('[data-slot="body-translation"]')).toHaveLength(
    manifest.segments.length,
  )
  expect(fetcher).toHaveBeenCalledTimes(2)
  fireEvent.click(button)
  fireEvent.click(button)
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('does not wait for Codex readiness before reading cached translations', async () => {
  vi.stubGlobal('crypto', webcrypto)
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes('/status')) return new Promise<Response>(() => undefined)
    return Response.json({ ...manifest, cachedResults: manifest.segments })
  })
  vi.stubGlobal('fetch', fetcher)
  const { container } = render(
    <SessionProvider value={{ role: 'owner', scopeProjects: [] }}>
      <BodyTranslation
        document={{ project: 'project-a', kind: 'wiki', id: 'W0001' }}
        sources={sources}
      >
        <Markdown>{text}</Markdown>
      </BodyTranslation>
    </SessionProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Translate to Chinese' }))
  await waitFor(() =>
    expect(container.querySelectorAll('[data-slot="body-translation"]')).toHaveLength(
      manifest.segments.length,
    ),
  )
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('aborts sibling packs and clears cached results when a revision becomes stale', async () => {
  const { container, fetcher, rerender, element } = setup()
  const large = Array.from(
    { length: 30 },
    (_, index) => `Paragraph ${index} describes evidence.`,
  ).join('\n\n')
  const body = createTranslationManifest([{ format: 'markdown', text: large }])
  const pending: Array<{ signal: AbortSignal; resolve: (response: Response) => void }> = []
  fetcher.mockImplementation(async (_url, options) => {
    if (!options?.method) return Response.json({ ...body, cachedResults: [body.segments[0]] })
    return new Promise((resolve) => pending.push({ signal: options.signal!, resolve }))
  })
  rerender(element(large))
  fireEvent.click(screen.getByRole('button', { name: 'Translate to Chinese' }))
  await waitFor(() => expect(pending).toHaveLength(2))
  expect(container.querySelectorAll('[data-slot="body-translation"]')).toHaveLength(1)
  pending[0]!.resolve(Response.json({ error: { code: 'SOURCE_CHANGED' } }, { status: 409 }))
  await waitFor(() => expect(pending.every((pack) => pack.signal.aborted)).toBe(true))
  expect(container.querySelector('[data-slot="body-translation"]')).toBeNull()
  pending[1]!.resolve(Response.json({ revision: body.revision, results: body.segments }))
  await waitFor(() => expect(container.querySelector('[data-slot="body-translation"]')).toBeNull())
})

it('submits all missing packs together and shows cache hits and independent completions', async () => {
  const { container, fetcher, rerender, element } = setup()
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Translate to Chinese' })).not.toBeDisabled(),
  )
  const large = Array.from(
    { length: 50 },
    (_, index) => `Paragraph ${index} contains useful evidence.`,
  ).join('\n\n')
  const body = createTranslationManifest([{ format: 'markdown', text: large }])
  const cached = body.segments[0]!
  const pending: Array<{ segments: typeof body.segments; resolve: (response: Response) => void }> =
    []
  fetcher.mockImplementation(async (_url, options) => {
    if (!options?.method) return Response.json({ ...body, cachedResults: [cached] })
    const requested = JSON.parse(String(options.body)).segments as typeof body.segments
    return new Promise((resolve) => pending.push({ segments: requested, resolve }))
  })
  rerender(element(large))
  fireEvent.click(screen.getByRole('button', { name: 'Translate to Chinese' }))
  await waitFor(() => expect(pending).toHaveLength(3))
  expect(container.querySelectorAll('[data-slot="body-translation"]')).toHaveLength(1)
  expect(pending.flatMap((pack) => pack.segments).some((segment) => segment.id === cached.id)).toBe(
    false,
  )
  const reply = (index: number) =>
    pending[index]!.resolve(
      Response.json({
        revision: body.revision,
        results: pending[index]!.segments.map((requested) =>
          body.segments.find((segment) => segment.id === requested.id),
        ),
      }),
    )
  reply(2)
  await waitFor(() =>
    expect(container.querySelectorAll('[data-slot="body-translation"]')).toHaveLength(2),
  )
  pending[0]!.resolve(Response.json({ error: { code: 'QUEUE_FULL' } }, { status: 429 }))
  reply(1)
  await waitFor(() =>
    expect(
      container.querySelector('[data-slot="body-translation-controls"] [role="status"]'),
    ).toHaveTextContent('Processed 50/50 segments'),
  )
  expect(
    container.querySelector('[data-slot="body-translation-controls"] [role="status"]'),
  ).toHaveTextContent('24 failed')
  expect(container.querySelectorAll('[data-slot="body-translation"]')).toHaveLength(26)
})

it('keeps the generated outline and heading anchors free of translation markers', async () => {
  const { container } = setup()
  const outline = screen.getByRole('navigation', { name: 'Table of contents' })
  expect(outline.textContent).not.toMatch(/span|data-memon-translation/)
  const link = outline.querySelector('a')!
  expect(link.textContent).toBe('Findings')
  expect(link.getAttribute('href')).toBe('#fixture-findings')
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Translate to Chinese' })).not.toBeDisabled(),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Translate to Chinese' }))
  await waitFor(() =>
    expect(container.querySelector('[data-slot="body-translation"]')).toBeTruthy(),
  )
  expect(outline.querySelector('[data-slot="body-translation"]')).toBeNull()
  expect(link.textContent).toBe('Findings')
  expect(container.querySelector('h2')?.id).toBe('fixture-findings')
})

it('does not render generated HTML or new explicit/automatic link destinations', async () => {
  const { container, fetcher } = setup()
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Translate to Chinese' })).not.toBeDisabled(),
  )
  fetcher.mockImplementationOnce(async () => Response.json(manifest))
  fetcher.mockImplementationOnce(async () =>
    Response.json({
      revision: manifest.revision,
      results: manifest.segments.map((segment) => ({
        ...segment,
        text:
          segment.text +
          ' <script>alert(1)</script> https://example.com/new [click](https://example.com/other)',
      })),
    }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Translate to Chinese' }))
  await waitFor(() =>
    expect(container.querySelector('[data-slot="body-translation"]')).toBeTruthy(),
  )
  expect(container.querySelector('[data-slot="body-translation"] a')).toBeNull()
  expect(container.querySelector('script')).toBeNull()
})

it('clears results on source refresh without automatically retranslating', async () => {
  const { container, rerender, element, fetcher } = setup()
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Translate to Chinese' })).not.toBeDisabled(),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Translate to Chinese' }))
  await waitFor(() =>
    expect(container.querySelector('[data-slot="body-translation"]')).toBeTruthy(),
  )
  const calls = fetcher.mock.calls.length
  rerender(element('Changed body'))
  expect(container.querySelector('[data-slot="body-translation"]')).toBeNull()
  expect(fetcher).toHaveBeenCalledTimes(calls)
})

it('ignores late results after a source update and stops on edit', async () => {
  const { container, rerender, element, fetcher } = setup()
  let finish!: (response: Response) => void
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Translate to Chinese' })).not.toBeDisabled(),
  )
  fetcher.mockImplementationOnce(async () => Response.json(manifest))
  fetcher.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Translate to Chinese' }))
  await waitFor(() => expect(finish).toBeDefined())
  rerender(element('Changed body'))
  finish(Response.json({ revision: manifest.revision, results: [] }))
  await waitFor(() => expect(container.querySelector('[data-slot="body-translation"]')).toBeNull())
  fireEvent(window, new Event('memon-translation-stop'))
  expect(screen.queryByRole('button', { name: 'Show original' })).toBeNull()
})
