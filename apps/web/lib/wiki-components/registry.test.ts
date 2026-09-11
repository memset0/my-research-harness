// @vitest-environment node

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseMemonDataFile } from './memon-data@1'
import { scanFencedBlocks } from './fence'
import { parseWikiComponentInfoString } from './parse-info-string'
import {
  createWikiComponentRegistry,
  describeComponent,
  findComponent,
  lintComponents,
  listComponentBlocks,
  listComponents,
  listDataProvenance,
  migrateComponents,
  resolveComponent,
} from './registry'
import type { WikiComponentDescriptor } from './types'
import { z } from 'zod'

const REPO_ROOT = join(__dirname, '..', '..', '..', '..')
const COMPONENT_DIR = __dirname

function block(...lines: string[]): string {
  return lines.join('\n')
}

const VALID_INLINE = block(
  '```memon-data@1 title="FID by preconditioning"',
  'script: python3 scripts/collect_fid.py --exp E0004',
  'captured_at: 2026-05-04T13:00:00+08:00',
  'captured_commit: 9f2c4e1a7b3d5f6081a2c3d4e5f60718293a4b5c',
  'sources: [E0004]',
  'columns: [precond, fid]',
  'rows:',
  '  - [karras, 8.91]',
  '  - [edm2, 8.74]',
  '```',
)

describe('info string parsing', () => {
  it('splits the component, its pinned version, and quoted attributes', () => {
    expect(parseWikiComponentInfoString('html-embed@1 height=280 title="Interactive FID curve"'))
      .toEqual({
        name: 'html-embed',
        pinnedVersion: 1,
        malformedVersion: false,
        attributes: { height: '280', title: 'Interactive FID curve' },
        bareTokens: [],
      })
  })

  it('marks a non-numeric version as malformed and keeps non key=value tokens', () => {
    const parsed = parseWikiComponentInfoString('memon-data@next legacy')
    expect(parsed).toMatchObject({
      name: 'memon-data',
      pinnedVersion: null,
      malformedVersion: true,
      bareTokens: ['legacy'],
    })
  })

  it('returns null when there is no leading identifier', () => {
    expect(parseWikiComponentInfoString('')).toBeNull()
    expect(parseWikiComponentInfoString('{.language-ts}')).toBeNull()
  })
})

describe('fenced block scanning', () => {
  it('does not treat a fenced example of a block as a block', () => {
    const blocks = scanFencedBlocks(
      block('````markdown', '```memon-data@1', 'script: x', '```', '````'),
    )
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.info).toBe('markdown')
  })

  it('strips the opening indentation from an indented block', () => {
    const blocks = scanFencedBlocks(block('  ```html-embed@1', '  <div>a</div>', '  ```'))
    expect(blocks[0]?.payload).toBe('<div>a</div>')
    expect(blocks[0]?.indent).toBe('  ')
  })
})

