// /manage/file-access — renamed Traffic control (/manage/traffic). The old URL
// keeps its capability (middleware also gates the path) and then redirects.

import { notFound, redirect } from 'next/navigation'
import { levelCan } from '../../../lib/server/auth/capabilities'
import { readAccountFromHeaders } from '../../../lib/server/auth/request-context'

export default async function FileAccessPage() {
  if (!levelCan((await readAccountFromHeaders())?.level, 'configure_instance')) notFound()
  redirect('/manage/traffic')
}
