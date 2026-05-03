import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

describe('test rig smoke', () => {
  it('jsdom + RTL + jest-dom matchers work end-to-end', () => {
    render(<div data-testid="t">hello</div>)
    const el = screen.getByTestId('t')
    expect(el).toBeInTheDocument()
    expect(el).toHaveTextContent('hello')
  })

  it('imports under @ alias resolve', async () => {
    const mod = await import('@/lib/utils')
    expect(typeof mod.cn).toBe('function')
    expect(mod.cn('a', 'b')).toBe('a b')
  })
})
