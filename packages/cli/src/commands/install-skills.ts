// memon install-skills — sync bundled SKILL.md trees into a project's
// `<projectRoot>/.claude/skills/`. Replaces every `memon-*` directory in
// the target so removed/renamed skills disappear cleanly. Skills not
// starting with `memon-` are left untouched.

import { existsSync as fsExistsSync, promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { emitJson, type OutputFormat } from '../lib/output.js'

export interface InstallSkillsInput {
  /** When set, target = `<projectRoot>/.claude/skills/`. Mutually exclusive with `target`. */
  projectRoot?: string
  /** Direct override; bypasses the projectRoot derivation entirely. */
  target?: string
  cwd: string
  dryRun?: boolean
  format: OutputFormat
}

/** Resolve the bundled skills source dir. */
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

function resolveTarget(input: InstallSkillsInput): string {
  if (input.target && input.projectRoot) {
    emitErrorAndExit('BAD_REQUEST', '--target and --project-root cannot both be set')
  }
  if (input.target) return resolve(input.target)
  const root = resolve(input.projectRoot ?? input.cwd)
  return join(root, '.claude', 'skills')
}

export async function runInstallSkills(input: InstallSkillsInput): Promise<void> {
  const target = resolveTarget(input)
  const src = await resolveSkillsDir()

  const sourceSkills = (await fs.readdir(src, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && d.name.startsWith('memon-'))
    .map((d) => d.name)
    .sort()

  // Anything memon-* in the target that's NOT in src should also be removed
  // (handles renamed / removed skills cleanly).
  let existingMemonInTarget: string[] = []
  if (await pathExists(target)) {
    existingMemonInTarget = (await fs.readdir(target, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && d.name.startsWith('memon-'))
      .map((d) => d.name)
      .sort()
  }

  const removed = existingMemonInTarget // every memon-* gets wiped before reinstall
  const installed = sourceSkills

  if (!input.dryRun) {
    await fs.mkdir(target, { recursive: true })
    // Remove all existing memon-* dirs (including any not in source — they
    // belong to a removed/renamed skill from a previous version)
    for (const name of removed) {
      await fs.rm(join(target, name), { recursive: true, force: true })
    }
    // Copy fresh from source
    for (const name of sourceSkills) {
      await copyDir(join(src, name), join(target, name))
    }
  }

  if (input.format === 'human') {
    const lines = [
      `source: ${src}`,
      `target: ${target}`,
      `replaced ${removed.length} memon-* dir(s); installed ${installed.length}`,
      input.dryRun ? '(dry run — no files written)' : '',
    ].filter(Boolean)
    process.stdout.write(`${lines.join('\n')}\n`)
  } else {
    emitJson({
      ok: true,
      source: src,
      target,
      removed,
      installed,
      dryRun: !!input.dryRun,
    })
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
