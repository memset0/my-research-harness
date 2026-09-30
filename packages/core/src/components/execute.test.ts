import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { componentAssetsDir, readComponentCache } from './cache.js'
import {
  ComponentRunError,
  listExecutableComponentBlocks,
  runDocumentComponents,
} from './execute.js'

let root = ''
const DOCUMENT = 'docs/wiki/note/W0004-fid.md'

async function write(relative: string, content: string): Promise<void> {
  const target = join(root, relative)
  await fs.mkdir(join(target, '..'), { recursive: true })
  await fs.writeFile(target, content, 'utf8')
}

function page(...blocks: string[]): string {
  return ['---', 'id: W0004', '---', '', '## Data', '', ...blocks, ''].join('\n')
}

function codeBlock(id: string, body: string[], extra: string[] = []): string {
  return [
    '```yaml datatable@1 #' + id,
    'code: |',
    ...body.map((line) => `  ${line}`),
    ...extra,
    '```',
  ].join('\n')
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-components-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('listExecutableComponentBlocks', () => {
  it('returns only executable blocks with their spec and file line', async () => {
    const body = page(
      '```yaml datatable@1 #static',
      'columns: [a]',
      'data: [[1]]',
      '```',
      '',
      codeBlock('live', ['def collect(**kw):', '    return {}'], ['limit: 3']),
    )
    const blocks = listExecutableComponentBlocks(body)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.id).toBe('live')
    expect(blocks[0]?.type).toBe('datatable')
    expect(blocks[0]?.spec.kwargs).toEqual({ limit: 3 })
    expect(body.split('\n')[blocks[0]!.line - 1]).toBe('```yaml datatable@1 #live')
  })
})

