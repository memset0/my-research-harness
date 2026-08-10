#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  access,
  appendFile,
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import fg from 'fast-glob'
import yaml from 'js-yaml'

const MIGRATION = 'v5-to-v6'
const EXP_RE = /^E\d{4}-[a-z0-9][a-z0-9-]*$/
const MIGRATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const CANDIDATE_FILES = ['README.md', 'implementation.yaml', 'investigation.yaml', 'results.yaml']
const MANAGED_SECTIONS = ['implementation', 'investigation', 'results']
const runFile = promisify(execFile)

function fail(message) {
  throw new Error(message)
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  const flags = new Map()
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]
    if (!token.startsWith('--')) fail(`unexpected argument: ${token}`)
    const value = rest[i + 1]
    if (!value || value.startsWith('--')) fail(`missing value for ${token}`)
    flags.set(token.slice(2), value)
    i += 1
  }
  return { command, flags }
}

function required(flags, name) {
  const value = flags.get(name)
  if (!value) fail(`missing --${name}`)
  return value
}

function nowId() {
  return new Date().toISOString().replaceAll(':', '').replaceAll('-', '').replace('.000Z', 'Z')
}

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function gitContext(projectRoot) {
  try {
    const { stdout } = await runFile('git', ['-C', projectRoot, 'rev-parse', '--show-toplevel'])
    return { root: path.resolve(stdout.trim()) }
  } catch {
    return null
  }
}

async function ensureLocalMigrationIgnore(projectRoot, git) {
  const relativeRoot = path.relative(git.root, projectRoot).split(path.sep).join('/')
  const prefix = relativeRoot ? `/${relativeRoot}` : ''
  const pattern = `${prefix}/.memon/migrations/`
  const probe = `${prefix}/.memon/migrations/.memon-ignore-probe`.slice(1)
  try {
    await runFile('git', ['-C', git.root, 'check-ignore', '--no-index', '-q', '--', probe])
    return
  } catch {
    // Add this runtime-only directory to Git's local exclude file, never to a tracked .gitignore.
  }

  const { stdout } = await runFile('git', [
    '-C',
    git.root,
    'rev-parse',
    '--git-path',
    'info/exclude',
  ])
  const rawExclude = stdout.trim()
  const exclude = path.isAbsolute(rawExclude) ? rawExclude : path.join(git.root, rawExclude)
  const previous = (await exists(exclude)) ? await readFile(exclude, 'utf8') : ''
  const separator = previous.length === 0 || previous.endsWith('\n') ? '' : '\n'
  await appendFile(exclude, `${separator}${pattern}\n`)
}

async function assertCleanGit(projectRoot, git) {
  if (!git) return
  const { stdout } = await runFile('git', [
    '-C',
    projectRoot,
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--',
    '.',
  ])
  if (stdout.trim()) {
    fail(
      `Git worktree is dirty; commit, stash manually, or discard changes before migration:\n${stdout.trim()}`,
    )
  }
}

async function shaFiles(projectRoot, filePaths) {
  const hash = createHash('sha256')
  const ordered = [...filePaths].sort((a, b) => a.localeCompare(b))
  for (const filePath of ordered) {
    hash.update(`${path.relative(projectRoot, filePath)}\0`)
    hash.update(await readFile(filePath))
    hash.update('\0')
  }
  return hash.digest('hex')
}

