// Inventory publication used by refresh; no standalone index command family.

import { promises as fs } from 'node:fs'
import {
  buildWikiProject,
  discoverWikiPages,
  type EffectiveRunDirs,
  rebuildIndex,
  resolveIndexPaths,
} from '@memon/core'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { cliRunDirs } from '../lib/discovery-options.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
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
        ]
      : []
  const valid = !diagnostics.some((issue) => issue.severity === 'error')
  const output: Record<string, unknown> = {
    ok: valid,
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
      `${result.status}: ${result.counts.runs} runs, ${result.counts.experiments} experiments, ${result.counts.wiki} wiki`,
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
