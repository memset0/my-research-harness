import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { makeTempDir } from './fs.js'

export interface TLSFixture {
  ca: string
  server: string
  serverKey: string
  client: string
  clientKey: string
  fingerprint: string
}

/** Ephemeral certificates shared by native-agent and HTTPS client tests. */
export async function createTLSFixture(): Promise<TLSFixture> {
  const directory = await makeTempDir('memon-tls-fixture-')
  const program = fileURLToPath(new URL('../native/tls-fixture/main.go', import.meta.url))
  const { stdout } = await promisify(execFile)(
    process.env.MEMON_GO || 'go',
    ['run', program, directory],
    { timeout: 30_000 },
  )
  return JSON.parse(stdout) as TLSFixture
}
