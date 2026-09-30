import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

import { ThemeProvider } from './theme-provider'
import { ThemeToggle } from './theme-toggle'

function renderWithProvider() {
  return render(
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <ThemeToggle />
    </ThemeProvider>,
  )
}

describe('ThemeToggle', () => {
  it('renders three options with accessible labels', async () => {
    renderWithProvider()
    // First render returns a placeholder; wait for the mount effect to flush.
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /light/i })).toBeInTheDocument()
    })
    expect(screen.getByRole('radio', { name: /dark/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /system/i })).toBeInTheDocument()
  })

  it('reports the System slot as active by default', async () => {
    renderWithProvider()
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /system/i })).toHaveAttribute('aria-checked', 'true')
    })
    expect(screen.getByRole('radio', { name: /light/i })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('radio', { name: /dark/i })).toHaveAttribute('aria-checked', 'false')
  })
})
