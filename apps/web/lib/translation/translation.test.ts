// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { createTranslationManifest } from './manifest'
import {
  literalSegment,
  packSegments,
  reconstructTranslation,
  segmentMarkdownTree,
} from './segments'
import { sourceRevision, translationSources } from './sources'
import { BodyTranslationService, validateTranslations } from './service'
import { TranslationError, isolatedTranslationConfig, translationEnvironment } from './codex'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
const segment = (text = 'Hello world') => literalSegment(text)!
const echo = async (prompt: string) =>
  JSON.stringify(JSON.parse(prompt.slice(prompt.indexOf('\n') + 1)))

describe('body manifest', () => {
  it('matches client IDs and preserves prose boundaries while excluding opaque content', async () => {
    const text =
      '# Heading\n\nHello **strong** [link][ref] `code` $x+1$ 42 E0001-test.\n\n- First item\n  - Nested item\n\n| Label | Metric |\n|---|---|\n| Some prose | 12 |\n\n```js\nignored()\n```\n\n<div>HTML only</div>\n\n[ref]: https://example.com/path\n'
    const sources = [{ format: 'markdown' as const, text }]
    const manifest = createTranslationManifest(sources)
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath)
    const tree = processor.runSync(processor.parse(text))
    expect(segmentMarkdownTree(tree, text, true)).toEqual(manifest.segments)
    expect(manifest.revision).toBe(await sourceRevision(sources))
    expect(manifest.segments).toHaveLength(7)
    expect(manifest.segments.map((item) => item.text).join(' ')).not.toMatch(
      /ignored|HTML only|https:|E0001|42/,
    )
    expect(reconstructTranslation(manifest.segments[1]!, manifest.segments[1]!.text)).toContain(
      '](<https://example.com/path>)',
    )
  })

  it('extracts normalized authored prose, not metadata, runs, metrics or diagnostics', () => {
    const sources = translationSources('experiment', {
      frontMatter: { title: 'Secret metadata' },
      memberRuns: [{ body: 'Run body' }],
      documentSections: [
        { heading: 'Motivation', source: 'readme', body: 'Useful prose' },
        { heading: 'Implementation', source: 'yaml' },
        { heading: 'Results', source: 'yaml' },
      ],
      documents: {
        implementation: {
          data: {
            items: [
              {
                title: 'Task title',
                description: 'Task prose',
                acceptanceCriteria: ['Criterion'],
                children: [{ title: 'Nested title' }],
              },
            ],
          },
        },
        results: {
          data: {
            variants: [
              { name: 'Baseline method', description: 'Invisible', metrics: { score: 0.9 } },
            ],
            columnAnnotations: {
              score: { description: 'Score prose', valueDescriptions: { high: 'High prose' } },
            },
          },
        },
      },
    })
    expect(sources.map((source) => source.text)).toEqual([
      'Motivation',
      'Useful prose',
      'Implementation',
      'Results',
      'Task title',
      'Task prose',
      'Criterion',
      'Nested title',
      'Score prose',
      'High prose',
      'Baseline method',
    ])
    expect(translationSources('wiki', { content: '---\ntitle: Metadata\n---\nBody text' })).toEqual(
      [{ format: 'markdown', text: 'Body text' }],
    )
    expect(
      createTranslationManifest(
        translationSources('report', { content: '<iframe src="https://example.com"></iframe>' }),
      ).segments,
    ).toEqual([])
  })

  it('protects formatting and rejects broken or forged placeholders', () => {
    const manifest = createTranslationManifest([
      {
        format: 'markdown',
        text: 'A **bold [link](https://example.com)** with `code` and $math$.',
      },
    ])
    const item = manifest.segments[0]!
    expect(reconstructTranslation(item, item.text)).toContain(
      '**bold [link](<https://example.com>)**',
    )
    expect(reconstructTranslation(item, item.text.replace('[[0]]', ''))).toBeNull()
    expect(reconstructTranslation(item, item.text + '[[0]]')).toBeNull()
    expect(reconstructTranslation(item, item.text.replace('[[/1]]', '[[/0]]'))).toBeNull()
    expect(
      reconstructTranslation(segment(), '<script>alert(1)</script> [x](javascript:evil)'),
    ).not.toContain('<script>')
    expect(
      validateTranslations(
        [item],
        JSON.stringify([
          { id: item.id, text: item.text },
          { id: item.id, text: item.text },
        ]),
      )[0]?.code,
    ).toBe('INVALID_RESULT')
    expect(validateTranslations([item], '[]')[0]?.code).toBe('INVALID_RESULT')
  })

  it('enforces UTF-8 serialized limits even for the first item', () => {
    const packed = packSegments(
      Array.from({ length: 25 }, (_, index) => segment(`Paragraph ${index}`)),
    )
    expect(packed.batches.map((batch) => batch.length)).toEqual([24, 1])
    expect(packSegments([segment('English ' + '界'.repeat(5000))]).oversized).toHaveLength(1)
    const long = createTranslationManifest([
      {
        format: 'markdown',
        text: 'A **protected phrase** with `code` and simple words. '.repeat(500),
      },
    ]).segments
    expect(long.length).toBeGreaterThan(1)
    expect(packSegments(long).oversized).toEqual([])
    for (const part of long) expect(reconstructTranslation(part, part.text)).not.toBeNull()
  })

  it('includes only a valid component caption, not its description or raw payload', () => {
    const manifest = createTranslationManifest([
      {
        format: 'markdown',
        text: '```yaml figure@1 #example\nimage: assets/example.svg\ncaption: Visible figure caption\ndescription: Agent-only visual description\n```',
      },
    ])
    expect(manifest.segments.map((item) => item.text)).toEqual(['Visible figure caption'])
    expect(
      createTranslationManifest([
        { format: 'markdown', text: '```yaml figure@1 #bad\nimage: x.svg\n```' },
      ]).segments,
    ).toEqual([])
  })
})

