import type { Command } from 'commander'
import { type CentralClientDeps, login, logout } from '../lib/central-client.js'
import { EXIT } from '../lib/exit-codes.js'

/** Read the token: all of piped stdin, or one line typed without echo on a terminal. */
export async function readToken(stdin: NodeJS.ReadStream = process.stdin): Promise<string> {
  if (!stdin.isTTY) {
    let text = ''
    for await (const chunk of stdin) text += chunk.toString()
    return text.trim()
  }
  process.stderr.write('API token: ')
  stdin.setRawMode(true)
  stdin.resume()
  return new Promise((resolve) => {
    let value = ''
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString()) {
        if (char === '\r' || char === '\n' || char === '\u0004') {
          stdin.setRawMode(false)
          stdin.pause()
          stdin.off('data', onData)
          process.stderr.write('\n')
          resolve(value.trim())
          return
        }
        if (char === '\u0003') {
          stdin.setRawMode(false)
          process.exit(130)
        }
        if (char === '\u007f') value = value.slice(0, -1)
        else value += char
      }
    }
    stdin.on('data', onData)
  })
}

export function registerLoginCommands(
  program: Command,
  deps: () => CentralClientDeps = () => ({ fetch, env: process.env }),
): void {
  program
    .command('login')
    .description('store an API token for memon central (read from stdin or prompted)')
    .argument('<central-url>', 'central URL, e.g. https://central.example')
    .addHelpText(
      'after',
      `
Create a token in the central admin area (Access control → API tokens), then:

  printf %s "$TOKEN" | memon login https://central.example
  memon login https://central.example        # prompts without echo

The token is checked against central and stored in ~/.config/memon/central.json
(mode 0600). MEMON_CENTRAL_URL + MEMON_CENTRAL_TOKEN override the stored login.`,
    )
    .action(async (url: string) => {
      const token = await readToken()
      const stored = await login(deps(), url, token)
      process.stdout.write(`${JSON.stringify({ logged_in: stored.url, file: stored.file })}\n`)
      process.exitCode = EXIT.SUCCESS
    })
  program
    .command('logout')
    .description('forget the stored memon central login')
    .action(async () => {
      const removed = await logout(deps())
      process.stdout.write(`${JSON.stringify({ logged_out: removed })}\n`)
      process.exitCode = EXIT.SUCCESS
    })
}
