// Super-admin Project grants to admins (scriptable with owner Basic auth).
//
//   GET    → every {host, project, username} admin grant
//   POST   {host, project, username} → let that admin manage the Project
//   DELETE {host, project, username} → revoke it

import type { NextRequest } from 'next/server'
import { z } from 'zod'
import {
  configuredProjects,
  json,
  parseBody,
  withAccountStore,
} from '@/lib/server/admin-accounts-route'

export const dynamic = 'force-dynamic'

const Schema = z
  .object({
    host: z.string().min(1).max(128),
    project: z.string().min(1).max(128),
    username: z.string().min(1).max(64),
  })
  .strict()

export async function GET(req: NextRequest) {
  return withAccountStore(req, async (store) => json({ grants: await store.projectAdmins() }))
}

async function change(req: NextRequest, action: 'add' | 'remove') {
  return withAccountStore(req, async (store) => {
    const body = await parseBody(req, Schema)
    if (body instanceof Response) return body
    if (
      !(await configuredProjects()).some((p) => p.host === body.host && p.project === body.project)
    )
      return json({ error: { code: 'NOT_FOUND', message: 'no such project' } }, 404)
    await store.changeProjectAdmin(action, body.host, body.project, body.username)
    return json({ ok: true })
  })
}

export async function POST(req: NextRequest) {
  return change(req, 'add')
}

export async function DELETE(req: NextRequest) {
  return change(req, 'remove')
}
