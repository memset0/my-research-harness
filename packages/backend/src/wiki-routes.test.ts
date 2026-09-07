import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  type ActorContext,
  ActorContextSchema,
  type BackendCapabilities,
  BackendExperimentResponseSchema,
  BackendWikiConflictResponseSchema,
  BackendWikiDocumentSchema,
  BackendWikiPagesResponseSchema,
  BackendWikiReviewOrderResponseSchema,
  BackendWikiReviewResponseSchema,
  BackendWikiWriteResponseSchema,
  type ProjectConfig,
} from '@memon/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BACKEND_ACTOR_CONTEXT_HEADER } from './actor-context.js'
import { FilesystemDocumentService } from './document-service.js'
import { BackendEventStream } from './event-stream.js'
import { FilesystemProjectService } from './project-service.js'
import { createBackendServer } from './server.js'
import { FilesystemStreamService } from './stream-service.js'

const exec = promisify(execFile)
const SERVICE_TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const CAPABILITIES = {
  projects: true,
  mutations: true,
  events: true,
  logStreaming: true,
  reportAssets: true,
  wikiAssets: true,
  git: true,
  shares: true,
  tmux: false,
  terminal: false,
  slurm: false,
  herdr: false,
} satisfies BackendCapabilities

const EXPERIMENT = `---
id: E0001-alpha
slug: alpha
title: "Alpha experiment"
status: OPEN
archived: false
runs: []
hypotheses: []
tags: []
created_at: 2026-09-01T09:00:00+08:00
updated_at: 2026-09-05T09:00:00+08:00
---

## Motivation

Alpha.
`

const FINDING = `---
id: W0001
kind: finding
title: Alpha holds
description: Alpha holds under E0001.
status: TENTATIVE
sources: [E0001-alpha]
tags: [alpha]
created_at: 2026-09-01T10:00:00+08:00
updated_at: 2026-09-02T10:00:00+08:00
---

## Claim

Alpha holds.

## Evidence

E0001-alpha measured it.

## Limits

One seed only.
`

const SHOWCASE = `---
id: W0002
kind: showcase
title: Gamma showcase
status: DRAFT
created_at: 2026-09-01T10:00:00+08:00
updated_at: 2026-09-01T10:00:00+08:00
---

## What to show

![Map](./views/map/index.html)

An unpinned block plus a payload only the central registry can judge:

\`\`\`memon-data
{ "rows": [[1, 2], [3]] }
\`\`\`

## How to reproduce

Open the view.

## Assets

views/map/index.html
`

let root = ''
let readOnlyRoot = ''
let origin = ''
let readOnlyOrigin = ''
let server: ReturnType<typeof createBackendServer>
let readOnlyServer: ReturnType<typeof createBackendServer>
let commits: string[] = []
const eventStream = new BackendEventStream({
  instanceEpoch: '123e4567-e89b-42d3-a456-426614174000',
})

const owner = ActorContextSchema.parse({ role: 'owner' })
const viewer = ActorContextSchema.parse({
  role: 'viewer',
  scopes: [{ host: 'host-a', project: 'research' }],
})

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await exec('git', args, { cwd })).stdout.trim()
}

async function writeFixtures(target: string): Promise<void> {
  await Promise.all([
    fs.mkdir(join(target, 'docs', 'wiki', 'finding'), { recursive: true }),
    fs.mkdir(join(target, 'docs', 'wiki', 'showcase', 'W0002-gamma', 'views', 'map'), {
      recursive: true,
    }),
    fs.mkdir(join(target, 'docs', 'experiments', 'E0001-alpha'), { recursive: true }),
  ])
  await Promise.all([
    fs.writeFile(join(target, 'docs', 'wiki', 'finding', 'W0001-alpha.md'), FINDING),
    fs.writeFile(join(target, 'docs', 'wiki', 'showcase', 'W0002-gamma', 'README.md'), SHOWCASE),
    fs.writeFile(
      join(target, 'docs', 'wiki', 'showcase', 'W0002-gamma', 'views', 'map', 'index.html'),
      '<p>map</p>\n',
    ),
    fs.writeFile(join(target, 'docs', 'hypotheses.md'), '# Hypotheses\n'),
    fs.writeFile(join(target, 'docs', 'experiments', 'E0001-alpha', 'README.md'), EXPERIMENT),
  ])
}

