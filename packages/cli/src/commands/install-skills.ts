// memon install-skills — copy bundled SKILL.md trees into ~/.claude/skills/.

import { existsSync as fsExistsSync, promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { emitJson, type OutputFormat } from '../lib/output.js'

export interface InstallSkillsInput {
  target?: string
  dryRun?: boolean
  force?: boolean
  format: OutputFormat
}

/**
 * Locate the bundled skills directory. Resolution order:
 *   1. `@memon/skills` package's exported SKILLS_DIR (preferred)
 *   2. monorepo dev fallback: `<this-file>/../../../skills/` (i.e., packages/skills)
 */
async function resolveSkillsDir(): Promise<string> {
  // 1. Env var override (handy for local hacking)
  const envDir = process.env.MEMON_SKILLS_DIR
  if (envDir && fsExistsSync(envDir)) return envDir

  // 2. Resolved @memon/skills package
  try {
    const mod = (await import('@memon/skills')) as { SKILLS_DIR?: string }
    if (mod.SKILLS_DIR && fsExistsSync(mod.SKILLS_DIR)) return mod.SKILLS_DIR
  } catch {
    /* fall through to dev fallback */
  }

  // 3. Dev fallback: walk up from this compiled file to find packages/skills
  const here = fileURLToPath(import.meta.url)
  const guesses = [
    resolve(here, '..', '..', '..', '..', 'skills'), // packages/cli/dist/commands → packages/skills
    resolve(here, '..', '..', '..', '..', '..', 'skills'),
  ]
  for (const g of guesses) {
    if (fsExistsSync(g)) return g
  }

  emitErrorAndExit(
    'NOT_FOUND',
    'cannot locate @memon/skills bundled directory; reinstall memon or set MEMON_SKILLS_DIR',
  )
}

export async function runInstallSkills(input: InstallSkillsInput): Promise<void> {
  const target = resolve(input.target ?? join(homedir(), '.claude', 'skills'))
  const src = await resolveSkillsDir()
  await fs.mkdir(target, { recursive: true })

  const skillNames = (await fs.readdir(src, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && d.name.startsWith('memon-'))
    .map((d) => d.name)

  const installed: string[] = []
  const skipped: string[] = []
  const conflicts: string[] = []

  for (const name of skillNames) {
    const srcDir = join(src, name)
    const dstDir = join(target, name)
    if (await pathExists(dstDir)) {
      if (!input.force) {
        conflicts.push(name)
        continue
      }
      if (!input.dryRun) await fs.rm(dstDir, { recursive: true, force: true })
    }
    if (input.dryRun) {
      skipped.push(name)
      continue
    }
    await copyDir(srcDir, dstDir)
    installed.push(name)
  }

  if (input.format === 'human') {
    const lines = [
      `source: ${src}`,
      `target: ${target}`,
      installed.length > 0 ? `installed: ${installed.join(', ')}` : 'installed: (none)',
      conflicts.length > 0
        ? `conflicts (use --force to overwrite): ${conflicts.join(', ')}`
        : '',
      input.dryRun ? `(dry run — no files written)` : '',
    ].filter(Boolean)
    process.stdout.write(`${lines.join('\n')}\n`)
  } else {
    emitJson({
      ok: true,
      source: src,
      target,
      installed,
      skipped,
      conflicts,
      dryRun: !!input.dryRun,
    })
  }

  if (conflicts.length > 0 && !input.force) {
    process.exit(1)
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p)
    return true
  } catch {
    return false
  }
}

async function copyDir(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true })
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const s = join(src, entry.name)
    const d = join(dst, entry.name)
    if (entry.isDirectory()) {
      await copyDir(s, d)
    } else {
      await fs.copyFile(s, d)
    }
  }
}
