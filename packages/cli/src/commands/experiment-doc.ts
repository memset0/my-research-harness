// memon experiment {ls, show, create, link, unlink, delete} — v3 exp-doc commands.
//
// These operate on `<projectRoot>/docs/experiments/E<NNNN>-<slug>.md`. Run-level
// operations (status set / readme write / archive / unarchive / rename) live in
// experiment.ts (legacy file name) and run-rename.ts respectively.

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  appendJournalEvent,
  discoverExperiments,
  EXPERIMENT_DIR_REGEX,
  EXPERIMENT_STATUS_VALUES,
  nextExperimentId,
  parseReadme,
  readExperimentDoc,
  readRunDir,
  reserializeReadme,
  resolveExperimentId,
  scanProjectRoot,
  serializeExperimentReadme,
  type ExperimentStatus,
  type Run,
} from '@memon/core'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { emitJson } from '../lib/output.js'

const EXPERIMENTS_SUBDIR = 'docs/experiments'

// ---------- experiment ls ----------

export interface ExperimentLsInput {
  projectRoot?: string
  cwd: string
  format: 'json' | 'human'
}

export async function runExperimentLs(input: ExperimentLsInput): Promise<void> {
  const r = await resolveContext(input)
  const projectRoot = singleProjectRoot(r)
  const projectName = r.config.projects[0]!.name
  const { experiments } = await discoverExperiments(projectRoot, projectName)
  if (input.format === 'human') {
    if (experiments.length === 0) {
      process.stdout.write('(no experiments)\n')
      return
    }
    for (const exp of experiments) {
      const status = exp.parseErrors.length > 0 ? '✗' : '·'
      const memberCount = exp.frontMatter.runs.length
      process.stdout.write(
        `${status} ${exp.id.padEnd(40)}  ${memberCount.toString().padStart(3)} runs  ${exp.frontMatter.title}\n`,
      )
    }
    return
  }
  emitJson({
    experiments: experiments.map((e) => ({
      id: e.id,
      slug: e.frontMatter.slug,
      title: e.frontMatter.title,
      runs: e.frontMatter.runs,
      hypotheses: e.frontMatter.hypotheses,
      tags: e.frontMatter.tags,
      createdAt: e.frontMatter.createdAt,
      updatedAt: e.frontMatter.updatedAt,
      path: e.path,
      mtime: e.mtime,
      parseErrors: e.parseErrors,
      parseWarnings: e.parseWarnings,
    })),
  })
}

// ---------- experiment show ----------

export interface ExperimentShowInput {
  projectRoot?: string
  cwd: string
  idOrSlug: string
  format: 'json' | 'human'
}

export async function runExperimentShow(input: ExperimentShowInput): Promise<void> {
  const r = await resolveContext(input)
  const projectRoot = singleProjectRoot(r)
  const projectName = r.config.projects[0]!.name
  const id = await resolveOrFail(projectRoot, input.idOrSlug)
  const exp = await readExperimentDoc(projectRoot, projectName, id)
  if (!exp) {
    emitErrorAndExit('NOT_FOUND', `experiment "${id}" not found`)
  }
  if (input.format === 'human') {
    const content = await fs.readFile(exp.path, 'utf8')
    process.stdout.write(content)
    return
  }
  emitJson({
    id: exp.id,
    project: exp.project,
    path: exp.path,
    mtime: exp.mtime,
    frontMatter: exp.frontMatter,
    sections: exp.sections,
    warningsRaw: exp.warningsRaw,
    parseErrors: exp.parseErrors,
    parseWarnings: exp.parseWarnings,
  })
}

// ---------- experiment create ----------