async function listen(target: ReturnType<typeof createBackendServer>): Promise<string> {
  await new Promise<void>((resolveListen, reject) => {
    target.once('error', reject)
    target.listen(0, '127.0.0.1', () => {
      target.off('error', reject)
      resolveListen()
    })
  })
  return `http://127.0.0.1:${(target.address() as AddressInfo).port}`
}

beforeAll(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-backend-wiki-routes-'))
  readOnlyRoot = await fs.mkdtemp(join(tmpdir(), 'memon-backend-wiki-readonly-'))
  await Promise.all([writeFixtures(root), writeFixtures(readOnlyRoot)])
  // A leaked file outside the bundle proves symlink containment.
  await fs.writeFile(join(root, 'outside.txt'), 'private')
  await fs.symlink(
    join(root, 'outside.txt'),
    join(root, 'docs', 'wiki', 'showcase', 'W0002-gamma', 'leak.txt'),
  )
  for (const target of [root, readOnlyRoot]) {
    await git(target, 'init')
    await git(target, 'config', 'user.email', 'backend@example.test')
    await git(target, 'config', 'user.name', 'Backend Test')
    await git(target, 'add', 'docs')
    await git(target, 'commit', '-m', 'wiki: initial pages')
    await fs.appendFile(join(target, 'docs', 'wiki', 'finding', 'W0001-alpha.md'), '\nMore.\n')
    await git(target, 'add', 'docs')
    await git(target, 'commit', '-m', 'wiki: extend the finding')
  }
  commits = (await git(root, 'log', '--format=%H', '--reverse', '--', 'docs/wiki')).split('\n')
  const projects = [{ name: 'research', root, include: [], exclude: [] }] satisfies ProjectConfig[]
  const readOnlyProjects = [
    { name: 'research', root: readOnlyRoot, include: [], exclude: [] },
  ] satisfies ProjectConfig[]
  server = createBackendServer({
    hostId: 'host-a',
    serviceTokens: { current: SERVICE_TOKEN },
    capabilities: CAPABILITIES,
    revision: '0123456789abcdef',
    instanceEpoch: eventStream.instanceEpoch,
    documentService: new FilesystemDocumentService(projects),
    streamService: new FilesystemStreamService(projects),
    projectService: new FilesystemProjectService(projects),
    eventStream,
  })
  readOnlyServer = createBackendServer({
    hostId: 'host-a',
    serviceTokens: { current: SERVICE_TOKEN },
    capabilities: { ...CAPABILITIES, mutations: false },
    revision: '0123456789abcdef',
    readOnly: true,
    documentService: new FilesystemDocumentService(readOnlyProjects),
    streamService: new FilesystemStreamService(readOnlyProjects),
  })
  ;[origin, readOnlyOrigin] = await Promise.all([listen(server), listen(readOnlyServer)])
})

afterAll(async () => {
  await Promise.all(
    [server, readOnlyServer].map(
      (target) =>
        new Promise<void>((resolveClose, reject) => {
          target.close((error) => (error ? reject(error) : resolveClose()))
        }),
    ),
  )
  await Promise.all([
    fs.rm(root, { recursive: true, force: true }),
    fs.rm(readOnlyRoot, { recursive: true, force: true }),
  ])
})

