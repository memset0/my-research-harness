import { JournalView } from '../../../../components/journal-view'

export default async function JournalPage({
  params,
}: {
  params: Promise<{ project: string }>
}) {
  const { project } = await params
  return <JournalView project={decodeURIComponent(project)} />
}
