// First-run password + session_secret generation.
//
// On startup, if `cfg.auth.password` is missing we generate a 144-bit random
// password and splice an `auth:` block into config.yml. If `cfg.auth` is
// present but missing `session_secret`, we append a `session_secret:` line to
// the existing block. Both can be coalesced into a single rewrite when both
// are needed (first-run fresh install).
//
// The plaintext lives in the selected config.yml so dev agents and curl-based
// automation can read it from a single canonical source. Central instance
// configs also carry Backend service tokens and therefore remain owner-only.
// We do NOT round-trip config.yml through js-yaml; the `auth:` block is spliced
// as raw text to preserve the operator's comments.

import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import {
  type AuthConfig,
  assertOwnerOnlyServiceConfig,
  type Config,
  isProtectedExampleConfigPath,
  SERVICE_CONFIG_FILE_MODE,
} from '@memon/core'

const DEFAULT_USERNAME = 'admin'
const PASSWORD_BYTES = 18 // 24 base64url chars, 144 bits of entropy
const SESSION_SECRET_BYTES = 32 // 44 base64url chars, 256 bits of entropy

function generatePassword(): string {
  return randomBytes(PASSWORD_BYTES).toString('base64url')
}

function generateSessionSecret(): string {
  return randomBytes(SESSION_SECRET_BYTES).toString('base64url')
}

function assertRuntimeWritableConfig(configPath: string): void {
  if (!isProtectedExampleConfigPath(configPath)) return

  throw new Error(
    `memon: refusing to initialize runtime authentication in ${configPath}: ` +
      '`config.example.yml` is a source-controlled template maintained by Agents/humans. ' +
      'Copy it to `config.yml` or select another instance config; runtime code never writes the example.',
  )
}

function spliceAuthBlock(
  originalText: string,
  username: string,
  password: string,
  sessionSecret: string,
): string {
  const trailing = originalText.endsWith('\n') ? '' : '\n'
  return (
    originalText +
    trailing +
    '\n' +
    '# memon: auto-generated on first run. To rotate the password, replace\n' +
    '# the `password` value below; to regenerate, delete the auth block and\n' +
    '# restart `memon serve`. The `session_secret` signs browser cookies for\n' +
    '# login + share links; rotating it invalidates every open session.\n' +
    'auth:\n' +
    `  username: ${JSON.stringify(username)}\n` +
    `  password: ${JSON.stringify(password)}\n` +
    `  session_secret: ${JSON.stringify(sessionSecret)}\n`
  )
}

/**
 * Append `  session_secret: "<value>"` underneath an existing `auth:` block.
 * Strategy: find the first line that starts with `auth:`; locate the end of
 * its indented child lines; insert the new line just before the first
 * non-indented (or EOF) line. Preserves all surrounding comments + ordering.
 */
function appendSessionSecretToAuthBlock(originalText: string, sessionSecret: string): string {
  const lines = originalText.split('\n')
  let authStartIdx = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (/^auth:\s*$/.test(lines[i]!)) {
      authStartIdx = i
      break
    }
  }
  if (authStartIdx === -1) {
    throw new Error(
      `appendSessionSecretToAuthBlock: no 'auth:' line found, but caller said auth block exists`,
    )
  }
  // Find the end of the auth block: the index AFTER the last contiguous
  // indented child line. A blank line OR a non-indented non-empty line
  // both terminate the block.
  let lastChildIdx = authStartIdx
  for (let i = authStartIdx + 1; i < lines.length; i += 1) {
    const line = lines[i]!
    if (line === '') break
    if (!/^\s/.test(line)) break
    lastChildIdx = i
  }
  const insertIdx = lastChildIdx + 1
  // Detect existing indentation from the first child line; default to '  '.
  let indent = '  '
  for (let i = authStartIdx + 1; i <= lastChildIdx; i += 1) {
    const m = /^(\s+)/.exec(lines[i]!)
    if (m) {
      indent = m[1]!
      break
    }
  }
  const newLine = `${indent}session_secret: ${JSON.stringify(sessionSecret)}`
  lines.splice(insertIdx, 0, newLine)
  return lines.join('\n')
}