async function request(
  path: string,
  options: {
    actor?: ActorContext
    method?: string
    body?: unknown
    base?: string
  } = {},
): Promise<Response> {
  const headers = new Headers({ authorization: `Bearer ${SERVICE_TOKEN}` })
  if (options.actor) headers.set(BACKEND_ACTOR_CONTEXT_HEADER, actorHeader(options.actor))
  if (options.body !== undefined) headers.set('content-type', 'application/json')
  return fetch(`${options.base ?? origin}${path}`, {
    method: options.method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

function actorHeader(actor: ActorContext): string {
  return Buffer.from(JSON.stringify(actor), 'utf8').toString('base64url')
}

describe('Backend wiki routes', () => {
  it('lists and reads pages through the strict, path-free envelopes', async () => {
    const listed = BackendWikiPagesResponseSchema.parse(
      await (await request('/api/backend/v1/wiki?project=research', { actor: owner })).json(),
    )
    expect(listed.pages.map((page) => page.id)).toEqual(['W0001', 'W0002'])
    expect(JSON.stringify(listed)).not.toContain(root)

    const page = BackendWikiDocumentSchema.parse(
      await (
        await request('/api/backend/v1/wiki/W0001?project=research', { actor: owner })
      ).json(),
    )
    expect(page.content).toContain('## Claim')
    expect(page.review?.state).toBe('UNVERIFIED')

    // A legacy Report id is not a wiki address, and neither is a missing page.
    expect((await request('/api/backend/v1/wiki/R0001?project=research', { actor: owner })).status)
      .toBe(400)
    expect((await request('/api/backend/v1/wiki/W9999?project=research', { actor: owner })).status)
      .toBe(404)
  })

  it('carries the citing wiki pages on the Experiment detail', async () => {
    const detail = BackendExperimentResponseSchema.parse(
      await (
        await request('/api/backend/v1/experiments/E0001-alpha?project=research', { actor: owner })
      ).json(),
    )
    expect(detail.citedBy).toEqual([
      {
        id: 'W0001',
        slug: 'alpha',
        kind: 'finding',
        title: 'Alpha holds',
        status: 'TENTATIVE',
        stale: true,
        deprecated: false,
        reviewState: 'UNVERIFIED',
        updatedAt: '2026-09-02T10:00:00+08:00',
      },
    ])

    const backlinks = await request(
      '/api/backend/v1/wiki/backlinks/E0001-alpha?project=research',
      { actor: owner },
    )
    expect(backlinks.status).toBe(200)
    expect(await backlinks.json()).toEqual({
      artifact: 'E0001-alpha',
      pages: detail.citedBy,
    })
  })

  it('keeps a Backend page opaque to component payloads', async () => {
    const page = BackendWikiDocumentSchema.parse(
      await (
        await request('/api/backend/v1/wiki/W0002?project=research', { actor: owner })
      ).json(),
    )
    // The block crosses the boundary verbatim; central resolves `components`.
    expect(page.content).toContain('{ "rows": [[1, 2], [3]] }')
    expect('components' in page).toBe(false)
    const codes = page.diagnostics.map((diagnostic) => diagnostic.code)
    // Structural info-string check happens here...
    expect(codes).toContain('WIKI_COMPONENT_UNPINNED')
    // ...but every payload/attribute judgement belongs to the registry.
    expect(codes).not.toContain('WIKI_DATA_BLOCK_INVALID')
    expect(codes).not.toContain('WIKI_COMPONENT_INVALID')
  })

  it('writes under the optimistic lock and emits wiki-change', async () => {
    const before = BackendWikiDocumentSchema.parse(
      await (
        await request('/api/backend/v1/wiki/W0001?project=research', { actor: owner })
      ).json(),
    )
    const frames: string[] = []
    const unsubscribe = eventStream.subscribe((frame) => {
      frames.push(frame)
      return true
    })
    const written = BackendWikiWriteResponseSchema.parse(
      await (
        await request('/api/backend/v1/wiki/W0001?project=research', {
          actor: owner,
          method: 'PUT',
          body: {
            content: before.content.replace('Alpha holds.', 'Alpha holds narrowly.'),
            expectedMtime: before.mtime,
            expectedHash: before.hash,
          },
        })
      ).json(),
    )
    unsubscribe()
    expect(written.page.content).toContain('Alpha holds narrowly.')
    expect(frames.some((frame) => frame.includes('wiki-change'))).toBe(true)

    const conflict = await request('/api/backend/v1/wiki/W0001?project=research', {
      actor: owner,
      method: 'PUT',
      body: {
        content: before.content,
        expectedMtime: before.mtime,
        expectedHash: before.hash,
      },
    })
    expect(conflict.status).toBe(409)
    const envelope = BackendWikiConflictResponseSchema.parse(await conflict.json())
    expect(envelope.currentContent).toContain('Alpha holds narrowly.')

    const current = BackendWikiDocumentSchema.parse(
      await (
        await request('/api/backend/v1/wiki/W0001?project=research', { actor: owner })
      ).json(),
    )
    const identity = await request('/api/backend/v1/wiki/W0001?project=research', {
      actor: owner,
      method: 'PUT',
      body: {
        content: current.content.replace('id: W0001', 'id: W0040'),
        expectedMtime: current.mtime,
        expectedHash: current.hash,
      },
    })
    expect(identity.status).toBe(400)
  })

  it('serves bundle assets with range metadata and refuses escapes', async () => {
    const asset = await request(
      '/api/backend/v1/wiki-assets/research/W0002/views/map/index.html',
      { actor: owner },
    )
    expect(asset.status).toBe(200)
    expect(asset.headers.get('content-type')).toContain('text/html')
    expect(asset.headers.get('accept-ranges')).toBe('bytes')
    expect(await asset.text()).toBe('<p>map</p>\n')

    const head = await request(
      '/api/backend/v1/wiki-assets/research/W0002/views/map/index.html',
      { actor: owner, method: 'HEAD' },
    )
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')

    // Dot-segments never reach the filesystem, and a symlink out of the
    // bundle is refused after resolution.
    expect(
      (
        await request('/api/backend/v1/wiki-assets/research/W0002/../../hypotheses.md', {
          actor: owner,
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await request('/api/backend/v1/wiki-assets/research/W0002/%252e%252e%2FREADME.md', {
          actor: owner,
        })
      ).status,
    ).toBe(404)
    expect(
      (await request('/api/backend/v1/wiki-assets/research/W0002/leak.txt', { actor: owner }))
        .status,
    ).toBe(400)
  })

  it('gates review marks on an owner actor and enforces commit order', async () => {
    const log = BackendWikiReviewResponseSchema.parse(
      await (
        await request('/api/backend/v1/wiki/review?project=research', { actor: owner })
      ).json(),
    )
    expect(log.commits.map((commit) => commit.sha)).toEqual(commits)
    expect(log.verifiedThrough).toBeNull()

    // A viewer may read the wiki but never record trust in it.
    expect(
      (await request('/api/backend/v1/wiki?project=research', { actor: viewer })).status,
    ).toBe(200)
    expect(
      (
        await request('/api/backend/v1/wiki/review?project=research', { actor: viewer })
      ).status,
    ).toBe(403)
    const viewerMark = await request(
      `/api/backend/v1/wiki/review/${commits[0]}?project=research`,
      { actor: viewer, method: 'POST' },
    )
    expect(viewerMark.status).toBe(403)
    expect(await fs.readdir(join(root, '.memon')).catch(() => [])).not.toContain(
      'wiki-review.csv',
    )

    const outOfOrder = await request(
      `/api/backend/v1/wiki/review/${commits[1]}?project=research`,
      { actor: owner, method: 'POST' },
    )
    expect(outOfOrder.status).toBe(409)
    const order = BackendWikiReviewOrderResponseSchema.parse(await outOfOrder.json())
    expect(order.error.code).toBe('REVIEW_ORDER')
    expect(order.nextSha).toBe(commits[0])


    const frames: string[] = []
    const unsubscribe = eventStream.subscribe((frame) => {
      frames.push(frame)
      return true
    })
    const marked = await request(
      `/api/backend/v1/wiki/review/${commits[0]}?project=research`,
      { actor: owner, method: 'POST', body: { note: 'read it all' } },
    )
    expect(marked.status).toBe(200)
    expect(BackendWikiReviewResponseSchema.parse(await marked.json()).verifiedThrough).toBe(
      commits[0],
    )
    unsubscribe()
    expect(frames.some((frame) => frame.includes('wiki-review-change'))).toBe(true)
    expect(frames.some((frame) => frame.includes('wiki-change'))).toBe(true)
    const removed = await request(
      `/api/backend/v1/wiki/review/${commits[0]}?project=research`,
      { actor: owner, method: 'DELETE' },
    )
    expect(removed.status).toBe(200)
    expect(BackendWikiReviewResponseSchema.parse(await removed.json()).verifiedThrough).toBeNull()
  })

  it('accepts review marks but refuses page writes on a read-only Backend', async () => {
    const page = BackendWikiDocumentSchema.parse(
      await (
        await request('/api/backend/v1/wiki/W0001?project=research', {
          actor: owner,
          base: readOnlyOrigin,
        })
      ).json(),
    )
    const write = await request('/api/backend/v1/wiki/W0001?project=research', {
      actor: owner,
      method: 'PUT',
      base: readOnlyOrigin,
      body: { content: page.content, expectedMtime: page.mtime, expectedHash: page.hash },
    })
    expect(write.status).toBe(403)

    const readOnlyCommits = (
      await git(readOnlyRoot, 'log', '--format=%H', '--reverse', '--', 'docs/wiki')
    ).split('\n')
    const mark = await request(
      `/api/backend/v1/wiki/review/${readOnlyCommits[0]}?project=research`,
      { actor: owner, method: 'POST', base: readOnlyOrigin },
    )
    expect(mark.status).toBe(200)
    expect(BackendWikiReviewResponseSchema.parse(await mark.json()).verifiedThrough).toBe(
      readOnlyCommits[0],
    )
  })
})
