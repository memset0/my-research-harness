import { rm } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

const packageRoot = resolve(process.cwd())
const output = resolve(packageRoot, 'dist')
if (basename(output) !== 'dist' || dirname(output) !== packageRoot) {
  throw new Error('refusing to clean an unexpected build-output path')
}
await rm(output, { recursive: true, force: true })
