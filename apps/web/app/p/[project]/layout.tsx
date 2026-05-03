import { Header } from '../../../components/header'

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ project: string }>
}) {
  const { project } = await params
  return (
    <>
      <Header project={decodeURIComponent(project)} />
      {children}
    </>
  )
}