export interface ExperimentCreateInput {
  projectRoot?: string
  cwd: string
  slug: string
  title?: string
  hypotheses?: string[]
  fromRun?: string | undefined
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/

export async function runExperimentCreate(input: ExperimentCreateInput): Promise<void> {
  if (!SLUG_RE.test(input.slug)) {
    emitErrorAndExit('BAD_REQUEST', `slug "${input.slug}" must match ${SLUG_RE}`)
  }
  const r = await resolveContext(input)
  const projectRoot = singleProjectRoot(r)
  const projectName = r.config.projects[0]!.name

  // Slug-uniqueness + prefix-collision checks against existing experiments.
  const { experiments } = await discoverExperiments(projectRoot, projectName)
  for (const e of experiments) {
    if (e.frontMatter.slug === input.slug) {
      emitErrorAndExit(
        'BAD_REQUEST',
        `DUPLICATE_EXPERIMENT_SLUG: experiment ${e.id} already uses slug "${input.slug}"`,
      )
    }
    if (
      e.frontMatter.slug.startsWith(`${input.slug}-`) ||
      input.slug.startsWith(`${e.frontMatter.slug}-`)
    ) {
      emitErrorAndExit(
        'BAD_REQUEST',
        `EXPERIMENT_SLUG_PREFIX_COLLISION: "${input.slug}" collides with existing slug "${e.frontMatter.slug}" (one is a prefix of the other)`,
      )
    }
  }

  // Allocate next id with a retry loop on EEXIST (lock-free allocator).
  let id: string | null = null
  let lastErr: Error | null = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = await nextExperimentId(projectRoot)
    const fullId = `${candidate}-${input.slug}`
    // v5 layout: docs/experiments/E<NNNN>-<slug>/README.md inside a per-exp folder.
    const expDir = join(projectRoot, EXPERIMENTS_SUBDIR, fullId)
    await fs.mkdir(expDir, { recursive: true })
    const filepath = join(expDir, 'README.md')
    const now = nowIso()
    const initialRuns: string[] = []
    if (input.fromRun) {
      // Validate the run exists and is unbound (or already claims this exp;
      // in the normal flow the run hasn't been written yet).
      const runRecord = await findRunByDirOrId(projectRoot, projectName, input.fromRun)
      if (!runRecord) {
        emitErrorAndExit('NOT_FOUND', `run "${input.fromRun}" not found`)
      }
      if (runRecord.frontMatter.experiment && runRecord.frontMatter.experiment !== fullId) {
        emitErrorAndExit(
          'BAD_STATE',
          `run "${input.fromRun}" already claims experiment ${runRecord.frontMatter.experiment}; unlink first`,
        )
      }
      initialRuns.push(runRecord.id)
    }
    const content = serializeExperimentReadme({
      frontMatter: {
        id: fullId,
        slug: input.slug,
        title: input.title ?? input.slug,
        // v4: new experiments default to OPEN + not-archived (human-only writes).
        status: 'OPEN',
        archived: false,
        runs: initialRuns,
        hypotheses: input.hypotheses ?? [],
        tags: [],
        createdAt: now,
        updatedAt: now,
      },
      sections: { motivation: null, method: null, plan: null, conclusion: null, caveats: null },
      warningsRaw: null,
    })
    try {
      // 'wx' flag fails if file exists — atomicity for concurrent allocators.
      await fs.writeFile(filepath, content, { encoding: 'utf8', flag: 'wx' })
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'EEXIST') {
        lastErr = e
        continue
      }
      throw err
    }
    id = fullId
    // If --from-run, also write the run's `experiment:` back-reference.
    if (input.fromRun) {
      await setRunExperiment(projectRoot, projectName, input.fromRun, fullId)
    }
    // [EXPERIMENT] op=create journal event
    await appendJournalEvent({
      path: join(projectRoot, 'docs', 'journal.md'),
      event: {
        timestamp: now,
        tag: 'EXPERIMENT',
        body: `\`${fullId}\` op=create slug=${input.slug}${input.fromRun ? ` from-run=${input.fromRun}` : ''}`,
      },
    })
    if (input.fromRun) {
      await appendJournalEvent({
        path: join(projectRoot, 'docs', 'journal.md'),
        event: {
          timestamp: now,
          tag: 'BIND',
          body: `\`${fullId}\` op=link run=${initialRuns[0]}`,
        },
      })
    }
    break
  }
  if (id === null) {
    emitErrorAndExit('BAD_STATE', `failed to allocate experiment id after 5 attempts: ${lastErr?.message}`)
  }
  emitJson({ ok: true, id })
}

// ---------- experiment link / unlink ----------

export interface ExperimentLinkInput {
  projectRoot?: string
  cwd: string
  experimentIdOrSlug: string
  runIdOrDir: string
}

