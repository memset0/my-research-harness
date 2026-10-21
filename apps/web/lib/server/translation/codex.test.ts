// @vitest-environment node

// Codex launch behaviour is not unit-tested with fake executables: those
// cases spawned extra Node processes. These cases cover the in-process auth
// path checks that run before any process is started.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { runCodexTranslation, translationAuthHome, translationEnvironment } from './codex'

let directory: string
let executable: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'memon-provider-test-'))
  executable = join(directory, 'codex')
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

it('uses the selected native auth file directory without reading its contents', async () => {
  const authJson = join(directory, 'auth.json')
  await writeFile(authJson, 'opaque fixture: wrapper must not parse this')
  expect(await translationAuthHome(authJson)).toBe(directory)
  expect(translationEnvironment(directory).CODEX_HOME).toBe(directory)
  expect(await readFile(authJson, 'utf8')).toBe('opaque fixture: wrapper must not parse this')
})

it('rejects missing, non-native and directory auth paths before executing Codex', async () => {
  for (const authJson of [join(directory, 'auth.json'), join(directory, 'other.json'), directory]) {
    await expect(runCodexTranslation({ executable, authJson }, null)).rejects.toMatchObject({
      code: 'INVALID_AUTH_PATH',
    })
  }
  expect(await translationAuthHome()).toBeUndefined()
})