describe('registry resolution', () => {
  it('ships the registered data, HTML, figure, and checklist components', () => {
    expect(listComponents().map((entry) => `${entry.name}@${entry.version}`).sort()).toEqual([
      'checklist@1',
      'figure@1',
      'html-embed@1',
      'memon-data@1',
    ])
  })

  it('registers every versioned descriptor directory', () => {
    const directories = readdirSync(COMPONENT_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /@\d+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort()
    expect(directories).toEqual(
      listComponents()
        .map((entry) => `${entry.name}@${entry.version}`)
        .sort(),
    )
  })

  it('resolves `name` and `name@N` references', () => {
    expect(findComponent('memon-data')?.version).toBe(1)
    expect(findComponent('memon-data@1')?.version).toBe(1)
    expect(findComponent('memon-data@9')).toBeNull()
    expect(findComponent('foo-chart')).toBeNull()
  })

  it('treats an unregistered language as ordinary code', () => {
    const body = block('```foo-chart', 'x: 1', '```')
    expect(resolveComponent('foo-chart')).toBeNull()
    expect(listComponentBlocks(body)).toEqual([])
    expect(lintComponents(body)).toEqual([])
  })
  it('resolves an unpinned block to latest and reports the structural warning', () => {
    const body = block('```html-embed height=240', '<div/>', '```')
    const [entry] = listComponentBlocks(body)
    expect(entry).toMatchObject({
      name: 'html-embed',
      pinnedVersion: null,
      version: 1,
      latestVersion: 1,
      outdated: false,
    })
    expect(lintComponents(body)).toEqual([
      {
        code: 'WIKI_COMPONENT_UNPINNED',
        severity: 'warn',
        message:
          'component block `html-embed` does not pin a major version; write `html-embed@<N>`',
        line: 1,
      },
    ])
  })

  it('reports an unregistered pinned version and keeps the block verbatim', () => {
    const body = block('```memon-data@9', 'script: x', '```')
    const [entry] = listComponentBlocks(body)
    expect(entry?.data).toBeNull()
    expect(entry?.version).toBeNull()
    expect(entry?.diagnostics).toEqual([
      {
        code: 'WIKI_COMPONENT_INVALID',
        severity: 'error',
        message: 'memon-data@9 block 0: version is not registered; registered versions are memon-data@1',
        line: 1,
      },
    ])
  })

  it('records index, line, and resolved version for every block of a page', () => {
    const body = block('# Page', '', VALID_INLINE, '', '```html-embed@1 height=240', '<i>a</i>', '```')
    expect(
      listComponentBlocks(body).map((entry) => ({
        index: entry.index,
        name: entry.name,
        version: entry.version,
        line: entry.line,
        outdated: entry.outdated,
      })),
    ).toEqual([
      { index: 0, name: 'memon-data', version: 1, line: 3, outdated: false },
      { index: 1, name: 'html-embed', version: 1, line: 14, outdated: false },
    ])
  })
})

describe('memon-data@1', () => {
  it('accepts the inline form without diagnostics', () => {
    const [entry] = listComponentBlocks(VALID_INLINE)
    expect(entry?.diagnostics).toEqual([])
    expect(entry?.data).toMatchObject({
      title: 'FID by preconditioning',
      capturedAt: '2026-05-04T13:00:00+08:00',
      capturedCommit: '9f2c4e1a7b3d5f6081a2c3d4e5f60718293a4b5c',
      runner: 'python3 -',
      table: { columns: ['precond', 'fid'], rows: [['karras', 8.91], ['edm2', 8.74]] },
    })
  })

  it('keeps `captured_at` a string instead of a YAML timestamp', () => {
    const [entry] = listComponentBlocks(VALID_INLINE)
    const data = entry?.data
    // js-yaml's default schema would have produced a `Date` here, which would
    // drop the recorded UTC offset on the way back out.
    expect(data && typeof data === 'object' && 'capturedAt' in data).toBe(true)
    if (!data || typeof data !== 'object' || !('capturedAt' in data)) return
    expect(typeof data.capturedAt).toBe('string')
  })

  it('rejects a ragged row', () => {
    const diagnostics = lintComponents(
      block(
        '```memon-data@1',
        'script: x',
        'captured_at: 2026-05-04T13:00:00+08:00',
        'captured_commit: 9f2c4e1a7b3d5f6081a2c3d4e5f60718293a4b5c',
        'columns: [precond, fid]',
        'rows:',
        '  - [karras, 8.91]',
        '  - [edm2]',
        '```',
      ),
    )
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.code).toBe('WIKI_DATA_BLOCK_INVALID')
    expect(diagnostics[0]?.message).toContain('memon-data@1 block 0 field `rows`')
    expect(diagnostics[0]?.message).toContain('row 1 has 1 cells but `columns` declares 2')
  })

  it('rejects unsupported payload fields and a non-HEAD commit', () => {
    const unsupported = lintComponents(
      block(
        '```memon-data@1',
        'script: x',
        'captured_at: 2026-05-04T13:00:00+08:00',
        'captured_commit: 9f2c4e1a7b3d5f6081a2c3d4e5f60718293a4b5c',
        'columns: [a]',
        'rows: [[1]]',
        'caption: legacy',
        '```',
      ),
    )
    expect(unsupported[0]?.message).toContain('field `caption`: field is not supported')

    const shortCommit = lintComponents(
      block(
        '```memon-data@1',
        'script: x',
        'captured_at: 2026-05-04T13:00:00+08:00',
        'captured_commit: 9f2c4e1',
        'columns: [a]',
        'rows: [[1]]',
        '```',
      ),
    )
    expect(shortCommit[0]?.message).toContain(
      'field `captured_commit`: `captured_commit` must be a 40-character git HEAD or null',
    )
  })

  it('rejects ragged rows in fetched CSV and JSON tables', () => {
    expect(() => parseMemonDataFile('data/a.csv', 'a,b\n1\n')).toThrow(
      'row 0 has 1 cells but its header declares 2',
    )
    expect(() =>
      parseMemonDataFile('data/a.json', '{"columns":["a","b"],"rows":[[1]]}'),
    ).toThrow('row 0 has 1 cells but its header declares 2')
  })

  it('rejects declaring both forms of data and both forms of script', () => {
    const both = lintComponents(
      block(
        '```memon-data@1',
        'script: x',
        'captured_at: 2026-05-04T13:00:00+08:00',
        'captured_commit: null',
        'columns: [a]',
        'rows: [[1]]',
        'data: ./data/a.csv',
        '```',
      ),
    )
    expect(both[0]?.code).toBe('WIKI_DATA_BLOCK_INVALID')
    expect(both[0]?.message).toContain('either inline `rows` or a `data` file')

    const scripts = lintComponents(
      block(
        '```memon-data@1',
        'script: x',
        'code: print(1)',
        'captured_at: 2026-05-04T13:00:00+08:00',
        'captured_commit: null',
        'columns: [a]',
        'rows: [[1]]',
        '```',
      ),
    )
    expect(scripts[0]?.message).toContain('either `script` or `code`, never both')
  })

  it('warns once when `captured_commit` is absent but still renders the table', () => {
    const [entry] = listComponentBlocks(
      block(
        '```memon-data@1',
        'script: x',
        'captured_at: 2026-05-04T13:00:00+08:00',
        'columns: [a]',
        'rows: [[1]]',
        '```',
      ),
    )
    expect(entry?.data).not.toBeNull()
    expect(entry?.diagnostics).toEqual([
      {
        code: 'WIKI_DATA_PROVENANCE_MISSING',
        severity: 'warn',
        message:
          'memon-data@1 block 0: `captured_commit` is missing; record the project HEAD at capture time (or `null` outside a git worktree)',
        line: 1,
      },
    ])
  })

  it('accepts an explicit null commit as the non-git case', () => {
    expect(
      lintComponents(
        block(
          '```memon-data@1',
          'script: x',
          'captured_at: 2026-05-04T13:00:00+08:00',
          'captured_commit: null',
          'columns: [a]',
          'rows: [[1]]',
          '```',
        ),
      ),
    ).toEqual([])
  })

  it('rejects an unresolvable or non-tabular `data` path', () => {
    for (const path of ['../secret.csv', '..\\secret.csv', '/etc/passwd', './data/notes.txt']) {
      const diagnostics = lintComponents(
        block(
          '```memon-data@1',
          'script: x',
          'captured_at: 2026-05-04T13:00:00+08:00',
          'captured_commit: null',
          `data: ${path}`,
          '```',
        ),
      )
      expect(diagnostics[0]?.code, path).toBe('WIKI_DATA_BLOCK_INVALID')
      expect(diagnostics[0]?.message, path).toContain('field `data`')
    }
  })

  it('reports a missing `data` file when the surface can probe the bundle', () => {
    const body = block(
      '```memon-data@1',
      'script: x',
      'captured_at: 2026-05-04T13:00:00+08:00',
      'captured_commit: null',
      'data: ./data/fid.csv',
      '```',
    )
    expect(lintComponents(body, { fileExists: (path) => path === 'data/fid.csv' })).toEqual([])
    const missing = lintComponents(body, { fileExists: () => false })
    expect(missing[0]?.code).toBe('WIKI_DATA_BLOCK_INVALID')
    expect(missing[0]?.message).toContain('`data/fid.csv` does not exist')
  })

  it('exposes provenance for staleness as data[<n>] entries', () => {
    expect(listDataProvenance(block(VALID_INLINE, '', '```html-embed@1', '<i/>', '```'))).toEqual([
      {
        index: 0,
        dataIndex: 0,
        sources: ['E0004'],
        capturedAt: '2026-05-04T13:00:00+08:00',
      },
    ])
  })

  it('projects the inline form as a GFM table plus caption', () => {
    const [entry] = listComponentBlocks(VALID_INLINE)
    const markdown = findComponent('memon-data@1')?.toMarkdown(entry?.data)
    expect(markdown).toContain('| precond | fid |')
    expect(markdown).toContain('| --- | --- |')
    expect(markdown).toContain('| karras | 8.91 |')
    expect(markdown).toContain('_captured 2026-05-04T13:00:00+08:00 · commit 9f2c4e1 ·')
  })

  it('projects the file form as the caption plus the path and the collection script', () => {
    const [entry] = listComponentBlocks(
      block(
        '```memon-data@1',
        'runner: bash -s',
        'code: |',
        '  echo hi',
        'captured_at: 2026-05-04T13:00:00+08:00',
        'captured_commit: 9f2c4e1a7b3d5f6081a2c3d4e5f60718293a4b5c',
        'captured_dirty: true',
        'data: ./data/fid.csv',
        '```',
      ),
    )
    const markdown = findComponent('memon-data@1')?.toMarkdown(entry?.data) ?? ''
    expect(markdown).not.toContain('| --- |')
    expect(markdown).toContain('commit 9f2c4e1 (dirty)')
    expect(markdown).toContain('data `data/fid.csv`')
    expect(markdown).toContain('```\necho hi\n```')
  })
})