export async function runExperimentLink(input: ExperimentLinkInput): Promise<void> {
  const r = await resolveContext(input)
  const projectRoot = singleProjectRoot(r)
  const projectName = r.config.projects[0]!.name
  const expId = await resolveOrFail(projectRoot, input.experimentIdOrSlug)
  const exp = await readExperimentDoc(projectRoot, projectName, expId)
  if (!exp) emitErrorAndExit('NOT_FOUND', `experiment "${expId}" not found`)

  const run = await findRunByDirOrId(projectRoot, projectName, input.runIdOrDir)
  if (!run) emitErrorAndExit('NOT_FOUND', `run "${input.runIdOrDir}" not found`)

  if (run.frontMatter.experiment && run.frontMatter.experiment !== expId) {
    emitErrorAndExit(
      'BAD_STATE',
      `run "${run.id}" already claims experiment ${run.frontMatter.experiment}; unlink first`,
    )
  }

  // Soft prefix warning to stderr.
  if (!run.id.startsWith(`${exp.frontMatter.slug}-`)) {
    process.stderr.write(
      `${JSON.stringify({
        warning: {
          code: 'RUN_SLUG_PREFIX_VIOLATION',
          message: `run slug does not start with experiment slug "${exp.frontMatter.slug}"`,
        },
      })}\n`,
    )
  }

  // Update both sides atomically (best-effort: write run first, then exp).
  if (!exp.frontMatter.runs.includes(run.id)) {
    exp.frontMatter.runs.push(run.id)
  }
  exp.frontMatter.updatedAt = nowIso()
  await atomicWrite(
    exp.path,
    serializeExperimentReadme({
      frontMatter: exp.frontMatter,
      sections: exp.sections,
      warningsRaw: exp.warningsRaw,
    }),
  )
  if (run.frontMatter.experiment !== expId) {
    await setRunExperiment(projectRoot, projectName, run.id, expId)
  }

  await appendJournalEvent({
    path: join(projectRoot, 'docs', 'journal.md'),
    event: {
      timestamp: nowIso(),
      tag: 'BIND',
      body: `\`${expId}\` op=link run=${run.id}`,
    },
  })
  emitJson({ ok: true, experimentId: expId, runId: run.id })
}

export interface ExperimentUnlinkInput {
  projectRoot?: string
  cwd: string
  experimentIdOrSlug: string
  runIdOrDir: string
}

export async function runExperimentUnlink(input: ExperimentUnlinkInput): Promise<void> {
  const r = await resolveContext(input)
  const projectRoot = singleProjectRoot(r)
  const projectName = r.config.projects[0]!.name
  const expId = await resolveOrFail(projectRoot, input.experimentIdOrSlug)
  const exp = await readExperimentDoc(projectRoot, projectName, expId)
  if (!exp) emitErrorAndExit('NOT_FOUND', `experiment "${expId}" not found`)

  const run = await findRunByDirOrId(projectRoot, projectName, input.runIdOrDir)
  if (!run) emitErrorAndExit('NOT_FOUND', `run "${input.runIdOrDir}" not found`)

  exp.frontMatter.runs = exp.frontMatter.runs.filter((r) => r !== run.id)
  exp.frontMatter.updatedAt = nowIso()
  await atomicWrite(
    exp.path,
    serializeExperimentReadme({
      frontMatter: exp.frontMatter,
      sections: exp.sections,
      warningsRaw: exp.warningsRaw,
    }),
  )
  if (run.frontMatter.experiment === expId) {
    await setRunExperiment(projectRoot, projectName, run.id, null)
  }

  await appendJournalEvent({
    path: join(projectRoot, 'docs', 'journal.md'),
    event: {
      timestamp: nowIso(),
      tag: 'BIND',
      body: `\`${expId}\` op=unlink run=${run.id}`,
    },
  })
  emitJson({ ok: true, experimentId: expId, runId: run.id })
}

// ---------- experiment status set (v4) ----------

export interface ExperimentStatusSetInput {
  projectRoot?: string
  cwd: string
  experimentId: string
  to: string
  expectedMtime: number
}

