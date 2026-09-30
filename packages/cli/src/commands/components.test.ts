// `memon components run` against a throwaway project root and the real
// `python3` on PATH: the command's contract is exactly what the interpreter
// did, so there is nothing useful to mock here.

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runComponentsRun } from './components.js'

let root = ''
const DOCUMENT = 'docs/wiki/note/W0004-fid.md'
const CACHE = 'docs/wiki/note/W0004-fid__assets/fid.json'

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-components-cli-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

class ExitCalled extends Error {
  constructor(public exitCode: number) {
    super(`process.exit(${exitCode})`)
  }
}

interface CapturedRun {
  exitCode: number | null
  stdout: string
  stderr: string
}

async function runCapturing(fn: () => Promise<unknown>): Promise<CapturedRun> {
  const realExit = process.exit
  const realStdout = process.stdout.write.bind(process.stdout)
  const realStderr = process.stderr.write.bind(process.stderr)
  const priorExitCode = process.exitCode
  process.exitCode = undefined
  let exitCode: number | null = null
  let stdout = ''
  let stderr = ''
  process.exit = ((code?: number) => {
    exitCode = code ?? 0
    throw new ExitCalled(exitCode)
  }) as typeof process.exit
  process.stdout.write = ((chunk: unknown) => {
    stdout += String(chunk)
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: unknown) => {
    stderr += String(chunk)
    return true
  }) as typeof process.stderr.write
  try {
    await fn()
    if (typeof process.exitCode === 'number') exitCode = process.exitCode
  } catch (err) {
    if (!(err instanceof ExitCalled)) throw err
  } finally {
    process.exit = realExit
    process.stdout.write = realStdout
    process.stderr.write = realStderr
    process.exitCode = priorExitCode
  }
  return { exitCode, stdout, stderr }
}

interface RunLine {
  id: string
  status: string
  path: string
  durationMs: number
  error?: string
}

function lines(run: CapturedRun): RunLine[] {
  return run.stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as RunLine)
}

function errorOf(run: CapturedRun): { code: string; message: string; details?: unknown } {
  const envelope = JSON.parse(run.stderr) as {
    error: { code: string; message: string; details?: unknown }
  }
  return envelope.error
}

async function write(relative: string, content: string): Promise<void> {
  const target = join(root, relative)
  await fs.mkdir(join(target, '..'), { recursive: true })
  await fs.writeFile(target, content, 'utf8')
}

function globals(): { projectRoot: string; cwd: string; format: string } {
  return { projectRoot: root, cwd: root, format: 'json' }
}

function page(...blocks: string[]): string {
  return [
    '---',
    'id: W0004',
    'kind: note',
    'title: FID',
    'created_at: "2026-09-01T09:00:00+08:00"',
    'updated_at: "2026-09-01T09:00:00+08:00"',
    '---',
    '',
    '## Data',
    '',
    ...blocks,
    '',
  ].join('\n')
}

function inline(id: string, body: string[], extra: string[] = []): string {
  return [
    `\`\`\`yaml datatable@1 #${id}`,
    'code: |',
    ...body.map((line) => `  ${line}`),
    ...extra,
    '```',
  ].join('\n')
}