describe('html-embed@1', () => {
  it('accepts a pixel height and a title', () => {
    const [entry] = listComponentBlocks(
      block('```html-embed@1 height=280 title="chart"', '<div/>', '```'),
    )
    expect(entry?.diagnostics).toEqual([])
    expect(entry?.data).toEqual({ html: '<div/>', height: 280, title: 'chart' })
  })

  it('defaults to an auto height', () => {
    const [entry] = listComponentBlocks(block('```html-embed@1', '<div/>', '```'))
    expect(entry?.data).toMatchObject({ height: 'auto' })
  })

  it('reports an invalid height and keeps the block verbatim', () => {
    const [entry] = listComponentBlocks(block('```html-embed@1 height=tall', '<div/>', '```'))
    expect(entry?.data).toBeNull()
    expect(entry?.diagnostics[0]).toMatchObject({
      code: 'WIKI_COMPONENT_INVALID',
      severity: 'error',
    })
    expect(entry?.diagnostics[0]?.message).toContain('html-embed@1 block 0 field `height`')
  })

  it('reports an unknown attribute by name', () => {
    const [entry] = listComponentBlocks(block('```html-embed@1 width=600', '<div/>', '```'))
    expect(entry?.diagnostics[0]?.message).toContain('block 0 field `width`')
  })

  it('reports an info-string token that is not key=value', () => {
    const [entry] = listComponentBlocks(block('```html-embed@1 responsive', '<div/>', '```'))
    expect(entry?.diagnostics[0]?.message).toContain('`responsive` is not in key=value form')
  })
})

