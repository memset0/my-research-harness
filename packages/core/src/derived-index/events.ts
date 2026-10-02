// Event publishing: one exclusive file per successful write.
//
// Writers never append to or modify a shared index file (NFSv3 appends are
// not atomic across clients). Each write creates `events/.tmp-<name>` with an
// exclusive create, writes it completely, then renames it to `<name>`; the
// unique name makes the rename non-clobbering and readers ignore dot files,
// so no reader ever sees a partial event. Publishing needs neither central,
// a lock nor the FS marker, and a failure never fails the primary write: it
// is returned as an `INDEX_EVENT_FAILED` warning.

import { formatIsoLocal } from '../time.js'
import { MEMON_RELEASE } from '../version.js'
import { defaultIndexFs, type IndexFs } from './fs.js'
import { ensureIndexDirectory } from './gitignore.js'
import { eventFileName, resolveIndexPaths } from './paths.js'
import { EventSchema, INDEX_VERSION, type IndexEvent, type IndexRole } from './schema.js'

export const INDEX_EVENT_FAILED = 'INDEX_EVENT_FAILED'

export interface IndexEventWarning {
  code: typeof INDEX_EVENT_FAILED
  message: string
}

/**
 * Where a writer publishes its events. Passed on `MutationBase.index` (and
 * the options of the remaining direct writers); absent means no event.
 */
export interface IndexSink {
  /** Project root the written documents belong to. */
  projectRoot: string
  role: IndexRole
  /** Filesystem port (defaults to core's `projectFs`). */
  fs?: IndexFs
  /** Clock for `written_at`, `verified_at` and the event name. */
  now?: () => Date
  /** Release recorded as `writer.release` (defaults to `MEMON_RELEASE`). */
  release?: string
}

export type IndexEventBody = Pick<IndexEvent, 'upserts' | 'removals'>

export interface AppendIndexEventResult {
  /** Final event file name, or null when publishing failed. */
  name: string | null
  warnings: IndexEventWarning[]
}

function failure(error: unknown): AppendIndexEventResult {
  return {
    name: null,
    warnings: [
      {
        code: INDEX_EVENT_FAILED,
        message: `derived index event not written: ${(error as Error)?.message ?? String(error)}`,
      },
    ],
  }
}

/** Publish one event describing `body`. Never throws. */
export async function appendIndexEvent(
  sink: IndexSink,
  op: string,
  body: IndexEventBody,
): Promise<AppendIndexEventResult> {
  const fs = sink.fs ?? defaultIndexFs
  let temporary: string | null = null
  try {
    const now = (sink.now ?? (() => new Date()))()
    const event: IndexEvent = EventSchema.parse({
      index_version: INDEX_VERSION,
      written_at: formatIsoLocal(now),
      writer: { release: sink.release ?? MEMON_RELEASE, role: sink.role, op },
      upserts: body.upserts,
      removals: body.removals,
    })
    const paths = resolveIndexPaths(sink.projectRoot)
    await ensureIndexDirectory(paths, { fs, events: true })
    const name = eventFileName(now)
    temporary = `${paths.events}/.tmp-${name.replace(/\.json$/, '')}`
    await fs.writeFile(temporary, `${JSON.stringify(event)}\n`, { encoding: 'utf8', flag: 'wx' })
    await fs.rename(temporary, `${paths.events}/${name}`)
    return { name, warnings: [] }
  } catch (error) {
    if (temporary) await fs.rm(temporary, { force: true }).catch(() => undefined)
    return failure(error)
  }
}
