// /manage/access — Access control: the Users, Projects and Shares cards.
// Middleware admits `manage_accounts` or `manage_project_grants`; each card is
// rendered only with its own capability, so an admin never receives the Users
// card (and the account list it would fetch).

import { notFound } from 'next/navigation'
import { AdminProjectsPanel } from '../../../components/admin-projects-panel'
import { AdminSharesPanel } from '../../../components/admin-shares-panel'
import { AdminUsersPanel } from '../../../components/admin-users-panel'
import { levelCan } from '../../../lib/server/auth/capabilities'
import { readAccountFromHeaders } from '../../../lib/server/auth/request-context'

export const metadata = { title: 'Access control — memon' }

export const dynamic = 'force-dynamic'

export default async function AccessControlPage() {
  const level = (await readAccountFromHeaders())?.level
  const accounts = levelCan(level, 'manage_accounts')
  const grants = levelCan(level, 'manage_project_grants')
  if (!accounts && !grants) notFound()
  const superAdmin = level === 'super_admin'
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div
        className="mx-auto flex w-full max-w-7xl flex-col gap-3 p-3 md:p-4"
        data-slot="access-control"
      >
        <h1 className="text-sm font-medium">Access control</h1>
        {accounts && <AdminUsersPanel />}
        {grants && <AdminProjectsPanel superAdmin={superAdmin} />}
        {grants && <AdminSharesPanel superAdmin={superAdmin} />}
      </div>
    </div>
  )
}