async function shaCandidate(dir) {
  const hash = createHash('sha256')
  for (const name of CANDIDATE_FILES) {
    hash.update(`${name}\0`)
    hash.update(await readFile(path.join(dir, name)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function statePath(staging) {
  return path.join(staging, 'state.yaml')
}

async function readState(staging) {
  const parsed = yaml.load(await readFile(statePath(staging), 'utf8'))
  if (!parsed || typeof parsed !== 'object' || parsed.migration !== MIGRATION) {
    fail(`invalid migration state: ${statePath(staging)}`)
  }
  return parsed
}

async function writeState(staging, state) {
  const target = statePath(staging)
  const temp = `${target}.tmp-${process.pid}`
  await writeFile(temp, yaml.dump(state, { lineWidth: 120, noRefs: true }), { mode: 0o600 })
  await rename(temp, target)
}

async function readFsVersion(projectRoot) {
  const marker = path.join(projectRoot, '.memon', 'version.json')
  const parsed = JSON.parse(await readFile(marker, 'utf8'))
  return { marker, parsed }
}

async function assertV5(projectRoot) {
  const { parsed } = await readFsVersion(projectRoot)
  if (parsed.fs_convention_version !== 5) {
    fail(`expected FS convention 5, found ${parsed.fs_convention_version}`)
  }
}

async function experimentIds(projectRoot) {
  const dir = path.join(projectRoot, 'docs', 'experiments')
  const entries = await readdir(dir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory() && EXP_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort()
}

function referencedRunIds(readme) {
  const lines = readme.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return []
  const end = lines.slice(1).findIndex((line) => line.trim() === '---')
  if (end < 0) return []
  let frontmatter
  try {
    frontmatter = yaml.load(lines.slice(1, end + 1).join('\n'))
  } catch (error) {
    fail(`cannot inspect Experiment frontmatter for source hashing: ${error.message}`)
  }
  if (!frontmatter || typeof frontmatter !== 'object' || !Array.isArray(frontmatter.runs)) return []
  const invalid = frontmatter.runs.find((run) => typeof run !== 'string' || run.length === 0)
  if (invalid !== undefined) fail('Experiment frontmatter runs must contain non-empty strings')
  return [...new Set(frontmatter.runs)]
}

async function sourceBundlePaths(projectRoot, experimentReadme) {
  const runIds = referencedRunIds(await readFile(experimentReadme, 'utf8'))
  if (runIds.length === 0) return [experimentReadme]
  const wanted = new Set(runIds)
  const candidates = await fg('**/README.md', {
    cwd: projectRoot,
    absolute: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    suppressErrors: true,
    ignore: [
      '**/.git/**',
      '**/.memon/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
    ],
  })
  const byRun = new Map(runIds.map((id) => [id, []]))
  for (const candidate of candidates) {
    const directoryName = path.basename(path.dirname(candidate))
    if (wanted.has(directoryName)) byRun.get(directoryName).push(candidate)
  }
  const resolved = [experimentReadme]
  for (const runId of runIds) {
    const matches = byRun.get(runId)
    if (matches.length === 0) fail(`missing referenced Run README for source hashing: ${runId}`)
    if (matches.length > 1) {
      fail(`ambiguous referenced Run README for ${runId}: ${matches.join(', ')}`)
    }
    resolved.push(matches[0])
  }
  return resolved
}

async function init(projectRoot, migrationId) {
  if (!MIGRATION_ID_RE.test(migrationId)) fail(`invalid migration id: ${migrationId}`)
  await assertV5(projectRoot)
  const git = await gitContext(projectRoot)
  if (git) await ensureLocalMigrationIgnore(projectRoot, git)
  await assertCleanGit(projectRoot, git)
  const staging = path.join(projectRoot, '.memon', 'migrations', MIGRATION, migrationId)
  if (await exists(staging)) fail(`staging directory already exists: ${staging}`)

  const ids = await experimentIds(projectRoot)
  const state = {
    schema_version: 1,
    migration: MIGRATION,
    project_root: projectRoot,
    migration_id: migrationId,
    created_at: new Date().toISOString(),
    published_at: null,
    experiments: {},
  }
  const prepared = []
  for (const id of ids) {
    const source = path.join(projectRoot, 'docs', 'experiments', id, 'README.md')
    if (!(await exists(source))) fail(`missing source README: ${source}`)
    for (const name of CANDIDATE_FILES.slice(1)) {
      const sidecar = path.join(projectRoot, 'docs', 'experiments', id, name)
      if (await exists(sidecar)) fail(`unexpected v6 sidecar while FS marker is v5: ${sidecar}`)
    }
    const sourcePaths = await sourceBundlePaths(projectRoot, source)
    prepared.push({ id, source })
    state.experiments[id] = {
      status: 'DRAFT',
      source_path: path.relative(projectRoot, source),
      source_paths: sourcePaths.map((sourcePath) => path.relative(projectRoot, sourcePath)),
      source_hash: await shaFiles(projectRoot, sourcePaths),
      staged_hash: null,
      approved_at: null,
      stale_reason: null,
    }
  }

  try {
    await mkdir(path.join(staging, 'experiments'), { recursive: true, mode: 0o700 })
    for (const { id, source } of prepared) {
      const candidate = path.join(staging, 'experiments', id)
      await mkdir(candidate, { recursive: true, mode: 0o700 })
      await cp(source, path.join(candidate, 'README.md'))
      await writeFile(
        path.join(candidate, 'implementation.yaml'),
        'schema_version: 1\nitems: []\n',
        { mode: 0o600 },
      )
      await writeFile(
        path.join(candidate, 'investigation.yaml'),
        'schema_version: 1\nitems: []\n',
        { mode: 0o600 },
      )
      await writeFile(
        path.join(candidate, 'results.yaml'),
        'schema_version: 1\ncolumns: []\nvariants: []\n',
        { mode: 0o600 },
      )
    }
    await writeState(staging, state)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
  process.stdout.write(`${staging}\n`)
}

async function approve(staging, id) {
  const state = await readState(staging)
  const record = state.experiments[id]
  if (!record) fail(`unknown experiment: ${id}`)
  const candidate = path.join(staging, 'experiments', id)
  const source = path.join(state.project_root, record.source_path)
  if (!(await exists(source))) fail(`missing source README: ${source}`)
  for (const name of CANDIDATE_FILES) {
    if (!(await exists(path.join(candidate, name)))) fail(`missing staged file: ${id}/${name}`)
  }
  const sourcePaths = await sourceBundlePaths(state.project_root, source)
  const relativeSourcePaths = sourcePaths.map((sourcePath) =>
    path.relative(state.project_root, sourcePath),
  )
  const expectedSourcePaths = [...(record.source_paths ?? [record.source_path])].sort()
  const currentSourcePaths = [...relativeSourcePaths].sort()
  const currentSourceHash = await shaFiles(state.project_root, sourcePaths)
  if (
    currentSourceHash !== record.source_hash ||
    JSON.stringify(currentSourcePaths) !== JSON.stringify(expectedSourcePaths)
  ) {
    record.status = 'STALE'
    record.approved_at = null
    record.stale_reason = 'SOURCE_CHANGED'
    await writeState(staging, state)
    fail(
      `${id}: source Experiment/Run bundle changed after staging; start a new staging migration before approval`,
    )
  }
  record.status = 'APPROVED'
  record.source_paths = relativeSourcePaths
  record.staged_hash = await shaCandidate(candidate)
  record.approved_at = new Date().toISOString()
  record.stale_reason = null
  await writeState(staging, state)
  process.stdout.write(`${id} APPROVED ${record.staged_hash}\n`)
}

async function invalidateChangedApprovals(staging, state) {
  let changed = false
  for (const [id, record] of Object.entries(state.experiments)) {
    if (record.status !== 'APPROVED') continue
    const sourcePaths = (record.source_paths ?? [record.source_path]).map((sourcePath) =>
      path.join(state.project_root, sourcePath),
    )
    const candidate = path.join(staging, 'experiments', id)
    let sourceChanged = false
    for (const sourcePath of sourcePaths) {
      if (!(await exists(sourcePath))) sourceChanged = true
    }
    if (!sourceChanged) {
      sourceChanged = (await shaFiles(state.project_root, sourcePaths)) !== record.source_hash
    }
    let stagedChanged = false
    for (const name of CANDIDATE_FILES) {
      if (!(await exists(path.join(candidate, name)))) stagedChanged = true
    }
    if (!stagedChanged && record.staged_hash) {
      stagedChanged = (await shaCandidate(candidate)) !== record.staged_hash
    }
    if (sourceChanged || stagedChanged) {
      record.status = 'STALE'
      record.approved_at = null
      record.stale_reason = [
        sourceChanged ? 'SOURCE_CHANGED' : null,
        stagedChanged ? 'STAGED_CHANGED' : null,
      ]
        .filter(Boolean)
        .join(',')
      changed = true
    }
  }
  if (changed) await writeState(staging, state)
}

async function verify(staging) {
  const state = await readState(staging)
  await invalidateChangedApprovals(staging, state)
  const projectRoot = state.project_root
  await assertV5(projectRoot)
  const problems = []
  const expectedIds = Object.keys(state.experiments).sort()
  const currentIds = await experimentIds(projectRoot)
  if (JSON.stringify(currentIds) !== JSON.stringify(expectedIds)) {
    const added = currentIds.filter((id) => !expectedIds.includes(id))
    const removed = expectedIds.filter((id) => !currentIds.includes(id))
    problems.push(
      `Experiment set changed after staging${added.length > 0 ? `; added: ${added.join(', ')}` : ''}${removed.length > 0 ? `; removed: ${removed.join(', ')}` : ''}`,
    )
  }
  for (const [id, record] of Object.entries(state.experiments)) {
    const sourcePaths = (record.source_paths ?? [record.source_path]).map((sourcePath) =>
      path.join(projectRoot, sourcePath),
    )
    const candidate = path.join(staging, 'experiments', id)
    let candidateComplete = true
    if (record.status !== 'APPROVED') problems.push(`${id}: status is ${record.status}`)
    if (record.status === 'APPROVED' && !record.staged_hash) {
      problems.push(`${id}: approved record has no staged hash`)
    }
    const missingSources = []
    for (const sourcePath of sourcePaths) {
      if (!(await exists(sourcePath))) missingSources.push(path.relative(projectRoot, sourcePath))
    }
    if (missingSources.length > 0) {
      problems.push(`${id}: source files are missing: ${missingSources.join(', ')}`)
    } else if ((await shaFiles(projectRoot, sourcePaths)) !== record.source_hash) {
      problems.push(`${id}: source Experiment/Run bundle changed after staging`)
    }
    for (const name of CANDIDATE_FILES) {
      if (!(await exists(path.join(candidate, name)))) {
        candidateComplete = false
        problems.push(`${id}: missing ${name}`)
      }
    }
    if (
      record.staged_hash &&
      candidateComplete &&
      (await shaCandidate(candidate)) !== record.staged_hash
    ) {
      problems.push(`${id}: staged files changed after approval`)
    }
    for (const name of CANDIDATE_FILES.slice(1)) {
      if (await exists(path.join(projectRoot, 'docs', 'experiments', id, name))) {
        problems.push(`${id}: live v6 sidecar already exists: ${name}`)
      }
    }
  }
  if (problems.length > 0) fail(`staging verification failed:\n- ${problems.join('\n- ')}`)
  process.stdout.write(`OK ${Object.keys(state.experiments).length} experiments approved\n`)
  return state
}

async function atomicCopy(source, destination) {
  const temp = `${destination}.v6-tmp-${process.pid}`
  await rm(temp, { force: true })
  await cp(source, temp)
  await rename(temp, destination)
}

async function restoreBackup(backup, projectRoot, ids) {
  for (const id of ids) {
    const liveDir = path.join(projectRoot, 'docs', 'experiments', id)
    const savedDir = path.join(backup, id)
    await rm(path.join(liveDir, 'implementation.yaml'), { force: true })
    await rm(path.join(liveDir, 'investigation.yaml'), { force: true })
    await rm(path.join(liveDir, 'results.yaml'), { force: true })
    await cp(path.join(savedDir, 'README.md'), path.join(liveDir, 'README.md'))
  }
}

async function runDocumentChecks(projectRoot, ids, memonBin, phase) {
  for (const id of ids) {
    for (const operation of ['validate', 'lint']) {
      let stdout = ''
      try {
        const result = await runFile(
          memonBin,
          ['--project-root', projectRoot, '--format', 'json', 'experiment', 'doc', operation, id],
          { maxBuffer: 10 * 1024 * 1024 },
        )
        stdout = result.stdout
      } catch (error) {
        const detail = error && typeof error === 'object' && 'stdout' in error ? error.stdout : ''
        fail(`${phase} ${operation} failed for ${id}${detail ? `:\n${detail}` : ''}`)
      }
      let parsed
      try {
        parsed = JSON.parse(stdout)
      } catch {
        fail(`${phase} ${operation} returned invalid JSON for ${id}`)
      }
      if (parsed.ok !== true) fail(`${phase} ${operation} reported errors for ${id}`)
    }
    for (const section of MANAGED_SECTIONS) {
      const { stdout } = await runFile(
        memonBin,
        [
          '--project-root',
          projectRoot,
          '--format',
          'human',
          'experiment',
          'doc',
          'render',
          id,
          section,
        ],
        { maxBuffer: 10 * 1024 * 1024 },
      )
      if (!stdout.trim()) fail(`${phase} render returned empty output for ${id}/${section}`)
    }
  }
}

async function validateStagedBundles(staging, ids, memonBin, markerText) {
  const validationRoot = path.join(staging, 'staged-validation')
  await rm(validationRoot, { recursive: true, force: true })
  try {
    await mkdir(path.join(validationRoot, '.memon'), { recursive: true, mode: 0o700 })
    await mkdir(path.join(validationRoot, 'docs', 'experiments'), {
      recursive: true,
      mode: 0o700,
    })
    await writeFile(path.join(validationRoot, '.memon', 'version.json'), markerText, {
      mode: 0o600,
    })
    for (const id of ids) {
      await cp(
        path.join(staging, 'experiments', id),
        path.join(validationRoot, 'docs', 'experiments', id),
        { recursive: true },
      )
    }
    await runDocumentChecks(validationRoot, ids, memonBin, 'staged')
  } finally {
    await rm(validationRoot, { recursive: true, force: true })
  }
}

async function publish(staging, confirmation, memonBin) {
  const state = await verify(staging)
  if (confirmation !== state.migration_id) {
    fail(`final confirmation token must equal migration id: ${state.migration_id}`)
  }
  const projectRoot = state.project_root
  await assertCleanGit(projectRoot, await gitContext(projectRoot))
  const ids = Object.keys(state.experiments)
  const { marker, parsed: originalMarker } = await readFsVersion(projectRoot)
  const originalMarkerText = `${JSON.stringify(originalMarker, null, 2)}\n`
  const approvedState = structuredClone(state)
  await validateStagedBundles(staging, ids, memonBin, originalMarkerText)
  // Candidate validation can take time. Recheck the immutable approval/source
  // snapshot immediately before the first live mutation.
  await verify(staging)
  const backup = path.join(staging, 'live-backup')
  if (await exists(backup)) fail(`backup already exists; refusing repeated publish: ${backup}`)
  await mkdir(backup, { recursive: true, mode: 0o700 })

  for (const id of ids) {
    const savedDir = path.join(backup, id)
    await mkdir(savedDir, { recursive: true, mode: 0o700 })
    await cp(
      path.join(projectRoot, 'docs', 'experiments', id, 'README.md'),
      path.join(savedDir, 'README.md'),
    )
  }

  try {
    for (const id of ids) {
      const sourceDir = path.join(staging, 'experiments', id)
      const liveDir = path.join(projectRoot, 'docs', 'experiments', id)
      for (const name of CANDIDATE_FILES) {
        await atomicCopy(path.join(sourceDir, name), path.join(liveDir, name))
      }
    }

    await runDocumentChecks(projectRoot, ids, memonBin, 'production')
    for (const id of ids) {
      const liveDirectory = path.join(projectRoot, 'docs', 'experiments', id)
      if ((await shaCandidate(liveDirectory)) !== state.experiments[id].staged_hash) {
        fail(`published bundle hash differs from approved candidate: ${id}`)
      }
    }

    state.published_at = new Date().toISOString()
    for (const record of Object.values(state.experiments)) record.status = 'PUBLISHED'
    await writeState(staging, state)

    const finalExperimentIds = await experimentIds(projectRoot)
    if (JSON.stringify(finalExperimentIds) !== JSON.stringify([...ids].sort())) {
      fail('Experiment set changed during publication')
    }

    // The FS marker is the final persisted migration mutation. If the process
    // reaches v6, every approved bundle, production check, hash check, backup,
    // and migration-state update has already completed.
    const next = {
      ...originalMarker,
      fs_convention_version: 6,
      last_migrated_at: new Date().toISOString(),
    }
    const markerTemp = `${marker}.v6-tmp-${process.pid}`
    await writeFile(markerTemp, `${JSON.stringify(next, null, 2)}\n`)
    await rename(markerTemp, marker)
  } catch (error) {
    const rollbackErrors = []
    let liveRestored = false
    try {
      await restoreBackup(backup, projectRoot, ids)
      liveRestored = true
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError)
    }
    try {
      await rm(`${marker}.v6-tmp-${process.pid}`, { force: true })
      const markerTemp = `${marker}.rollback-tmp-${process.pid}`
      await writeFile(markerTemp, originalMarkerText)
      await rename(markerTemp, marker)
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError)
    }
    try {
      await writeState(staging, approvedState)
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError)
    }
    if (liveRestored) {
      try {
        await rename(backup, path.join(staging, `failed-live-backup-${nowId()}`))
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        'publish failed and rollback was incomplete',
      )
    }
    throw error
  }
  process.stdout.write(`PUBLISHED ${ids.length} experiments; backup: ${backup}\n`)
}

async function statusCommand(staging) {
  const state = await readState(staging)
  await invalidateChangedApprovals(staging, state)
  for (const [id, record] of Object.entries(state.experiments)) {
    process.stdout.write(`${id}\t${record.status}\t${record.staged_hash ?? '-'}\n`)
  }
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2))
  if (command === 'init') {
    const projectRoot = path.resolve(required(flags, 'project-root'))
    await init(projectRoot, flags.get('migration-id') ?? nowId())
    return
  }
  const staging = path.resolve(required(flags, 'staging'))
  if (command === 'status') return statusCommand(staging)
  if (command === 'approve') return approve(staging, required(flags, 'experiment'))
  if (command === 'verify') return verify(staging)
  if (command === 'publish') {
    return publish(staging, required(flags, 'confirm'), flags.get('memon-bin') ?? 'memon')
  }
  fail('usage: v5-to-v6-stage.mjs {init|status|approve|verify|publish} ...')
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