export async function runExperimentStatusSet(
  input: ExperimentStatusSetInput,
): Promise<void> {
  if (!(EXPERIMENT_STATUS_VALUES as readonly string[]).includes(input.to)) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `--to must be one of: ${EXPERIMENT_STATUS_VALUES.join(', ')}`,
    )
  }
  const r = await resolveContext(input)
  const projectRoot = singleProjectRoot(r)
  const projectName = r.config.projects[0]!.name
  const expId = await resolveOrFail(projectRoot, input.experimentId)
  const exp = await readExperimentDoc(projectRoot, projectName, expId)
  if (!exp) {
    emitErrorAndExit('NOT_FOUND', `experiment "${expId}" not found`)
  }

  let stat
  try {
    stat = await fs.stat(exp.path)
  } catch {
    emitErrorAndExit('NOT_FOUND', `${exp.path} does not exist`)
  }
  if (stat.mtimeMs !== input.expectedMtime) {
    const current = await fs.readFile(exp.path, 'utf8')
    process.stdout.write(current)
    process.stderr.write(
      `${JSON.stringify({
        error: { code: 'CONFLICT', message: 'on-disk mtime differs from expectedMtime' },
        currentMtime: stat.mtimeMs,
        expectedMtime: input.expectedMtime,
      })}\n`,
    )
    process.exit(9)
  }

  const prevStatus = exp.frontMatter.status
  const prevArchived = exp.frontMatter.archived
  const nextStatus = input.to as ExperimentStatus
  exp.frontMatter.status = nextStatus
  exp.frontMatter.updatedAt = nowIso()
  await atomicWrite(
    exp.path,
    serializeExperimentReadme({
      frontMatter: exp.frontMatter,
      sections: exp.sections,
      warningsRaw: exp.warningsRaw,
    }),
  )
  const newStat = await fs.stat(exp.path)

  let journalAppended = false
  if (prevStatus !== nextStatus) {
    await appendJournalEvent({
      path: join(projectRoot, 'docs', 'journal.md'),
      event: {
        timestamp: nowIso(),
        tag: 'EXP_STATUS',
        body: `\`${expId}\` ${prevStatus} → ${nextStatus}`,
      },
    })
    journalAppended = true
  }

  const result: Record<string, unknown> = {
    ok: true,
    mtime: newStat.mtimeMs,
    prevStatus,
    nextStatus,
    journalAppended,
  }
  if (prevArchived) {
    process.stderr.write(`warning: ${expId} is archived; modifying anyway\n`)
    result.warning = 'archived'
  }
  emitJson(result)
}

// ---------- experiment archive (v4 — exp-doc form) ----------

export interface ExperimentArchiveInput {
  projectRoot?: string
  cwd: string
  experimentId: string
}

export async function runExperimentArchiveDoc(
  input: ExperimentArchiveInput,
): Promise<void> {
  await setExperimentArchived(input, true)
}

export async function runExperimentUnarchiveDoc(
  input: ExperimentArchiveInput,
): Promise<void> {
  await setExperimentArchived(input, false)
}

async function setExperimentArchived(
  input: ExperimentArchiveInput,
  target: boolean,
): Promise<void> {
  const r = await resolveContext(input)
  const projectRoot = singleProjectRoot(r)
  const projectName = r.config.projects[0]!.name
  const expId = await resolveOrFail(projectRoot, input.experimentId)
  const exp = await readExperimentDoc(projectRoot, projectName, expId)
  if (!exp) emitErrorAndExit('NOT_FOUND', `experiment "${expId}" not found`)

  const prevArchived = exp.frontMatter.archived
  if (prevArchived === target) {
    emitJson({ ok: true, archived: target, noop: true })
    return
  }

  exp.frontMatter.archived = target
  exp.frontMatter.updatedAt = nowIso()
  await atomicWrite(
    exp.path,
    serializeExperimentReadme({
      frontMatter: exp.frontMatter,
      sections: exp.sections,
      warningsRaw: exp.warningsRaw,
    }),
  )
  await appendJournalEvent({
    path: join(projectRoot, 'docs', 'journal.md'),
    event: {
      timestamp: nowIso(),
      tag: 'ARCHIVE',
      body: `\`${expId}\` op=${target ? 'archive' : 'unarchive'}`,
    },
  })
  emitJson({ ok: true, archived: target, noop: false })
}

// ---------- experiment delete ----------

export interface ExperimentDeleteInput {
  projectRoot?: string
  cwd: string
  experimentIdOrSlug: string
  force: boolean
}

