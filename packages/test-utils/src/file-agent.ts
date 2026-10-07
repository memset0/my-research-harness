import { execFile, spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { makeTempDir } from './fs.js'
import { createTLSFixture } from './tls.js'

/** Starts a real source kernel with synthetic mTLS grants; callers own teardown. */
export async function startFileAgentFixture(root: string) {
  const tls = await createTLSFixture()
  const directory = await makeTempDir('memon-file-agent-fixture-')
  const binary = join(directory, 'file-agent')
  await promisify(execFile)(
    process.env.MEMON_GO || 'go',
    ['build', '-o', binary, './cmd/memon-file-agent'],
    {
      cwd: fileURLToPath(new URL('../../file-agent/', import.meta.url)),
      timeout: 30_000,
    },
  )
  const port = await new Promise<number>((resolve, reject) => {
    const listener = createServer()
    listener.on('error', reject)
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address()
      if (!address || typeof address === 'string') return reject(new Error('no fixture listener'))
      listener.close(() => resolve(address.port))
    })
  })
  const configPath = join(directory, 'agent.json')
  const config = {
    listen: `127.0.0.1:${port}`,
    certificate: tls.server,
    key: tls.serverKey,
    clientCA: tls.ca,
    replayDirectory: join(directory, 'replay'),
    projects: {
      'project-a': { root, sourceIdentity: 'source-a', acknowledgedWriterLockVersion: 1 },
    },
    grants: { [tls.fingerprint]: { 'project-a': 'read-write' } },
  }
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 })
  const { stdout } = await promisify(execFile)(binary, ['--config', configPath, '--describe'])
  const sourceIdentity = (JSON.parse(stdout) as { projects: Record<string, string> }).projects[
    'project-a'
  ]!
  const child = spawn(binary, ['--config', configPath], { stdio: ['ignore', 'ignore', 'pipe'] })
  let logs = ''
  child.stderr?.on('data', (bytes) => {
    logs = (logs + String(bytes)).slice(-4096)
  })
  child.on('error', (error) => {
    logs += error.message
  })
  return {
    endpoint: `https://127.0.0.1:${port}`,
    binary,
    sourceIdentity,
    tls,
    child,
    configPath,
    diagnostics: () => logs,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return
      await new Promise<void>((resolve) => {
        child.once('exit', () => resolve())
        child.kill('SIGTERM')
      })
    },
  }
}
