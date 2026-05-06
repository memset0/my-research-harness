// @vitest-environment node
//
// v3-spec-sync task 2.1.2 — integration tests against `mock/project-{a,b}`
// covering the v3 read flow end-to-end.
//
// We invoke the API route handlers directly (no live server) to keep the
// test self-contained. The runtime is shared across the suite — it caches
// after the first `getRuntime()` call, so loading the mock fixtures
// happens once.
//
// The mock fixtures MUST NOT be mutated by these tests. The
// "Fixture immutability check" describe-block snapshots mtimes before
// and after; if any test path writes a fixture file, the suite fails.

import { promises as fs } from 'node:fs'
import { join, relative } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'

import { GET as getExperiments } from '../../app/api/experiments/route'
import { GET as getExperimentDetail } from '../../app/api/experiments/[id]/route'
import { GET as getExperimentWarnings } from '../../app/api/experiments/[id]/warnings/route'
import { GET as getRuns } from '../../app/api/runs/route'
import { GET as getRunDetail } from '../../app/api/runs/[id]/route'
import { GET as getAnomalies } from '../../app/api/anomalies/route'

// Point the runtime at the repo's config.yml (which already lists
// `./mock/project-{a,b}`). Must run BEFORE the runtime module imports.
const REPO_ROOT = join(__dirname, '..', '..', '..', '..')
process.env.MEMON_CONFIG_PATH = join(REPO_ROOT, 'config.yml')

const PROJECTS = ['project-a', 'project-b']

interface MtimeSnapshot {
  [path: string]: number
}

async function snapshotMtimes(dir: string): Promise<MtimeSnapshot> {
  const out: MtimeSnapshot = {}
  async function walk(path: string): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(path, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = join(path, e.name)
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git') continue
        await walk(full)
      } else if (e.isFile()) {
        const st = await fs.stat(full)
        out[relative(REPO_ROOT, full)] = st.mtimeMs
      }
    }
  }
  await walk(dir)
  return out
}

