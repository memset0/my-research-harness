// @vitest-environment node

import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const runtimeModuleUrl = pathToFileURL(join(webRoot, 'lib', 'server', 'runtime.ts')).href
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

describe('direct web runtime anomalies', () => {
  it('classifies declared Run paths from disk when composing anomalies', async () => {
    const root = join(workspace, 'project')
    const bundle = join(root, 'docs', 'experiments', 'E0001-grp')
    await fs.mkdir(bundle, { recursive: true })
    await fs.writeFile(
      join(bundle, 'README.md'),
      '---\nid: E0001-grp\nslug: grp\ntitle: Group\nstatus: OPEN\nruns: ["outputs/b/grp-a-260101-000000", "logs/grp-missing-260101-000001"]\n---\n',
    )
    await fs.mkdir(join(root, 'outputs', 'b', 'grp-a-260101-000000'), { recursive: true })
    const configPath = join(workspace, 'config.yml')
    await fs.writeFile(
      configPath,
      `projects:\n  - name: project-a\n    root: ${JSON.stringify(root)}\n    exclude: [outputs]\nauth:\n  username: owner\n  password: integration-password\n  session_secret: ${'s'.repeat(64)}\n`,
    )
    const program = `
      void (async () => {
        const { getRuntime } = await import(${JSON.stringify(runtimeModuleUrl)})
        const runtime = await getRuntime()
        if (runtime.index.size() !== 0 || runtime.experiments.size !== 0) throw new Error('startup eagerly scanned project files')
        const { FilesystemProjectService } = await import(${JSON.stringify(pathToFileURL(resolve(webRoot, '../../packages/backend/dist/index.js')).href)})
        const { withProjectFileContext } = await import(${JSON.stringify(pathToFileURL(resolve(webRoot, '../../packages/core/dist/index.js')).href)})
        const { anomalies } = await withProjectFileContext({ root: runtime.config.projects[0].root, storage: 'local' }, () => new FilesystemProjectService(runtime.config.projects).getAnomalies('project-a'))
        process.stdout.write('\\n@@' + JSON.stringify(anomalies.map((a) => [a.code, a.runId])))
        process.exit(0)
      })()
    `
    const { stdout } = await execFileAsync(tsxBinary, ['--eval', program], {
      cwd: workspace,
      env: { ...process.env, MEMON_CONFIG_PATH: configPath },
      timeout: 30_000,
    })
    expect(JSON.parse(stdout.slice(stdout.lastIndexOf('@@') + 2))).toEqual([
      ['PHANTOM_RUN_REF', 'logs/grp-missing-260101-000001'],
    ])
  })
})
