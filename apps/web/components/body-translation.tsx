'use client'

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import {
  literalSegment,
  packSegments,
  reconstructTranslation,
  type TranslationSegment,
} from '../lib/translation/segments'
import {
  sourceRevision,
  type TranslationDocument,
  type TranslationSource,
} from '../lib/translation/sources'
import type { TranslationSourceLanguage, TranslationTarget } from '../lib/translation/target'
import { useSession } from './session-provider'
import { Button } from './ui/button'

type State = {
  identity: string
  visible: boolean
  complete: boolean
  results: Record<string, string>
  errors: Record<string, string>
  done: number
  total: number
  running: boolean
  message: string
}
const Context = createContext<{
  active: boolean
  target: TranslationTarget
  results: Record<string, string>
  errors: Record<string, string>
} | null>(null)
export const useBodyTranslation = () => useContext(Context)

const MESSAGES: Record<string, string> = {
  TRANSLATION_DISABLED: 'Body translation is disabled',
  LOGIN_REQUIRED: 'Sign in to Codex with ChatGPT on the server',
  SPARK_UNAVAILABLE: 'Spark is unavailable for this account',
  QUOTA_EXHAUSTED: 'Spark quota exhausted. Try again later',
  UNTESTED_CODEX_VERSION: 'This Codex version has not passed translation isolation checks',
  SOURCE_CHANGED: 'Body text changed. Refresh before translating again',
  QUEUE_FULL: 'Translation queue is full. Try again later',
  TIMEOUT: 'Translation timed out',
  INVALID_RESULT: 'Translation format validation failed',
  CODEX_UNAVAILABLE: 'Codex was not found on the server',
  INVALID_AUTH_PATH: 'The server auth.json path is invalid or unreadable',
  CACHE_UNAVAILABLE: 'Translation cache unavailable. Check the server SQLite storage',
  PAYLOAD_TOO_LARGE: 'Body text exceeds the translation size limit',
  PROVIDER_FAILED: 'Translation failed. Try again',
  ISOLATION_UNAVAILABLE: 'Could not establish an isolated translation session',
}
const describe = (code: string) => MESSAGES[code] ?? 'Translation failed. Try again'
let lastReadingRoot: HTMLElement | null = null

function visible(element: Element): boolean {
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false
  for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor)
    if (style.display === 'none' || style.visibility === 'hidden') return false
  }
  return true
}

function selectedReadingRoot(target: Element | null): Element | undefined {
  const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter(
    visible,
  )
  const dialog = dialogs.at(-1)
  const roots = [...document.querySelectorAll('[data-slot="body-translation-root"]')].filter(
    (root) => visible(root) && (!dialog || dialog.contains(root)),
  )
  return (
    roots.find((root) => root === target?.closest('[data-slot="body-translation-root"]')) ??
    roots.find((root) => root === lastReadingRoot) ??
    roots[0]
  )
}

async function jsonRequest(url: string, options: RequestInit = {}) {
  const response = await fetch(url, { ...options, credentials: 'same-origin', cache: 'no-store' })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error?.code ?? 'PROVIDER_FAILED')
  return data
}

