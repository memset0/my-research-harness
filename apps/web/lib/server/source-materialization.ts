import 'server-only'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join as nativeJoin } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { projectFs } from '@memon/core'
import { FileAccessError } from '@memon/file-protocol'
import { extname } from '@memon/file-protocol/paths'

/** Central media tools use a private bounded input file, never an agent command. */
export async function withLocalSourceFile<T>(
  source: string,
  work: (localPath: string) => Promise<T>,
  opened?: Awaited<ReturnType<typeof projectFs.open>>,
): Promise<T> {
  const handle = opened ?? (await projectFs.open(source, 'r'))
  try {
    const metadata = await handle.stat()
    if (!metadata.isFile() || metadata.size > 256 * 1024 * 1024)
      throw new FileAccessError('LIMIT_EXCEEDED')
    const directory = await mkdtemp(nativeJoin(tmpdir(), 'memon-media-input-'))
    const input = nativeJoin(directory, `input${extname(source)}`)
    try {
      try {
        if (metadata.size === 0) throw new FileAccessError('CAPABILITY_UNAVAILABLE')
        await pipeline(
          handle.createReadStream({ end: metadata.size - 1 }),
          createWriteStream(input, { mode: 0o600 }),
        )
      } finally {
        await handle.close()
      }
      if ((await stat(input)).size !== metadata.size)
        throw new FileAccessError('SOURCE_UNAVAILABLE')
      return await work(input)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  } finally {
    await handle.close()
  }
}
