// /manage/users — super-admin account management (middleware also gates the path).

import { notFound } from 'next/navigation'
import { AdminUsersPanel } from '../../../components/admin-users-panel'
import { levelCan } from '../../../lib/server/auth/capabilities'
import { readAccountFromHeaders } from '../../../lib/server/auth/request-context'

export const metadata = { title: 'Users — memon' }

export default async function UsersPage() {
  if (!levelCan((await readAccountFromHeaders())?.level, 'manage_accounts')) notFound()
  return <AdminUsersPanel />
}
