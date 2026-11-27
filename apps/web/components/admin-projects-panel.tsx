'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import type { ProjectAccessDto, ProjectAccessGrantDto } from '@/lib/dto/accounts'
import { changeProjectAccess, changeProjectAdmin, fetchProjectAccess } from '../lib/api'
import { queryKeys } from '../lib/query-keys'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function grantText(grant: ProjectAccessGrantDto): string {
  return grant.document ? `${grant.username} · ${grant.document.id}` : grant.username
}

/** Admin area → Projects: read grants on manageable Projects; the super admin also assigns admins. */
export function AdminProjectsPanel({ superAdmin }: { superAdmin: boolean }) {
  const access = useQuery({ queryKey: queryKeys.projectAccess(), queryFn: fetchProjectAccess })
  const projects = access.data?.projects ?? []
  return (
    <Card size="sm" id="projects" className="scroll-mt-3" data-slot="admin-projects">
      <CardHeader>
        <CardTitle>Projects</CardTitle>
        <CardDescription>
          {superAdmin ? 'Project admins and user read grants.' : 'Read grants on your projects.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {access.isError && <p className="text-xs text-destructive">{errorMessage(access.error)}</p>}
        {access.isSuccess && projects.length === 0 && (
          <p className="text-xs text-muted-foreground">No projects have been granted to you yet.</p>
        )}
        {projects.length > 0 && (
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead className="h-8">Project</TableHead>
                {superAdmin && <TableHead className="h-8">Admins</TableHead>}
                <TableHead className="h-8">Read access</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project) => (
                <ProjectRow
                  key={`${project.host}/${project.project}`}
                  project={project}
                  superAdmin={superAdmin}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function ProjectRow({ project, superAdmin }: { project: ProjectAccessDto; superAdmin: boolean }) {
  const client = useQueryClient()
  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.projectAccess() })
  const ref = { host: project.host, project: project.project }
  const access = useMutation({
    mutationFn: (args: Parameters<typeof changeProjectAccess>) => changeProjectAccess(...args),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error)),
  })
  const admin = useMutation({
    mutationFn: (args: Parameters<typeof changeProjectAdmin>) => changeProjectAdmin(...args),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error)),
  })
  return (
    <TableRow data-project={`${project.host}/${project.project}`}>
      <TableCell className="py-1 align-top font-mono">
        {project.host}/{project.project}
      </TableCell>
      {superAdmin && (
        <TableCell className="py-1 align-top">
          <div className="flex flex-wrap items-center gap-1">
            {(project.admins ?? []).map((name) => (
              <Badge key={name} variant="secondary" className="gap-0.5">
                {name}
                <button
                  type="button"
                  aria-label={`Remove admin ${name}`}
                  onClick={() => admin.mutate(['remove', { ...ref, username: name }])}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
            <NameForm
              placeholder="admin username"
              pending={admin.isPending}
              onSubmit={(username) => admin.mutate(['add', { ...ref, username }])}
            />
          </div>
        </TableCell>
      )}
      <TableCell className="py-1 align-top">
        <div className="flex flex-wrap items-center gap-1">
          {project.grants.map((grant) => (
            <Badge key={grantText(grant)} variant="outline" className="gap-0.5">
              {grantText(grant)}
              <button
                type="button"
                aria-label={`Remove ${grantText(grant)}`}
                onClick={() =>
                  access.mutate([
                    'remove',
                    {
                      ...ref,
                      username: grant.username,
                      ...(grant.document ? { document: grant.document } : {}),
                    },
                  ])
                }
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          <GrantForm
            pending={access.isPending}
            onSubmit={(username, document) =>
              access.mutate(['add', { ...ref, username, ...(document ? { document } : {}) }])
            }
          />
        </div>
      </TableCell>
    </TableRow>
  )
}

function NameForm({
  placeholder,
  pending,
  onSubmit,
}: {
  placeholder: string
  pending: boolean
  onSubmit: (name: string) => void
}) {
  const [name, setName] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    onSubmit(name.trim())
    setName('')
  }
  return (
    <form onSubmit={submit} className="flex items-center gap-1">
      <Input
        className="h-6 w-32 text-xs"
        aria-label={placeholder}
        placeholder={placeholder}
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="off"
      />
      <Button type="submit" size="xs" variant="outline" disabled={pending || !name.trim()}>
        Add
      </Button>
    </form>
  )
}

function GrantForm({
  pending,
  onSubmit,
}: {
  pending: boolean
  onSubmit: (username: string, document?: { kind: 'report' | 'wiki'; id: string }) => void
}) {
  const [username, setUsername] = useState('')
  const [scope, setScope] = useState<'project' | 'report' | 'wiki'>('project')
  const [docId, setDocId] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!username.trim() || (scope !== 'project' && !docId.trim())) return
    onSubmit(
      username.trim(),
      scope === 'project' ? undefined : { kind: scope, id: docId.trim().toUpperCase() },
    )
    setUsername('')
    setDocId('')
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-1">
      <Input
        className="h-6 w-32 text-xs"
        aria-label="Exact username"
        placeholder="exact username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        autoComplete="off"
      />
      <Select value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
        <SelectTrigger size="sm" className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="project">Whole project</SelectItem>
          <SelectItem value="report">One Report</SelectItem>
          <SelectItem value="wiki">One Wiki</SelectItem>
        </SelectContent>
      </Select>
      {scope !== 'project' && (
        <Input
          className="h-6 w-20 text-xs"
          aria-label="Document id"
          placeholder={scope === 'report' ? 'R0001' : 'W0001'}
          value={docId}
          onChange={(e) => setDocId(e.target.value)}
        />
      )}
      <Button type="submit" size="xs" variant="outline" disabled={pending}>
        Grant
      </Button>
    </form>
  )
}
