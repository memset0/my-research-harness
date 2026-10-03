// Test support for the FS v9 Results commands: a temporary project with
// Experiment bundles, Run READMEs and `result.csv` files, and a capture of a
// command's stdout, stderr and exit code. Excluded from the build.

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { MANAGED_SECTION_POINTERS } from '@memon/core'

export interface ResultsProject {
  root: string
  write(rel: string, content: string): Promise<void>
  read(rel: string): Promise<string>
  exists(rel: string): Promise<boolean>
  cleanup(): Promise<void>
}

export async function makeResultsProject(prefix = 'memon-results-'): Promise<ResultsProject> {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), prefix)))
  const absolute = (rel: string) => join(root, ...rel.split('/'))
  return {
    root,
    async write(rel, content) {
      await fs.mkdir(dirname(absolute(rel)), { recursive: true })
      await fs.writeFile(absolute(rel), content)
    },
    read: (rel) => fs.readFile(absolute(rel), 'utf8'),
    exists: (rel) =>
      fs.stat(absolute(rel)).then(
        () => true,
        () => false,
      ),
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  }
}

export function experimentReadme(
  id: string,
  runs: readonly string[],
  options: { resultsPointer?: string } = {},
): string {
  return `---
id: ${id}
slug: ${id.slice(6)}
title: ${id.slice(6)}
status: OPEN
archived: false
runs: [${runs.map((run) => JSON.stringify(run)).join(', ')}]
hypotheses: []
tags: []
created_at: '2026-09-01T09:00:00+08:00'
updated_at: '2026-09-01T09:00:00+08:00'
---

## Motivation

## Design

## Implementation

${MANAGED_SECTION_POINTERS.implementation}

## Investigation

${MANAGED_SECTION_POINTERS.investigation}

## Results

${options.resultsPointer ?? MANAGED_SECTION_POINTERS.results}

## Findings

## Limitations

## Conclusion

## Warnings
`
}

export function runReadme(run: string, status: string, extra = ''): string {
  return `---\nid: ${run.split('/').at(-1)}\nstatus: ${status}\ncreated_at: '2026-09-01T09:00:00+08:00'\nupdated_at: '2026-09-01T09:00:00+08:00'\n${extra}---\n`
}

/** `result.csv` content: header, version row, then `[path, stat, value]` rows. */
export function resultCsv(version: number, rows: ReadonlyArray<[string, string, string]>): string {
  return `${['path,stat,value', `$experiment_schema_version,,${version}`, ...rows.map((row) => row.join(','))].join('\n')}\n`
}

export interface ExperimentFixture {
  runs: Record<string, string>
  description: unknown
  /** Overrides the README `runs` (default: the keys of `runs`). */
  readmeRuns?: string[]
  resultsPointer?: string
}

/** Write an Experiment bundle with its member Run READMEs. */
export async function writeExperiment(
  project: ResultsProject,
  id: string,
  fixture: ExperimentFixture,
): Promise<void> {
  const folder = `docs/experiments/${id}`
  await project.write(
    `${folder}/README.md`,
    experimentReadme(id, fixture.readmeRuns ?? Object.keys(fixture.runs), {
      ...(fixture.resultsPointer ? { resultsPointer: fixture.resultsPointer } : {}),
    }),
  )
  await project.write(`${folder}/implementation.yaml`, 'schema_version: 1\nitems: []\n')
  await project.write(`${folder}/investigation.yaml`, 'schema_version: 1\nitems: []\n')
  await project.write(
    `${folder}/experiment.json`,
    typeof fixture.description === 'string'
      ? fixture.description
      : `${JSON.stringify(fixture.description, null, 2)}\n`,
  )
  for (const [run, status] of Object.entries(fixture.runs))
    await project.write(`${run}/README.md`, runReadme(run, status))
}

export interface CapturedCli {
  exitCode: number
  stdout: string
  stderr: string
  /** Parsed stdout (JSON), or undefined when it is not JSON. */
  json: ReturnType<typeof JSON.parse>
  /** Parsed stderr error envelope, when one was written. */
  error: { code: string; message: string; details?: ReturnType<typeof JSON.parse> } | undefined
}

class Exited extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`)
  }
}

/** Run one command function, capturing stdout, stderr and its exit code. */
export async function captureCli(action: () => Promise<unknown>): Promise<CapturedCli> {
  const realExit = process.exit
  const realStdout = process.stdout.write
  const realStderr = process.stderr.write
  const priorExitCode = process.exitCode
  process.exitCode = undefined
  let exitCode: number | null = null
  let stdout = ''
  let stderr = ''
  process.exit = ((code?: number) => {
    exitCode = code ?? 0
    throw new Exited(exitCode)
  }) as typeof process.exit
  process.stdout.write = ((chunk: unknown) => {
    stdout += String(chunk)
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: unknown) => {
    stderr += String(chunk)
    return true
  }) as typeof process.stderr.write
  try {
    await action()
  } catch (error) {
    if (!(error instanceof Exited)) throw error
  } finally {
    process.exit = realExit
    process.stdout.write = realStdout
    process.stderr.write = realStderr
  }
  const code = exitCode ?? (typeof process.exitCode === 'number' ? process.exitCode : 0)
  process.exitCode = priorExitCode
  let json: ReturnType<typeof JSON.parse>
  try {
    json = JSON.parse(stdout)
  } catch {}
  let error: CapturedCli['error']
  for (const line of stderr.split('\n')) {
    try {
      const parsed = JSON.parse(line) as { error?: CapturedCli['error'] }
      if (parsed.error) error = parsed.error
    } catch {}
  }
  return { exitCode: code, stdout, stderr, json, error }
}
