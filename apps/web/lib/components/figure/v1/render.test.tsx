import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Render } from './render'

const block = {
  type: 'figure',
  version: 1,
  id: 'rollout',
  line: 1,
  payload: '',
  executable: false,
  document: { project: 'project-a', path: 'docs/wiki/showcase/W0009-x.md' },
  resourceUrl: (path: string) => `/api/doc-assets/project-a/docs/wiki/showcase/${path}`,
}
const video = '/api/doc-assets/project-a/docs/wiki/showcase/W0009-x__assets/rollout.mp4'

describe('figure@1 video', () => {
  it('shows only the poster until the reader clicks, then plays the video', () => {
    render(
      <Render
        block={block}
        data={{
          video: 'W0009-x__assets/rollout.mp4',
          poster: 'W0009-x__assets/rollout.jpg',
          caption: 'Video 1.',
        }}
      />,
    )
    expect(document.querySelector('video')).toBeNull()
    expect(document.querySelector('img')).toHaveAttribute(
      'src',
      '/api/doc-assets/project-a/docs/wiki/showcase/W0009-x__assets/rollout.jpg',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Play video: Video 1.' }))
    const player = document.querySelector('video')
    expect(player).toHaveAttribute('src', video)
    expect(player).toHaveAttribute('controls')
    expect(player).toHaveAttribute('autoplay')
  })

  it('shows a server-extracted thumbnail and no video element before the click', () => {
    render(
      <Render block={block} data={{ video: 'W0009-x__assets/rollout.mp4', caption: 'Video 1.' }} />,
    )
    expect(document.querySelector('video')).toBeNull()
    expect(document.querySelector('img')).toHaveAttribute('src', `${video}?thumbnail=1`)
    fireEvent.click(screen.getByRole('button', { name: 'Play video: Video 1.' }))
    expect(document.querySelector('video')).toHaveAttribute('src', video)
  })

  it('keeps a clickable placeholder when no thumbnail loads', () => {
    render(
      <Render block={block} data={{ video: 'W0009-x__assets/rollout.mp4', caption: 'Video 1.' }} />,
    )
    fireEvent.error(document.querySelector('img') as HTMLImageElement)
    expect(document.querySelector('img')).toBeNull()
    expect(document.querySelector('video')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Play video: Video 1.' }))
    expect(document.querySelector('video')).toHaveAttribute('src', video)
  })

  it('falls back to the caption notice when the video fails to play', () => {
    render(
      <Render block={block} data={{ video: 'W0009-x__assets/rollout.mp4', caption: 'Video 1.' }} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Play video: Video 1.' }))
    fireEvent.error(document.querySelector('video') as HTMLVideoElement)
    expect(screen.getByRole('status')).toHaveTextContent(
      'Video unavailable: W0009-x__assets/rollout.mp4',
    )
  })
})