async function writeAtomicWithMtimeGuard(
  path: string,
  newText: string,
  expectedMtimeMs: number,
  targetMode: number,
  requireOwnerOnly: boolean,
): Promise<void> {
  // Defense in depth: callers must reject the template before reading it, but
  // the final persistence boundary independently protects future call sites.
  assertRuntimeWritableConfig(path)
  if (requireOwnerOnly) await assertOwnerOnlyServiceConfig(path)
  const recheck = await fs.stat(path)
  if (recheck.mtimeMs !== expectedMtimeMs) {
    throw new Error(
      `config.yml was modified during first-run init; set auth.password (or auth.session_secret) manually and restart`,
    )
  }
  const tmp = `${path}.first-run-tmp.${process.pid}.${Date.now()}`
  try {
    await fs.writeFile(tmp, newText, { flag: 'wx', mode: targetMode })
    if (process.platform !== 'win32') await fs.chmod(tmp, targetMode)
    await fs.rename(tmp, path)
    if (requireOwnerOnly) await assertOwnerOnlyServiceConfig(path)
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
 * Ensure config.yml has both `auth.password` AND `auth.session_secret`.
 *
 * - If `cfg.auth` is absent entirely: generate both, splice a fresh `auth:`
 *   block, print the password banner.
 * - If `cfg.auth.password` is present but `session_secret` is missing:
 *   generate just the secret and append a `session_secret:` line to the
 *   existing auth block. NO password banner (the password was already set).
 * - If both are present: return as-is, no filesystem touch.
 */
export async function ensureAuthInitialised(configPath: string, cfg: Config): Promise<AuthConfig> {
  // The check intentionally precedes every stat/read/write. The example is a
  // source-authored template, never a runtime configuration or write target.
  assertRuntimeWritableConfig(configPath)
  const requireOwnerOnly = cfg.central !== undefined
  if (requireOwnerOnly) await assertOwnerOnlyServiceConfig(configPath)

  // Case 1: no auth block at all.
  if (!cfg.auth) {
    const stat = await fs.stat(configPath)
    const text = await fs.readFile(configPath, 'utf8')

    if (/^auth:\s*$/m.test(text) || /^auth:\s*\n\s+\w/m.test(text)) {
      throw new Error(
        `config.yml has an 'auth' block that loadConfig couldn't parse. ` +
          `Either remove it (auto-regenerate) or fix the schema (require: password: '<plaintext>').`,
      )
    }

    const username = DEFAULT_USERNAME
    const password = generatePassword()
    const sessionSecret = generateSessionSecret()
    const newText = spliceAuthBlock(text, username, password, sessionSecret)
    await writeAtomicWithMtimeGuard(
      configPath,
      newText,
      stat.mtimeMs,
      requireOwnerOnly ? SERVICE_CONFIG_FILE_MODE : stat.mode & 0o777,
      requireOwnerOnly,
    )
    printStdoutBlock(username, password, configPath)
    return { username, password, sessionSecret }
  }

  // Case 2: auth present, session_secret missing.
  if (!cfg.auth.sessionSecret) {
    const stat = await fs.stat(configPath)
    const text = await fs.readFile(configPath, 'utf8')
    const sessionSecret = generateSessionSecret()
    const newText = appendSessionSecretToAuthBlock(text, sessionSecret)
    await writeAtomicWithMtimeGuard(
      configPath,
      newText,
      stat.mtimeMs,
      requireOwnerOnly ? SERVICE_CONFIG_FILE_MODE : stat.mode & 0o777,
      requireOwnerOnly,
    )
    return { ...cfg.auth, sessionSecret }
  }

  // Case 3: both present.
  return cfg.auth
}

/** Test-only helper. */
export const __testGeneratePassword = generatePassword
/** Test-only helper. */
export const __testGenerateSessionSecret = generateSessionSecret
/** Test-only helper. */
export const __testAppendSessionSecretToAuthBlock = appendSessionSecretToAuthBlock
