// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Config, DEFAULT_GIT_STATUS, DEFAULT_POLL, DEFAULT_TERMINAL } from '@memon/core'
import { describe, expect, it } from 'vitest'
import { STANDALONE_SERVICE_MIGRATION, standaloneServices } from './standalone-services'

function config(): Config {
  return {
    projects: [],
    poll: { ...DEFAULT_POLL },
    gitStatus: { ...DEFAULT_GIT_STATUS },
    slurm: { totalNodes: -1 },
    terminal: { ...DEFAULT_TERMINAL, ttydIdleTtlMinutes: 0 },
  } as Config
}

describe('standalone shared service composition', () => {
  it('memoizes one service/terminal lifecycle per Runtime Config', () => {
    const value = config()
    const first = standaloneServices(value)
    const second = standaloneServices(value)
    expect(first).toBe(second)
    expect(first.git).toBe(second.git)
    expect(first.terminal()).toBe(second.terminal())
    first.terminal().close()
  })

  it('routes terminal/tmux/Herdr and binary install through shared services', () => {
    expect(STANDALONE_SERVICE_MIGRATION).toMatchObject({
      terminalBinary: 'shared',
      tmux: 'shared',
      herdr: 'shared',
      git: 'shared',
    })
    const routes = [
      'app/api/terminal/check/route.ts',
      'app/api/terminal/install/route.ts',
      'app/api/terminal/start/route.ts',
      'app/api/terminal/attach/route.ts',
      'app/api/terminal/herdr/route.ts',
      'app/api/tmux-sessions/route.ts',
      'app/api/tmux-sessions/[name]/route.ts',
      'app/api/tmux-sessions/[name]/rename/route.ts',
    ]
    for (const route of routes) {
      const source = readFileSync(join(process.cwd(), route), 'utf8')
      expect(source, route).toContain('standalone-terminal')
      expect(source, route).not.toContain('lib/terminal/binary')
      expect(source, route).not.toContain('lib/terminal/manager')
      expect(source, route).not.toContain('tmux-discover')
    }
  })
})
