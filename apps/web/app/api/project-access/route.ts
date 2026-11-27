// Read grants on every configured Project, for admins and the super admin alike.
//
//   GET    → every configured Project with its user grants (usernames only)
//   POST   {host, project, username, document?} → grant read access to a user account
//   DELETE {host, project, username, document?} → revoke it
//
// Grants name an exact username; unknown and non-user names fail identically,
// so an admin cannot discover which accounts exist.

import type { NextRequest } from 'next/server'
import { z } from 'zod'
import type { AccountStore } from '@/lib/server/account-store'
import {
  configuredProjects,
  json,
  parseBody,
  withAccountStore,
} from '@/lib/server/admin-accounts-route'

export const dynamic = 'force-dynamic'

const GrantSchema = z
  .object({
    host: z.string().min(1).max(128),
    project: z.string().min(1).max(128),
    username: z.string().min(1).max(64),
    document: z
      .object({ kind: z.enum(['report', 'wiki']), id: z.string().min(1).max(16) })
      .strict()
      .optional(),
  })
  .strict()

/** Admins and the super admin both manage read grants on every configured Project. */
async function manageable(_req: NextRequest, _store: AccountStore) {
  return configuredProjects()
}

export async function GET(req: NextRequest) {
  return withAccountStore(
    req,
    async (store) => {
      const projects = await manageable(req, store)
      return json({
        projects: await Promise.all(
          projects.map(async (p) => ({ ...p, grants: await store.grantsOn(p.host, p.project) })),
        ),
      })
    },
    'manage_project_grants',
  )
}

async function change(req: NextRequest, action: 'add' | 'remove') {
  return withAccountStore(
    req,
    async (store) => {
      const body = await parseBody(req, GrantSchema)
      if (body instanceof Response) return body
      const allowed = (await manageable(req, store)).some(
        (p) => p.host === body.host && p.project === body.project,
      )
      if (!allowed)
        return json({ error: { code: 'NOT_FOUND', message: 'no such manageable project' } }, 404)
      await store.changeGrantByUsername(action, body.username, {
        host: body.host,
        project: body.project,
        ...(body.document ? { document: body.document } : {}),
      })
      return json({ ok: true })
    },
    'manage_project_grants',
  )
}

export async function POST(req: NextRequest) {
  return change(req, 'add')
}

export async function DELETE(req: NextRequest) {
  return change(req, 'remove')
}
