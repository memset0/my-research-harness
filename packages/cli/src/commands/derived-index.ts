// Inventory publication used by refresh; no standalone index command family.

import { promises as fs } from 'node:fs'
import {
  buildWikiProject,
  checkPublishedCatalog,
  discoverWikiPages,
  type EffectiveRunDirs,
  PROJECT_CATALOG_KINDS,
  type ProjectCatalogIssue,
  rebuildIndex,
  resolveIndexPaths,
} from '@memon/core'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { cliRunDirs } from '../lib/discovery-options.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { exitCodeForErrorCode } from '../lib/exit-codes.js'
import { recordCliInvocationFailureSync } from '../lib/invocation.js'
import { emitHuman, emitJson, type OutputFormat } from '../lib/output.js'

interface IndexCommandInput {
  projectRoot?: string
  cwd: string
  format: OutputFormat
}

async function projectRootOf(input: IndexCommandInput): Promise<string> {
  return singleProjectRoot(await resolveContext(input))
}

function runDirsLine(label: string, value: EffectiveRunDirs | null): string {
  return value === null ? `${label}: -` : `${label}: ${value.patterns.join(', ')} (${value.source})`
}

async function readLeaseHolder(path: string): Promise<Record<string, unknown> | null> {
  let raw: string
  try {
    raw = await fs.readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    // The token identifies the holder for release only; it is not reported.
    const { token: _token, ...holder } = parsed
    return holder
  } catch {
    return { unreadable: true }
  }
}

/**
 * Refused publication: every document that cannot be indexed, in one
 * response, so a single repair pass is enough. Nothing was written. It runs
 * inside the project writer lock, so it sets the exit code and returns
 * instead of exiting, letting the lock be released.
 */
function reportInvalidDocuments(format: OutputFormat, invalid: ProjectCatalogIssue[]): void {
  const code = 'INVALID_DOCUMENTS'
  const message = `${invalid.length} document(s) cannot be indexed; nothing was published and the previous index is unchanged`
  recordCliInvocationFailureSync(code)
  if (format === 'human') {
    const lines = [`not published: ${message}`]
    for (const issue of invalid) lines.push(`  ${issue.resource}: ${issue.message}`)
    lines.push('Fix every listed document, then run memon refresh again.')
    process.stderr.write(`${lines.join('\n')}\n`)
  } else {
    process.stderr.write(
      `${JSON.stringify({ error: { code, message, details: { published: false, invalid } } })}\n`,
    )
  }
  process.exitCode = exitCodeForErrorCode(code)
}

function countsLine(counts: Record<'runs' | 'experiments' | 'wiki' | 'reports', number>): string {
  return `${counts.runs} runs, ${counts.experiments} experiments, ${counts.wiki} wiki, ${counts.reports} reports`
}

// ---------- rebuild ----------

export interface IndexRebuildInput extends IndexCommandInput {
  auditRunDirs?: boolean
  dryRun?: boolean
  validate?: boolean
}

