import { createHash } from 'node:crypto'
import { z } from 'zod'

// These versions describe file primitives and cooperating writer locks,
// independently of both memon's business release and project file convention.
export const FILE_PROTOCOL_MAJOR = 1
export const FILE_WRITER_LOCK_VERSION = 1
export const MAX_DIRECTORY_FILE_CHECKS = 32

const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const opaqueId = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_.:-]+$/)

export const RelativeFilePathSchema = z
  .string()
  .max(4096)
  .refine(
    (path) =>
      path === '' ||
      (!path.startsWith('/') &&
        !/^[A-Za-z]:/.test(path) &&
        !path.includes('\\') &&
        [...path].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127) &&
        path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')),
    'must be a normalized project-relative path',
  )

export const FileTargetSchema = z
  .object({ project: opaqueId, path: RelativeFilePathSchema })
  .strict()

export const ContentVersionSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)

export const ConditionalOptionsSchema = z
  .object({ knownVersion: ContentVersionSchema.optional() })
  .strict()

export const FileErrorCodeSchema = z.enum([
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'OUTSIDE_PROJECT',
  'SOURCE_UNAVAILABLE',
  'IO_ERROR',
  'CONFLICT',
  'READ_ONLY',
  'WRITER_UPGRADE_REQUIRED',
  'LIMIT_EXCEEDED',
  'PROTOCOL_INCOMPATIBLE',
  'CAPABILITY_UNAVAILABLE',
  'REPLAY_CONFLICT',
  'MUTATION_UNCERTAIN',
  'READ_HANDLE_EXPIRED',
])

export const FileErrorSchema = z
  .object({
    code: FileErrorCodeSchema,
    retryAfterMs: safeInteger.optional(),
  })
  .strict()

export type FileErrorCode = z.infer<typeof FileErrorCodeSchema>

const FILE_ACCESS_ERROR_BRAND = Symbol.for('memon.file-access-error.v1')
export class FileAccessError extends Error {
  readonly [FILE_ACCESS_ERROR_BRAND] = true
  constructor(
    public readonly code: FileErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options)
    this.name = 'FileAccessError'
  }
}

export function isFileAccessError(value: unknown): value is FileAccessError {
  return (
    typeof value === 'object' &&
    value !== null &&
    Reflect.get(value, FILE_ACCESS_ERROR_BRAND) === true &&
    FileErrorCodeSchema.safeParse(Reflect.get(value, 'code')).success
  )
}

export const FileMetadataSchema = z
  .object({
    fileId: ContentVersionSchema.optional(),
    kind: z.enum(['file', 'directory', 'symlink', 'other']),
    size: safeInteger,
    mtimeMs: z.number().finite(),
    mode: safeInteger.max(0o177777),
    identity: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
    ino: safeInteger.optional(),
    dev: safeInteger.optional(),
    ctimeMs: z.number().finite().optional(),
  })
  .strip()

// JSON transport uses canonical base64, avoiding lossy UTF-8 decoding.
const bytesSchema = z
  .string()
  .refine(
    (value) =>
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) &&
      Buffer.from(value, 'base64').toString('base64') === value,
    'must be canonical base64',
  )

const checkedAtSchema = z.number().finite().nonnegative()
const missingSchema = z
  .object({ outcome: z.literal('missing'), checkedAt: checkedAtSchema })
  .strict()
const unchangedSchema = z
  .object({
    outcome: z.literal('unchanged'),
    version: ContentVersionSchema,
    checkedAt: checkedAtSchema,
  })
  .strict()

export function contentVersion(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

const presentReadSchema = z
  .object({
    outcome: z.literal('present'),
    content: bytesSchema,
    version: ContentVersionSchema,
    checkedAt: checkedAtSchema,
  })
  .strict()

export const FileReadResultSchema = z
  .discriminatedUnion('outcome', [presentReadSchema, unchangedSchema, missingSchema])
  .superRefine((result, context) => {
    if (
      result.outcome === 'present' &&
      contentVersion(Buffer.from(result.content, 'base64')) !== result.version
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['version'],
        message: 'version must identify returned bytes',
      })
    }
  })

export type FileReadResult = z.infer<typeof FileReadResultSchema>

export function conditionalFileResult(
  bytes: Uint8Array,
  checkedAt: number,
  knownVersion?: string,
): FileReadResult {
  const version = contentVersion(bytes)
  return FileReadResultSchema.parse(
    knownVersion === version
      ? { outcome: 'unchanged', version, checkedAt }
      : { outcome: 'present', content: Buffer.from(bytes).toString('base64'), version, checkedAt },
  )
}

