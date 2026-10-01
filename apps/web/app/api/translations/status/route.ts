import type { NextRequest } from 'next/server'
import { runCodexTranslation, TRANSLATION_MODEL } from '../../../../lib/server/translation/codex'
import {
  assertTranslationOwner,
  translationFailure,
  translationOptions,
  translationResponse,
  translationService,
} from '../../../../lib/server/translation/http'
import { translationReadiness } from '../../../../lib/server/translation/readiness'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    assertTranslationOwner(request)
    // Disabled is decided from the environment, before any probe.
    const options = translationOptions()
    await translationReadiness(async () => {
      await (await translationService()).checkCache()
      await runCodexTranslation(options, null)
    })
    return translationResponse({ ready: true, model: TRANSLATION_MODEL })
  } catch (error) {
    return translationFailure(error)
  }
}
