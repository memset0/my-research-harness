// `memon share` subcommands — create / list / revoke per-project share links.
//
// The CLI operates on a single-project context (via `--project-root` or the
// current working directory — see lib/resolver.ts). The positional `<project>`
// argument is the project NAME used in the share URL; it does NOT control
// where shares.json is written (that's always `<projectRoot>/.memon/shares.json`).
//
// The intent: the operator passes the same project name they have configured
// in `config.yml`'s `projects:` list. The CLI does NOT read `config.yml`
// (consistent with the rest of the CLI surface), so it can't auto-derive
// the project name.

import {
  addShare,
  AmbiguousShareError,
  listShares,
  revokeShare,
  ShareNotFoundError,
  parseDuration,
  type ShareRecord,
} from '@memon/core'
import { emitJson, emitHuman, type OutputFormat } from '../lib/output.js'
import { resolveConfig } from '../lib/resolver.js'
import { emitErrorAndExit } from '../lib/emit-error.js'

export interface ShareCreateOptions {
  projectName: string
  label?: string
  expires?: string
  urlBase?: string
  projectRoot?: string
  cwd: string
  format: OutputFormat
}

export interface ShareListOptions {
  projectName?: string
  projectRoot?: string
  cwd: string
  format: OutputFormat
}

export interface ShareRevokeOptions {
  idOrLabel: string
  force?: boolean
  projectRoot?: string
  cwd: string
  format: OutputFormat
}

function constructShareUrl(urlBase: string | undefined, project: string, token: string): string {
  const base = urlBase ?? process.env.MEMON_PUBLIC_URL ?? ''
  const path = `/share/${encodeURIComponent(project)}/${encodeURIComponent(token)}`
  if (!base) return path
  // Strip trailing slash from base.
  const trimmed = base.replace(/\/+$/, '')
  return `${trimmed}${path}`
}

// ---------- create ----------

export async function runShareCreate(opts: ShareCreateOptions): Promise<void> {
  // Validate expires early so we can fail with EXIT.BAD_REQUEST (= 2).
  if (opts.expires !== undefined) {
    try {
      parseDuration(opts.expires)
    } catch (err) {
      emitErrorAndExit('BAD_REQUEST', (err as Error).message)
    }
  }

  const cfg = await resolveConfig({ projectRoot: opts.projectRoot, cwd: opts.cwd })
  const root = cfg.projects[0]!.root

  let record: ShareRecord
  try {
    const created = await addShare(root, { label: opts.label, expires: opts.expires })
    record = created
  } catch (err) {
    emitErrorAndExit('GENERIC', (err as Error).message)
  }

  const shareUrl = constructShareUrl(opts.urlBase, opts.projectName, record.token)

  if (opts.format === 'human') {
    emitHuman(shareUrl)
    return
  }

  emitJson({
    share: {
      id: record.id,
      project: opts.projectName,
      token: record.token,
      label: record.label,
      created_at: record.created_at,
      expires_at: record.expires_at,
      share_url: shareUrl,
    },
  })
}

// ---------- list ----------

function formatListTable(rows: Array<ShareRecord & { project: string }>): string {
  if (rows.length === 0) return '(no shares)'
  const header = `${'ID'.padEnd(14)} ${'PROJECT'.padEnd(16)} ${'LABEL'.padEnd(20)} ${'CREATED'.padEnd(28)} EXPIRES`
  const body = rows.map((r) => {
    const label = r.label ?? '-'
    const expires = r.expires_at ?? 'never'
    return `${r.id.padEnd(14)} ${r.project.padEnd(16)} ${label.padEnd(20)} ${r.created_at.padEnd(28)} ${expires}`
  })
  return [header, ...body].join('\n')
}

export async function runShareList(opts: ShareListOptions): Promise<void> {
  const cfg = await resolveConfig({ projectRoot: opts.projectRoot, cwd: opts.cwd })
  const root = cfg.projects[0]!.root
  const projectName = opts.projectName ?? cfg.projects[0]!.name

  const records = await listShares(root, { includeTokens: false })
  // Filter by --project if provided (only meaningful in multi-project setups,
  // which the CLI doesn't currently support — but kept for forward compat).
  // Here every record belongs to the single project, so the filter passes
  // through unchanged.

  const rows = records.map((r) => ({ ...r, project: projectName }))

  if (opts.format === 'human') {
    emitHuman(formatListTable(rows))
    return
  }

  emitJson({ shares: rows })
}

// ---------- revoke ----------

export async function runShareRevoke(opts: ShareRevokeOptions): Promise<void> {
  const cfg = await resolveConfig({ projectRoot: opts.projectRoot, cwd: opts.cwd })
  const root = cfg.projects[0]!.root

  let removed: ShareRecord[]
  try {
    removed = await revokeShare(root, opts.idOrLabel, { force: opts.force })
  } catch (err) {
    if (err instanceof ShareNotFoundError) {
      emitErrorAndExit('NOT_FOUND', err.message)
    }
    if (err instanceof AmbiguousShareError) {
      emitErrorAndExit(
        'BAD_REQUEST',
        `${err.message} — pass --force to revoke all matching, or use a longer id prefix`,
      )
    }
    emitErrorAndExit('GENERIC', (err as Error).message)
  }

  if (opts.format === 'human') {
    for (const r of removed) {
      emitHuman(`revoked ${r.id}${r.label ? ` (${r.label})` : ''}`)
    }
    return
  }

  emitJson({
    revoked: removed.map((r) => ({
      id: r.id,
      label: r.label,
      created_at: r.created_at,
      expires_at: r.expires_at,
    })),
  })
}
