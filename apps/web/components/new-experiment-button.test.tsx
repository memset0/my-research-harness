import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithQuery } from '../test/utils'

const routerPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('../lib/api', () => ({
  ApiError: class extends Error {},
  fetchProjects: vi.fn(),
  postExperiment: vi.fn(),
}))

import { fetchProjects, postExperiment } from '../lib/api'
import { NewExperimentButton } from './new-experiment-button'

describe('NewExperimentButton modal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    routerPush.mockClear()
    vi.mocked(fetchProjects).mockResolvedValue({
      projects: [{ name: 'project-a', root: '/p/a', exclude: [] }],
    })
  })

  async function openModal() {
    renderWithQuery(<NewExperimentButton project="project-a" />)
    await userEvent.click(screen.getByRole('button', { name: /new experiment/i }))
  }

  it('rejects empty name + invalid characters', async () => {
    await openModal()
    const nameInput = await screen.findByLabelText('Name')
    const submit = screen.getByRole('button', { name: /create/i })

    // Empty submit button is disabled (button has `disabled={busy || !name.trim()}`)
    expect(submit).toBeDisabled()

    // Invalid chars trigger inline error after submit attempt
    await userEvent.type(nameInput, 'has space!')
    await userEvent.click(submit)
    expect(await screen.findByText(/letters, digits, dashes, underscores/i)).toBeInTheDocument()
    expect(postExperiment).not.toHaveBeenCalled()
  })

  it('POST 200 → router.push to detail page + close', async () => {
    vi.mocked(postExperiment).mockResolvedValue({
      created: {
        id: 'foo-260503-100000',
        path: '/p/a/logs/foo-260503-100000',
        project: 'project-a',
      },
    } as never)

    await openModal()
    const nameInput = await screen.findByLabelText('Name')
    await userEvent.type(nameInput, 'foo')
    await userEvent.click(screen.getByRole('button', { name: /create/i }))

    await waitFor(() => {
      expect(postExperiment).toHaveBeenCalledWith({ name: 'foo', project: 'project-a' })
    })
    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith(
        '/p/project-a/experiments/foo-260503-100000',
      )
    })
  })

  it('POST 409 collision → inline error in modal', async () => {
    vi.mocked(postExperiment).mockResolvedValue({
      error: { code: 'CONFLICT', message: 'already exists' },
    } as never)

    await openModal()
    const nameInput = await screen.findByLabelText('Name')
    await userEvent.type(nameInput, 'foo')
    await userEvent.click(screen.getByRole('button', { name: /create/i }))

    expect(await screen.findByText(/already exists this second/i)).toBeInTheDocument()
    expect(routerPush).not.toHaveBeenCalled()
  })
})
