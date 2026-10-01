// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { projectFromWorkspacePathname } from './use-report-workspace'

describe('projectFromWorkspacePathname', () => {
  it('extracts and decodes a project route segment', () => {
    expect(projectFromWorkspacePathname('/p/vsqa/e/E0017')).toBe('vsqa')
    expect(projectFromWorkspacePathname('/p/vision%20qa/reports')).toBe('vision qa')
  })

  it('rejects non-project and malformed routes', () => {
    expect(projectFromWorkspacePathname('/manage/file-access')).toBeNull()
    expect(projectFromWorkspacePathname('/p/%ZZ/e/E0017')).toBeNull()
  })
})
