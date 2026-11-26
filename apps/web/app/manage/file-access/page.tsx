// /manage/file-access — owner-only view of the central filesystem scheduler:
// its effective settings, the values saved for the next restart, and what its
// operation queue has been doing.
//
// The panel is a client component because it edits a form and reads live
// metrics; the route itself renders no project data and touches no files.

import { notFound } from 'next/navigation'
import { FileAccessSettingsPanel } from '../../../components/file-access-settings-panel'
import { levelCan } from '../../../lib/server/auth/capabilities'
import { readAccountFromHeaders } from '../../../lib/server/auth/request-context'

export const metadata = {
  title: 'File access — memon',
}

export default async function FileAccessPage() {
  if (!levelCan((await readAccountFromHeaders())?.level, 'configure_instance')) notFound()
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 md:p-6">
        <FileAccessSettingsPanel />
      </div>
    </div>
  )
}