export async function runIndexRebuild(input: IndexRebuildInput): Promise<void> {
  const root = await projectRootOf(input)
  const cli = cliRunDirs()
  const result = await rebuildIndex(root, {
    role: 'rebuild',
    ...(cli === undefined ? {} : { cliRunDirs: cli }),
    ...(input.auditRunDirs ? { auditRunDirs: true } : {}),
    ...(input.dryRun ? { dryRun: true } : {}),
  })
  if (result.status === 'conflict') {
    emitErrorAndExit('CONFLICT', 'another process holds the derived-index compaction lease', {
      lease: await readLeaseHolder(resolveIndexPaths(root).lock),
    })
  }
  if (result.status === 'unsupported') {
    emitErrorAndExit(
      'INDEX_UNSUPPORTED',
      'the snapshot on disk has a newer index_version; update memon instead of rebuilding',
    )
  }
  if (result.status === 'invalid') {
    reportInvalidDocuments(input.format, result.invalid ?? [])
    return
  }
  const diagnostics =
    input.validate && result.snapshot
      ? [
          ...Object.entries(result.snapshot.runs).flatMap(([file, entry]) =>
            entry.row.parse_errors.map((issue) => ({ file, ...issue })),
          ),
          ...Object.entries(result.snapshot.experiments).flatMap(([file, entry]) =>
            entry.row.parse_errors.map((issue) => ({ file, ...issue })),
          ),
          ...buildWikiProject(await discoverWikiPages(root), {
            resolveSourceTargets: false,
          }).summaries.flatMap((page) =>
            page.diagnostics.map((issue) => ({ file: page.path, ...issue })),
          ),
          ...(result.warnings ?? []).map((issue) => ({
            file: issue.resource,
            severity: 'warning' as const,
            message: issue.message,
          })),
        ]
      : []
  const valid = !diagnostics.some((issue) => issue.severity === 'error')
  const output: Record<string, unknown> = {
    ok: valid,
    published: result.status === 'rebuilt',
    status: result.status,
    dryRun: result.status === 'dry-run',
    runDirs: result.runDirs,
    counts: result.counts,
    deletedEvents: result.deletedEvents.length,
    nested: result.nested,
    ...(input.validate ? { diagnostics } : {}),
  }
  if (result.audit) output.audit = { outside: result.audit.outside }
  if (input.format === 'human') {
    const lines = [
      `${result.status === 'rebuilt' ? 'published' : result.status}: ${countsLine(result.counts)}`,
      runDirsLine('run_dirs', result.runDirs),
    ]
    for (const path of result.nested) lines.push(`  RUN_NESTED ${path}`)
    if (result.audit) {
      lines.push(`outside run_dirs: ${result.audit.outside.length}`)
      for (const path of result.audit.outside) lines.push(`  ${path}`)
    }
    for (const issue of diagnostics)
      lines.push(`  ${issue.file}: ${issue.severity}: ${issue.message}`)
    emitHuman(lines.join('\n'))
  } else {
    emitJson(output)
  }
  if (!valid) process.exitCode = 1
}

// ---------- check ----------

/** Read-only: compare the catalogs the files would publish now with the published ones. */
export async function runIndexCheck(input: IndexCommandInput): Promise<void> {
  const root = await projectRootOf(input)
  const cli = cliRunDirs()
  const result = await rebuildIndex(root, {
    dryRun: true,
    ...(cli === undefined ? {} : { cliRunDirs: cli }),
  })
  if (result.status === 'unsupported')
    emitErrorAndExit(
      'INDEX_UNSUPPORTED',
      'the snapshot on disk has a newer index_version; update memon instead of checking',
    )
  const catalogs = result.catalogs
  if (!catalogs) emitErrorAndExit('BAD_REQUEST', 'published catalogs exist only in FS11 projects')
  const drift = await Promise.all(
    PROJECT_CATALOG_KINDS.map((kind) => checkPublishedCatalog(root, kind, catalogs[kind])),
  )
  const invalid = PROJECT_CATALOG_KINDS.flatMap((kind) => catalogs[kind].invalid)
  const current = invalid.length === 0 && drift.every((item) => item.state === 'current')
  if (input.format === 'human') {
    const lines = [current ? 'index current' : 'index not current; run memon refresh']
    for (const item of drift) {
      const parts = [
        item.missing.length ? `missing ${item.missing.join(', ')}` : '',
        item.extra.length ? `extra ${item.extra.join(', ')}` : '',
        item.changed.length ? `changed ${item.changed.join(', ')}` : '',
      ].filter(Boolean)
      lines.push(`  ${item.kind}: ${item.state}${parts.length ? ` (${parts.join('; ')})` : ''}`)
    }
    if (invalid.length) {
      lines.push(`cannot be indexed: ${invalid.length}`)
      for (const issue of invalid) lines.push(`  ${issue.resource}: ${issue.message}`)
    }
    emitHuman(lines.join('\n'))
  } else {
    emitJson({ ok: current, current, catalogs: drift, invalid, counts: result.counts })
  }
  if (!current) process.exitCode = 1
}
