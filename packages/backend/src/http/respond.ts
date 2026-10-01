// JSON response writers and bounded JSON request readers.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { TextDecoder } from 'node:util'
import {
  BackendCodeReviewPatchRequestSchema,
  BackendCommitMarkWriteRequestSchema,
  BackendDocumentWriteRequestSchema,
  type BackendErrorCode,
  BackendErrorResponseSchema,
} from '@memon/core'
import {
  MAX_BACKEND_CONTROL_JSON_BYTES,
  MAX_BACKEND_DOCUMENT_BODY_BYTES,
  MAX_BACKEND_GIT_CONTROL_BODY_BYTES,
} from './paths.js'

export function endJson(
  response: ServerResponse,
  status: number,
  payload: string,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  })
  response.end(payload)
}

export function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  maxBytes = MAX_BACKEND_CONTROL_JSON_BYTES,
  headers: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body)
  if (Buffer.byteLength(payload) > maxBytes) {
    const boundedError = JSON.stringify(
      BackendErrorResponseSchema.parse({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Backend control response exceeds the size limit',
          retryable: false,
        },
      }),
    )
    endJson(response, 500, boundedError)
    return
  }
  endJson(response, status, payload, headers)
}

export function writeError(
  response: ServerResponse,
  status: number,
  code: BackendErrorCode,
  message: string,
  retryable = false,
): void {
  writeJson(
    response,
    status,
    BackendErrorResponseSchema.parse({ error: { code, message, retryable } }),
  )
}

export class BackendControlBodyError extends Error {
  constructor(
    public readonly status: 400 | 413,
    public readonly code: Extract<BackendErrorCode, 'BAD_REQUEST' | 'PAYLOAD_TOO_LARGE'>,
    message: string,
  ) {
    super(message)
    this.name = 'BackendControlBodyError'
  }
}

export async function readBoundedJsonRequest(
  request: IncomingMessage,
  maxBytes: number,
): Promise<unknown> {
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw new BackendControlBodyError(400, 'BAD_REQUEST', 'JSON request body is required')
  }
  const declaredRaw = request.headers['content-length']
  if (declaredRaw !== undefined) {
    const declared = Number(declaredRaw)
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > maxBytes) {
      throw new BackendControlBodyError(
        413,
        'PAYLOAD_TOO_LARGE',
        'Backend JSON request exceeds the size limit',
      )
    }
  }

  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += bytes.byteLength
    if (total > maxBytes) {
      throw new BackendControlBodyError(
        413,
        'PAYLOAD_TOO_LARGE',
        'Backend JSON request exceeds the size limit',
      )
    }
    chunks.push(bytes)
  }

  let raw: unknown
  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
    raw = JSON.parse(json)
  } catch {
    throw new BackendControlBodyError(400, 'BAD_REQUEST', 'Backend JSON request is invalid')
  }
  return raw
}

export async function readDocumentWriteRequest(request: IncomingMessage) {
  const parsed = BackendDocumentWriteRequestSchema.safeParse(
    await readBoundedJsonRequest(request, MAX_BACKEND_DOCUMENT_BODY_BYTES),
  )
  if (!parsed.success) {
    throw new BackendControlBodyError(400, 'BAD_REQUEST', 'Document write request is invalid')
  }
  return parsed.data
}

export async function readCodeReviewPatchRequest(request: IncomingMessage) {
  const parsed = BackendCodeReviewPatchRequestSchema.safeParse(
    await readBoundedJsonRequest(request, MAX_BACKEND_DOCUMENT_BODY_BYTES),
  )
  if (!parsed.success) {
    throw new BackendControlBodyError(400, 'BAD_REQUEST', 'Code-review patch request is invalid')
  }
  return parsed.data
}

export async function readCommitMarkWriteRequest(request: IncomingMessage) {
  const parsed = BackendCommitMarkWriteRequestSchema.safeParse(
    await readBoundedJsonRequest(request, MAX_BACKEND_GIT_CONTROL_BODY_BYTES),
  )
  if (!parsed.success) {
    throw new BackendControlBodyError(400, 'BAD_REQUEST', 'Commit-mark request is invalid')
  }
  return parsed.data
}
