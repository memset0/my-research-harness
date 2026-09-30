'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Server } from 'lucide-react'
import { fetchSlurmStatus, type SlurmStatus, type SlurmJobJson } from '../lib/api'
import { useIsMobile } from '../hooks/use-mobile'
import { SidebarMenuButton, SidebarMenuItem } from './ui/sidebar'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Badge } from './ui/badge'
import { cn } from '../lib/utils'

export function SlurmStatusWidget() {
  const isMobile = useIsMobile()
  const [dialogOpen, setDialogOpen] = useState(false)

  const { data } = useQuery({
    queryKey: ['slurm-status'],
    queryFn: fetchSlurmStatus,
    refetchInterval: 30_000,
    staleTime: 25_000,
  })

  // Render nothing until the first fetch resolves. We can't show a
  // skeleton during loading because SSR doesn't know yet whether the
  // feature is disabled (`enabled: false` → MUST render nothing per spec),
  // and a flash of skeleton on the disabled path violates that contract.
  if (!data || data.enabled === false) {
    return null
  }

  const isError = 'error' in data
  const overlayBody = isError ? (
    <p className="text-destructive">{data.error.message}</p>
  ) : (
    <JobsTable jobs={data.jobs} />
  )
  const overlayTitle = isError ? 'Slurm — error' : 'Slurm — squeue --me'

  const row = (
    <SidebarMenuButton
      size="sm"
      onClick={isMobile ? () => setDialogOpen(true) : undefined}
      className={cn(isError && 'text-destructive')}
    >
      {isError ? <AlertTriangle className="size-4" /> : <Server className="size-4" />}
      <span>Slurm Usage</span>
      <Badge variant={isError ? 'destructive' : 'secondary'} className="ml-auto font-mono">
        {isError ? 'error' : `${data.usedNodes} / ${data.totalNodes}`}
      </Badge>
    </SidebarMenuButton>
  )

  if (isMobile) {
    return (
      <>
        <SidebarMenuItem>{row}</SidebarMenuItem>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-[min(95vw,560px)]">
            <DialogHeader>
              <DialogTitle>{overlayTitle}</DialogTitle>
            </DialogHeader>
            {overlayBody}
          </DialogContent>
        </Dialog>
      </>
    )
  }

  return (
    <SidebarMenuItem>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>{row}</TooltipTrigger>
          <TooltipContent
            side="right"
            align="end"
            className="max-w-[min(90vw,520px)] bg-popover p-3 text-popover-foreground ring-1 ring-foreground/10"
          >
            {overlayBody}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </SidebarMenuItem>
  )
}

function JobsTable({ jobs }: { jobs: SlurmJobJson[] }) {
  if (jobs.length === 0) {
    return <p className="text-xs/relaxed text-muted-foreground">No active jobs</p>
  }
  return (
    <table className="w-full text-xs/relaxed">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="pr-3 pb-1 font-medium">Job</th>
          <th className="pr-3 pb-1 font-medium">Name</th>
          <th className="pr-3 pb-1 font-medium">State</th>
          <th className="pr-3 pb-1 font-medium">Time</th>
          <th className="pr-3 pb-1 font-medium">Nodes</th>
          <th className="pb-1 font-medium">Hosts</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((j) => (
          <tr key={j.jobId} className="align-top">
            <td className="pr-3 font-mono">{j.jobId}</td>
            <td className="pr-3">{j.name}</td>
            <td className="pr-3">{j.state}</td>
            <td className="pr-3 font-mono whitespace-nowrap">{j.time}</td>
            <td className="pr-3 font-mono">{j.numNodes}</td>
            <td className="font-mono break-all">{j.nodeList}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// Re-export for callers that want to typecheck against the union directly.
export type { SlurmStatus }