describe('descriptor completeness', () => {
  for (const descriptor of listComponents()) {
    const label = `${descriptor.name}@${descriptor.version}`

    it(`${label} documents every attribute and payload field`, () => {
      expect(descriptor.description.length).toBeGreaterThan(0)
      expect(descriptor.effect.length).toBeGreaterThan(0)
      expect(descriptor.useWhen.length).toBeGreaterThan(0)
      expect(descriptor.args.length).toBeGreaterThan(0)
      for (const arg of descriptor.args) {
        expect(arg.meaning.length, `${label} ${arg.name}`).toBeGreaterThan(0)
        expect(arg.type.length, `${label} ${arg.name}`).toBeGreaterThan(0)
      }
    })

    it(`${label} has an example that lints clean under its pinned form`, () => {
      expect(descriptor.example).toContain(`\`\`\`${label}`)
      const [entry] = listComponentBlocks(descriptor.example)
      expect(entry?.name).toBe(descriptor.name)
      expect(entry?.version).toBe(descriptor.version)
      expect(entry?.diagnostics).toEqual([])
    })

    it(`${label} invalidExamples trigger exactly the code they claim`, () => {
      expect(descriptor.invalidExamples.length).toBeGreaterThan(0)
      for (const example of descriptor.invalidExamples) {
        const diagnostics = lintComponents(example.block)
        expect(
          diagnostics.map((diagnostic) => diagnostic.code),
          `${label} → ${example.code}\n${example.block}`,
        ).toContain(example.code)
      }
    })

    it(`${label} fixtures exist and contain a block of this component`, () => {
      expect(descriptor.fixtures.length).toBeGreaterThan(0)
      for (const fixture of descriptor.fixtures) {
        const path = join(REPO_ROOT, fixture)
        expect(existsSync(path), fixture).toBe(true)
        const blocks = listComponentBlocks(readFileSync(path, 'utf8'))
        expect(
          blocks.some(
            (entry) => entry.name === descriptor.name && entry.version === descriptor.version,
          ),
          `${fixture} has no ${label} block`,
        ).toBe(true)
      }
    })
  }

  it('serializes a descriptor for the components API', () => {
    const descriptor = findComponent('memon-data@1')
    expect(descriptor).not.toBeNull()
    if (!descriptor) return
    expect(describeComponent(descriptor)).toMatchObject({
      name: 'memon-data',
      version: 1,
      pinned: 'memon-data@1',
      latestVersion: 1,
      outdated: false,
      hasMigration: false,
    })
  })
})

