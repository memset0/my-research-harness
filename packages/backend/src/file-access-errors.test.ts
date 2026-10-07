import { FileAccessError, type FileErrorCode } from '@memon/file-protocol'
import { describe, expect, it } from 'vitest'
import { toHttpError } from './http/errors.js'

describe('file source dependency failures', () => {
  it.each([
    ['CONFLICT', 409, 'CONFLICT'],
    ['FORBIDDEN', 503, 'FILE_SOURCE_FORBIDDEN'],
    ['UNAUTHORIZED', 503, 'FILE_SOURCE_FORBIDDEN'],
    ['READ_ONLY', 403, 'FORBIDDEN'],
    ['SOURCE_UNAVAILABLE', 503, 'FILE_SOURCE_UNAVAILABLE'],
    ['PROTOCOL_INCOMPATIBLE', 502, 'FILE_PROTOCOL_INCOMPATIBLE'],
    ['CAPABILITY_UNAVAILABLE', 501, 'FILE_CAPABILITY_UNAVAILABLE'],
    ['WRITER_UPGRADE_REQUIRED', 503, 'FILE_WRITER_UPGRADE_REQUIRED'],
    ['MUTATION_UNCERTAIN', 503, 'FILE_MUTATION_UNCERTAIN'],
    ['REPLAY_CONFLICT', 409, 'FILE_REPLAY_CONFLICT'],
    ['LIMIT_EXCEEDED', 429, 'FILE_LIMIT_EXCEEDED'],
  ] as const)('maps %s without confusing source credentials with browser login', (error, status, code) => {
    expect(toHttpError(new FileAccessError(error as FileErrorCode))).toMatchObject({ status, code })
  })
  it('recognizes the file error brand across duplicated server bundles', () => {
    const error = Object.assign(new Error('source failure'), {
      code: 'SOURCE_UNAVAILABLE',
      [Symbol.for('memon.file-access-error.v1')]: true,
    })
    expect(toHttpError(error)).toMatchObject({ status: 503, code: 'FILE_SOURCE_UNAVAILABLE' })
    expect(toHttpError({ code: 'SOURCE_UNAVAILABLE' })).toBeNull()
  })
})
