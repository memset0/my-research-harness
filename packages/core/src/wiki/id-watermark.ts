import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { writeFileAtomic } from '../atomic-write.js'

/** Called under the common writer lock. Failed allocations may leave gaps. */
export async function reserveWikiId(
  root: string,
  observedMaximum: number,
  allocate = true,
): Promise<number> {
  const path = join(root, '.memon/id-watermarks.json')
  let before: string | null = null
  let mtime: number | null = null
  try {
    const real = await fs.realpath(path)
    const rootReal = await fs.realpath(root)
    if (!real.startsWith(`${rootReal}${sep}`))
      throw new Error('ID watermark file escapes project root')
    before = await fs.readFile(path, 'utf8')
    mtime = (await fs.stat(path)).mtimeMs
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const record: unknown = JSON.parse(before ?? '{}')
  if (record === null || typeof record !== 'object' || Array.isArray(record))
    throw new Error('ID watermark file must contain a JSON object')
  const doc = record as Record<string, unknown>
  const old = doc.wiki ?? 0
  if (!Number.isInteger(old) || Number(old) < 0 || Number(old) > 9999)
    throw new Error('invalid Wiki ID high watermark')
  const next = Math.max(Number(old), observedMaximum) + (allocate ? 1 : 0)
  if (next > 9999) throw new Error('wiki id space exhausted (W9999 allocated)')
  if (Number(old) === next) return next
  doc.wiki = next
  await fs.mkdir(dirname(path), { recursive: true })
  const dir = await fs.realpath(dirname(path)),
    rootReal = await fs.realpath(root)
  if (!dir.startsWith(`${rootReal}${sep}`))
    throw new Error('ID watermark directory escapes project root')
  const current = await fs.readFile(path, 'utf8').catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  })
  const digest = (s: string | null) =>
    s === null ? null : createHash('sha256').update(s).digest('hex')
  if (
    digest(current) !== digest(before) ||
    (current !== null && (await fs.stat(path)).mtimeMs !== mtime)
  )
    throw Object.assign(new Error('ID watermark changed during allocation'), {
      code: 'CONFLICT',
    })
  await writeFileAtomic(path, `${JSON.stringify(doc, null, 2)}\n`)
  return next
}
