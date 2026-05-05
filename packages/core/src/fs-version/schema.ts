import type { FsVersionRecord } from './types.js'

export class FsVersionSchemaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FsVersionSchemaError'
  }
}

const ISO8601_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)$/

/**
 * Validate that an unknown value matches the `FsVersionRecord` schema.
 * Throws `FsVersionSchemaError` on violation, naming the offending field.
 */
export function validateFsVersionRecord(value: unknown): FsVersionRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new FsVersionSchemaError(`expected object, got ${describe(value)}`)
  }
  const v = value as Record<string, unknown>

  if (typeof v.fs_convention_version !== 'number' || !Number.isInteger(v.fs_convention_version) || v.fs_convention_version < 1) {
    throw new FsVersionSchemaError(
      `field "fs_convention_version" must be a positive integer; got ${describe(v.fs_convention_version)}`,
    )
  }

  if (typeof v.installed_at !== 'string' || !ISO8601_OFFSET.test(v.installed_at)) {
    throw new FsVersionSchemaError(
      `field "installed_at" must be an ISO8601 string with timezone offset; got ${describe(v.installed_at)}`,
    )
  }

  if (v.last_migrated_at !== null) {
    if (typeof v.last_migrated_at !== 'string' || !ISO8601_OFFSET.test(v.last_migrated_at)) {
      throw new FsVersionSchemaError(
        `field "last_migrated_at" must be null or an ISO8601 string with timezone offset; got ${describe(v.last_migrated_at)}`,
      )
    }
  }

  return {
    fs_convention_version: v.fs_convention_version,
    installed_at: v.installed_at,
    last_migrated_at: v.last_migrated_at as string | null,
  }
}

function describe(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}