export const DirectoryEntrySchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(255)
      .refine(
        (name) =>
          !name.includes('/') &&
          !name.includes('\\') &&
          !name.includes('\0') &&
          name !== '.' &&
          name !== '..',
      ),
    kind: FileMetadataSchema.shape.kind,
  })
  .strict()

export type DirectoryEntry = z.infer<typeof DirectoryEntrySchema>

export function directoryVersion(entries: readonly DirectoryEntry[]): string {
  const normalized = entries.map((entry) => DirectoryEntrySchema.parse(entry))
  normalized.sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)))
  if (new Set(normalized.map((entry) => entry.name)).size !== normalized.length) {
    throw new FileAccessError('BAD_REQUEST')
  }
  const hash = createHash('sha256')
  const kinds = { file: 1, directory: 2, symlink: 3, other: 4 }
  for (const entry of normalized) {
    const name = Buffer.from(entry.name)
    const length = Buffer.alloc(4)
    length.writeUInt32BE(name.length)
    hash
      .update(length)
      .update(name)
      .update(Buffer.from([kinds[entry.kind]]))
  }
  return `sha256:${hash.digest('hex')}`
}

const presentListSchema = z
  .object({
    outcome: z.literal('present'),
    entries: z.array(DirectoryEntrySchema),
    version: ContentVersionSchema,
    checkedAt: checkedAtSchema,
  })
  .strict()

export const DirectoryListResultSchema = z
  .discriminatedUnion('outcome', [presentListSchema, unchangedSchema, missingSchema])
  .superRefine((result, context) => {
    if (result.outcome !== 'present') return
    try {
      if (directoryVersion(result.entries) === result.version) return
    } catch {
      // Duplicate names and invalid entries are protocol errors too.
    }
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['version'],
      message: 'version must identify distinct directory entries',
    })
  })

export function conditionalDirectoryResult(
  entries: readonly DirectoryEntry[],
  checkedAt: number,
  knownVersion?: string,
): z.infer<typeof DirectoryListResultSchema> {
  const version = directoryVersion(entries)
  return DirectoryListResultSchema.parse(
    knownVersion === version
      ? { outcome: 'unchanged', version, checkedAt }
      : { outcome: 'present', entries, version, checkedAt },
  )
}

export const FileStatResultSchema = z.discriminatedUnion('outcome', [
  z
    .object({
      outcome: z.literal('present'),
      metadata: FileMetadataSchema,
      checkedAt: checkedAtSchema,
    })
    .strict(),
  missingSchema,
])

export const FileRangeRequestSchema = FileTargetSchema.extend({
  offset: safeInteger,
  length: safeInteger.positive(),
})
  .strict()
  .refine(
    (request) => Number.isSafeInteger(request.offset + request.length),
    'range end must be safe',
  )

export const FileRangeResultSchema = z
  .object({
    outcome: z.literal('present'),
    offset: safeInteger,
    extent: safeInteger,
    content: bytesSchema,
    version: ContentVersionSchema,
    checkedAt: checkedAtSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const bytes = Buffer.from(result.content, 'base64')
    if (
      bytes.length > Math.max(0, result.extent - result.offset) ||
      contentVersion(bytes) !== result.version
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'invalid range extent or content version',
      })
    }
  })

export const FileReadHandleSchema = z.discriminatedUnion('outcome', [
  z
    .object({
      outcome: z.literal('present'),
      readToken: opaqueId,
      metadata: FileMetadataSchema,
      leaseMs: safeInteger.positive(),
      checkedAt: checkedAtSchema,
    })
    .strict(),
  missingSchema,
])
export type FileReadHandle = z.infer<typeof FileReadHandleSchema>
export const FileReadAtRequestSchema = z
  .object({
    project: opaqueId,
    readToken: opaqueId,
    offset: safeInteger,
    length: safeInteger.positive(),
  })
  .strict()
  .refine(
    (request) => Number.isSafeInteger(request.offset + request.length),
    'range end must be safe',
  )

export const FileFingerprintSchema = z
  .object({
    kind: z.literal('match'),
    expectedMtime: z.number().finite(),
    expectedHash: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
  })
  .strict()
export const DirectoryFileCheckSchema = z
  .object({
    path: RelativeFilePathSchema.refine((path) => path.length > 0),
    precondition: FileFingerprintSchema,
  })
  .strict()

export const MutationPreconditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('absent') }).strict(),
  z.object({ kind: z.literal('directory'), expectedIdentity: ContentVersionSchema }).strict(),
  z.object({ kind: z.literal('entry'), expectedIdentity: ContentVersionSchema }).strict(),
  FileFingerprintSchema,
])