describe('runDocumentComponents', () => {
  it('runs an inline function, caches the object with the hidden keys, and reports unchanged on a rerun', async () => {
    await write(
      DOCUMENT,
      page(
        codeBlock(
          'fid',
          [
            'def collect(limit, **kw):',
            '    return {"columns": ["step"], "data": [[i] for i in range(limit)],',
            '            "note": kw["__id"] + "|" + kw["__md_file_path"] + "|" + kw["__assets_dir"]}',
          ],
          ['limit: 2'],
        ),
      ),
    )

    const first = await runDocumentComponents({ root, documentPath: DOCUMENT })
    expect(first).toEqual([
      {
        id: 'fid',
        status: 'updated',
        path: 'docs/wiki/note/W0004-fid__assets/fid.json',
        durationMs: expect.any(Number),
      },
    ])

    const cached = await readComponentCache(root, DOCUMENT, 'fid')
    expect(cached?.data).toEqual({
      columns: ['step'],
      data: [[0], [1]],
      note: `fid|${DOCUMENT}|${componentAssetsDir(DOCUMENT)}`,
    })
    expect(cached?.componentType).toBe('datatable@1')
    expect(cached?.componentId).toBe('fid')
    expect(cached?.mdFilePath).toBe(DOCUMENT)
    expect(cached?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
    expect(cached?.sourceHash).toMatch(/^[0-9a-f]{64}$/)
    expect(cached?.durationMs).toBeGreaterThanOrEqual(0)
    expect(cached?.lastError).toBeNull()

    const again = await runDocumentComponents({ root, documentPath: DOCUMENT })
    expect(again[0]?.status).toBe('unchanged')
    expect((await readComponentCache(root, DOCUMENT, 'fid'))?.data).toEqual(cached?.data)
  })

  it('keeps the previous data and records __last_error when the function raises', async () => {
    await write(DOCUMENT, page(codeBlock('fid', ['def collect(**kw):', '    return {"value": 1}'])))
    expect((await runDocumentComponents({ root, documentPath: DOCUMENT }))[0]?.status).toBe(
      'updated',
    )

    await write(
      DOCUMENT,
      page(codeBlock('fid', ['def collect(**kw):', '    raise RuntimeError("no runs yet")'])),
    )
    const failed = await runDocumentComponents({ root, documentPath: DOCUMENT })
    expect(failed[0]?.status).toBe('failed')
    expect(failed[0]?.error).toContain('no runs yet')

    const cached = await readComponentCache(root, DOCUMENT, 'fid')
    expect(cached?.data).toEqual({ value: 1 })
    expect(cached?.lastError?.message).toContain('no runs yet')
  })

  it('fails a non-object return without writing data', async () => {
    await write(DOCUMENT, page(codeBlock('fid', ['def collect(**kw):', '    return [1, 2]'])))
    const results = await runDocumentComponents({ root, documentPath: DOCUMENT })
    expect(results[0]?.status).toBe('failed')
    expect(results[0]?.error).toContain('must return a JSON object')
    expect((await readComponentCache(root, DOCUMENT, 'fid'))?.data).toEqual({})
  })

  it('runs a script relative to the document and injects the project root', async () => {
    await write(
      'scripts/collect.py',
      [
        'import os',
        '',
        '',
        'def collect(scale, **kw):',
        '    return {"scale": scale, "cwd": os.getcwd(), "root": kw["__project_root"]}',
        '',
      ].join('\n'),
    )
    await write(
      DOCUMENT,
      page(
        [
          '```yaml datatable@1 #fid',
          'script: ../../../scripts/collect.py::collect',
          'scale: 4',
          '```',
        ].join('\n'),
      ),
    )
    const results = await runDocumentComponents({ root, documentPath: DOCUMENT })
    expect(results[0]?.status).toBe('updated')
    const cached = await readComponentCache(root, DOCUMENT, 'fid')
    expect(cached?.data.scale).toBe(4)
    expect(cached?.data.cwd).toBe(await fs.realpath(root))
    expect(cached?.data.root).toBe(await fs.realpath(root))
  })

  it('refuses a script path that resolves outside the project root', async () => {
    const outside = await fs.mkdtemp(join(tmpdir(), 'memon-outside-'))
    await fs.writeFile(
      join(outside, 'evil.py'),
      'def collect():\n    return {"ok": True}\n',
      'utf8',
    )
    await write(
      DOCUMENT,
      page(
        ['```yaml datatable@1 #fid', `script: ${join(outside, 'evil.py')}::collect`, '```'].join(
          '\n',
        ),
      ),
    )
    const results = await runDocumentComponents({ root, documentPath: DOCUMENT })
    expect(results[0]?.status).toBe('failed')
    expect(results[0]?.error).toContain('escapes the project root')
    await fs.rm(outside, { recursive: true, force: true })
  })

  it('fails a missing script without touching the interpreter', async () => {
    await write(
      DOCUMENT,
      page(['```yaml datatable@1 #fid', 'script: ./nope.py::collect', '```'].join('\n')),
    )
    const results = await runDocumentComponents({ root, documentPath: DOCUMENT })
    expect(results[0]?.status).toBe('failed')
    expect(results[0]?.error).toContain('script not found')
  })

  it('kills a run that exceeds the timeout', async () => {
    await write(
      DOCUMENT,
      page(codeBlock('fid', ['def collect(**kw):', '    import time', '    time.sleep(30)'])),
    )
    const results = await runDocumentComponents({ root, documentPath: DOCUMENT, timeoutMs: 500 })
    expect(results[0]?.status).toBe('failed')
    expect(results[0]?.error).toBe('timed out after 500 ms')
  })

  it('runs only the named ids and reports the executable ids for an unknown one', async () => {
    await write(
      DOCUMENT,
      page(
        codeBlock('one', ['def collect(**kw):', '    return {"n": 1}']),
        '',
        codeBlock('two', ['def collect(**kw):', '    return {"n": 2}']),
      ),
    )
    const results = await runDocumentComponents({ root, documentPath: DOCUMENT, ids: ['two'] })
    expect(results.map((result) => result.id)).toEqual(['two'])
    expect(await readComponentCache(root, DOCUMENT, 'one')).toBeNull()

    const error = await runDocumentComponents({
      root,
      documentPath: DOCUMENT,
      ids: ['nope'],
    }).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(ComponentRunError)
    expect((error as ComponentRunError).code).toBe('UNKNOWN_ID')
    expect((error as ComponentRunError).ids).toEqual(['one', 'two'])
  })

  it('refuses a missing document, a document without executable blocks, and an id-less block', async () => {
    const missing = await runDocumentComponents({ root, documentPath: DOCUMENT }).catch(
      (err: unknown) => err as ComponentRunError,
    )
    expect((missing as ComponentRunError).code).toBe('DOCUMENT_NOT_FOUND')

    await write(DOCUMENT, page('```yaml datatable@1 #static', 'columns: [a]', 'data: [[1]]', '```'))
    expect(await runDocumentComponents({ root, documentPath: DOCUMENT })).toEqual([])
    const named = await runDocumentComponents({
      root,
      documentPath: DOCUMENT,
      ids: ['static'],
    }).catch((err: unknown) => err as ComponentRunError)
    expect((named as ComponentRunError).code).toBe('NO_EXECUTABLE_BLOCKS')

    await write(
      DOCUMENT,
      page(
        ['```yaml datatable@1', 'code: |', '  def collect():', '      return {}', '```'].join('\n'),
      ),
    )
    const anonymous = await runDocumentComponents({ root, documentPath: DOCUMENT }).catch(
      (err: unknown) => err as ComponentRunError,
    )
    expect((anonymous as ComponentRunError).code).toBe('INVALID_BLOCK')
    expect((anonymous as ComponentRunError).message).toContain('needs #<id>')
  })

  it('caches a bundle page beside its README', async () => {
    const bundle = 'docs/wiki/showcase/W0006-explorer/README.md'
    await write(bundle, page(codeBlock('fid', ['def collect(**kw):', '    return {"n": 1}'])))
    const results = await runDocumentComponents({ root, documentPath: bundle })
    expect(results[0]?.path).toBe('docs/wiki/showcase/W0006-explorer/README__assets/fid.json')
  })
})
