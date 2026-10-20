import { promises as fs, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { containedRealPath } from '../../dist/project-file-store/containment.js'

export function argumentsFor(options, usage) {
  const { values } = parseArgs({
    options: { 'project-root': { type: 'string' }, help: { type: 'boolean' }, ...options },
  })
  if (values.help) {
    process.stdout.write(`${usage}\n`)
    return null
  }
  if (!values['project-root']) throw new Error('--project-root is required')
  return values
}

export async function contained(root, path) {
  async function nearest(path) {
    try {
      return await fs.realpath(path)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      const parent = dirname(path)
      if (parent === path) throw error
      return join(await nearest(parent), path.slice(parent.length + 1))
    }
  }
  return containedRealPath(root, resolve(root, path), 'migration', false, nearest)
}

export function runScript(url, main) {
  if (!process.argv[1] || realpathSync(process.argv[1]) !== fileURLToPath(url)) return
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({ error: { code: error.code ?? 'MIGRATION_FAILED', message: error.message } })}\n`,
    )
    process.exitCode = error.code === 'CONFLICT' ? 9 : 1
  })
}
