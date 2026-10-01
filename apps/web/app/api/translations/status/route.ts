import type { NextRequest } from 'next/server'
import { runCodexTranslation, TRANSLATION_MODEL } from '../../../../lib/server/translation/codex'
import {
  assertTranslationOwner,
  translationFailure,
  translationOptions,
  translationResponse,
  translationService,
} from '../../../../lib/server/translation/http'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    assertTranslationOwner(request)
    await (await translationService()).checkCache()
    await runCodexTranslation(translationOptions(), null, request.signal)
    return translationResponse({ ready: true, model: TRANSLATION_MODEL })
  } catch (error) {
    return translationFailure(error)
  }
}
