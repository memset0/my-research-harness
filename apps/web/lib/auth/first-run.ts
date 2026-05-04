// First-run password generation.
//
// If `loadConfig` returned a `Config` without `auth`, we generate a 144-bit
// random password and splice an `auth:` block (with PLAINTEXT password) into
// config.yml. Subsequent boots are no-ops.
//
// The plaintext lives in config.yml (mode 0644) so dev agents and curl-based
// automation can read it from a single canonical source. The threat model is
// "single user, host fs trust = auth trust" — same as having an SSH key pair
// or kubectl config in $HOME. We do NOT round-trip config.yml through
// js-yaml; the `auth:` block is appended as raw text to preserve the
// operator's comments.

import { promises as fs } from 'node:fs'
import { randomBytes } from 'node:crypto'
import type { AuthConfig, Config } from '@memon/core'

const DEFAULT_USERNAME = 'admin'
const PASSWORD_BYTES = 18 // 24 base64url chars, 144 bits of entropy

function generatePassword(): string {
  return randomBytes(PASSWORD_BYTES).toString('base64url')
}

function spliceAuthBlock(originalText: string, username: string, password: string): string {
  const trailing = originalText.endsWith('\n') ? '' : '\n'
  return (
    originalText +
    trailing +
    '\n' +
    '# memon: auto-generated on first run. To rotate the password, replace\n' +
    '# the `password` value below; to regenerate, delete the auth block and\n' +
    '# restart `memon serve`.\n' +
    'auth:\n' +
    `  username: ${JSON.stringify(username)}\n` +
    `  password: ${JSON.stringify(password)}\n`
  )
}

async function writeAtomicWithMtimeGuard(
  path: string,
  newText: string,
  expectedMtimeMs: number,
): Promise<void> {
  const recheck = await fs.stat(path)
  if (recheck.mtimeMs !== expectedMtimeMs) {
    throw new Error(
      `config.yml was modified during first-run init; set auth.password manually and restart`,
    )
  }
  const tmp = `${path}.first-run-tmp.${process.pid}.${Date.now()}`
  await fs.writeFile(tmp, newText, { mode: 0o644 })
  try {
    await fs.rename(tmp, path)
  } catch (e) {
    await fs.rm(tmp, { force: true })
    throw e
  }
}

function printStdoutBlock(username: string, password: string, configPath: string): void {
  // eslint-disable-next-line no-console
  console.log(
    `\n*** memon: generated initial password ***\n` +
      `  username: ${username}\n` +
      `  password: ${password}\n` +
      `Persisted in ${configPath} as plaintext (auth.password).\n` +
      `This banner is printed once; the password remains in config.yml so dev\n` +
      `agents and curl-based automation can read it from a single source.\n`,
  )
}

/**
 * Ensure config.yml has an auth block. If `cfg.auth` is already set, returns
 * it without touching the filesystem. Otherwise generates a 144-bit
 * plaintext password, splices an `auth:` block into config.yml, and prints
 * the credentials once.
 */
export async function ensureAuthInitialised(
  configPath: string,
  cfg: Config,
): Promise<AuthConfig> {
  if (cfg.auth) {
    return cfg.auth
  }

  const stat = await fs.stat(configPath)
  const text = await fs.readFile(configPath, 'utf8')

  // Defensive: if the file already contains an `auth:` line that loadConfig
  // couldn't parse (malformed / partial block), refuse to clobber.
  if (/^auth:\s*$/m.test(text) || /^auth:\s*\n\s+\w/m.test(text)) {
    throw new Error(
      `config.yml has an 'auth' block that loadConfig couldn't parse. ` +
        `Either remove it (auto-regenerate) or fix the schema (require: password: '<plaintext>').`,
    )
  }

  const username = DEFAULT_USERNAME
  const password = generatePassword()
  const newText = spliceAuthBlock(text, username, password)
  await writeAtomicWithMtimeGuard(configPath, newText, stat.mtimeMs)

  printStdoutBlock(username, password, configPath)

  return { username, password }
}

/** Test-only helper. */
export const __testGeneratePassword = generatePassword
