// `memon journal submit --files <relative-paths...>` — the one direct-file
// maintenance receipt.
//
// An Agent that edited managed research documents by hand (Experiment bundle
// files, Wiki pages) closes the loop with exactly one invocation: memon
// verifies that every named path is a managed document inside this project,
// then records the batch's *observed current* fingerprints.
//
// Deliberate non-features:
//   * No prose. There is no `--message`; the Journal is not a research
//     narrative and this command cannot author one.
//   * No submitted preimages. A caller-supplied "before" hash would be an
//     unverifiable claim, so `before` is always `null` (unavailable) and
//     `after` is what the bytes on disk hash to right now.
//   * Not a commit or a push. It changes no file and touches no git state.
//
// Validation is all-or-nothing: one bad path rejects the whole batch and no
// submission is recorded (the ledger still records the failed invocation,
// which is the point of an invocation ledger).

import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import { isAbsolute } from 'node:path'
import {
  addJournalInvocationDetail,
  currentJournalInvocation,
  EXPERIMENT_DIR_REGEX,
  markJournalInvocationOutcome,
  ProjectResourceError,
  readJournalActivity,
  resolveProjectResource,
  WIKI_DIR_RELPATH,
  WIKI_PAGE_NAME_REGEX,
} from '@memon/core'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { emitHuman, emitJson, type OutputFormat } from '../lib/output.js'

/** `docs/experiments`, the only other managed tree submissions may name. */
const EXPERIMENTS_DIR_RELPATH = 'docs/experiments'

/** The command path used for the ledger record; also the noop comparison key. */
const SUBMIT_COMMAND = 'journal submit'

/**
 * A whole-bundle batch is expected and supported; this only guards against a
 * batch so large that the receipt's own detail ceiling would truncate it. It
 * is a hard error, never a silent drop of the tail of the file list.
 */
const MAX_SUBMIT_FILES = 500

export interface JournalSubmitInput {
  projectRoot?: string
  cwd: string
  format: OutputFormat
  /** Project-root-relative paths, as given on the command line. */
  files: string[]
}

/** One accepted managed file with the digest observed at submission time. */
export interface SubmittedFile {
  /** Project-root-relative, POSIX separators. */
  path: string
  /** sha1 hex of the current bytes. */
  sha1: string
  target: SubmissionTarget
}

interface SubmissionTarget {
  type: 'experiment' | 'wiki'
  /** `E<NNNN>-<slug>` or `W<NNNN>-<slug>`. */
  id: string
}

export async function runJournalSubmit(input: JournalSubmitInput): Promise<void> {
  const requested = normalizeRequestedFiles(input.files)
  const ctx = await resolveContext({ projectRoot: input.projectRoot, cwd: input.cwd })
  const root = singleProjectRoot(ctx)

  const invocation = currentJournalInvocation()
  if (invocation === null) {
    // Without an open invocation there is nothing to submit *into*, and
    // printing a receipt id we never wrote would be a lie.
    emitErrorAndExit(
      'BAD_STATE',
      'no invocation record is open for this command; run it from a project root or pass --project-root <path>',
    )
  }

  const files: SubmittedFile[] = []
  for (const relPath of requested) {
    const target = classifyManagedPath(relPath)
    const absolute = await resolveInsideProject(root, relPath)
    files.push({ path: relPath, sha1: await hashFile(absolute, relPath), target })
  }

  // Details are attached only after EVERY path validated, so a rejected batch
  // never leaves a partial file set on the receipt.
  const targets = dedupeTargets(files)
  for (const target of targets) {
    addJournalInvocationDetail({ kind: 'target', type: target.type, id: target.id })
  }
  for (const file of files) {
    addJournalInvocationDetail({
      kind: 'file-change',
      path: file.path,
      // The writer edited the file before memon ever saw it, so no preimage
      // was observed. Never fabricate one from a caller-supplied claim.
      before: null,
      after: file.sha1,
    })
  }

  const repeated = await isRepeatOfLastSubmission(root, files)
  if (repeated) markJournalInvocationOutcome('noop')

  const payload = {
    invocationId: invocation.id,
    outcome: repeated ? 'noop' : 'success',
    files: files.map((file) => ({ path: file.path, sha1: file.sha1 })),
    targets,
  }
  if (input.format === 'human') {
    emitHuman(
      [
        `invocation: ${payload.invocationId} (${payload.outcome})`,
        ...files.map((file) => `${file.sha1}  ${file.path}`),
      ].join('\n'),
    )
    return
  }
  emitJson(payload)
}

// ---------- path validation ----------

function normalizeRequestedFiles(files: string[]): string[] {
  if (files.length === 0) {
    emitErrorAndExit('BAD_REQUEST', '--files requires at least one project-root-relative path')
  }
  if (files.length > MAX_SUBMIT_FILES) {
    emitErrorAndExit(
      'BAD_REQUEST',
      `--files accepts at most ${MAX_SUBMIT_FILES} paths per submission, got ${files.length}; split the batch`,
    )
  }
  const seen: string[] = []
  for (const raw of files) {
    const value = raw.trim()
    if (value === '') {
      emitErrorAndExit('BAD_REQUEST', '--files contains an empty path')
    }
    if (isAbsolute(value) || value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) {
      emitErrorAndExit(
        'BAD_REQUEST',
        `--files takes project-root-relative paths; got an absolute path: ${value}`,
      )
    }
    const normalized = value.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '')
    if (
      normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
    ) {
      emitErrorAndExit('BAD_REQUEST', `--files path is not a plain relative path: ${value}`)
    }
    if (!seen.includes(normalized)) seen.push(normalized)
  }
  return seen
}

