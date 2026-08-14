import { describe, expect, it } from 'vitest'
import { CONFIG_EXAMPLE_BASENAME, isProtectedExampleConfigPath } from './path-policy.js'

describe('isProtectedExampleConfigPath', () => {
  it.each([
    CONFIG_EXAMPLE_BASENAME,
    `./${CONFIG_EXAMPLE_BASENAME}`,
    `/srv/memon/${CONFIG_EXAMPLE_BASENAME}`,
    `/srv/memon/${CONFIG_EXAMPLE_BASENAME}/`,
  ])('protects an exact example-config basename: %s', (configPath) => {
    expect(isProtectedExampleConfigPath(configPath)).toBe(true)
  })

  it.each([
    'config.yml',
    'config.example.yaml',
    'config.example.yml.bak',
    'my-config.example.yml',
    'CONFIG.EXAMPLE.YML',
    '/srv/memon/config.example.yml.backup',
  ])('does not overmatch a different basename: %s', (configPath) => {
    expect(isProtectedExampleConfigPath(configPath)).toBe(false)
  })
})
