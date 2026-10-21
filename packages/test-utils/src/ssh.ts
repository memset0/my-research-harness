import { execFile, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { connect, createServer } from 'node:net'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

/** Isolated loopback sshd with strict host checking; never modifies ~/.ssh. */
export async function startSshFixture() {
  // StrictModes rejects authorized_keys beneath /tmp on some hosts.
  const directory = await mkdtemp(join(homedir(), '.memon-ssh-test-'))
  let child: ReturnType<typeof spawn> | undefined
  const stop = async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve) => {
        child!.once('exit', () => resolve())
        child!.kill('SIGTERM')
      })
    }
    await rm(directory, { recursive: true, force: true })
  }
  try {
    for (const name of ['host', 'client'])
      await promisify(execFile)('ssh-keygen', [
        '-q',
        '-t',
        'ed25519',
        '-N',
        '',
        '-f',
        join(directory, name),
      ])
    await writeFile(
      join(directory, 'authorized_keys'),
      await readFile(join(directory, 'client.pub')),
      { mode: 0o600 },
    )
    const port = await new Promise<number>((resolve, reject) => {
      const listener = createServer()
      listener.once('error', reject)
      listener.listen(0, '127.0.0.1', () => {
        const address = listener.address() as { port: number }
        listener.close(() => resolve(address.port))
      })
    })
    const options = {
      ListenAddress: '127.0.0.1',
      Port: String(port),
      HostKey: join(directory, 'host'),
      PidFile: join(directory, 'pid'),
      AuthorizedKeysFile: join(directory, 'authorized_keys'),
      PasswordAuthentication: 'no',
      KbdInteractiveAuthentication: 'no',
      PubkeyAuthentication: 'yes',
      UsePAM: 'no',
      StrictModes: 'yes',
      AllowTcpForwarding: 'local',
      GatewayPorts: 'no',
      X11Forwarding: 'no',
      AllowAgentForwarding: 'no',
      PermitTTY: 'no',
      UseDNS: 'no',
    }
    const config = join(directory, 'sshd_config')
    await writeFile(
      config,
      Object.entries(options)
        .map(([name, value]) => `${name} "${value}"\n`)
        .join(''),
    )
    const [algorithm, key] = (await readFile(join(directory, 'host.pub'), 'utf8')).split(' ')
    const knownHostsFile = join(directory, 'known_hosts')
    await writeFile(knownHostsFile, `[127.0.0.1]:${port} ${algorithm} ${key}\n`)
    child = spawn(process.env.MEMON_SSHD ?? '/usr/sbin/sshd', ['-D', '-e', '-f', config], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let error = ''
    child.stderr?.on('data', (bytes) => {
      error = `${error}${bytes}`.slice(-4096)
    })
    child.on('error', (cause) => {
      error = cause.message
    })
    for (let attempt = 0; attempt < 50; attempt++) {
      if (child.exitCode !== null) throw new Error(`sshd fixture failed: ${error}`)
      const ready = await new Promise<boolean>((resolve) => {
        const socket = connect(port, '127.0.0.1')
        socket.once('connect', () => {
          socket.destroy()
          resolve(true)
        })
        socket.once('error', () => {
          socket.destroy()
          resolve(false)
        })
      })
      if (ready)
        return {
          target: `${userInfo().username}@127.0.0.1`,
          port,
          identityFile: join(directory, 'client'),
          knownHostsFile,
          stop,
        }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`sshd fixture did not start: ${error}`)
  } catch (error) {
    await stop()
    throw error
  }
}
