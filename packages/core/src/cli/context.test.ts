import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CliContextError, loadCliContext } from './context.js'

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'memon-cli-ctx-'))
}

describe('loadCliContext', () => {
  it('uses --project-root when provided (source = project-root)', async () => {
    const root = makeTmpDir()
    try {
      const ctx = await loadCliContext({ projectRoot: root, cwd: '/some/other/cwd' })
      expect(ctx.source).toBe('project-root')
      expect(ctx.config.projects).toHaveLength(1)
      expect(ctx.config.projects[0]?.root).toBe(root)
      expect(ctx.config.projects[0]?.name).toBe('(project-root)')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('falls back to implicit cwd when projectRoot is not provided', async () => {
    const cwd = makeTmpDir()
    try {
      const ctx = await loadCliContext({ cwd })
      expect(ctx.source).toBe('implicit-cwd')
      expect(ctx.config.projects).toHaveLength(1)
      expect(ctx.config.projects[0]?.root).toBe(cwd)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('throws NOT_FOUND when projectRoot path does not exist', async () => {
    await expect(
      loadCliContext({ projectRoot: '/this/path/does/not/exist/9z9z9z', cwd: '/' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('throws NOT_FOUND when projectRoot is a file, not a directory', async () => {
    const root = makeTmpDir()
    const filePath = join(root, 'imafile.txt')
    writeFileSync(filePath, 'hello')
    try {
      await expect(loadCliContext({ projectRoot: filePath, cwd: '/' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('CliContextError carries a typed code', () => {
    const err = new CliContextError('BAD_REQUEST', 'sample')
    expect(err.code).toBe('BAD_REQUEST')
    expect(err.name).toBe('CliContextError')
  })

  it('input type does not accept configPath (compile-time check)', () => {
    // @ts-expect-error — configPath was removed from LoadCliContextInput
    void loadCliContext({ configPath: '/foo', cwd: '/' })
  })
})