/**
 * Accepts exactly the two managed trees an Agent maintains directly:
 * `docs/experiments/E<NNNN>-<slug>/**` and `docs/wiki/<kind>/W<NNNN>-<slug>…`.
 * Run READMEs, `docs/reports/`, `docs/hypotheses.md` and the legacy
 * `docs/journal.md` are rejected — they are either written through native
 * mutations or preserved history, not direct-maintenance surfaces.
 */
function classifyManagedPath(relPath: string): SubmissionTarget {
  const segments = relPath.split('/')
  if (relPath.startsWith(`${EXPERIMENTS_DIR_RELPATH}/`)) {
    const bundle = segments[2] ?? ''
    if (segments.length >= 4 && EXPERIMENT_DIR_REGEX.test(bundle)) {
      return { type: 'experiment', id: bundle }
    }
    emitErrorAndExit(
      'BAD_REQUEST',
      `not a file inside an Experiment bundle (docs/experiments/E<NNNN>-<slug>/…): ${relPath}`,
    )
  }
  if (relPath.startsWith(`${WIKI_DIR_RELPATH}/`)) {
    const page = pageIdFromWikiPath(segments)
    if (page !== null) return { type: 'wiki', id: page }
    emitErrorAndExit(
      'BAD_REQUEST',
      `not a Wiki page file (docs/wiki/<kind>/W<NNNN>-<slug>{.md,/…}): ${relPath}`,
    )
  }
  emitErrorAndExit(
    'BAD_REQUEST',
    `outside the managed Experiment and Wiki trees: ${relPath} (accepted: ${EXPERIMENTS_DIR_RELPATH}/E<NNNN>-<slug>/…, ${WIKI_DIR_RELPATH}/<kind>/…)`,
  )
}

/** `docs/wiki/<kind>/W0007-x.md` and `docs/wiki/<kind>/W0007-x/asset.png`. */
function pageIdFromWikiPath(segments: string[]): string | null {
  const entry = segments[3]
  if (segments.length < 4 || entry === undefined) return null
  const name = entry.endsWith('.md') ? entry.slice(0, -'.md'.length) : entry
  return WIKI_PAGE_NAME_REGEX.test(name) ? name : null
}

/**
 * Root containment plus symlink-escape rejection, through the same resolver
 * the Backend routes use, so submission cannot reach outside the project or
 * digest a link target elsewhere on the machine.
 */
async function resolveInsideProject(root: string, relPath: string): Promise<string> {
  try {
    const resolved = await resolveProjectResource(root, relPath)
    const stat = await fs.stat(resolved.path)
    if (!stat.isFile()) {
      emitErrorAndExit('BAD_REQUEST', `not a regular file: ${relPath}`)
    }
    return resolved.path
  } catch (error) {
    if (error instanceof ProjectResourceError) {
      if (error.code === 'NOT_FOUND') {
        emitErrorAndExit('NOT_FOUND', `file does not exist in this project: ${relPath}`)
      }
      emitErrorAndExit('BAD_REQUEST', `${relPath}: ${error.message}`)
    }
    throw error
  }
}

async function hashFile(absolute: string, relPath: string): Promise<string> {
  try {
    const hash = createHash('sha1')
    for await (const chunk of createReadStream(absolute)) hash.update(chunk)
    return hash.digest('hex')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    emitErrorAndExit('BAD_STATE', `cannot read ${relPath}: ${reason}`)
  }
}

function dedupeTargets(files: SubmittedFile[]): SubmissionTarget[] {
  const targets: SubmissionTarget[] = []
  for (const file of files) {
    if (targets.some((t) => t.type === file.target.type && t.id === file.target.id)) continue
    targets.push(file.target)
  }
  return targets
}

/**
 * A re-submission of the same paths at the same digests changed nothing, so it
 * is recorded as a `noop` invocation rather than a second "success" that
 * implies new content. The invocation itself still gets its own id: retries
 * are distinct invocations, and the ledger records invocations.
 */
async function isRepeatOfLastSubmission(root: string, files: SubmittedFile[]): Promise<boolean> {
  const activity = await readJournalActivity(root)
  const completed = activity.records.filter(
    (record) =>
      record.command === SUBMIT_COMMAND &&
      (record.outcome === 'success' || record.outcome === 'noop') &&
      record.finishedAt !== null,
  )
  if (completed.length === 0) return false
  let latest = -Infinity
  for (const record of completed) {
    const time = Date.parse(record.finishedAt!)
    if (!Number.isFinite(time)) return false
    latest = Math.max(latest, time)
  }
  const now = files.map((file) => `${file.path}:${file.sha1}`).sort()
  // Equal timestamps do not establish a causal order across concurrent writers.
  // Only call the submission a no-op when every latest candidate agrees.
  return completed
    .filter((record) => Date.parse(record.finishedAt!) === latest)
    .every((record) => {
      const before = (record.details ?? [])
        .filter((detail) => detail.kind === 'file-change')
        .map((detail) => `${detail.path}:${detail.after ?? ''}`)
        .sort()
      return before.length === now.length && before.every((entry, index) => entry === now[index])
    })
}