export function BodyTranslation({
  document: target,
  sources,
  sourceLanguage = 'en',
  children,
}: {
  document: TranslationDocument
  sources: TranslationSource[]
  /** Language the body is written in; a `zh` body is translated into English. */
  sourceLanguage?: TranslationSourceLanguage
  children: ReactNode
}) {
  const { role } = useSession()
  const targetLanguage: TranslationTarget = sourceLanguage === 'zh' ? 'en' : 'zh-CN'
  const identity = JSON.stringify([target, sources, targetLanguage])
  const currentIdentity = useRef(identity)
  currentIdentity.current = identity
  const abort = useRef<AbortController | null>(null)
  const root = useRef<HTMLDivElement | null>(null)
  const [state, setState] = useState<State | null>(null)
  const [availability, setAvailability] = useState<string | null>(null)
  const [readinessCheck, setReadinessCheck] = useState(0)
  const current = role === 'owner' && state?.identity === identity
  const active = current && state.visible
  const toggleCurrent = useRef<() => boolean>(() => false)
  toggleCurrent.current = () => {
    if (
      role !== 'owner' ||
      (!active && !(current && state.complete) && availability === 'TRANSLATION_DISABLED')
    )
      return false
    if (active) {
      abort.current?.abort()
      setState((previous) => previous && { ...previous, visible: false, running: false })
    } else if (current && state.complete) {
      setState((previous) => previous && { ...previous, visible: true })
    } else void translate(true)
    return true
  }

  useEffect(() => {
    if (role !== 'owner') return
    const toggle = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (event.code !== 'KeyT' && event.key.toLowerCase() !== 't')
      )
        return
      const target = event.target instanceof Element ? event.target : document.activeElement
      if (
        target?.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], .monaco-editor, .cm-editor',
        )
      )
        return
      const selected = selectedReadingRoot(target)
      if (selected === root.current && toggleCurrent.current()) event.preventDefault()
    }
    window.addEventListener('keydown', toggle, true)
    return () => window.removeEventListener('keydown', toggle, true)
  }, [role])

  // biome-ignore lint/correctness/useExhaustiveDependencies: readinessCheck is a re-check trigger bumped by the retry control
  useEffect(() => {
    if (role !== 'owner') return
    setAvailability(null)
    const controller = new AbortController()
    jsonRequest('/api/translations/status', { signal: controller.signal })
      .then(() => setAvailability('ready'))
      .catch((error: Error) => {
        if (!controller.signal.aborted) setAvailability(error.message)
      })
    return () => controller.abort()
  }, [role, readinessCheck])

  // biome-ignore lint/correctness/useExhaustiveDependencies: identity/role changes must abort an in-flight translation
  useEffect(() => {
    const stop = () => {
      abort.current?.abort()
      setState(null)
    }
    window.addEventListener('memon-translation-stop', stop)
    return () => {
      abort.current?.abort()
      window.removeEventListener('memon-translation-stop', stop)
    }
  }, [identity, role])

  async function translate(retry = false) {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    const previousResults = retry && current ? state!.results : {}
    setState({
      identity,
      visible: true,
      complete: false,
      results: previousResults,
      errors: {},
      done: 0,
      total: 0,
      running: true,
      message: '',
    })
    const update = (change: Partial<State> | ((previous: State) => Partial<State>)) => {
      if (controller.signal.aborted || currentIdentity.current !== identity) return
      setState((previous) =>
        previous?.identity === identity
          ? { ...previous, ...(typeof change === 'function' ? change(previous) : change) }
          : previous,
      )
    }
    try {
      const revision = await sourceRevision(sources)
      const params = new URLSearchParams({ ...target, revision, targetLanguage })
      if (!target.host) params.delete('host')
      const manifest = await jsonRequest(`/api/translations/body?${params}`, {
        signal: controller.signal,
      })
      if (manifest.revision !== revision) throw new Error('SOURCE_CHANGED')
      const readyResults = { ...previousResults }
      const cachedById = new Map<string, Array<{ sourceHash: string; text?: string }>>()
      for (const result of manifest.cachedResults ?? []) {
        const matches = cachedById.get(result.id) ?? []
        matches.push(result)
        cachedById.set(result.id, matches)
      }
      for (const segment of manifest.segments as TranslationSegment[]) {
        const matches = (cachedById.get(segment.id) ?? []).filter(
          (result) => result.sourceHash === segment.sourceHash,
        )
        const result = matches.length === 1 ? matches[0] : undefined
        if (typeof result?.text === 'string') readyResults[segment.id] = result.text
      }
      const pending: TranslationSegment[] = manifest.segments.filter(
        (segment: TranslationSegment) => readyResults[segment.id] === undefined,
      )
      const packed = packSegments(pending)
      const errors = Object.fromEntries(packed.oversized.map((id) => [id, 'PAYLOAD_TOO_LARGE']))
      update({
        results: readyResults,
        total: manifest.segments.length,
        done: manifest.segments.length - pending.length + packed.oversized.length,
        errors,
        message: manifest.segments.length
          ? ''
          : 'No eligible body text. Code, math, and embeds are unchanged.',
      })
      await Promise.all(
        packed.batches.map(async (batch, index) => {
          if (controller.signal.aborted) return
          const results: Record<string, string> = {}
          const failures: Record<string, string> = {}
          try {
            const response = await jsonRequest('/api/translations/body', {
              method: 'POST',
              signal: controller.signal,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                document: target,
                revision,
                targetLanguage,
                retry: index === 0,
                segments: batch.map(({ id, sourceHash }) => ({ id, sourceHash })),
              }),
            })
            if (response.revision !== revision) throw new Error('SOURCE_CHANGED')
            for (const segment of batch) {
              const matches = response.results.filter(
                (result: { id: string; sourceHash: string }) =>
                  result.id === segment.id && result.sourceHash === segment.sourceHash,
              )
              if (matches.length === 1 && typeof matches[0].text === 'string')
                results[segment.id] = matches[0].text
              else failures[segment.id] = matches[0]?.code ?? 'INVALID_RESULT'
            }
          } catch (error) {
            if ((error as Error).message === 'SOURCE_CHANGED') throw error
            if (controller.signal.aborted) return
            for (const segment of batch) failures[segment.id] = (error as Error).message
          }
          update((previous) => ({
            results: { ...previous.results, ...results },
            errors: { ...previous.errors, ...failures },
            done: previous.done + batch.length,
          }))
        }),
      )
      update((previous) => ({ complete: Object.keys(previous.errors).length === 0 }))
    } catch (error) {
      if (!controller.signal.aborted) {
        if ((error as Error).message === 'SOURCE_CHANGED') {
          update({ results: {}, errors: {}, running: false, message: describe('SOURCE_CHANGED') })
          controller.abort()
        } else update({ message: describe((error as Error).message) })
      }
    } finally {
      update({ running: false })
    }
  }

  return (
    <Context.Provider
      value={{
        active: !!active,
        target: targetLanguage,
        results: active ? state!.results : {},
        errors: active ? state!.errors : {},
      }}
    >
      <div
        ref={root}
        className="contents"
        data-slot="body-translation-root"
        onPointerDownCapture={() => {
          lastReadingRoot = root.current
        }}
        onFocusCapture={() => {
          lastReadingRoot = root.current
        }}
      >
        {role === 'owner' && (
          <div
            className="not-prose my-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
            data-slot="body-translation-controls"
          >
            <Button
              size="sm"
              variant="outline"
              aria-keyshortcuts="Alt+T"
              aria-pressed={!!active}
              disabled={
                !active && !(current && state.complete) && availability === 'TRANSLATION_DISABLED'
              }
              onClick={() => toggleCurrent.current()}
            >
              {active
                ? 'Show original'
                : targetLanguage === 'en'
                  ? 'Translate to English'
                  : 'Translate to Chinese'}
            </Button>
            {active &&
              !state!.running &&
              (Object.keys(state!.errors).length > 0 || state!.message) && (
                <Button size="sm" variant="outline" onClick={() => void translate(true)}>
                  Retry unfinished segments
                </Button>
              )}
            <span>
              Body text is sent to Codex using the server's Spark quota. Source files are unchanged.
            </span>
            <span>Alt+T toggles translation / original</span>
            {availability && availability !== 'ready' && (
              <span role="status">{describe(availability)}</span>
            )}
            {availability && availability !== 'ready' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setReadinessCheck((value) => value + 1)}
              >
                Check service again
              </Button>
            )}
            {active && (
              <span role="status">
                {state!.running ? 'Translating ' : 'Processed '}
                {state!.done}/{state!.total} segments
                {Object.keys(state!.errors).length > 0
                  ? ` · ${Object.keys(state!.errors).length} failed`
                  : ''}
                {state!.message ? ` · ${state!.message}` : ''}
              </span>
            )}
          </div>
        )}
        {children}
      </div>
    </Context.Provider>
  )
}

