import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { acquireIndexLease, compactIndex, writeSnapshot } from '../derived-index/compact.js'
import { deriveWikiEntry } from '../derived-index/entries.js'
import { rebuildIndex } from '../derived-index/rebuild.js'
import { readDerivedIndex } from '../derived-index/snapshot.js'
import { withFileWriterLock } from '../file-writer-lock.js'
import { publishWikiCatalog } from '../project-catalogs.js'
import { formatIsoLocal } from '../time.js'
import { MEMON_RELEASE } from '../version.js'
import { discoverWikiPages } from './discover.js'

export async function prepareWikiInventory(root: string): Promise<void> {
  let read = await readDerivedIndex(root)
  if (read.snapshotState === 'missing') {
    const registered = await fs.stat(join(root, '.memon/version.json')).then(
      () => true,
      (error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
        throw error
      },
    )
    if (registered) throw new Error('project inventory is missing; run memon refresh')
    const rebuilt = await rebuildIndex(root, { role: 'cli' })
    if (rebuilt.status !== 'rebuilt') throw new Error(`inventory initialization ${rebuilt.status}`)
    read = await readDerivedIndex(root)
  }
  if (read.snapshotState !== 'ok' || read.pending.length || read.skipped.length)
    throw new Error('project inventory is invalid or incomplete; run memon refresh')
  const compact = await compactIndex(root, { role: 'cli' })
  if (!['compacted', 'unchanged'].includes(compact.status))
    throw new Error(`inventory publication ${compact.status}`)
}

/** Refresh Wiki rows only; existing Run and Experiment inventories remain intact. */
export async function publishWikiInventory(root: string): Promise<void> {
  return withFileWriterLock(root, async () => {
    await prepareWikiInventory(root)
    const lease = await acquireIndexLease(root, { role: 'cli' })
    if (!lease) throw new Error('inventory publication is busy')
    try {
      const read = await readDerivedIndex(root)
      if (!read.snapshot || read.snapshotState !== 'ok')
        throw new Error('inventory changed before Wiki publication')
      const entries = await Promise.all(
        (await discoverWikiPages(root, { inventoryOnly: true })).map((page) =>
          deriveWikiEntry({ page }),
        ),
      )
      if (entries.some((entry) => !entry)) throw new Error('Wiki source changed during publication')
      read.snapshot.wiki = Object.fromEntries(entries.map((entry) => [entry!.key, entry!.entry]))
      read.snapshot.generated_at = formatIsoLocal(new Date())
      read.snapshot.generator = { role: 'cli', release: MEMON_RELEASE }
      if (!(await lease.held())) throw new Error('inventory publication lease expired')
      await writeSnapshot(root, read.snapshot)
      if (read.snapshot.fs_convention_version >= 11) await publishWikiCatalog(root, read.snapshot)
    } finally {
      await lease.release()
    }
  })
}
