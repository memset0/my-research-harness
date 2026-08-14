import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtimeModuleUrl = pathToFileURL(join(webRoot, 'lib', 'runtime.ts')).href
const tsxBinary = join(webRoot, 'node_modules', '.bin', 'tsx')

let workspace: string

beforeEach(async () => {
  workspace = await fs.mkdtemp(join(tmpdir(), 'memon-example-config-integration-'))
  await fs.writeFile(join(workspace, 'pnpm-workspace.yaml'), 'packages: []\n', 'utf8')
})

afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true })
})

describe('direct web runtime with only config.example.yml', () => {
  it('fails before loading or mutating the protected template', async () => {
    const examplePath = join(workspace, 'config.example.yml')
    const template = 'projects: []\n# template stays source-authored\n'
    await fs.writeFile(examplePath, template, 'utf8')
    const before = await fs.stat(examplePath)
    const env = { ...process.env }
    delete env.MEMON_CONFIG_PATH

    const program = `
      void (async () => {
        const { getRuntime } = await import(${JSON.stringify(runtimeModuleUrl)})
        try {
          await getRuntime()
          process.stdout.write(JSON.stringify({ ok: false, message: 'runtime unexpectedly started' }))
          process.exitCode = 9
        } catch (error) {
          process.stdout.write(JSON.stringify({
            ok: true,
            message: error instanceof Error ? error.message : String(error),
          }))
        }
      })()
    `

    const { stdout } = await execFileAsync(tsxBinary, ['--eval', program], {
      cwd: workspace,
      env,
      timeout: 15_000,
    })

    const result = JSON.parse(stdout) as { ok: boolean; message: string }
    expect(result.ok).toBe(true)
    expect(result.message).toMatch(/no instance config.*copy config\.example\.yml to config\.yml/i)
    expect(await fs.readFile(examplePath, 'utf8')).toBe(template)
    expect((await fs.stat(examplePath)).mtimeMs).toBe(before.mtimeMs)
    expect((await fs.readdir(workspace)).filter((name) => name.includes('first-run-tmp'))).toEqual(
      [],
    )
  })
})
