// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { captureCli } from '../test-support/results-project.js'
import { runSsh } from './ssh.js'

let dir: string
let priorConfig: string | undefined

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memon-ssh-'))
  priorConfig = process.env.MEMON_NODES_CONFIG
  process.env.MEMON_NODES_CONFIG = path.join(dir, 'nodes.yml')
  await fs.writeFile(
    process.env.MEMON_NODES_CONFIG,
    [
      'schema_version: 1',
      'nodes:',
      '  local:',
      '    cluster: cluster-a',
      '    gpus: 2',
      '    available_until: 2099-01-01T00:00:00+08:00',
      '    via: sh -c',
      '  old:',
      '    available_until: 2000-01-01T00:00:00Z',
      '    ssh: { target: user@login.example }',
      '',
    ].join('\n'),
  )
})

afterEach(async () => {
  if (priorConfig === undefined) delete process.env.MEMON_NODES_CONFIG
  else process.env.MEMON_NODES_CONFIG = priorConfig
  await fs.rm(dir, { recursive: true, force: true })
})

function memon(node: string | undefined, command: string[] = [], list = false) {
  return captureCli(async () => {
    process.exitCode = await runSsh({ node, command, list, isTty: false })
  })
}

it('runs the line through via with quoting intact', async () => {
  const out = path.join(dir, 'out.txt')
  const result = await memon('local', [`printf "%s|" "a  b" > ${out}`])
  expect(result.exitCode).toBe(0)
  expect(result.stderr).toBe('')
  expect(await fs.readFile(out, 'utf8')).toBe('a  b|')
})

it('passes the remote exit status through without an envelope', async () => {
  const result = await memon('local', ['exit 7'])
  expect(result.exitCode).toBe(7)
  expect(result.error).toBeUndefined()
})

it('refuses expired and unknown nodes before spawning', async () => {
  const expired = await memon('old', ['hostname'])
  expect(expired.exitCode).toBe(13)
  expect(expired.error?.code).toBe('NODE_EXPIRED')
  const unknown = await memon('missing', ['hostname'])
  expect(unknown.exitCode).toBe(4)
  expect(unknown.error?.code).toBe('NOT_FOUND')
})

it('needs a terminal and a shell for interactive sessions', async () => {
  const result = await memon('local')
  expect(result.exitCode).toBe(2)
  expect(result.error?.code).toBe('BAD_REQUEST')
})

it('reports invalid registries', async () => {
  await fs.writeFile(
    process.env.MEMON_NODES_CONFIG!,
    'schema_version: 1\nnodes:\n  a: { via: x }\n',
  )
  const result = await memon(undefined, [], true)
  expect(result.exitCode).toBe(2)
  expect(result.error?.code).toBe('NODES_CONFIG_INVALID')
})

it('lists nodes without connection details', async () => {
  const result = await memon(undefined, [], true)
  expect(result.exitCode).toBe(0)
  expect(result.stdout).not.toMatch(/login\.example|sh -c/)
  expect(
    result.json.nodes.map((node: { id: string; expired: boolean }) => [node.id, node.expired]),
  ).toEqual([
    ['local', false],
    ['old', true],
  ])
})
