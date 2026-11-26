// /manage/projects — read grants on the Projects an admin manages (middleware also gates the path).

import { notFound } from 'next/navigation'
import { AdminProjectsPanel } from '../../../components/admin-projects-panel'
import { levelCan } from '../../../lib/server/auth/capabilities'
import { readAccountFromHeaders } from '../../../lib/server/auth/request-context'

export const metadata = { title: 'Projects — memon' }

export default async function ProjectsAccessPage() {
  const level = (await readAccountFromHeaders())?.level
  if (!levelCan(level, 'manage_project_grants')) notFound()
  return <AdminProjectsPanel superAdmin={level === 'super_admin'} />
}
