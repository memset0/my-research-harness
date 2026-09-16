// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { cacheFileUrl, componentAssetsDir, docAssetUrl } from './urls'

const doc = { project: 'project/a', host: 'host-a', path: 'docs/wiki/note/W1-page.md' }

describe('component asset URLs', () => {
  it('derives cache directories for files and bundle READMEs', () => {
    expect(componentAssetsDir('docs/wiki/note/W1-page.md')).toBe('docs/wiki/note/W1-page__assets')
    expect(componentAssetsDir('docs/wiki/note/W1-page/README.md')).toBe('docs/wiki/note/W1-page/README__assets')
  })

  it('normalises document-relative targets without climbing above root', () => {
    expect(docAssetUrl(doc, '../assets/x y.svg')).toBe('/api/doc-assets/project%2Fa/docs/wiki/assets/x%20y.svg?host=host-a')
    expect(docAssetUrl(doc, '../../../../../../x.svg')).toBe('/api/doc-assets/project%2Fa/x.svg?host=host-a')
  })

  it('keeps the leading slash of absolute targets encoded', () => {
    expect(docAssetUrl(doc, '/srv/project/chart.svg')).toBe('/api/doc-assets/project%2Fa/%2Fsrv/project/chart.svg?host=host-a')
  })

  it('addresses cache files by project-relative derived path exactly once', () => {
    expect(cacheFileUrl(doc, 'metrics')).toBe('/api/doc-assets/project%2Fa/docs/wiki/note/W1-page__assets/metrics.json?host=host-a')
  })
})
