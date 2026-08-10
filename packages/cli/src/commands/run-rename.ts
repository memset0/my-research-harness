// `memon run rename <id-or-dir> <new-slug>` — rename a run dir's slug while
// preserving its `<YYMMDD>-<HHMMSS>` timestamp suffix and atomically updating
// the parent experiment's `runs[]` back-reference if the run is bound.
//
// Per design D8 / spec run-edit:
// - new slug must match `[a-z0-9][a-z0-9-]*`
// - new dir name must be unique across the project's runs
// - if the run claims an experiment but that experiment doesn't list the run
//   (a MISMATCH_EXPERIMENT_REF), the rename is refused (BAD_STATE)
// - soft prefix violation (new slug isn't prefixed by the experiment slug)
//   prints a warning to stderr but does NOT block

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  appendJournalEvent,
  parseReadme,
  parseSlugFromRunDir,
  parseTimestampFromRunDir,
  readExperimentDoc,
  reserializeReadme,
  scanProjectRoot,
  serializeExperimentReadme,
} from '@memon/core'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { emitJson } from '../lib/output.js'

const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]?$/

export interface RunRenameInput {
  projectRoot?: string
  cwd: string
  runIdOrDir: string
  newSlug: string
}

export async function runRunRename(input: RunRenameInput): Promise<void> {
  if (!SLUG_RE.test(input.newSlug)) {
    emitErrorAndExit('BAD_REQUEST', `new slug "${input.newSlug}" must match ${SLUG_RE}`)
  }
  if (/-\d{6}-\d{6}$/.test(input.newSlug)) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `new slug "${input.newSlug}" must NOT include a timestamp tail; provide the slug only`,
    )
  }

  const r = await resolveContext(input)
  const projectRoot = singleProjectRoot(r)
  const projectName = r.config.projects[0]!.name

  const snap = await scanProjectRoot(projectRoot, { includeArchived: true })
  const target = snap.experiments.find((e) => e.id === input.runIdOrDir)
  if (!target) {
    emitErrorAndExit('NOT_FOUND', `run "${input.runIdOrDir}" not found in ${projectRoot}`)
  }

  // Compute new dir name: <newSlug>-<YYMMDD>-<HHMMSS>
  const oldId = target.id
  const oldName = parseSlugFromRunDir(oldId)
  if (oldName === null) {
    emitErrorAndExit('BAD_STATE', `run dir "${oldId}" does not match the run-dir regex`)
  }
  const tail = oldId.slice(oldName.length) // "-YYMMDD-HHMMSS"
  const newId = `${input.newSlug}${tail}`

  if (newId === oldId) {
    emitJson({ ok: true, oldId, newId, noop: true })
    return
  }

  // Run-dir-name collision check. The same slug at different timestamps
  // is FINE (run slugs MAY repeat across attempts) — what we reject is
  // a full dir-name clash, which can only happen if another run already
  // happens to have both this slug AND this exact timestamp suffix.
  const collide = snap.experiments.find((e) => e.id !== oldId && e.id === newId)
  if (collide) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `DUPLICATE_RUN_DIR: another run already has dir name "${newId}"`,
    )
  }

  // If the run claims an experiment, ensure the binding is consistent before
  // touching disk; otherwise refuse with BAD_STATE.
  const claimedExpId = target.frontMatter.experiment
  if (claimedExpId) {
    const exp = await readExperimentDoc(projectRoot, projectName, claimedExpId)
    if (!exp) {
      emitErrorAndExit(
        'BAD_STATE',
        `run claims experiment ${claimedExpId} but no such exp doc found; reconcile first via 'memon experiment unlink'`,
      )
    }
    if (!exp.frontMatter.runs.includes(oldId)) {
      emitErrorAndExit(
        'BAD_STATE',
        `MISMATCH_EXPERIMENT_REF: run "${oldId}" claims ${claimedExpId} but ${claimedExpId}.runs[] does not list it; reconcile first`,
      )
    }
    // Soft prefix violation warning (non-blocking)
    if (!input.newSlug.startsWith(exp.frontMatter.slug)) {
      process.stderr.write(
        `${JSON.stringify({
          warning: {
            code: 'RUN_SLUG_PREFIX_VIOLATION',
            message: `new slug "${input.newSlug}" does not start with experiment slug "${exp.frontMatter.slug}"`,
          },
        })}\n`,
      )
    }
  }

  // Step 1: rename the directory.
  const newPath = join(dirname(target.path), newId)
  await fs.rename(target.path, newPath)

  // Step 2: rewrite the run README's frontmatter id (and updated_at).
  const readmePath = join(newPath, 'README.md')
  let stat
  try {
    stat = await fs.stat(readmePath)
  } catch {
    stat = null
  }
  if (stat) {
    const content = await fs.readFile(readmePath, 'utf8')
    const parsed = parseReadme(content)
    parsed.frontMatter.id = newId
    parsed.frontMatter.name = input.newSlug
    parsed.frontMatter.updatedAt = nowIso()
    await atomicWrite(readmePath, reserializeReadme(parsed))
  }

  // Step 3: update the parent experiment's runs[] entry atomically.
  if (claimedExpId) {
    const exp = await readExperimentDoc(projectRoot, projectName, claimedExpId)
    if (exp) {
      exp.frontMatter.runs = exp.frontMatter.runs.map((r) => (r === oldId ? newId : r))
      exp.frontMatter.updatedAt = nowIso()
      await atomicWrite(
        exp.path,
        serializeExperimentReadme({
          frontMatter: exp.frontMatter,
          sections: exp.sections,
          warningsRaw: exp.warningsRaw,
          rawSections: exp.rawSections,
          rawBody: exp.body,
        }),
      )
      const results = exp.documents?.results
      if (
        results?.raw &&
        results.data?.variants.some(
          (variant) => variant.runs.includes(oldId) || variant.attempts.includes(oldId),
        )
      ) {
        const escaped = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const token = new RegExp(`(?<![A-Za-z0-9._-])${escaped}(?![A-Za-z0-9._-])`, 'g')
        const rewritten = results.raw.replace(token, newId)
        if (rewritten !== results.raw) await atomicWrite(results.path, rewritten)
      }
    }
  }

  await appendJournalEvent({
    path: join(projectRoot, 'docs', 'journal.md'),
    event: {
      timestamp: nowIso(),
      tag: 'RENAME',
      body: `op=run-rename old=${oldId} new=${newId}`,
    },
  })

  void parseTimestampFromRunDir // silence unused import (kept for future use)
  emitJson({ ok: true, oldId, newId })
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const tmp = join(dirname(path), `.${Date.now()}-${Math.random().toString(36).slice(2)}.cli.tmp`)
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, path)
}

function nowIso(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const offsetMin = -d.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const absMin = Math.abs(offsetMin)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(absMin / 60))}:${pad(absMin % 60)}`
}