describe('versioning across two majors', () => {
  const base = {
    name: 'fixture-block',
    description: 'test fixture',
    args: [{ name: 'mode', scope: 'attribute' as const, type: 'string', required: false, meaning: 'test' }],
    effect: 'test',
    useWhen: 'test',
    invalidExamples: [],
    fixtures: [],
    attributes: z.object({ mode: z.string().optional() }).strict(),
    lint: () => [],
  }
  const fixtureV1: WikiComponentDescriptor<{ value: string }> = {
    ...base,
    version: 1,
    example: '```fixture-block@1\nhello\n```',
    parsePayload: (payload) => ({ value: payload.trim() }),
    toMarkdown: (data) => data.value,
  }
  const fixtureV2: WikiComponentDescriptor<{ value: string }> = {
    ...base,
    version: 2,
    example: '```fixture-block@2\nvalue: hello\n```',
    parsePayload: (payload) => ({ value: payload.replace(/^value:\s*/, '').trim() }),
    toMarkdown: (data) => data.value,
    migrate: (previous) => ({
      attributes: { ...previous.attributes, mode: 'migrated' },
      payload: `value: ${previous.payload.trim()}`,
    }),
  }
  const registry = createWikiComponentRegistry([fixtureV1, fixtureV2])

  it('resolves an unpinned block to the latest version', () => {
    const match = registry.resolveComponent('fixture-block')
    expect(match).toMatchObject({ pinnedVersion: null, version: 2, outdated: false })
  })

  it('keeps rendering an old pinned block and flags it outdated', () => {
    const [entry] = registry.listComponentBlocks('```fixture-block@1\nhello\n```')
    expect(entry).toMatchObject({ version: 1, outdated: true, data: { value: 'hello' } })
    expect(entry?.diagnostics).toEqual([])
  })

  it('pins an unpinned block without touching any other byte', () => {
    const body = ['# Page', '', '```fixture-block mode=keep', 'hello', '```', '', 'After.'].join(
      '\n',
    )
    const { content, changes } = registry.migrateComponents(body)
    expect(content).toBe(
      ['# Page', '', '```fixture-block@2 mode=keep', 'hello', '```', '', 'After.'].join('\n'),
    )
    expect(changes).toEqual([{ index: 0, name: 'fixture-block', from: null, to: 2 }])
  })

  it('rewrites an old pinned block through its migration chain', () => {
    const body = ['Before.', '', '```fixture-block@1', 'hello', '```', '', 'After.'].join('\n')
    const { content, changes } = registry.migrateComponents(body)
    expect(content).toBe(
      [
        'Before.',
        '',
        '```fixture-block@2 mode=migrated',
        'value: hello',
        '```',
        '',
        'After.',
      ].join('\n'),
    )
    expect(changes).toEqual([{ index: 0, name: 'fixture-block', from: 1, to: 2 }])
    expect(registry.lintComponents(content)).toEqual([])
  })

  it('leaves an old pinned block alone when its version has no migration', () => {
    const noMigration = createWikiComponentRegistry([
      fixtureV1,
      { ...fixtureV2, migrate: undefined },
    ])
    const body = '```fixture-block@1\nhello\n```'
    expect(noMigration.migrateComponents(body)).toEqual({ content: body, changes: [] })
  })

  it('reports a pinned version that is not registered', () => {
    const diagnostics = registry.lintComponents('```fixture-block@9\nhello\n```')
    expect(diagnostics[0]?.code).toBe('WIKI_COMPONENT_INVALID')
    expect(diagnostics[0]?.message).toContain('fixture-block@1, fixture-block@2')
  })
})

describe('the shipped registry against the project fixtures', () => {
  for (const fixture of [
    'mock/project-a/docs/wiki/finding/W0001-zero-snr-brightness.md',
    'mock/project-a/docs/wiki/bottleneck/W0002-edm2-nan-crash.md',
    'mock/project-a/docs/wiki/decision/W0003-adopt-bf16-flow-matching.md',
    'mock/project-a/docs/wiki/question/W0005-snr-weighting-hf-artifacts.md',
    'mock/project-a/docs/wiki/showcase/W0006-edm2-precond-explorer/README.md',
  ]) {
    it(`${fixture} lints clean and is already pinned`, () => {
      const body = readFileSync(join(REPO_ROOT, fixture), 'utf8')
      expect(lintComponents(body)).toEqual([])
      expect(migrateComponents(body)).toEqual({ content: body, changes: [] })
    })
  }
})