describe('integration: v3 read flow against mock fixtures', () => {
  let preMtimes: MtimeSnapshot

  beforeAll(async () => {
    preMtimes = {}
    for (const p of PROJECTS) {
      Object.assign(preMtimes, await snapshotMtimes(join(REPO_ROOT, 'mock', p)))
    }
  })

  afterAll(async () => {
    const postMtimes: MtimeSnapshot = {}
    for (const p of PROJECTS) {
      Object.assign(postMtimes, await snapshotMtimes(join(REPO_ROOT, 'mock', p)))
    }
    const drift = Object.entries(postMtimes).filter(
      ([k, v]) => preMtimes[k] !== v,
    )
    expect(drift, `mock fixture mtimes drifted: ${drift.map(([k]) => k).join(', ')}`).toEqual(
      [],
    )
  })

  describe('GET /api/experiments?project=project-a', () => {
    it('returns ≥1 exp doc with effectiveCreatedAt + effectiveUpdatedAt populated', async () => {
      const res = await getExperiments(
        new NextRequest('http://localhost/api/experiments?project=project-a'),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        experiments: Array<{
          id: string
          effectiveCreatedAt: string
          effectiveUpdatedAt: string
          frontMatter: { runs: string[] }
        }>
      }
      expect(body.experiments.length).toBeGreaterThanOrEqual(1)
      for (const e of body.experiments) {
        expect(e.id).toMatch(/^E\d{4}-/)
        expect(e.effectiveCreatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
        expect(e.effectiveUpdatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
        // effective range is closed: created ≤ updated
        expect(e.effectiveCreatedAt <= e.effectiveUpdatedAt).toBe(true)
      }
    })
  })

  describe('GET /api/experiments/[id]', () => {
    it('returns full detail with member runs + effective times for E0001-vpred-convergence', async () => {
      const id = 'E0001-vpred-convergence'
      const res = await getExperimentDetail(
        new NextRequest(`http://localhost/api/experiments/${id}`),
        { params: Promise.resolve({ id }) },
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        id: string
        frontMatter: { runs: string[]; title: string }
        memberRuns: Array<{ id: string; status: string }>
        effectiveCreatedAt: string
        effectiveUpdatedAt: string
      }
      expect(body.id).toBe(id)
      expect(body.frontMatter.runs.length).toBeGreaterThan(0)
      // memberRuns is the cross-join — every confirmed member run shows up
      expect(body.memberRuns.length).toBeGreaterThan(0)
      expect(body.memberRuns[0]!.status).toBeDefined()
      expect(body.effectiveCreatedAt).toBeTruthy()
      expect(body.effectiveUpdatedAt).toBeTruthy()
    })

    it('returns 404 for an unknown id', async () => {
      const res = await getExperimentDetail(
        new NextRequest('http://localhost/api/experiments/E9999-nope'),
        { params: Promise.resolve({ id: 'E9999-nope' }) },
      )
      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/experiments/[id]/warnings', () => {
    it('returns 200 with a (possibly empty) warnings array', async () => {
      const id = 'E0001-vpred-convergence'
      const res = await getExperimentWarnings(
        new NextRequest(`http://localhost/api/experiments/${id}/warnings`),
        { params: Promise.resolve({ id }) },
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        ok: boolean
        warnings: Array<{ rowId: string; status: string; run: string | null }>
      }
      expect(body.ok).toBe(true)
      expect(Array.isArray(body.warnings)).toBe(true)
      for (const w of body.warnings) {
        expect(w.status === 'OPEN' || w.status === 'RESOLVED').toBe(true)
        // v3: every row has a `run` field (string | null)
        expect(w.run === null || typeof w.run === 'string').toBe(true)
      }
    })
  })

  describe('GET /api/runs?project=project-a', () => {
    it('returns ≥1 run with hasReadme + frontMatter populated', async () => {
      const res = await getRuns(new NextRequest('http://localhost/api/runs?project=project-a'))
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        experiments: Array<{
          id: string
          hasReadme: boolean
          frontMatter: { status: string }
          stale: boolean
        }>
      }
      expect(body.experiments.length).toBeGreaterThanOrEqual(1)
      const withReadme = body.experiments.filter((r) => r.hasReadme)
      expect(withReadme.length).toBeGreaterThan(0)
      expect(typeof withReadme[0]!.stale).toBe('boolean')
    })
  })

  describe('GET /api/runs/[id]', () => {
    it('returns the run detail for a known id from the exp doc list', async () => {
      // Discover a known run id via the exp doc list, then look it up.
      const expRes = await getExperimentDetail(
        new NextRequest(`http://localhost/api/experiments/E0001-vpred-convergence`),
        { params: Promise.resolve({ id: 'E0001-vpred-convergence' }) },
      )
      const expBody = (await expRes.json()) as { memberRuns: Array<{ id: string }> }
      const runId = expBody.memberRuns[0]?.id
      expect(runId).toBeTruthy()

      const res = await getRunDetail(
        new NextRequest(`http://localhost/api/runs/${runId}`),
        { params: Promise.resolve({ id: runId! }) },
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        id: string
        frontMatter: { experiment: string | null }
      }
      expect(body.id).toBe(runId)
      // When the run is a confirmed member, its experiment field points
      // back at the parent exp.
      expect(body.frontMatter.experiment).toBe('E0001-vpred-convergence')
    })
  })

  describe('GET /api/anomalies?project=project-a', () => {
    it('returns the anomaly list as a structured array', async () => {
      const res = await getAnomalies(
        new NextRequest('http://localhost/api/anomalies?project=project-a'),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        anomalies: Array<{ code: string; project: string; runId: string | null }>
      }
      expect(Array.isArray(body.anomalies)).toBe(true)
      // Whether the count is 0 or N depends on the fixture state; both are
      // valid. The shape is what we test.
      for (const a of body.anomalies) {
        expect(typeof a.code).toBe('string')
        expect(a.project).toBe('project-a')
      }
    })
  })
})
