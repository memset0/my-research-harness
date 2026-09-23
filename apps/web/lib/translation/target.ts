/**
 * Translation direction. Shared by the reading UI, the HTTP layer and the
 * provider, so a single invocation, cache entry and queued batch always carry
 * exactly one target language.
 */
export const TRANSLATION_TARGETS = ['zh-CN', 'en'] as const
export type TranslationTarget = (typeof TRANSLATION_TARGETS)[number]

/** Language a document body is written in; a `zh` body reads in English. */
export type TranslationSourceLanguage = 'en' | 'zh'

/** Name used inside the provider prompts. */
export const TRANSLATION_TARGET_NAMES: Record<TranslationTarget, string> = {
  'zh-CN': 'Simplified Chinese',
  en: 'English',
}
