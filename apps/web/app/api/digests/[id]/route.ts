// GET /api/digests/[id]?project=NAME → { id, date, path, mtime, hash, content }
// PUT /api/digests/[id]?project=NAME body { content, expectedMtime, expectedHash }
//
// Same contract as /api/reports/[id]; differs only in the cache and id regex.

import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../../lib/runtime'
import { PathSafetyError, assertWithinProjectRoots } from '../../../../lib/path-safety'

export const dynamic = 'force-dynamic'

const ID_REGEX = /^D\d{4}$/

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const rt = await getRuntime()
    const url = new URL(req.url)
    const projectName = url.searchParams.get('project')
    const { id } = await ctx.params
    if (!projectName) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'project query parameter is required' } },
        { status: 400 },
      )
    }
    if (!ID_REGEX.test(id)) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: `invalid digest id "${id}" (expected D<NNNN>)` } },
        { status: 400 },
      )
    }
    const dir = rt.digestsDir(projectName)
    if (!dir) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `project "${projectName}" not configured` } },
        { status: 404 },
      )
    }
    const entry = rt.digestsCache.getList(dir).find((d) => d.id === id)
    if (!entry) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `digest "${id}" not found` } },
        { status: 404 },
      )
    }
    try {
      assertWithinProjectRoots(entry.path, rt.config)
    } catch (err) {
      if (err instanceof PathSafetyError) {
        return NextResponse.json(
          { error: { code: 'FORBIDDEN', message: err.message } },
          { status: 403 },
        )
      }
      throw err
    }
    const fresh = await rt.digestsCache.getContent(entry.path)
    if (!fresh) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `digest "${id}" file disappeared` } },
        { status: 404 },
      )
    }
    return NextResponse.json({
      id: entry.id,
      date: entry.date,
      path: entry.path,
      mtime: fresh.mtime,
      hash: fresh.hash,
      content: fresh.content,
    })
  } catch (err) {
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
}

interface PutBody {
  content: string
  expectedMtime: number
  expectedHash: string
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const rt = await getRuntime()
    const url = new URL(req.url)
    const projectName = url.searchParams.get('project')
    const { id } = await ctx.params
    const body = (await req.json()) as PutBody

    if (!projectName) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'project query parameter is required' } },
        { status: 400 },
      )
    }
    if (!ID_REGEX.test(id)) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: `invalid digest id "${id}"` } },
        { status: 400 },
      )
    }
    if (
      typeof body.content !== 'string' ||
      typeof body.expectedMtime !== 'number' ||
      typeof body.expectedHash !== 'string'
    ) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'content, expectedMtime, expectedHash required' } },
        { status: 400 },
      )
    }
    const dir = rt.digestsDir(projectName)
    if (!dir) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `project "${projectName}" not configured` } },
        { status: 404 },
      )
    }
    const entry = rt.digestsCache.getList(dir).find((d) => d.id === id)
    if (!entry) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `digest "${id}" not found` } },
        { status: 404 },
      )
    }
    try {
      assertWithinProjectRoots(entry.path, rt.config)
    } catch (err) {
      if (err instanceof PathSafetyError) {
        return NextResponse.json(
          { error: { code: 'FORBIDDEN', message: err.message } },
          { status: 403 },
        )
      }
      throw err
    }
    const result = await rt.digestsCache.putContent(
      entry.path,
      body.content,
      body.expectedMtime,
      body.expectedHash,
    )
    if (result.ok) {
      return NextResponse.json({ ok: true, mtime: result.mtime, hash: result.hash })
    }
    if (result.code === 'CONFLICT') {
      return NextResponse.json(
        {
          error: { code: 'CONFLICT', message: 'on-disk content has changed since read' },
          currentMtime: result.currentMtime,
          currentHash: result.currentHash,
          currentContent: result.currentContent,
        },
        { status: 409 },
      )
    }
    if (result.code === 'NOT_FOUND') {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'file disappeared during write' } },
        { status: 404 },
      )
    }
    return NextResponse.json(
      { error: { message: result.message ?? 'write failed' } },
      { status: 500 },
    )
  } catch (err) {
    return NextResponse.json({ error: { message: (err as Error).message } }, { status: 500 })
  }
}
