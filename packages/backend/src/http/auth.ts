// Service Bearer authentication for the Backend namespace.

import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { BackendServiceTokenSet } from './options.js'

const MAX_AUTHORIZATION_BYTES = 4096
const DUMMY_SERVICE_TOKEN = '00000000000000000000000000000000'

function constantTimeStringEqual(candidate: string, expected: string): boolean {
  const candidateBytes = Buffer.from(candidate, 'utf8')
  const expectedBytes = Buffer.from(expected, 'utf8')
  const compareLength = Math.max(candidateBytes.length, expectedBytes.length, 1)
  const paddedCandidate = Buffer.alloc(compareLength)
  const paddedExpected = Buffer.alloc(compareLength)
  candidateBytes.copy(paddedCandidate)
  expectedBytes.copy(paddedExpected)
  return (
    timingSafeEqual(paddedCandidate, paddedExpected) &&
    candidateBytes.length === expectedBytes.length
  )
}

function bearerToken(request: IncomingMessage): string | null {
  // Backend service auth is deliberately not a browser auth surface. Even a
  // valid Bearer token cannot be combined with browser or proxy credentials.
  if (
    request.headers.cookie !== undefined ||
    request.headers['proxy-authorization'] !== undefined
  ) {
    return null
  }

  const authorization = request.headers.authorization
  if (
    typeof authorization !== 'string' ||
    Buffer.byteLength(authorization) > MAX_AUTHORIZATION_BYTES
  ) {
    return null
  }
  const match = /^Bearer ([A-Za-z0-9_-]+)$/i.exec(authorization)
  return match?.[1] ?? null
}

export function authenticates(request: IncomingMessage, tokens: BackendServiceTokenSet): boolean {
  const candidate = bearerToken(request) ?? ''
  let matched = 0
  for (const [configured, active] of [
    [tokens.current, true],
    [tokens.next ?? DUMMY_SERVICE_TOKEN, tokens.next !== undefined],
  ] as const) {
    // Do not early-return: both rotation slots are compared for every request.
    const equal = constantTimeStringEqual(candidate, configured)
    matched |= Number(active) & Number(equal)
  }
  return matched !== 0
}
