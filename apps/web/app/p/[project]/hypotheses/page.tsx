import { HypothesisView } from '../../../../components/hypothesis-view'

export default async function HypothesesPage({
  params,
}: {
  params: Promise<{ project: string }>
}) {
  const { project } = await params
  return <HypothesisView project={decodeURIComponent(project)} />
}
