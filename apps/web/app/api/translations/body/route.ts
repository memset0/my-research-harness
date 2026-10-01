import type { NextRequest } from 'next/server'
import { TranslationError } from '../../../../lib/server/translation/codex'
import {
  assertTranslationOwner,
  boundedTranslationJson,
  loadTranslationManifest,
  TranslationDocumentSchema,
  TranslationRequestSchema,
  TranslationTargetSchema,
  translationCacheKey,
  translationFailure,
  translationOptions,
  translationResponse,
  translationService,
} from '../../../../lib/server/translation/http'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    assertTranslationOwner(request)
    translationOptions()
    const params = new URL(request.url).searchParams
    const document = TranslationDocumentSchema.parse({
      host: params.get('host') ?? undefined,
      project: params.get('project'),
      kind: params.get('kind'),
      id: params.get('id'),
    })
    const target = TranslationTargetSchema.parse(params.get('targetLanguage') ?? 'zh-CN')
    const manifest = await loadTranslationManifest(document, request.signal)
    if (params.get('revision') !== manifest.revision)
      throw new TranslationError('SOURCE_CHANGED', 409)
    const cachedResults = await (await translationService()).cached(
      translationCacheKey(document, manifest.revision, target),
      manifest.segments,
      request.signal,
    )
    return translationResponse({
      revision: manifest.revision,
      cachedResults,
      segments: manifest.segments.map(({ id, sourceHash, text }) => ({ id, sourceHash, text })),
    })
  } catch (error) {
    return translationFailure(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    assertTranslationOwner(request, true)
    const body = TranslationRequestSchema.parse(await boundedTranslationJson(request, 32 * 1024))
    translationOptions()
    const manifest = await loadTranslationManifest(body.document, request.signal)
    if (manifest.revision !== body.revision) throw new TranslationError('SOURCE_CHANGED', 409)
    const lookup = new Map(manifest.segments.map((segment) => [segment.id, segment]))
    if (new Set(body.segments.map((segment) => segment.id)).size !== body.segments.length)
      throw new TranslationError('BAD_REQUEST', 400)
    const segments = body.segments.map((requested) => {
      const segment = lookup.get(requested.id)
      if (!segment || segment.sourceHash !== requested.sourceHash)
        throw new TranslationError('SOURCE_CHANGED', 409)
      return segment
    })
    const results = await (await translationService()).translate(
      translationCacheKey(body.document, body.revision, body.targetLanguage),
      body.targetLanguage,
      segments,
      request.signal,
      body.retry,
    )
    const current = await loadTranslationManifest(body.document, request.signal)
    if (current.revision !== body.revision) throw new TranslationError('SOURCE_CHANGED', 409)
    return translationResponse({ revision: body.revision, results })
  } catch (error) {
    return translationFailure(error)
  }
}
