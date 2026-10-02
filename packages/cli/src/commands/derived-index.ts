// `memon index status|compact|rebuild` — maintain and inspect the FS v8
// derived index under `<projectRoot>/.memon/index/`.
//
// The index is a cache, never a source of truth: these commands read and
// write only `.memon/index/` (plus the project-file reads a rebuild or a
// verification needs), never a project document or the FS marker, never the
// Journal, and never central. Run-walking commands use the invocation's
// effective `run_dirs` (`--run-dir`, else `.memon/project.yml`, else the v8
// default).
//
// Exit codes: 0 success (a missing index is reported, not an error); 1 drift
// under `status --verify --strict`, or a snapshot of a newer `index_version`
// that this release must not overwrite; 2 bad request (including an invalid
// `.memon/project.yml`); 9 `CONFLICT` while another compactor holds the lease.

import { promises as fs } from 'node:fs'
import {
  compactIndex,
  type EffectiveRunDirs,
  INDEX_DIR_RELPATH,
  type IndexDriftRecord,
  type IndexLayoutNotice,
  listIndexEvents,
  mergedIndexView,
  readDerivedIndex,
  rebuildIndex,
  resolveIndexPaths,
  verifyIndex,
} from '@memon/core'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { cliRunDirs, effectiveRunDirs } from '../lib/discovery-options.js'
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

function ageSeconds(iso: string | undefined, now: number): number | null {
  if (iso === undefined) return null
  const at = Date.parse(iso)
  return Number.isNaN(at) ? null : Math.max(0, Math.round((now - at) / 1000))
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

// ---------- status ----------

export interface IndexStatusInput extends IndexCommandInput {
  verify?: boolean
  strict?: boolean
}

export async function runIndexStatus(input: IndexStatusInput): Promise<void> {
  if (input.strict && !input.verify) {
    emitErrorAndExit('BAD_REQUEST', '--strict requires --verify')
  }
  const root = await projectRootOf(input)
  const paths = resolveIndexPaths(root)
  const now = Date.now()
  const effective = await effectiveRunDirs(root)
  const present = await fs
    .stat(paths.dir)
    .then((stat) => stat.isDirectory())
    .catch(() => false)
  const read = await readDerivedIndex(root)
  const view = mergedIndexView(read, {
    runDirs: effective.patterns,
    runDirsSource: effective.source,
  })
  const snapshot = read.snapshot
  const eventNames = await listIndexEvents(root)
  const oldest = read.events[0]?.event.written_at
  const output: Record<string, unknown> = {
    present,
    path: INDEX_DIR_RELPATH,
    snapshot: {
      state: read.snapshotState,
      ...(read.snapshotMessage === undefined ? {} : { message: read.snapshotMessage }),
      indexVersion: snapshot?.index_version ?? null,
      generatedAt: snapshot?.generated_at ?? null,
      ageSeconds: ageSeconds(snapshot?.generated_at, now),
      generator: snapshot?.generator ?? null,
    },
    runDirs: {
      recorded: snapshot ? { patterns: snapshot.run_dirs, source: snapshot.run_dirs_source } : null,
      effective,
    },
    counts: view
      ? {
          runs: Object.keys(view.runs).length,
          experiments: Object.keys(view.experiments).length,
          wiki: Object.keys(view.wiki).length,
        }
      : { runs: 0, experiments: 0, wiki: 0 },
    events: {
      unmerged: eventNames.length,
      oldestWrittenAt: oldest ?? null,
      oldestAgeSeconds: ageSeconds(oldest, now),
      skipped: read.skipped,
      pending: read.pending.length,
    },
    lease: await readLeaseHolder(paths.lock),
  }

  let drift: IndexDriftRecord[] = []
  let notices: IndexLayoutNotice[] = []
  if (input.verify) {
    const cli = cliRunDirs()
    const verified = await verifyIndex(root, cli === undefined ? {} : { cliRunDirs: cli })
    drift = verified.drift
    notices = verified.notices
    output.verify = { drift, notices, driftCount: drift.length }
  }

  if (input.format === 'human') {
    const recorded = output.runDirs as { recorded: EffectiveRunDirs | null }
    const counts = output.counts as { runs: number; experiments: number; wiki: number }
    const lines = [
      `index: ${present ? INDEX_DIR_RELPATH : `${INDEX_DIR_RELPATH} (absent)`}`,
      `snapshot: ${read.snapshotState}${snapshot ? ` v${snapshot.index_version}, generated ${snapshot.generated_at} by ${snapshot.generator.role}` : ''}`,
      runDirsLine('run_dirs recorded', recorded.recorded),
      runDirsLine('run_dirs effective', effective),
      `entries: ${counts.runs} runs, ${counts.experiments} experiments, ${counts.wiki} wiki`,
      `events: ${eventNames.length} unmerged${oldest ? ` (oldest ${oldest})` : ''}, ${read.skipped.length} skipped`,
      `lease: ${output.lease ? JSON.stringify(output.lease) : 'free'}`,
    ]
    if (input.verify) {
      lines.push(`drift: ${drift.length}`)
      for (const record of drift)
        lines.push(
          `  ${record.code} ${record.kind} ${record.key} ${record.field}: ${JSON.stringify(record.indexed)} -> ${JSON.stringify(record.disk)}`,
        )
      for (const notice of notices)
        lines.push(`  ${notice.code} ${notice.experiment} ${notice.path}: ${notice.message}`)
    }
    emitHuman(lines.join('\n'))
  } else {
    emitJson(output)
  }
  if (input.strict && drift.length > 0) process.exitCode = 1
}

// ---------- compact ----------

export async function runIndexCompact(input: IndexCommandInput): Promise<void> {
  const root = await projectRootOf(input)
  const result = await compactIndex(root, { role: 'cli' })
  if (result.status === 'conflict') {
    emitErrorAndExit('CONFLICT', 'another process holds the derived-index compaction lease', {
      lease: await readLeaseHolder(resolveIndexPaths(root).lock),
    })
  }
  if (result.status === 'unsupported') {
    emitErrorAndExit(
      'INDEX_UNSUPPORTED',
      'the snapshot on disk has a newer index_version; update memon instead of compacting',
    )
  }
  const output = {
    ok: true,
    status: result.status,
    merged: result.merged.length,
    skipped: result.skipped,
    removedTemporaries: result.removedTemporaries.length,
  }
  if (input.format === 'human') {
    emitHuman(
      `${result.status}: ${result.merged.length} events merged, ${result.skipped.length} skipped, ${result.removedTemporaries.length} temporaries removed`,
    )
  } else {
    emitJson(output)
  }
}

// ---------- rebuild ----------

export interface IndexRebuildInput extends IndexCommandInput {
  auditRunDirs?: boolean
  dryRun?: boolean
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
  const output: Record<string, unknown> = {
    ok: true,
    status: result.status,
    dryRun: result.status === 'dry-run',
    runDirs: result.runDirs,
    counts: result.counts,
    deletedEvents: result.deletedEvents.length,
    nested: result.nested,
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
    emitHuman(lines.join('\n'))
  } else {
    emitJson(output)
  }
}
