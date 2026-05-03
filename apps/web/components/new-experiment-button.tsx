'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ApiError, fetchProjects, postExperiment } from '../lib/api'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'

export function NewExperimentButton({ project }: { project: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        + New experiment
      </Button>
      {open && <NewExperimentModal project={project} onClose={() => setOpen(false)} />}
    </>
  )
}

function NewExperimentModal({ project, onClose }: { project: string; onClose: () => void }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [chosenProject, setChosenProject] = useState(project)
  const [busy, setBusy] = useState(false)
  const [inlineError, setInlineError] = useState<string | null>(null)

  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
    staleTime: 60_000,
  })
  const projects = projectsData?.projects ?? []
  const showProjectSelect = projects.length > 1

  const onSubmit = async () => {
    setInlineError(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setInlineError('Name is required')
      return
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
      setInlineError('Name may only contain letters, digits, dashes, underscores')
      return
    }
    setBusy(true)
    try {
      const res = await postExperiment({ name: trimmed, project: chosenProject })
      if ('error' in res) {
        if (res.error.code === 'CONFLICT') {
          setInlineError('An experiment with that name already exists this second; try again')
        } else {
          setInlineError(res.error.message)
        }
        return
      }
      toast.success(`Created ${res.created.id}`)
      queryClient.invalidateQueries({ queryKey: ['experiments'] })
      router.push(
        `/p/${encodeURIComponent(res.created.project)}/experiments/${encodeURIComponent(res.created.id)}`,
      )
      onClose()
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message
      setInlineError(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New experiment</DialogTitle>
          <DialogDescription>
            Scaffolds a directory + README + run.sh in the chosen project's logs path.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="exp-name">Name</Label>
            <Input
              id="exp-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              placeholder="e.g. attn-overlap"
            />
            <p className="text-xs text-muted-foreground">
              Directory will be{' '}
              <code className="font-mono">
                {name.trim() || '<name>'}-&lt;yymmdd&gt;-&lt;hhmmss&gt;
              </code>
            </p>
          </div>
          {showProjectSelect && (
            <div className="space-y-1.5">
              <Label htmlFor="exp-project">Project</Label>
              <Select value={chosenProject} onValueChange={setChosenProject}>
                <SelectTrigger id="exp-project">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.name} value={p.name}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {inlineError && (
            <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
              {inlineError}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void onSubmit()} disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