const mutationBase = FileTargetSchema.extend({
  path: RelativeFilePathSchema.refine((path) => path.length > 0, 'cannot mutate project root'),
  requestId: opaqueId,
  lockVersion: z.literal(FILE_WRITER_LOCK_VERSION),
})

export const FileMutationRequestSchema = z
  .discriminatedUnion('operation', [
    mutationBase
      .extend({
        operation: z.literal('replace'),
        precondition: MutationPreconditionSchema,
        content: bytesSchema,
        mode: safeInteger.max(0o7777).optional(),
      })
      .strict(),
    mutationBase
      .extend({ operation: z.literal('delete'), precondition: MutationPreconditionSchema })
      .strict(),
    mutationBase
      .extend({
        operation: z.literal('rename'),
        precondition: MutationPreconditionSchema,
        destination: RelativeFilePathSchema.refine(
          (path) => path.length > 0,
          'cannot replace project root',
        ),
        destinationPrecondition: MutationPreconditionSchema,
        fileChecks: z.array(DirectoryFileCheckSchema).max(MAX_DIRECTORY_FILE_CHECKS).optional(),
      })
      .strict(),
    mutationBase
      .extend({
        operation: z.literal('mkdir'),
        recursive: z.boolean().default(false),
        mode: safeInteger.max(0o7777).optional(),
      })
      .strict(),
  ])
  .superRefine((request, context) => {
    if (request.operation !== 'rename' || !request.fileChecks?.length) return
    if (
      request.precondition.kind !== 'directory' ||
      request.fileChecks.some((check) => !check.path.startsWith(`${request.path}/`)) ||
      new Set(request.fileChecks.map((check) => check.path)).size !== request.fileChecks.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'file checks must be distinct descendants of a directory rename',
      })
    }
  })

export type FileMutationRequest = z.infer<typeof FileMutationRequestSchema>

export const FileCapabilitiesSchema = z
  .object({
    protocolMajor: safeInteger.positive(),
    sourceIdentity: opaqueId,
    writerLockVersion: safeInteger.positive(),
    capabilities: z.array(z.string().min(1).max(64)),
    limits: z
      .object({
        maxBodyBytes: safeInteger.positive(),
        maxRangeBytes: safeInteger.positive(),
        maxBatchItems: safeInteger.positive(),
        maxConcurrent: safeInteger.positive(),
        replayRetentionMs: safeInteger.positive(),
        maxReadHandles: safeInteger.positive().optional(),
        readHandleIdleMs: safeInteger.positive().optional(),
      })
      .strip(),
  })
  .strip()

export function requireFileCapabilities(
  input: unknown,
  required: readonly string[] = [],
): z.infer<typeof FileCapabilitiesSchema> {
  const value = FileCapabilitiesSchema.parse(input)
  if (value.protocolMajor !== FILE_PROTOCOL_MAJOR)
    throw new FileAccessError('PROTOCOL_INCOMPATIBLE')
  if (required.some((name) => !value.capabilities.includes(name)))
    throw new FileAccessError('CAPABILITY_UNAVAILABLE')
  return value
}

export function assertAgentWriteEnabled(input: {
  readOnly: boolean
  acknowledgedWriterLockVersion?: number
}): void {
  if (input.readOnly) throw new FileAccessError('READ_ONLY')
  if (input.acknowledgedWriterLockVersion !== FILE_WRITER_LOCK_VERSION) {
    throw new FileAccessError('WRITER_UPGRADE_REQUIRED')
  }
}

export interface FileAdapter {
  readonly sourceIdentity: string
  readonly authorityIdentity?: string
  read(
    target: z.infer<typeof FileTargetSchema>,
    options?: z.infer<typeof ConditionalOptionsSchema>,
  ): Promise<FileReadResult>
  list(
    target: z.infer<typeof FileTargetSchema>,
    options?: z.infer<typeof ConditionalOptionsSchema>,
  ): Promise<z.infer<typeof DirectoryListResultSchema>>
  stat(
    target: z.infer<typeof FileTargetSchema>,
    follow?: boolean,
  ): Promise<z.infer<typeof FileStatResultSchema>>
  resolve(target: z.infer<typeof FileTargetSchema>): Promise<string>
  readRange(
    request: z.infer<typeof FileRangeRequestSchema>,
  ): Promise<z.infer<typeof FileRangeResultSchema> | z.infer<typeof missingSchema>>
  openRead?(target: z.infer<typeof FileTargetSchema>): Promise<FileReadHandle>
  readAt?(
    request: z.infer<typeof FileReadAtRequestSchema>,
  ): Promise<z.infer<typeof FileRangeResultSchema>>
  closeRead?(target: { project: string; readToken: string }): Promise<void>
  mutate(request: z.infer<typeof FileMutationRequestSchema>): Promise<void>
}
