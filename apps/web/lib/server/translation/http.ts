import 'server-only'

import { BackendDocumentServiceError, BackendProjectServiceError } from '@memon/backend'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { type TranslationDocument, translationSources } from '../../translation/sources'
import { TRANSLATION_TARGETS, type TranslationTarget } from '../../translation/target'
import { publicOrigin } from '../auth/public-url'
import { readIdentityFromRequest } from '../auth/request-context'
import { proxyCentralApiRequest } from '../central/backend-proxy'
import { directCentralRuntime } from '../central/direct-runtime'
import { getCentralFleet } from '../central/fleet-runtime'
import { getRuntime } from '../runtime'
import { standaloneServices } from '../standalone-services'
import { getTranslationCache } from './cache'
import { runCodexTranslation, TRANSLATION_MODEL, TranslationError } from './codex'
import { createTranslationManifest } from './manifest'
import { BodyTranslationService } from './service'

const selector = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => !/[\\/\0]/.test(value) && !['.', '..'].includes(value))
export const TranslationDocumentSchema = z
  .object({
    host: selector.optional(),
    project: selector,
    kind: z.enum(['experiment', 'wiki', 'report']),
    id: selector,
  })
  .strict()
  .refine((value) =>
    ({ experiment: /^E\d{4}-[a-z0-9-]+$/, wiki: /^W\d{4}$/, report: /^R\d{4}$/ })[value.kind].test(
      value.id,
    ),
  )
export const TranslationTargetSchema = z.enum(TRANSLATION_TARGETS)
export const TranslationRequestSchema = z
  .object({
    document: TranslationDocumentSchema,
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    targetLanguage: TranslationTargetSchema,
    segments: z
      .array(z.object({ id: z.string().max(128), sourceHash: z.string().max(32) }).strict())
      .min(1)
      .max(24),
    retry: z.boolean().optional(),
  })
  .strict()

export function assertTranslationOwner(request: NextRequest, mutating = false) {
  if (readIdentityFromRequest(request).role !== 'owner')
    throw new TranslationError('UNAUTHORIZED', 401)
  if (mutating) {
    const origin = request.headers.get('origin')
    if (
      request.headers.get('sec-fetch-site') === 'cross-site' ||
      (origin && origin !== publicOrigin(request))
    )
      throw new TranslationError('INVALID_ORIGIN', 403)
    if (
      !origin &&
      request.headers.has('cookie') &&
      !request.headers.get('authorization')?.startsWith('Basic ')
    )
      throw new TranslationError('INVALID_ORIGIN', 403)
  }
}

export function translationOptions() {
  if (process.env.MEMON_TRANSLATION_ENABLED !== '1')
    throw new TranslationError('TRANSLATION_DISABLED')
  return {
    executable: process.env.MEMON_TRANSLATION_CODEX || 'codex',
    authJson: process.env.MEMON_TRANSLATION_AUTH_JSON,
  }
}

export function translationResponse(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
}

export function translationFailure(error: unknown) {
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return translationResponse({ error: { code: 'BAD_REQUEST' } }, 400)
  const failure =
    error instanceof TranslationError ? error : new TranslationError('DOCUMENT_UNAVAILABLE')
  return translationResponse({ error: { code: failure.code } }, failure.status)
}

export async function boundedTranslationJson(
  request: Request | Response,
  limit: number,
): Promise<unknown> {
  const reader = request.body?.getReader()
  if (!reader) throw new TranslationError('BAD_REQUEST', 400)
  let bytes = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > limit) {
        await reader.cancel()
        throw new TranslationError('PAYLOAD_TOO_LARGE', 413)
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const combined = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(combined))
}

export async function loadTranslationManifest(document: TranslationDocument, signal?: AbortSignal) {
  const runtime = await getRuntime()
  let data: unknown
  if (document.host) {
    const resource = { experiment: 'experiments', wiki: 'wiki', report: 'reports' }[document.kind]
    const search = new URLSearchParams({ host: document.host, project: document.project })
    const request = new Request(
      `http://localhost/api/${resource}/${encodeURIComponent(document.id)}?${search}`,
      { signal },
    )
    const direct = directCentralRuntime(runtime.config)
    let response: Response
    if (direct.registry.capabilities(document.host))
      response = await direct.dispatch({ request, actor: { role: 'owner' } })
    else if (runtime.config.central)
      response = await proxyCentralApiRequest(request, {
        registry: (await getCentralFleet()).registry,
        actor: { role: 'owner' },
      })
    else throw new TranslationError('NOT_FOUND', 404)
    if (!response.ok)
      throw new TranslationError(
        response.status === 404 ? 'NOT_FOUND' : 'DOCUMENT_UNAVAILABLE',
        response.status === 404 ? 404 : 503,
      )
    data = await boundedTranslationJson(response, 5 * 1024 * 1024)
  } else {
    if (
      !runtime.config.projects.some(
        (project) => project.name === document.project && project.host === undefined,
      )
    )
      throw new TranslationError('NOT_FOUND', 404)
    const services = standaloneServices(runtime.config)
    try {
      data =
        document.kind === 'experiment'
          ? await services.projects.getExperiment(document.project, document.id)
          : document.kind === 'wiki'
            ? await services.documents.getWiki(document.project, document.id)
            : await services.documents.getReport(document.project, document.id)
    } catch (error) {
      if (
        (error instanceof BackendDocumentServiceError ||
          error instanceof BackendProjectServiceError) &&
        ['PROJECT_NOT_FOUND', 'RESOURCE_NOT_FOUND'].includes(error.code)
      )
        throw new TranslationError('NOT_FOUND', 404)
      throw new TranslationError('DOCUMENT_UNAVAILABLE')
    }
  }
  return createTranslationManifest(translationSources(document.kind, data))
}

const state = globalThis as typeof globalThis & {
  __memonBodyTranslation?: { key: string; service: BodyTranslationService }
}
export async function translationService() {
  const options = translationOptions()
  const { configPath } = await getRuntime()
  const key = JSON.stringify([options, configPath])
  if (!state.__memonBodyTranslation || state.__memonBodyTranslation.key !== key) {
    state.__memonBodyTranslation = {
      key,
      service: new BodyTranslationService(
        (prompt, signal, target) => runCodexTranslation(options, { prompt, target }, signal),
        Date.now,
        getTranslationCache(configPath),
      ),
    }
  }
  return state.__memonBodyTranslation.service
}

export function translationCacheKey(
  document: TranslationDocument,
  revision: string,
  target: TranslationTarget,
) {
  return JSON.stringify([
    document.host ?? null,
    document.project,
    document.kind,
    document.id,
    revision,
    target,
    TRANSLATION_MODEL,
    'body-v1',
  ])
}