export function TranslationText({
  segment,
  render,
}: {
  segment: TranslationSegment
  render: (markdown: string) => ReactNode
}) {
  const context = useBodyTranslation()
  if (!context?.active) return null
  const text = context.results[segment.id]
  if (text === undefined) {
    return context.errors[segment.id] ? (
      <span className="mt-1 block text-xs text-muted-foreground" role="status">
        {describe(context.errors[segment.id]!)}
      </span>
    ) : null
  }
  const markdown = reconstructTranslation(segment, text)
  const chinese = context.target === 'zh-CN'
  if (markdown === null)
    return (
      <span role="status">
        {chinese ? '译文格式校验失败' : 'Translation format validation failed'}
      </span>
    )
  return (
    <span
      lang={context.target}
      className="mt-1 block border-l-2 border-primary/30 pl-3 text-foreground"
      data-slot="body-translation"
      role="note"
      aria-label={chinese ? '机器译文' : 'Machine translation'}
    >
      {render(markdown)}
    </span>
  )
}

export function TranslatedLiteral({
  children,
  original,
}: {
  children: string
  original?: ReactNode
}) {
  const segment = literalSegment(children)
  return (
    <>
      {original ?? children}
      {segment && (
        <TranslationText
          segment={segment}
          render={(markdown) => (
            <ReactMarkdown skipHtml components={{ p: 'span' }}>
              {markdown}
            </ReactMarkdown>
          )}
        />
      )}
    </>
  )
}
