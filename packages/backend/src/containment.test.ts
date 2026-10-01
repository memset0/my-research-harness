import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectFs } from '@memon/core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { isContained, PathContainmentError, resolveContained } from './containment.js'
import { openProjectByteStream } from './stream-service.js'

let base: string
let root: string
let outside: string

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'memon-containment-')))
  root = join(base, 'project')
  outside = join(base, 'outside')
  await mkdir(join(root, 'docs'), { recursive: true })
  await mkdir(outside, { recursive: true })
  await writeFile(join(root, 'docs', 'a.txt'), '0123456789')
  await writeFile(join(outside, 'secret.txt'), 'secret')
  await symlink(join(outside, 'secret.txt'), join(root, 'docs', 'escape.txt'))
  await symlink(join(root, 'docs'), join(outside, 'into-project'))
})

afterAll(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('isContained', () => {
  it('accepts the root and descendants and rejects parents, siblings and prefixes', () => {
    expect(isContained('/p/root', '/p/root')).toBe(true)
    expect(isContained('/p/root', '/p/root/a/b')).toBe(true)
    expect(isContained('/p/root', '/p/root/..x')).toBe(true)
    expect(isContained('/p/root', '/p')).toBe(false)
    expect(isContained('/p/root', '/p/root-other/a')).toBe(false)
    expect(isContained('/p/root', '/p/other')).toBe(false)
  })
})

describe('resolveContained', () => {
  it('returns the real path of a contained resource', async () => {
    await expect(resolveContained(root, 'docs/a.txt')).resolves.toBe(join(root, 'docs', 'a.txt'))
    await expect(resolveContained(root, join(root, 'docs'))).resolves.toBe(join(root, 'docs'))
  })

  it('rejects lexical and symlink escapes', async () => {
    await expect(resolveContained(root, '../outside/secret.txt')).rejects.toBeInstanceOf(
      PathContainmentError,
    )
    await expect(resolveContained(root, 'docs/escape.txt')).rejects.toBeInstanceOf(
      PathContainmentError,
    )
  })

  it('treats a missing target as an error unless absence is allowed', async () => {
    await expect(resolveContained(root, 'docs/missing.txt')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(
      resolveContained(root, 'docs/missing.txt', { allowMissing: true }),
    ).resolves.toBeNull()
    await expect(
      resolveContained(root, 'docs/a.txt/below', { allowMissing: true }),
    ).resolves.toBeNull()
    await expect(
      resolveContained(join(base, 'no-root'), 'x', { allowMissing: true }),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('judges only the real path for configured paths that link into the Project', async () => {
    const link = join(outside, 'into-project')
    await expect(resolveContained(root, link)).rejects.toBeInstanceOf(PathContainmentError)
    await expect(resolveContained(root, link, { realPathOnly: true })).resolves.toBe(
      join(root, 'docs'),
    )
  })
})

describe('resolveContained with mustExist: false', () => {
  const lenient = { mustExist: false } as const

  it('resolves absent leaves, directories and roots through the nearest existing ancestor', async () => {
    await expect(resolveContained(root, 'docs/a.txt', lenient)).resolves.toBe(
      join(root, 'docs', 'a.txt'),
    )
    await expect(resolveContained(root, 'docs/missing.txt', lenient)).resolves.toBe(
      join(root, 'docs', 'missing.txt'),
    )
    await expect(resolveContained(root, 'new/dir/file.txt', lenient)).resolves.toBe(
      join(root, 'new', 'dir', 'file.txt'),
    )
    await expect(resolveContained(root, 'docs/a.txt/below', lenient)).resolves.toBe(
      join(root, 'docs', 'a.txt', 'below'),
    )
    await expect(resolveContained(join(base, 'no-root'), 'x/y.txt', lenient)).resolves.toBe(
      join(base, 'no-root', 'x', 'y.txt'),
    )
  })

  it('maps an absent path below a contained link to the real directory', async () => {
    const linked = join(root, 'linked-docs')
    await symlink(join(root, 'docs'), linked)
    await expect(resolveContained(root, 'linked-docs/new.txt', lenient)).resolves.toBe(
      join(root, 'docs', 'new.txt'),
    )
  })

  it('still rejects lexical, absolute and symlink escapes, also with an absent leaf', async () => {
    for (const path of [
      '../outside/secret.txt',
      '../outside/absent.txt',
      join(outside, 'absent.txt'),
      'docs/escape.txt',
    ]) {
      await expect(resolveContained(root, path, lenient)).rejects.toBeInstanceOf(
        PathContainmentError,
      )
    }
    const out = join(root, 'out')
    await symlink(outside, out)
    await expect(resolveContained(root, 'out/absent.txt', lenient)).rejects.toBeInstanceOf(
      PathContainmentError,
    )
    await expect(resolveContained(root, 'out/deeper/absent.txt', lenient)).rejects.toBeInstanceOf(
      PathContainmentError,
    )
  })

  it('propagates failures other than absence', async () => {
    const error = Object.assign(new Error('denied'), { code: 'EACCES' })
    const spy = vi.spyOn(projectFs, 'realpath').mockRejectedValueOnce(error)
    try {
      await expect(resolveContained(root, 'docs/a.txt', lenient)).rejects.toBe(error)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('openProjectByteStream', () => {
  async function collect(stream: NodeJS.ReadableStream): Promise<string> {
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer))
    return Buffer.concat(chunks).toString()
  }

  it('opens through the Project file facade and honours byte ranges', async () => {
    const open = vi.spyOn(projectFs, 'open')
    try {
      await expect(collect(openProjectByteStream(join(root, 'docs', 'a.txt')))).resolves.toBe(
        '0123456789',
      )
      await expect(
        collect(openProjectByteStream(join(root, 'docs', 'a.txt'), { start: 2, end: 4 })),
      ).resolves.toBe('234')
      expect(open).toHaveBeenCalledWith(join(root, 'docs', 'a.txt'), 'r')
    } finally {
      open.mockRestore()
    }
  })

  it('surfaces an open failure as a stream error', async () => {
    await expect(
      collect(openProjectByteStream(join(root, 'docs', 'missing.txt'))),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('closes the file handle when the consumer destroys the stream early', async () => {
    const handles: Array<{ fd: number }> = []
    const realOpen = projectFs.open.bind(projectFs)
    const open = vi.spyOn(projectFs, 'open').mockImplementation(async (...args) => {
      const handle = await realOpen(...(args as Parameters<typeof realOpen>))
      handles.push(handle)
      return handle
    })
    try {
      const stream = openProjectByteStream(join(root, 'docs', 'a.txt'))
      stream.destroy()
      await vi.waitFor(() => {
        expect(handles).toHaveLength(1)
        expect(handles[0]!.fd).toBe(-1)
      })
      const reading = openProjectByteStream(join(root, 'docs', 'a.txt'))
      await new Promise((resolveRead) => reading.once('readable', resolveRead))
      reading.destroy()
      await vi.waitFor(() => {
        expect(handles).toHaveLength(2)
        expect(handles[1]!.fd).toBe(-1)
      })
    } finally {
      open.mockRestore()
    }
  })
})
