import { FileAccessError, validateAppendLine } from '@memon/file-protocol'
import { basename, dirname, isFileURI, join, relative } from '@memon/file-protocol/paths'
import { withFileWriterLock } from '../file-writer-lock.js'
import { getProjectFileContext, projectFileContextStorage } from '../project-file-context.js'
import { projectFs as fs } from '../project-file-store.js'
import { resolveProjectResource } from '../project-resource.js'

export async function appendDiscussionLine(
  root: string,
  resource: string,
  line: string,
  expectedSize: number,
): Promise<void> {
  validateAppendLine(Buffer.from(line))
  if (
    !/^docs\/discussions\/D\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\/responses\.jsonl$/.test(resource) ||
    !Number.isSafeInteger(expectedSize) ||
    expectedSize < 0
  )
    throw new FileAccessError('BAD_REQUEST')
  const context = getProjectFileContext()
  if (context?.readOnly) throw new FileAccessError('READ_ONLY')
  const work = async () => {
    const resolved = await resolveProjectResource(root, resource, { forCreate: true })
    if (resolved.exists && (await fs.lstat(join(root, resource))).isSymbolicLink())
      throw new FileAccessError('CONFLICT')
    const realParent = await fs.realpath(dirname(resolved.path))
    const realRoot = await fs.realpath(root)
    if (
      !/^docs\/discussions\/D\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\/responses\.jsonl$/.test(
        relative(realRoot, join(realParent, basename(resolved.path))),
      )
    )
      throw new FileAccessError('FORBIDDEN')
    const options = { encoding: 'utf8' as const, expectedSize }
    if (isFileURI(root)) {
      await fs.appendFile(resolved.path, line, options)
      return
    }
    await withFileWriterLock(root, async () => {
      const current = await resolveProjectResource(root, resource, { forCreate: true })
      if (!current.exists) {
        if (expectedSize !== 0) throw new FileAccessError('CONFLICT')
      } else {
        const stat = await fs.lstat(current.path)
        if (!stat.isFile() || stat.size !== expectedSize) throw new FileAccessError('CONFLICT')
        if (stat.size > 0) {
          const handle = await fs.open(current.path, 'r')
          try {
            const tail = Buffer.alloc(1)
            await handle.read(tail, 0, 1, stat.size - 1)
            if (tail[0] !== 10) throw new FileAccessError('CONFLICT')
          } finally {
            await handle.close()
          }
        }
      }
      await fs.appendFile(current.path, line, {
        encoding: 'utf8',
        flag: current.exists ? 'a' : 'ax',
      })
    })
  }
  // Size checks cannot reuse a stale observation, even while holding the writer lock.
  if (context)
    return projectFileContextStorage().run({ ...context, observationPolicy: 'fresh' }, work)
  return work()
}
