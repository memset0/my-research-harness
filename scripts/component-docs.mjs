// Thin wrapper around `scripts/component-docs.ts`.
//
// The generator imports the component descriptors, which import `zod` from
// `apps/web/node_modules`, so it has to run inside the `@memon/web` workspace
// through that workspace's `tsx`. This file exists so `node
// scripts/component-docs.mjs --write|--check` works from the repository root
// and can be wired into package scripts next to `wiki-kinds.mjs`.

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const result = spawnSync(
  'pnpm',
  [
    '--filter',
    '@memon/web',
    'exec',
    'tsx',
    '../../scripts/component-docs.ts',
    ...process.argv.slice(2),
  ],
  { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit' },
)
if (result.error) throw result.error
process.exit(result.status ?? 1)
