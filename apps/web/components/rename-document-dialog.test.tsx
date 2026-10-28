import { ProjectRefSchema } from '@memon/core'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renameDocument } from '../lib/api'
import { queryKeys } from '../lib/query-keys'
import { renderWithQuery } from '../test/utils'
import { RenameDocumentButton } from './rename-document-dialog'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, renameDocument: vi.fn() }
})
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))

const PROJECT = ProjectRefSchema.parse({ host: 'host-a', project: 'project-a' })

describe('RenameDocumentButton', () => {
  beforeEach(() => vi.mocked(renameDocument).mockReset())

  it('saves a trimmed title and refreshes the document and its lists', async () => {
    vi.mocked(renameDocument).mockResolvedValue({ ok: true, title: 'New name' })
    const { queryClient } = renderWithQuery(
      <RenameDocumentButton project={PROJECT} kind="report" id="R0001" title="Old name" />,
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }))
    const input = screen.getByLabelText('Title')
    expect(input).toHaveValue('Old name')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.clear(input)
    await userEvent.type(input, '  New name ')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(renameDocument).toHaveBeenCalledWith(PROJECT, 'report', 'R0001', 'New name')
    await waitFor(() => expect(screen.queryByLabelText('Title')).toBeNull())
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.reports(PROJECT) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.report(PROJECT, 'R0001') })
  })

  it('keeps the dialog open with the refusal message', async () => {
    vi.mocked(renameDocument).mockRejectedValueOnce(
      new Error('Title edits are not enabled for this Project'),
    )
    renderWithQuery(<RenameDocumentButton project={PROJECT} kind="wiki" id="W0001" title="A" />)
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }))
    await userEvent.type(screen.getByLabelText('Title'), 'B')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Title edits are not enabled')
    expect(screen.getByLabelText('Title')).toHaveValue('AB')
  })
})