describe('queue and cache', () => {
  it('runs at most two batches and starts queued work after a slot is released', async () => {
    vi.useFakeTimers()
    const finish: Array<() => void> = []
    const invoke = vi.fn(
      (prompt: string) =>
        new Promise<string>((resolve) => {
          finish.push(() => {
            void echo(prompt).then(resolve)
          })
        }),
    )
    const service = new BodyTranslationService(invoke)
    const requests = ['first', 'second', 'third'].map((identity) =>
      service.translate(identity, 'zh-CN', [segment()], new AbortController().signal),
    )
    await vi.advanceTimersByTimeAsync(1000)
    expect(invoke).toHaveBeenCalledTimes(2)
    finish[0]!()
    await vi.advanceTimersByTimeAsync(150)
    expect(invoke).toHaveBeenCalledTimes(3)
    finish[1]!()
    finish[2]!()
    await Promise.all(requests)
  })

  it('evicts old entries by entry count and serialized cache bytes', async () => {
    vi.useFakeTimers()
    const invoke = vi.fn(echo)
    const service = new BodyTranslationService(invoke)
    for (let offset = 0; offset < 2016; offset += 24) {
      const request = service.translate(
        'same',
        'zh-CN',
        Array.from({ length: 24 }, (_, index) => segment(`Prose ${offset + index}`)),
        new AbortController().signal,
      )
      await vi.advanceTimersByTimeAsync(150)
      await request
    }
    const before = invoke.mock.calls.length
    const evicted = service.translate(
      'same',
      'zh-CN',
      [segment('Prose 0')],
      new AbortController().signal,
    )
    await vi.advanceTimersByTimeAsync(150)
    await evicted
    expect(invoke.mock.calls.length).toBe(before + 1)
    const large = vi.fn(async (prompt: string) =>
      JSON.stringify(
        JSON.parse(prompt.slice(prompt.indexOf('\n') + 1)).map(
          (item: { id: string; text: string }) => ({
            id: item.id,
            text: '中'.repeat(10000) + (item.text.match(/\[\[\/?\d+\]\]/g) ?? []).join(''),
          }),
        ),
      ),
    )
    const bytes = new BodyTranslationService(large)
    for (let offset = 0; offset < 600; offset += 6) {
      const request = bytes.translate(
        'same',
        'zh-CN',
        Array.from({ length: 6 }, (_, index) => segment(`Prose ${offset + index}`)),
        new AbortController().signal,
      )
      await vi.advanceTimersByTimeAsync(150)
      await request
    }
    const cached = await bytes.translate(
      'same',
      'zh-CN',
      [segment('Prose 599')],
      new AbortController().signal,
    )
    expect(cached[0]?.text).toContain('中')
    expect(large).toHaveBeenCalledTimes(100)
    const byteEvicted = bytes.translate(
      'same',
      'zh-CN',
      [segment('Prose 0')],
      new AbortController().signal,
    )
    await vi.advanceTimersByTimeAsync(150)
    await byteEvicted
    expect(large).toHaveBeenCalledTimes(101)
  })

  it('keeps partial successes and correlates out-of-order output', () => {
    const first = segment('First paragraph')
    const second = segment('Second paragraph')
    const third = segment('Third paragraph')
    const results = validateTranslations(
      [first, second, third],
      JSON.stringify([
        { id: second.id, text: '第二段' },
        { id: first.id, text: '第一段' },
        { id: 'unknown', text: '无效' },
      ]),
    )
    expect(results.map((result) => result.text ?? result.code)).toEqual([
      '第一段',
      '第二段',
      'INVALID_RESULT',
    ])
  })

  it('retries transient exits once and discards queued cancellations before inference', async () => {
    vi.useFakeTimers()
    const invoke = vi.fn(echo).mockRejectedValueOnce(new TranslationError('PROVIDER_EXIT'))
    const service = new BodyTranslationService(invoke)
    const request = service.translate('same', 'zh-CN', [segment()], new AbortController().signal)
    await vi.runAllTimersAsync()
    expect((await request)[0]?.text).toBe('Hello world')
    expect(invoke).toHaveBeenCalledTimes(2)
    const controller = new AbortController()
    const abandoned = service
      .translate('other', 'zh-CN', [segment()], controller.signal)
      .catch((error) => error.code)
    controller.abort()
    expect(await abandoned).toBe('CANCELLED')
    await vi.runAllTimersAsync()
    expect(invoke).toHaveBeenCalledTimes(2)
  })
  it('coalesces subscribers and caches only under exact identity', async () => {
    vi.useFakeTimers()
    const invoke = vi.fn(echo)
    const service = new BodyTranslationService(invoke)
    const first = service.translate(
      'project-a/revision-a',
      'zh-CN',
      [segment()],
      new AbortController().signal,
    )
    const second = service.translate(
      'project-a/revision-a',
      'zh-CN',
      [segment()],
      new AbortController().signal,
    )
    await vi.advanceTimersByTimeAsync(150)
    expect(await first).toEqual(await second)
    await service.translate(
      'project-a/revision-a',
      'zh-CN',
      [segment()],
      new AbortController().signal,
    )
    expect(invoke).toHaveBeenCalledTimes(1)
    const changed = service.translate(
      'project-a/revision-b',
      'zh-CN',
      [segment()],
      new AbortController().signal,
    )
    await vi.advanceTimersByTimeAsync(150)
    await changed
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('keeps shared work alive and aborts when its last subscriber leaves', async () => {
    vi.useFakeTimers()
    let activeSignal!: AbortSignal
    const service = new BodyTranslationService((_prompt, signal) => {
      activeSignal = signal
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new TranslationError('CANCELLED'))),
      )
    })
    const first = new AbortController()
    const second = new AbortController()
    const one = service
      .translate('same', 'zh-CN', [segment()], first.signal)
      .catch((error) => error.code)
    const two = service
      .translate('same', 'zh-CN', [segment()], second.signal)
      .catch((error) => error.code)
    await vi.advanceTimersByTimeAsync(150)
    first.abort()
    expect(await one).toBe('CANCELLED')
    expect(activeSignal.aborted).toBe(false)
    second.abort()
    expect(await two).toBe('CANCELLED')
    expect(activeSignal.aborted).toBe(true)
    await vi.runAllTimersAsync()
  })

  it('expires cache and does not retry terminal quota failures', async () => {
    vi.useFakeTimers()
    let now = 0
    const invoke = vi.fn(echo)
    const service = new BodyTranslationService(invoke, () => now)
    const pending = service.translate('same', 'zh-CN', [segment()], new AbortController().signal)
    await vi.advanceTimersByTimeAsync(150)
    await pending
    now = 1_800_001
    invoke.mockRejectedValueOnce(new TranslationError('QUOTA_EXHAUSTED'))
    const expired = service.translate('same', 'zh-CN', [segment()], new AbortController().signal)
    await vi.advanceTimersByTimeAsync(150)
    expect((await expired)[0]?.code).toBe('QUOTA_EXHAUSTED')
    await expect(
      service.translate('other', 'zh-CN', [segment()], new AbortController().signal),
    ).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' })
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('bounds queued batches', async () => {
    vi.useFakeTimers()
    const service = new BodyTranslationService(echo)
    const requests = Array.from({ length: 32 }, (_, index) =>
      service.translate(`doc-${index}`, 'zh-CN', [segment()], new AbortController().signal),
    )
    await expect(
      service.translate('overflow', 'zh-CN', [segment()], new AbortController().signal),
    ).rejects.toMatchObject({ code: 'QUEUE_FULL' })
    await vi.runAllTimersAsync()
    await Promise.all(requests)
  })
})

it('strips API overrides and disables discovery and tool paths', () => {
  vi.stubEnv('OPENAI_API_KEY', 'fixture-only')
  expect(translationEnvironment().OPENAI_API_KEY).toBeUndefined()
  const config = isolatedTranslationConfig(
    'shell_tool stable true\napps stable true\nold removed true',
    { mcp_servers: { example: {} }, plugins: { example: {} } },
  )
  expect(config.features).toEqual({
    shell_tool: false,
    apps: false,
    skip_host_skill_discovery: true,
  })
  expect(config.orchestrator).toEqual({ skills: { enabled: false }, mcp: { enabled: false } })
  expect(config.mcp_servers.example).toEqual({ enabled: false })
  expect(config.project_doc_max_bytes).toBe(0)
})
