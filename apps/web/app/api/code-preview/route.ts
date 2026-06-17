// GET /api/code-preview?project=<name>&url=<github-permalink>
//
// Logged-in-only (read class, project-scoped — see route-classes.ts). Resolves a
// GitHub blob line-permalink to a LOCAL git repo via the project's `github`
// mapping and returns the referenced lines + surrounding context, read locally
// at the permalink's sha. No GitHub network access. Both the mapped repo root
// and the resolved file path are validated by assertWithinProjectRoots so a
// crafted url cannot escape the configured roots.

import { type NextRequest, NextResponse } from 'next/server'
import { join } from 'node:path'
import { parseGithubPermalink, readGitFileContents, sliceContext } from '@memon/core'
import { getRuntime } from '../../../lib/runtime'
import { PathSafetyError, assertWithinProjectRoots } from '../../../lib/path-safety'

export const dynamic = 'force-dynamic'

const err = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status })

export async function GET(req: NextRequest) {
  try {
    const rt = await getRuntime()
    const sp = new URL(req.url).searchParams
    const projectName = sp.get('project')
    const url = sp.get('url')

    if (!projectName) return err('BAD_REQUEST', 'project query parameter is required', 400)
    if (!url) return err('BAD_REQUEST', 'url query parameter is required', 400)

    const project = rt.config.projects.find((p) => p.name === projectName)
    if (!project) return err('NOT_FOUND', `project "${projectName}" not configured`, 404)

    const link = parseGithubPermalink(url)
    if (!link) return err('BAD_REQUEST', 'url is not a GitHub blob line-permalink', 400)

    const entry = (project.github ?? []).find(
      (g) =>
        g.owner.toLowerCase() === link.owner.toLowerCase() &&
        g.repo.toLowerCase() === link.repo.toLowerCase(),
    )
    if (!entry) {
      return err(
        'NOT_FOUND',
        `no local mapping for ${link.owner}/${link.repo} in project "${projectName}"`,
        404,
      )
    }

    const localRoot = entry.path
    const filePath = join(localRoot, link.path)
    try {
      assertWithinProjectRoots(localRoot, rt.config)
      assertWithinProjectRoots(filePath, rt.config)
    } catch (e) {
      if (e instanceof PathSafetyError) return err('FORBIDDEN', e.message, 403)
      throw e
    }

    const base = {
      owner: link.owner,
      repo: link.repo,
      sha: link.sha,
      path: link.path,
      startLine: link.startLine,
      endLine: link.endLine,
    }

    const read = await readGitFileContents(localRoot, link.sha, link.path)
    if (!read.ok) {
      if (read.reason === 'not-found') {
        return err('NOT_FOUND', `"${link.path}" not found at ${link.sha} in the local repo`, 404)
      }
      if (read.reason === 'too-large' || read.reason === 'binary') {
        // Graceful: the link still resolved, we just can't preview the bytes.
        return NextResponse.json({ ...base, lines: [], truncated: false, reason: read.reason })
      }
      return err('ERROR', read.message ?? 'failed to read file', 500)
    }

    const ctx = sliceContext(read.content, link.startLine, link.endLine)
    return NextResponse.json({ ...base, lines: ctx.lines, truncated: ctx.truncated })
  } catch (e) {
    return NextResponse.json({ error: { message: (e as Error).message } }, { status: 500 })
  }
}
