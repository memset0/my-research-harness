import { describe, expect, it } from 'vitest'
import {
  assertAgentWriteEnabled,
  conditionalDirectoryResult,
  conditionalFileResult,
  contentVersion,
  DirectoryListResultSchema,
  FileAccessError,
  FileCapabilitiesSchema,
  FileErrorSchema,
  FileMutationRequestSchema,
  FileRangeRequestSchema,
  FileRangeResultSchema,
  FileReadResultSchema,
  FileStatResultSchema,
  FileTargetSchema,
  requireFileCapabilities,
} from './index.js'

describe('conditional file protocol', () => {
  it('returns binary bytes losslessly and suppresses only a matching body', () => {
    const bytes = Buffer.from([0, 255, 128, 13, 10])
    const first = conditionalFileResult(bytes, 100)
    expect(first.outcome).toBe('present')
    if (first.outcome !== 'present') throw new Error('expected body')
    expect(Buffer.from(first.content, 'base64')).toEqual(bytes)
    const unchanged = conditionalFileResult(bytes, 200, first.version)
    expect(unchanged).toEqual({ outcome: 'unchanged', version: first.version, checkedAt: 200 })
    expect(unchanged).not.toHaveProperty('content')
    expect(
      conditionalFileResult(bytes, 200, contentVersion(Buffer.from('different'))).outcome,
    ).toBe('present')
  })

  it('detects equal-length changes independently of metadata', () => {
    const old = conditionalFileResult(Buffer.from('old'), 100)
    if (old.outcome !== 'present') throw new Error('expected body')
    const changed = conditionalFileResult(Buffer.from('new'), 101, old.version)
    expect(changed.outcome).toBe('present')
    if (changed.outcome === 'present') expect(changed.version).not.toBe(old.version)
  })

  it('rejects mismatched bytes/versions and noncanonical binary encodings', () => {
    const result = conditionalFileResult(Buffer.from('one'), 100)
    expect(
      FileReadResultSchema.safeParse({ ...result, content: Buffer.from('two').toString('base64') })
        .success,
    ).toBe(false)
    expect(FileReadResultSchema.safeParse({ ...result, content: '%%%bad' }).success).toBe(false)
    expect(FileReadResultSchema.safeParse({ ...result, content: 'Zh==' }).success).toBe(false)
  })

  it('distinguishes empty present files, missing files, and source errors', () => {
    expect(conditionalFileResult(Buffer.alloc(0), 100)).toMatchObject({
      outcome: 'present',
      content: '',
    })
    expect(FileReadResultSchema.parse({ outcome: 'missing', checkedAt: 100 })).toEqual({
      outcome: 'missing',
      checkedAt: 100,
    })
    expect(
      FileReadResultSchema.safeParse({ outcome: 'missing', checkedAt: 100, error: 'EIO' }).success,
    ).toBe(false)
    expect(FileErrorSchema.parse({ code: 'SOURCE_UNAVAILABLE' })).toEqual({
      code: 'SOURCE_UNAVAILABLE',
    })
  })

  it('rejects invented fresh times and bodies in unchanged responses', () => {
    const unchanged = conditionalFileResult(Buffer.from('x'), 100, contentVersion(Buffer.from('x')))
    expect(FileReadResultSchema.safeParse({ ...unchanged, content: 'eA==' }).success).toBe(false)
    expect(FileReadResultSchema.safeParse({ ...unchanged, checkedAt: Number.NaN }).success).toBe(
      false,
    )
  })

  it('canonicalizes directory order and distinguishes membership changes', () => {
    const a = { name: 'a', kind: 'file' as const }
    const b = { name: 'b', kind: 'directory' as const }
    const first = conditionalDirectoryResult([b, a], 100)
    if (first.outcome !== 'present') throw new Error('expected listing')
    expect(conditionalDirectoryResult([a, b], 101, first.version).outcome).toBe('unchanged')
    expect(conditionalDirectoryResult([a], 102, first.version).outcome).toBe('present')
    expect(
      conditionalDirectoryResult([{ ...a, kind: 'symlink' }], 102, first.version).outcome,
    ).toBe('present')
    expect(DirectoryListResultSchema.safeParse({ ...first, entries: [a, a] }).success).toBe(false)
    expect(DirectoryListResultSchema.safeParse({ ...first, entries: [] }).success).toBe(false)
  })

  it('metadata does not assert content equality', () => {
    const result = {
      outcome: 'present',
      checkedAt: 1,
      metadata: { kind: 'file', size: 5, mtimeMs: 1, mode: 0o644 },
    }
    expect(FileStatResultSchema.safeParse(result).success).toBe(true)
    expect(
      FileStatResultSchema.safeParse({ ...result, version: contentVersion(Buffer.from('abc')) })
        .success,
    ).toBe(false)
  })

  it.each([
    '/etc/file',
    '../file',
    'a/../file',
    'a//file',
    './a',
    'C:/a',
    'a\\b',
    'a\0b',
  ])('refuses nonrelative or nonnormalized target %s', (path) => {
    expect(FileTargetSchema.safeParse({ project: 'project-a', path }).success).toBe(false)
  })

  it('accepts the root directory and unicode file names without endpoint overrides', () => {
    expect(FileTargetSchema.safeParse({ project: 'project-a', path: '' }).success).toBe(true)
    expect(FileTargetSchema.safeParse({ project: 'project-a', path: 'docs/笔记.md' }).success).toBe(
      true,
    )
    expect(
      FileTargetSchema.safeParse({ project: 'project-a', path: 'docs/a', root: '/tmp' }).success,
    ).toBe(false)
  })

  it('bounds ranges and exposes truncation independently of byte content', () => {
    expect(
      FileRangeRequestSchema.safeParse({
        project: 'project-a',
        path: 'run.log',
        offset: Number.MAX_SAFE_INTEGER,
        length: 1,
      }).success,
    ).toBe(false)
    expect(
      FileRangeRequestSchema.safeParse({
        project: 'project-a',
        path: 'run.log',
        offset: 0,
        length: 0,
      }).success,
    ).toBe(false)
    const empty = {
      outcome: 'present',
      offset: 100,
      extent: 10,
      content: '',
      version: contentVersion(Buffer.alloc(0)),
      checkedAt: 1,
    }
    expect(FileRangeResultSchema.safeParse(empty).success).toBe(true)
    expect(
      FileRangeResultSchema.safeParse({
        ...empty,
        content: 'eA==',
        version: contentVersion(Buffer.from('x')),
      }).success,
    ).toBe(false)
  })

  it('requires complete conditional write preconditions and the shared lock version', () => {
    const request = {
      project: 'project-a',
      path: 'README.md',
      operation: 'replace',
      requestId: 'request-1',
      lockVersion: 1,
      content: 'eA==',
      precondition: { kind: 'match', expectedMtime: 1, expectedHash: 'a'.repeat(40) },
    }
    expect(FileMutationRequestSchema.safeParse(request).success).toBe(true)
    expect(FileMutationRequestSchema.safeParse({ ...request, lockVersion: 2 }).success).toBe(false)
    expect(
      FileMutationRequestSchema.safeParse({
        ...request,
        precondition: { kind: 'match', expectedMtime: 1 },
      }).success,
    ).toBe(false)
    expect(
      FileMutationRequestSchema.safeParse({ ...request, precondition: { kind: 'absent' } }).success,
    ).toBe(true)
  })

  it('bounds directory checks and refuses unrelated or duplicate prerequisites', () => {
    const check = {
      path: 'docs/a/README.md',
      precondition: { kind: 'match', expectedMtime: 1, expectedHash: 'a'.repeat(64) },
    }
    const request = {
      project: 'project-a',
      path: 'docs/a',
      operation: 'rename',
      requestId: 'guarded-move',
      lockVersion: 1,
      precondition: { kind: 'directory', expectedIdentity: contentVersion(Buffer.from('entry')) },
      destination: 'docs/b',
      destinationPrecondition: { kind: 'absent' },
      fileChecks: [check],
    }
    expect(FileMutationRequestSchema.safeParse(request).success).toBe(true)
    expect(
      FileMutationRequestSchema.safeParse({ ...request, fileChecks: [check, check] }).success,
    ).toBe(false)
    expect(
      FileMutationRequestSchema.safeParse({
        ...request,
        fileChecks: [{ ...check, path: 'docs/other/README.md' }],
      }).success,
    ).toBe(false)
    expect(
      FileMutationRequestSchema.safeParse({
        ...request,
        fileChecks: Array.from({ length: 33 }, (_, i) => ({ ...check, path: `docs/a/${i}.md` })),
      }).success,
    ).toBe(false)
  })

  it('keeps baseline compatibility independent of extra capabilities', () => {
    const capabilities = {
      protocolMajor: 1,
      sourceIdentity: 'source-a',
      writerLockVersion: 1,
      capabilities: ['read', 'future-feature'],
      limits: {
        maxBodyBytes: 1024,
        maxRangeBytes: 1024,
        maxBatchItems: 10,
        maxConcurrent: 2,
        replayRetentionMs: 1000,
      },
    }
    expect(FileCapabilitiesSchema.safeParse(capabilities).success).toBe(true)
    expect(requireFileCapabilities(capabilities, ['read'])).toEqual(capabilities)
    expect(() => requireFileCapabilities(capabilities, ['mutate'])).toThrow(
      'CAPABILITY_UNAVAILABLE',
    )
    expect(() => requireFileCapabilities({ ...capabilities, protocolMajor: 2 })).toThrow(
      'PROTOCOL_INCOMPATIBLE',
    )
  })

  it('refuses mutations of the project root and rename destinations outside the project', () => {
    const base = {
      project: 'project-a',
      path: '',
      operation: 'delete',
      requestId: 'request-1',
      lockVersion: 1,
      precondition: { kind: 'match', expectedMtime: 1, expectedHash: 'a'.repeat(40) },
    }
    expect(FileMutationRequestSchema.safeParse(base).success).toBe(false)
    expect(
      FileMutationRequestSchema.safeParse({
        ...base,
        path: 'docs/a',
        operation: 'rename',
        destination: '',
        destinationPrecondition: { kind: 'absent' },
      }).success,
    ).toBe(false)
    expect(
      FileMutationRequestSchema.safeParse({
        ...base,
        path: 'docs/a',
        operation: 'rename',
        destination: '../outside',
        destinationPrecondition: { kind: 'absent' },
      }).success,
    ).toBe(false)
  })

  it('keeps agent writes disabled until upgraded writers are acknowledged', () => {
    expect(() => assertAgentWriteEnabled({ readOnly: false })).toThrow('WRITER_UPGRADE_REQUIRED')
    expect(() =>
      assertAgentWriteEnabled({ readOnly: false, acknowledgedWriterLockVersion: 2 }),
    ).toThrow('WRITER_UPGRADE_REQUIRED')
    expect(() =>
      assertAgentWriteEnabled({ readOnly: true, acknowledgedWriterLockVersion: 1 }),
    ).toThrow('READ_ONLY')
    expect(() =>
      assertAgentWriteEnabled({ readOnly: false, acknowledgedWriterLockVersion: 1 }),
    ).not.toThrow()
    expect(new FileAccessError('CONFLICT').code).toBe('CONFLICT')
  })
})
