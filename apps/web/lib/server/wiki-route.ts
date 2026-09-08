// Shared plumbing for the `/api/wiki*` routes.
//
// Every wiki route resolves the same `?project=` selector, answers with the
// same `{ error: { code, message } }` envelope, and serves the same summary
// DTO: the core `WikiSummary` (with its project-relative `path`) plus the
// `project` / `resource` pair every other document DTO carries, so a client
// reads a standalone and a Backend-proxied page the same way.

import { NextResponse } from 'next/server'
import {
  parseWikiFrontmatter,
  JournalRecordingError,
  withJournalInvocation,
  WIKI_ID_REGEX,
  type WikiDiagnostic,
  type WikiPage,
  type WikiResolvedComponent,
  type WikiSummary,
} from '@memon/core'
import type { Runtime } from '../runtime'
import { lintComponents, listComponentBlocks } from '../wiki-components/registry'

/** Summary as the HTTP layer serves it. */
export type WikiSummaryDto = WikiSummary & { project: string; resource: string }

/** Page detail as the HTTP layer serves it. */
export type WikiPageDto = WikiPage & { project: string; resource: string }

export interface WikiRouteTarget {
  project: string
}

export interface WikiRouteRejection {
  error: NextResponse
}

export function wikiError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status })
}

/** Validate `?project=` against the configured projects. */
export function wikiProjectTarget(
  runtime: Runtime,
  searchParams: URLSearchParams,
): WikiRouteTarget | WikiRouteRejection {
  const project = searchParams.get('project')
  if (!project) {
    return { error: wikiError(400, 'BAD_REQUEST', 'project query parameter is required') }
  }
  if (!runtime.config.projects.some((entry) => entry.name === project)) {
    return { error: wikiError(404, 'NOT_FOUND', `project "${project}" not configured`) }
  }
  return { project }
}

/** One standalone Wiki mutation, including returned validation/conflict errors. */
export async function withWikiInvocation(
  runtime: Runtime,
  project: string,
  command: string,
  parameters: Record<string, unknown>,
  action: () => Promise<NextResponse>,
): Promise<NextResponse> {
  const root = runtime.config.projects.find((entry) => entry.name === project)?.root
  if (!root) return wikiError(404, 'NOT_FOUND', 'project is not configured')
  try {
    return await withJournalInvocation(root, { command, origin: 'web', parameters }, async (ctx) => {
      const response = await action()
      if (response.status >= 400) {
        ctx.markOutcome(response.status === 409 ? 'conflict' : 'failure',
          response.status === 409 ? 'CONFLICT' : response.status === 404 ? 'NOT_FOUND' :
            response.status === 400 ? 'BAD_REQUEST' : 'INTERNAL')
      }
      return response
    }, { standalone: true })
  } catch (error) {
    if (error instanceof JournalRecordingError) {
      return wikiError(500, error.code,
        'Journal recording failed; inspect the current document state before retrying.')
    }
    return wikiError(500, 'INTERNAL', 'Wiki operation failed')
  }
}

export function wikiSummaryDto(project: string, summary: WikiSummary): WikiSummaryDto {
  return { ...summary, project, resource: summary.path }
}

/**
 * Detail projection. `components[]` and the central-only component
 * diagnostics (`WIKI_COMPONENT_INVALID`, `WIKI_DATA_BLOCK_INVALID`,
 * `WIKI_DATA_PROVENANCE_MISSING`) exist only here: Backends and the CLI treat
 * component blocks as opaque fenced code, so central resolves them against
 * the shipped registry when it serves the page.
 */
export function wikiPageDto(
  project: string,
  summary: WikiSummary,
  content: string,
  hash: string,
  options: { fileExists?: (relativePath: string) => boolean } = {},
): WikiPageDto {
  const componentProjection = wikiComponentProjection(content, options)
  return {
    ...summary,
    project,
    resource: summary.path,
    diagnostics: [...summary.diagnostics, ...componentProjection.diagnostics],
    content,
    hash,
    components: componentProjection.components,
  }
}

/**
 * Central-only component fields for either a standalone or Backend-served
 * wiki page. Registry scanners receive the Markdown body, while line numbers
 * are shifted back into full-file coordinates for the HTTP contract.
 */
export function wikiComponentProjection(
  content: string,
  options: { fileExists?: (relativePath: string) => boolean } = {},
): Pick<WikiPage, 'components'> & { diagnostics: WikiDiagnostic[] } {
  const parsed = parseWikiFrontmatter(content)
  const lineOffset = (
    content.slice(0, Math.max(0, content.length - parsed.body.length)).match(/\n/g) ?? []
  ).length
  const blockOptions = options.fileExists ? { fileExists: options.fileExists } : {}
  const components: WikiResolvedComponent[] = []
  for (const block of listComponentBlocks(parsed.body, blockOptions)) {
    if (block.version === null) continue
    components.push({
      index: block.index,
      name: block.name,
      version: block.version,
      line: block.line + lineOffset,
      outdated: block.outdated,
    })
  }
  const diagnostics = lintComponents(parsed.body, blockOptions).map((diagnostic) => ({
    ...diagnostic,
    ...(diagnostic.line === undefined ? {} : { line: diagnostic.line + lineOffset }),
  }))
  return { components, diagnostics }
}

export interface WikiWriteRequest {
  content: string
  expectedMtime: number
  expectedHash: string
}

/** Parse and validate a `PUT /api/wiki/[id]` body. */
export function parseWikiWriteBody(body: unknown): WikiWriteRequest | null {
  if (typeof body !== 'object' || body === null) return null
  const { content, expectedMtime, expectedHash } = body as Record<string, unknown>
  if (typeof content !== 'string' || content.length > 4 * 1024 * 1024) return null
  if (typeof expectedMtime !== 'number' || !Number.isFinite(expectedMtime)) return null
  if (typeof expectedHash !== 'string' || !/^[0-9a-f]{40}$/.test(expectedHash)) return null
  return { content, expectedMtime, expectedHash }
}

/**
 * Identity is changed only through `memon wiki move`, and review marks are
 * never client-writable. Returns the rejection reason, or null when the write
 * may proceed.
 */
export function wikiWriteIdentityError(current: WikiSummary, content: string): string | null {
  const { frontmatter } = parseWikiFrontmatter(content)
  if (!frontmatter) return 'page frontmatter is required'
  if (typeof frontmatter.id !== 'string' || frontmatter.id !== current.id) {
    return `id cannot change (use \`memon wiki move\`); expected ${current.id}`
  }
  if (typeof frontmatter.kind !== 'string' || frontmatter.kind !== current.kind) {
    return `kind cannot change (use \`memon wiki move\`); expected ${current.kind}`
  }
  if ('reviewed_at' in frontmatter || 'reviewed_hash' in frontmatter) {
    return 'reviewed_at / reviewed_hash are managed by the review store'
  }
  return null
}