export async function runExperimentDelete(input: ExperimentDeleteInput): Promise<void> {
  const r = await resolveContext(input)
  const projectRoot = singleProjectRoot(r)
  const projectName = r.config.projects[0]!.name
  const expId = await resolveOrFail(projectRoot, input.experimentIdOrSlug)
  const exp = await readExperimentDoc(projectRoot, projectName, expId)
  if (!exp) emitErrorAndExit('NOT_FOUND', `experiment "${expId}" not found`)

  const memberRuns = exp.frontMatter.runs.slice()

  if (!input.force && memberRuns.length > 0) {
    // In JSON mode (default) we can't prompt — refuse and require --force.
    // Human callers using --format human get a confirmation prompt via
    // stdin. Skill code paths should always pass --force.
    emitErrorAndExit(
      'BAD_REQUEST',
      `experiment ${expId} has ${memberRuns.length} member runs; pass --force to cascade-unlink`,
    )
  }

  // Cascade-unlink each member run.
  for (const runDir of memberRuns) {
    const run = await findRunByDirOrId(projectRoot, projectName, runDir)
    if (run && run.frontMatter.experiment === expId) {
      await setRunExperiment(projectRoot, projectName, runDir, null)
    }
  }

  // v5: Delete the exp folder (and everything inside — README.md plus any
  // user-owned scratch files). For legacy v4 records still on disk (the
  // mid-migration window), `exp.path` is a file path; just unlink it.
  if (exp.path.endsWith(`${expId}.md`)) {
    // Legacy v4 file form — just unlink the single file.
    await fs.unlink(exp.path)
  } else {
    // v5 folder form — remove the whole experiment folder.
    const expFolder = dirname(exp.path)
    if (!input.force) {
      // Without --force, refuse if the folder contains anything other than
      // README.md (treats sibling files as user scratch the user might
      // care about).
      let siblings: string[] = []
      try {
        siblings = (await fs.readdir(expFolder)).filter((n) => n !== 'README.md')
      } catch {
        /* folder vanished mid-op — fall through to rm */
      }
      if (siblings.length > 0) {
        emitErrorAndExit(
          'BAD_REQUEST',
          `experiment folder ${expFolder} contains ${siblings.length} non-README file(s) ${JSON.stringify(siblings)}; pass --force to remove the whole folder + scratch`,
        )
      }
    }
    await fs.rm(expFolder, { recursive: true, force: true })
  }

  await appendJournalEvent({
    path: join(projectRoot, 'docs', 'journal.md'),
    event: {
      timestamp: nowIso(),
      tag: 'EXPERIMENT',
      body: `\`${expId}\` op=delete cascaded-runs=${JSON.stringify(memberRuns)}`,
    },
  })
  emitJson({ ok: true, deletedId: expId, cascadedRuns: memberRuns })
}

// ---------- helpers ----------

async function resolveOrFail(projectRoot: string, idOrSlug: string): Promise<string> {
  // Fast path: if the input already looks like a canonical v5 id (`E<NNNN>-<slug>`),
  // skip the slug-lookup round-trip. The id format itself is the v5 folder regex.
  if (idOrSlug.match(EXPERIMENT_DIR_REGEX)) {
    return idOrSlug
  }
  const resolved = await resolveExperimentId(projectRoot, idOrSlug)
  if (!resolved) {
    emitErrorAndExit('NOT_FOUND', `no experiment matches "${idOrSlug}" in ${projectRoot}`)
  }
  return resolved
}

async function findRunByDirOrId(
  projectRoot: string,
  _projectName: string,
  needle: string,
): Promise<Run | null> {
  const snap = await scanProjectRoot(projectRoot, { includeArchived: true })
  const match = snap.experiments.find((e) => e.id === needle)
  if (!match) return null
  return match
}

async function setRunExperiment(
  projectRoot: string,
  projectName: string,
  runId: string,
  experiment: string | null,
): Promise<void> {
  const run = await findRunByDirOrId(projectRoot, projectName, runId)
  if (!run) return
  const readmePath = join(run.path, 'README.md')
  if (run.hasReadme) {
    const content = await fs.readFile(readmePath, 'utf8')
    const parsed = parseReadme(content)
    parsed.frontMatter.experiment = experiment
    parsed.frontMatter.updatedAt = nowIso()
    await atomicWrite(readmePath, reserializeReadme(parsed))
  }
  // If the run has no README, the membership join will surface this as a
  // parse-issue rather than fail silently. We don't synthesize a README here.
  void readRunDir // silence unused import (kept for future-need consumers)
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