describe('memon components run', () => {
  it('writes the cache on the first run and reports unchanged on the second', async () => {
    await write(
      DOCUMENT,
      page(
        inline(
          'fid',
          ['def collect(limit, **kw):', '    return {"columns": ["step"], "data": [[limit]]}'],
          ['limit: 7'],
        ),
      ),
    )

    const first = await runCapturing(() => runComponentsRun({ ...globals(), document: DOCUMENT }))
    expect(first.exitCode).toBeNull()
    expect(lines(first)).toEqual([
      { id: 'fid', status: 'updated', path: CACHE, durationMs: expect.any(Number) },
    ])
    const cached = JSON.parse(await fs.readFile(join(root, CACHE), 'utf8')) as Record<
      string,
      unknown
    >
    expect(cached).toMatchObject({
      columns: ['step'],
      data: [[7]],
      __component_type: 'datatable@1',
      __component_id: 'fid',
      __md_file_path: DOCUMENT,
    })

    const second = await runCapturing(() => runComponentsRun({ ...globals(), document: DOCUMENT }))
    expect(lines(second)[0]?.status).toBe('unchanged')
  })

  it('accepts an absolute document path inside the project root', async () => {
    await write(DOCUMENT, page(inline('fid', ['def collect(**kw):', '    return {"n": 1}'])))
    const run = await runCapturing(() =>
      runComponentsRun({ ...globals(), document: join(root, DOCUMENT) }),
    )
    expect(lines(run)[0]?.path).toBe(CACHE)
  })

  it('refuses a document outside the project root with exit 2', async () => {
    const run = await runCapturing(() =>
      runComponentsRun({ ...globals(), document: '../elsewhere/page.md' }),
    )
    expect(run.exitCode).toBe(2)
    expect(errorOf(run).code).toBe('BAD_REQUEST')
  })

  it('exits 1 and keeps the previous data when a block raises', async () => {
    await write(DOCUMENT, page(inline('fid', ['def collect(**kw):', '    return {"n": 1}'])))
    await runCapturing(() => runComponentsRun({ ...globals(), document: DOCUMENT }))

    await write(
      DOCUMENT,
      page(inline('fid', ['def collect(**kw):', '    raise RuntimeError("no runs yet")'])),
    )
    const failed = await runCapturing(() => runComponentsRun({ ...globals(), document: DOCUMENT }))
    expect(failed.exitCode).toBe(1)
    const [row] = lines(failed)
    expect(row?.status).toBe('failed')
    expect(row?.error).toContain('no runs yet')
    const cached = JSON.parse(await fs.readFile(join(root, CACHE), 'utf8')) as Record<
      string,
      unknown
    >
    expect(cached.n).toBe(1)
    expect(cached.__last_error).toMatchObject({ message: expect.stringContaining('no runs yet') })
  })

  it('exits 1 when a block returns something other than an object', async () => {
    await write(DOCUMENT, page(inline('fid', ['def collect(**kw):', '    return [1, 2]'])))
    const run = await runCapturing(() => runComponentsRun({ ...globals(), document: DOCUMENT }))
    expect(run.exitCode).toBe(1)
    expect(lines(run)[0]?.error).toContain('must return a JSON object')
  })

  it('runs only the named ids and exits 2 on an unknown one, listing the executable ids', async () => {
    await write(
      DOCUMENT,
      page(
        inline('one', ['def collect(**kw):', '    return {"n": 1}']),
        '',
        inline('two', ['def collect(**kw):', '    return {"n": 2}']),
      ),
    )
    const selected = await runCapturing(() =>
      runComponentsRun({ ...globals(), document: DOCUMENT, ids: ['two'] }),
    )
    expect(lines(selected).map((row) => row.id)).toEqual(['two'])

    const unknown = await runCapturing(() =>
      runComponentsRun({ ...globals(), document: DOCUMENT, ids: ['nope'] }),
    )
    expect(unknown.exitCode).toBe(2)
    expect(errorOf(unknown).code).toBe('UNKNOWN_ID')
    expect(errorOf(unknown).details).toEqual({ executableIds: ['one', 'two'] })
  })

  it('exits 2 when ids are named but the document has no executable block', async () => {
    await write(DOCUMENT, page('```yaml datatable@1 #static', 'columns: [a]', 'data: [[1]]', '```'))
    const named = await runCapturing(() =>
      runComponentsRun({ ...globals(), document: DOCUMENT, ids: ['static'] }),
    )
    expect(named.exitCode).toBe(2)
    expect(errorOf(named).code).toBe('NO_EXECUTABLE_BLOCKS')

    const all = await runCapturing(() => runComponentsRun({ ...globals(), document: DOCUMENT }))
    expect(all.exitCode).toBeNull()
    expect(all.stdout).toBe('')
  })

  it('exits 4 when the document does not exist', async () => {
    const run = await runCapturing(() =>
      runComponentsRun({ ...globals(), document: 'docs/wiki/note/W9999-missing.md' }),
    )
    expect(run.exitCode).toBe(4)
    expect(errorOf(run).code).toBe('NOT_FOUND')
  })

  it('fails a `script` path that escapes the project root', async () => {
    const outside = await fs.mkdtemp(join(tmpdir(), 'memon-outside-'))
    try {
      await fs.writeFile(join(outside, 'evil.py'), 'def collect(**kw):\n    return {"ok": 1}\n')
      await write(
        DOCUMENT,
        page(
          ['```yaml datatable@1 #fid', `script: ${join(outside, 'evil.py')}::collect`, '```'].join(
            '\n',
          ),
        ),
      )
      const run = await runCapturing(() => runComponentsRun({ ...globals(), document: DOCUMENT }))
      expect(run.exitCode).toBe(1)
      expect(lines(run)[0]?.error).toContain('escapes the project root')
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  })

  it('runs a `script` relative to the document in human format', async () => {
    await write(
      'scripts/collect.py',
      [
        'def collect(**kw):',
        '    return {"id": kw["__id"], "assets": kw["__assets_dir"]}',
        '',
      ].join('\n'),
    )
    await write(
      DOCUMENT,
      page(
        ['```yaml datatable@1 #fid', 'script: ../../../scripts/collect.py::collect', '```'].join(
          '\n',
        ),
      ),
    )
    const run = await runCapturing(() =>
      runComponentsRun({ ...globals(), document: DOCUMENT, format: 'human' }),
    )
    expect(run.stdout).toContain('updated')
    expect(run.stdout).toContain(CACHE)
    expect(JSON.parse(await fs.readFile(join(root, CACHE), 'utf8'))).toMatchObject({
      id: 'fid',
      assets: 'docs/wiki/note/W0004-fid__assets',
    })
  })
})
