import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const go = process.env.MEMON_GO || 'go'
const operation = process.argv[2]
if (operation === 'fixture-build') {
  mkdirSync('../file-agent/dist', { recursive: true })
  const result = spawnSync(
    go,
    ['build', '-trimpath', '-o', 'dist/memon-file-agent', './cmd/memon-file-agent'],
    { cwd: '../file-agent', stdio: 'inherit', env: { ...process.env, CGO_ENABLED: '0' } },
  )
  if (result.error)
    process.stderr.write('Set MEMON_GO to the patched Go toolchain used for native-agent tests.\n')
  process.exit(result.status ?? 1)
}
const args =
  operation === 'build'
    ? ['build', '-trimpath', '-o', 'dist/memon-file-agent', './cmd/memon-file-agent']
    : operation === 'test'
      ? ['test', './internal/agent']
      : null
if (!args) throw new Error('expected build or test')
if (operation === 'build') mkdirSync('dist', { recursive: true })
const result = spawnSync(go, args, { stdio: 'inherit', env: { ...process.env, CGO_ENABLED: '0' } })
if (result.error) {
  process.stderr.write(
    'Go is required to build/test the file agent; set MEMON_GO to a patched Go >= 1.27.1 toolchain.\n',
  )
  process.exit(1)
}
process.exit(result.status ?? 1)
