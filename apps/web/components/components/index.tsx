'use client'

import { AlertTriangle, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { stripHiddenKeys } from '../../lib/components/payload'
import { type ResolvedBlock, validatePayload } from '../../lib/components/registry'
import { GENERATED_RENDERERS } from '../../lib/components/renderers.generated'
import type { ComponentBlockContext, ComponentDocumentRef } from '../../lib/components/types'
import { docAssetUrl } from '../../lib/components/urls'
import { useComponentCache } from './cache'
import { RecomputeButton } from './recompute-button'

export function hasComponentRenderer(type: string, version: number): boolean {
  return `${type}@${version}` in GENERATED_RENDERERS
}

export function ComponentBlockView({
  block,
  document,
}: {
  block: ResolvedBlock
  document?: ComponentDocumentRef
}) {
  const context: ComponentBlockContext | null =
    block.version === null
      ? null
      : {
          type: block.type,
          version: block.version,
          id: block.id,
          line: block.line,
          payload: block.payload,
          executable: block.executable,
          document: document ?? null,
          resourceUrl: (target) => (document ? docAssetUrl(document, target) : null),
        }
  return (
    <div
      className="not-prose my-4 min-w-0 space-y-2"
      data-component-block=""
      data-component-type={`${block.type}@${block.version ?? '?'}`}
      data-component-id={block.id ?? undefined}
    >
      {context && block.executable && <RecomputeButton block={context} />}
      {context && block.executable && document && block.id ? (
        <ExecutableBlock block={block} context={context} document={document} id={block.id} />
      ) : block.data && context ? (
        <ValidatedRender data={block.data} context={context} />
      ) : (
        <InvalidBlock block={block} />
      )}
    </div>
  )
}

function ValidatedRender({
  data,
  context,
}: {
  data: Record<string, unknown>
  context: ComponentBlockContext
}) {
  const Render = GENERATED_RENDERERS[`${context.type}@${context.version}`]
  if (!Render)
    return (
      <Notice>
        Renderer unavailable for {context.type}@{context.version}.
      </Notice>
    )
  return <>{Render({ data, block: context })}</>
}

function ExecutableBlock({
  block,
  context,
  document,
  id,
}: {
  block: ResolvedBlock
  context: ComponentBlockContext
  document: ComponentDocumentRef
  id: string
}) {
  const cache = useComponentCache(document, id)
  if (cache.phase === 'loading')
    return (
      <Notice>
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Loading cached result…
      </Notice>
    )
  if (cache.phase === 'notComputed') {
    return (
      <Notice>
        This component has not been computed. Run{' '}
        <code>
          memon components run {document.path} --id {id}
        </code>
        .
      </Notice>
    )
  }
  if (cache.phase === 'error')
    return <InvalidBlock block={block} notice={`Unable to load cached result: ${cache.message}`} />
  const cachedId = cache.value.__component_id
  const cachedType = cache.value.__component_type
  const expectedType = `${context.type}@${context.version}`
  if (cachedId !== id || cachedType !== expectedType) {
    return (
      <InvalidBlock
        block={block}
        notice={`Cached result is stale: expected ${id} / ${expectedType}.`}
      />
    )
  }
  const lastError = cache.value.__last_error
  const lastErrorMessage =
    lastError && typeof lastError === 'object' && 'message' in lastError
      ? String(lastError.message)
      : null
  const validation = validatePayload(context.type, context.version, stripHiddenKeys(cache.value))
  if (!validation.ok) {
    const field = validation.field ? ` field ${validation.field}` : ''
    return (
      <>
        {lastErrorMessage && (
          <Notice tone="error">Last recompute failed: {lastErrorMessage}</Notice>
        )}
        <InvalidBlock
          block={block}
          notice={`Cached result${field} is invalid: ${validation.message}`}
        />
      </>
    )
  }
  return (
    <>
      {lastErrorMessage && <Notice tone="error">Last recompute failed: {lastErrorMessage}</Notice>}
      <ValidatedRender data={validation.data} context={context} />
    </>
  )
}

function InvalidBlock({ block, notice }: { block: ResolvedBlock; notice?: string }) {
  const messages = notice ? [notice] : block.diagnostics.map((diagnostic) => diagnostic.message)
  return (
    <>
      {messages.map((message) => (
        <Notice key={message} tone="error">
          {message}
        </Notice>
      ))}
      <pre>
        <code className={block.lang ? `language-${block.lang}` : undefined}>{block.payload}</code>
      </pre>
    </>
  )
}

function Notice({ children, tone = 'normal' }: { children: ReactNode; tone?: 'normal' | 'error' }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2 rounded border p-2 text-xs ${tone === 'error' ? 'border-destructive/50 text-destructive' : 'text-muted-foreground'}`}
    >
      {tone === 'error' && <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
      <span>{children}</span>
    </div>
  )
}
