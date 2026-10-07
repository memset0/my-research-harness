import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeTempDir, removeTempDirs } from '@memon/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from './load.js'
import { projectSourceGroup } from './source-group.js'

afterEach(removeTempDirs)
async function load(projects: string, extra = '') {
  const directory = await makeTempDir('memon-file-access-config-')
  await writeFile(join(directory, 'config.yml'), `projects:\n${projects}\n${extra}`)
  return loadConfig({ cwd: directory })
}
const dump = 'file_cache:\n  dump_path: ./cache/files.dump\n'
const agent = `file_agents:
  agent-a:
    endpoint: https://localhost:3738
    ca_file: ./tls/ca.pem
    certificate_file: ./tls/client.pem
    key_file: ./tls/client-key.pem
${dump}`

describe('file transport and cache configuration', () => {
  it('keeps legacy defaults and enables memory cache on native NFS paths', async () => {
    const config = await load(
      '  - { name: project-a, root: ./project-a }\n  - { name: project-b, root: ./project-b, access: { kind: filesystem, cache: memory }, storage_group: shared-a }',
    )
    expect(config!.projects[0]).toMatchObject({ storage: 'local' })
    expect(config!.projects[1]).toMatchObject({
      access: { kind: 'filesystem', cache: 'memory' },
      storageGroup: 'shared-a',
      persistentCache: false,
    })
  })
  it('allows qualified and unqualified namespaces together without using host as a transport selector', async () => {
    const config = await load(
      '  - { name: project-a, root: ./project-a, access: { kind: filesystem, cache: memory } }\n  - { name: project-a, host: host-a, access: { kind: agent, connection: agent-a, project: project-a, source_identity: source-a } }',
      agent,
    )
    expect(config!.projects.map((p) => p.host)).toEqual([undefined, 'host-a'])
    expect(config!.central!.hosts).toEqual([])
    expect(config!.projects[0]!.execution).toEqual({ kind: 'local' })
    expect(config!.projects[1]!.execution).toBeUndefined()
  })
  it('allows unqualified projects in an explicit central configuration', async () => {
    const config = await load(
      '  - { name: project-a, root: ./project-a, access: {kind: filesystem, cache: memory} }',
      'central: {hosts: []}\n',
    )
    expect(config!.central).toBeDefined()
    expect(config!.projects[0]!.host).toBeUndefined()
  })
  it('keeps independent authority defaults separate and supports explicit source sharing', async () => {
    const config = await load(
      '  - {name: project-a, root: ./project-a, access: {kind: filesystem, cache: memory}}\n  - {name: project-a, host: host-a, root: ./project-b, access: {kind: filesystem, cache: memory}}',
    )
    expect(projectSourceGroup(config!.projects[0]!)).not.toBe(
      projectSourceGroup(config!.projects[1]!),
    )
    expect(projectSourceGroup(config!.projects[0]!)).not.toContain(config!.projects[0]!.root)
    const shared = await load(
      '  - {name: project-a, root: ./project-a, access: {kind: filesystem, cache: memory, source: storage-a}}\n  - {name: project-b, root: ./project-b, access: {kind: filesystem, cache: memory, source: storage-a}}',
    )
    expect(shared!.projects.map(projectSourceGroup)).toEqual(['storage-a', 'storage-a'])
    await expect(
      load(
        '  - {name: project-a, root: ./project-a, storage_group: storage-b, access: {kind: filesystem, cache: memory, source: storage-a}}',
      ),
    ).rejects.toThrow(/conflicts/)
  })
  it('gives SSHFS and agent projects the same two-tier policy', async () => {
    const config = await load(
      '  - { name: project-a, root: ./project-a, access: { kind: sshfs } }\n  - { name: project-b, access: { kind: agent, connection: agent-a, project: project-b, source_identity: source-a }, read_only: true }',
      agent,
    )
    expect(config!.projects.map((p) => p.access?.cache)).toEqual(['memory-disk', 'memory-disk'])
    expect(config!.projects[1]).toMatchObject({
      root: 'memon-file:/agent-a/project-b',
      readOnly: true,
    })
    expect(config!.projects[1]!.execution).toBeUndefined()
    expect(config!.fileAgents!['agent-a']!.keyFile).toMatch(/\/tls\/client-key.pem$/)
  })
  it.each([
    [
      'legacy contradiction',
      '{ name: project-a, root: ./project-a, access: { kind: filesystem }, storage: local }',
    ],
    ['native missing root', '{ name: project-a, access: { kind: filesystem } }'],
    [
      'agent fake root',
      '{ name: project-a, root: ./project-a, access: { kind: agent, connection: agent-a, project: project-a, source_identity: source-a } }',
    ],
    [
      'agent local execution',
      '{ name: project-a, access: { kind: agent, connection: agent-a, project: project-a, source_identity: source-a }, execution: { kind: local } }',
    ],
    [
      'native disk cache',
      '{ name: project-a, root: ./project-a, access: { kind: filesystem, cache: memory-disk } }',
    ],
    [
      'unknown connection',
      '{ name: project-a, access: { kind: agent, connection: absent, project: project-a, source_identity: source-a } }',
    ],
  ])('rejects %s', async (_label, project) => {
    await expect(load(`  - ${project}`, agent)).rejects.toThrow()
  })
  it('requires a central dump for a two-tier policy', async () => {
    await expect(
      load('  - { name: project-a, root: ./project-a, access: { kind: sshfs } }'),
    ).rejects.toThrow('dump_path')
  })
})
