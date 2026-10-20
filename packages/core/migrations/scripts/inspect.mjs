#!/usr/bin/env node
// Migration-only inspection of historical declarations, before current index publication.
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  discoverWikiPages,
  listExperimentPaths,
  loadCliContext,
  loadResultsSummary,
  parseImplementationYaml,
  parseInvestigationYaml,
  parseResultsYaml,
  readExperimentDoc,
  renderImplementationMarkdown,
  renderInvestigationMarkdown,
  renderResultsMarkdown,
  resolveExperimentId,
  verifyIndex,
} from '../../dist/index.js'
import { argumentsFor, contained, runScript } from './runtime.mjs'

async function main() {
  const options = argumentsFor(
    {
      experiment: { type: 'string' },
      section: { type: 'string' },
      'verify-index': { type: 'boolean' },
      results: { type: 'boolean' },
    },
    'node inspect.mjs --project-root PROJECT [--experiment E0001] [--section implementation|investigation|results] [--verify-index] [--results]',
  )
  if (!options) return
  const root = await fs.realpath(options['project-root'])
  const context = await loadCliContext({ projectRoot: root, cwd: root })
  const ids = options.experiment
    ? [await resolveExperimentId(root, options.experiment)]
    : [...(await listExperimentPaths(root)).keys()]
  if (ids.some((id) => !id)) throw new Error('Experiment not found')
  const problems = []
  const experiments = []
  const parsers = {
    implementation: parseImplementationYaml,
    investigation: parseInvestigationYaml,
    results: parseResultsYaml,
  }
  const renderers = {
    implementation: renderImplementationMarkdown,
    investigation: renderInvestigationMarkdown,
    results: renderResultsMarkdown,
  }
  for (const id of ids) {
    const doc = await readExperimentDoc(root, 'migration', id)
    if (!doc) throw new Error(`Missing Experiment ${id}`)
    experiments.push({ id, runs: doc.frontMatter.runs, parseWarnings: doc.parseWarnings })
    if (options.experiment) {
      problems.push(...doc.parseErrors)
      const legacyResults = await fs
        .access(join(root, 'docs/experiments', id, 'results.yaml'))
        .then(
          () => true,
          () => false,
        )
      if (legacyResults) {
        for (const section of Object.keys(parsers)) {
          const file = await contained(root, `docs/experiments/${id}/${section}.yaml`)
          const parsed = parsers[section](await fs.readFile(file, 'utf8'))
          problems.push(...parsed.parseErrors)
          if (options.section === section && parsed.data) {
            const rendered = renderers[section](parsed.data)
            process.stdout.write(typeof rendered === 'string' ? rendered : rendered.markdown)
          }
        }
      }
    }
    if (options.results) {
      const loaded = await loadResultsSummary(root, id, { role: 'migration', write: false })
      if (loaded && loaded.summary.outcome !== 'ok') problems.push(loaded.summary.error)
    }
  }
  if (options.section && !Object.hasOwn(parsers, options.section))
    throw new Error('Unknown section')
  const index = options['verify-index'] ? await verifyIndex(root) : undefined
  if (index && (index.snapshotState !== 'ok' || index.drift.length)) problems.push(index)
  const output = {
    ok: problems.length === 0,
    experiments,
    problems,
    index,
    effective: context.config.projects[0]?.run_dirs,
    pages: (await discoverWikiPages(root)).map((page) => ({ id: page.id, path: page.path })),
  }
  if (!options.section) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  if (problems.length) {
    if (options.section) process.stderr.write(`${JSON.stringify(problems)}\n`)
    process.exitCode = 1
  }
}

runScript(import.meta.url, main)
