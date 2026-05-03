'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ApiError, fetchProjects, postExperiment } from '../lib/api'
import { Button } from './ui'

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="border-b border-slate-100 p-3 text-sm font-semibold">New experiment</div>
        <div className="space-y-3 p-4">
          <div>
            <label className="text-[10px] uppercase tracking-wide text-slate-500" htmlFor="exp-name">
              Name
            </label>
            <input
              id="exp-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              placeholder="e.g. attn-overlap"
              className="mt-1 h-9 w-full rounded border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
            <p className="mt-1 text-xs text-slate-500">
              Directory will be{' '}
              <code className="font-mono">
                {name.trim() || '<name>'}-&lt;yymmdd&gt;-&lt;hhmmss&gt;
              </code>
            </p>
          </div>
          {showProjectSelect && (
            <div>
              <label
                className="text-[10px] uppercase tracking-wide text-slate-500"
                htmlFor="exp-project"
              >
                Project
              </label>
              <select
                id="exp-project"
                value={chosenProject}
                onChange={(e) => setChosenProject(e.target.value)}
                className="mt-1 h-9 w-full rounded border border-slate-300 bg-white px-2 text-sm"
              >
                {projects.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {inlineError && (
            <div className="rounded bg-red-50 p-2 text-xs text-red-700">{inlineError}</div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 p-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void onSubmit()} disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  )
}
