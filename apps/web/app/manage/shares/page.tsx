// /manage/shares — share links: every share for the super admin, an admin's own otherwise.

import { notFound } from 'next/navigation'
import { AdminSharesPanel } from '../../../components/admin-shares-panel'
import { levelCan } from '../../../lib/server/auth/capabilities'
import { readAccountFromHeaders } from '../../../lib/server/auth/request-context'

export const metadata = { title: 'Shares — memon' }

export default async function SharesPage() {
  const level = (await readAccountFromHeaders())?.level
  if (!levelCan(level, 'manage_project_grants')) notFound()
  return <AdminSharesPanel superAdmin={level === 'super_admin'} />
}
