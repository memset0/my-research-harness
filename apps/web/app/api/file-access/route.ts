// Owner-only File access settings endpoint.
//
//   GET  /api/file-access[?windowMs=N]  → effective + pending settings, edit
//                                         revision, restart availability and a
//                                         bounded in-memory metrics snapshot.
//   PUT  /api/file-access               → persist pending settings only. This
//                                         never hot-applies and never restarts;
//                                         `restartRequired` in the response is
//                                         the honest signal that the running
//                                         process still uses the old values.
//
// Neither method touches project storage: `effective` comes from the config the
// process loaded at startup, `pending` from the local instance config file, and
// metrics from the Store's in-memory aggregates. A `storage: local` project is
// read directly inside the request and never reaches the Store, so it
// contributes no storage group and no samples to that snapshot.

import { getFileOperationMetrics } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { readIdentityFromRequest } from '@/lib/auth/request-context'
import { getRuntime } from '@/lib/runtime'
import {
  FileAccessSettingsError,
  type FileAccessSettingsErrorCode,
  fileAccessOptionsEqual,
  parseMetricsWindow,
  readPendingFileAccessSettings,
  resolveFileAccessOptions,
  resolveRestartAdapter,
  saveFileAccessSettings,
  validateFileAccessSettings,
} from '@/lib/server/file-access-settings'

export const dynamic = 'force-dynamic'

const RESPONSE_HEADERS = { 'Cache-Control': 'no-store' }

const STATUS_BY_ERROR_CODE: Record<FileAccessSettingsErrorCode, number> = {
  CONFIG_UNAVAILABLE: 503,
  CONFIG_SHAPE: 409,
  CONFIG_NOT_WRITABLE: 409,
  REVISION_CONFLICT: 409,
  SAVE_FAILED: 500,
}

const SaveRequestSchema = z
  .object({
    revision: z.string().min(1).max(256),
    settings: z.unknown(),
  })
  .strict()

function errorResponse(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    { error: { code, message }, ...extra },
    { status, headers: RESPONSE_HEADERS },
  )
}

function settingsError(error: FileAccessSettingsError): NextResponse {
  return errorResponse(
    STATUS_BY_ERROR_CODE[error.code],
    error.code,
    error.message,
    error.current ? { revision: error.current.revision, pending: error.current.pending } : undefined,
  )
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (readIdentityFromRequest(req).role !== 'owner') {
    return errorResponse(
      403,
      'FORBIDDEN',
      'file access settings and operator metrics are available only to the logged-in owner',
    )
  }

  const window = parseMetricsWindow(req.nextUrl.searchParams.get('windowMs'))
  if (!window.ok) return errorResponse(400, 'INVALID_WINDOW', window.message)

  try {
    const runtime = await getRuntime()
    const effective = resolveFileAccessOptions(runtime.config)
    const { pending, revision } = await readPendingFileAccessSettings(runtime.configPath)
    return NextResponse.json(
      {
        effective,
        pending,
        revision,
        restartRequired: !fileAccessOptionsEqual(effective, pending),
        restartAvailable: resolveRestartAdapter(runtime.config).status === 'available',
        cacheConfigured: runtime.config.fileCache !== undefined,
        metrics: getFileOperationMetrics(window.windowMs),
      },
      { headers: RESPONSE_HEADERS },
    )
  } catch (error) {
    if (error instanceof FileAccessSettingsError) return settingsError(error)
    return errorResponse(503, 'CONFIG_UNAVAILABLE', 'file access settings are unavailable')
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  if (readIdentityFromRequest(req).role !== 'owner') {
    return errorResponse(
      403,
      'FORBIDDEN',
      'file access settings may be changed only by the logged-in owner',
    )
  }

  const window = parseMetricsWindow(req.nextUrl.searchParams.get('windowMs'))
  if (!window.ok) return errorResponse(400, 'INVALID_WINDOW', window.message)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse(400, 'INVALID_BODY', 'request body must be JSON')
  }

  const request = SaveRequestSchema.safeParse(body)
  if (!request.success) {
    return errorResponse(
      400,
      'INVALID_BODY',
      'body must be {revision, settings} with the revision returned by GET /api/file-access',
    )
  }

  const validated = validateFileAccessSettings(request.data.settings)
  if (!validated.ok) {
    return errorResponse(400, 'INVALID_SETTINGS', 'the submitted settings are not valid', {
      issues: validated.issues,
    })
  }

  try {
    const runtime = await getRuntime()
    const saved = await saveFileAccessSettings({
      configPath: runtime.configPath,
      revision: request.data.revision,
      settings: validated.settings,
    })
    // Effective values intentionally come from the startup config: a save
    // changes the file, never the running scheduler.
    const effective = resolveFileAccessOptions(runtime.config)
    return NextResponse.json(
      {
        effective,
        pending: saved.pending,
        revision: saved.revision,
        restartRequired: !fileAccessOptionsEqual(effective, saved.pending),
        restartAvailable: resolveRestartAdapter(runtime.config).status === 'available',
        cacheConfigured: runtime.config.fileCache !== undefined,
        metrics: getFileOperationMetrics(window.windowMs),
      },
      { headers: RESPONSE_HEADERS },
    )
  } catch (error) {
    if (error instanceof FileAccessSettingsError) return settingsError(error)
    return errorResponse(500, 'SAVE_FAILED', 'could not save the file access settings')
  }
}
