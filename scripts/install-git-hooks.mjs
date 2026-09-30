// Install the repository's lefthook Git hooks. Runs from the root `prepare`
// script, so it must never fail an install that has nothing to hook into:
//
//   * an exported release tree (`git archive`) has no `.git` at all;
//   * a filtered install (`pnpm install --filter @memon/cli...`) may not have
//     the root devDependency `lefthook` installed.
//
// Both cases print one skip line and exit 0. Only a real `lefthook install`
// failure inside a checkout that has lefthook exits non-zero.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// `.git` is a directory in a normal clone and a file in a linked worktree.
if (!existsSync(join(repoRoot, '.git'))) {
  console.log('install-git-hooks: skip: not a git checkout')
  process.exit(0)
}

try {
  createRequire(join(repoRoot, 'package.json')).resolve('lefthook/package.json')
} catch {
  console.log('install-git-hooks: skip: lefthook is not installed')
  process.exit(0)
}

const result = spawnSync('pnpm', ['exec', 'lefthook', 'install'], {
  cwd: repoRoot,
  stdio: 'inherit',
})
if (result.error) {
  console.error(`install-git-hooks: ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
