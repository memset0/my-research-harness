'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { fetchExperimentResearch, mutateExperimentResearch, type ProjectTarget } from '../lib/api'
import type { ResultsSummaryPayload } from '../lib/dto/experiments'
import { queryKeys } from '../lib/query-keys'
import { useSession } from './session-provider'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Textarea } from './ui/textarea'

type Action = 'advance' | 'deprecate' | 'restore' | 'import'
export function ExperimentResearchControls({
  project,
  experimentId,
  summary,
  version,
  onVersion,
  onChanged,
}: {
  project: ProjectTarget
  experimentId: string
  summary: ResultsSummaryPayload
  version?: number
  onVersion: (version?: number) => void
  onChanged: () => void
}) {
  const owner = useSession().role === 'owner'
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [action, setAction] = useState<Action>('advance')
  const [reason, setReason] = useState('')
  const [variantId, setVariantId] = useState('')
  const [successor, setSuccessor] = useState('')
  const [run, setRun] = useState('')
  const [historicalVersion, setHistoricalVersion] = useState('1')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const state = useQuery({
    queryKey: queryKeys.experimentResearch(project, experimentId),
    queryFn: () => fetchExperimentResearch(project, experimentId),
    enabled: open,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
  const research = summary.research
  if (!research) return null
  const selected = research.versions.find(
    (v) => v.version === (version ?? research.current_version),
  )
  const submit = async () => {
    if (!state.data) return
    setBusy(true)
    setError('')
    const lock = { expectedMtime: state.data.mtime, expectedHash: state.data.hash, reason }
    try {
      const input =
        action === 'advance'
          ? { ...lock, action, expectedVersion: state.data.research!.current_version }
          : action === 'import'
            ? {
                ...lock,
                action,
                run,
                version: Number(historicalVersion),
                ...(variantId ? { variantId } : {}),
              }
            : action === 'deprecate'
              ? {
                  ...lock,
                  action,
                  variantId,
                  ...(successor.trim() ? { successor: successor.trim() } : {}),
                }
              : { ...lock, action, variantId }
      await mutateExperimentResearch(project, experimentId, input)
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.experiment(project, experimentId) }),
        client.invalidateQueries({ queryKey: queryKeys.experimentResearch(project, experimentId) }),
        client.invalidateQueries({ queryKey: queryKeys.runs(project) }),
      ])
      setOpen(false)
      setReason('')
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-2 border-b pb-3" data-research-controls>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={version === undefined ? 'current' : String(version)}
          onValueChange={(v) => onVersion(v === 'current' ? undefined : Number(v))}
        >
          <SelectTrigger className="w-64" aria-label="Research version">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="current">Current research v{research.current_version}</SelectItem>
            {research.versions
              .filter((v) => v.version !== research.current_version)
              .map((v) => (
                <SelectItem key={v.version} value={String(v.version)}>
                  History v{v.version}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        {owner && version === undefined && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void state.refetch()
              setOpen(true)
              setError('')
            }}
          >
            Manage research
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {selected?.reason}
        {version !== undefined ? ' — Historical evidence; excluded from current conclusions.' : ''}
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage research</DialogTitle>
            <DialogDescription>
              Version changes preserve every Run and association. Earlier Runs cease contributing to
              current results. Variant deprecation is independent of research version.
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="research-action">Operation</Label>
          <Select value={action} onValueChange={(v) => setAction(v as Action)}>
            <SelectTrigger id="research-action">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="advance">Advance research version</SelectItem>
              <SelectItem value="deprecate">Deprecate Variant</SelectItem>
              <SelectItem value="restore">Restore Variant</SelectItem>
              <SelectItem value="import">Register historical Run</SelectItem>
            </SelectContent>
          </Select>
          {(action === 'deprecate' || action === 'restore' || action === 'import') && (
            <>
              <Label htmlFor="research-variant">
                Variant{action === 'import' ? ' (optional)' : ''}
              </Label>
              <Select
                value={variantId || 'none'}
                onValueChange={(value) => setVariantId(value === 'none' ? '' : value)}
              >
                <SelectTrigger id="research-variant">
                  <SelectValue placeholder="Choose Variant" />
                </SelectTrigger>
                <SelectContent>
                  {action === 'import' && (
                    <SelectItem value="none">No Variant association</SelectItem>
                  )}
                  {summary.variants.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.id} · {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
          {action === 'deprecate' && (
            <>
              <Label htmlFor="research-successor">Successor Variant (optional)</Label>
              <Input
                id="research-successor"
                value={successor}
                onChange={(e) => setSuccessor(e.target.value)}
              />
            </>
          )}
          {action === 'import' && (
            <>
              <Label htmlFor="research-run">Existing Run path</Label>
              <Input id="research-run" value={run} onChange={(e) => setRun(e.target.value)} />
              <Label htmlFor="research-history">Historical version</Label>
              <Input
                id="research-history"
                type="number"
                min={1}
                max={research.current_version - 1}
                value={historicalVersion}
                onChange={(e) => setHistoricalVersion(e.target.value)}
              />
              <p className="text-sm text-muted-foreground">
                Links an existing Run to this Experiment as historical evidence.
              </p>
            </>
          )}
          <Label htmlFor="research-reason">Reason</Label>
          <Textarea
            id="research-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {(error || state.error) && (
            <p role="alert" className="text-sm text-destructive">
              {error || state.error?.message}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => void state.refetch()}>
              Reload latest state
            </Button>
            <Button
              disabled={
                busy ||
                state.isFetching ||
                Boolean(state.error) ||
                !state.data ||
                !reason.trim() ||
                ((action === 'deprecate' || action === 'restore') && !variantId)
              }
              onClick={() => void submit()}
            >
              {busy ? 'Saving…' : 'Apply'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
