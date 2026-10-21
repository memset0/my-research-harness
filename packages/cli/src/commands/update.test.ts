import { describe, expect, it } from 'vitest'
import { childEnv } from './update.js'

// Only the pure child-environment rules are unit-tested here: the git and
// package-manager steps of `memon update` would need a real clone and build.

describe('memon update child environment', () => {
  it('keeps operator package-manager configuration when run directly', () => {
    const env = childEnv({
      PATH: '/bin',
      npm_config_store_dir: '/work/cache/pnpm-store',
      npm_config_cache_dir: '/work/cache/pnpm',
      npm_package_name: 'stray',
      NODE_OPTIONS: '--inspect',
    })

    expect(env).toEqual({
      PATH: '/bin',
      npm_config_store_dir: '/work/cache/pnpm-store',
      npm_config_cache_dir: '/work/cache/pnpm',
    })
  })

  it('drops every inherited npm variable when launched from a package script', () => {
    const env = childEnv({
      PATH: '/bin',
      npm_lifecycle_event: 'memon',
      npm_config_store_dir: '/parent/store',
      npm_config_user_agent: 'pnpm/10',
      npm_execpath: '/parent/pnpm.cjs',
    })

    expect(env).toEqual({ PATH: '/bin' })
  })
})
