'use client'

import { Play } from 'lucide-react'
import { useState } from 'react'
import { cn } from '../../../utils'
import type { ComponentData, ComponentRenderer } from '../../types'
import type { descriptor } from './index'

type FigureData = ComponentData<typeof descriptor>

export const Render: ComponentRenderer<FigureData> = ({ data, block }) => {
  const path = data.video ?? data.image ?? ''
  const source = block.resourceUrl(path)
  const [failed, setFailed] = useState<string | null>(null)
  const available = source !== null && failed !== source
  return (
    <figure className="not-prose my-6" data-component={`figure@${block.version}`}>
      {!available ? (
        <div role="status" className="border border-border p-4 text-sm text-muted-foreground">
          <p>
            {source
              ? `${data.video ? 'Video' : 'Image'} unavailable: ${path}`
              : `Figure ${data.video ? 'video' : 'image'} requires a document context.`}
          </p>
          <p className="font-medium text-foreground">{data.caption}</p>
          {data.description && <p>{data.description}</p>}
        </div>
      ) : data.video ? (
        <FigureVideo
          source={source}
          poster={data.poster ? block.resourceUrl(data.poster) : null}
          label={data.description ?? data.caption}
          onError={() => setFailed(source)}
        />
      ) : (
        <img
          src={source}
          alt={data.description ?? data.caption}
          loading="lazy"
          decoding="async"
          className="mx-auto block h-auto max-w-full"
          onError={() => setFailed(source)}
        />
      )}
      <figcaption className="mt-2 text-center text-sm text-muted-foreground">{data.caption}</figcaption>
    </figure>
  )
}

/**
 * No byte of the video reaches the browser until the reader presses play.
 * The thumbnail is the poster, or the first frame the server extracts
 * (`?thumbnail=1`); if neither loads, a neutral tile with the play button
 * stands in. Clicking swaps in the real player, which is when the file loads.
 */
function FigureVideo({
  source,
  poster,
  label,
  onError,
}: {
  source: string
  poster: string | null
  label: string
  onError: () => void
}) {
  const [playing, setPlaying] = useState(false)
  const [thumbnailFailed, setThumbnailFailed] = useState(false)
  const thumbnail = poster ?? `${source}${source.includes('?') ? '&' : '?'}thumbnail=1`

  if (playing) {
    return (
      // biome-ignore lint/a11y/useMediaCaption: project videos (samples, rollouts) ship no caption track; the figure caption and description carry the text.
      <video
        src={source}
        poster={poster ?? undefined}
        controls
        autoPlay
        playsInline
        preload="auto"
        aria-label={label}
        className="mx-auto block h-auto max-w-full bg-black"
        data-figure-video="playing"
        onError={onError}
      />
    )
  }
  return (
    <button
      type="button"
      aria-label={`Play video: ${label}`}
      className={cn(
        'group relative mx-auto flex max-w-full items-center justify-center overflow-hidden rounded-sm bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        thumbnailFailed ? 'aspect-video w-full max-w-xl' : 'min-h-24',
      )}
      data-figure-video="thumbnail"
      onClick={() => setPlaying(true)}
    >
      {!thumbnailFailed && (
        <img
          src={thumbnail}
          alt=""
          loading="lazy"
          decoding="async"
          className="block h-auto max-w-full"
          onError={() => setThumbnailFailed(true)}
        />
      )}
      <span className="absolute inset-0 flex items-center justify-center bg-black/10 transition-colors group-hover:bg-black/25">
        <span className="flex size-14 items-center justify-center rounded-full bg-background/90 text-foreground shadow-md">
          <Play className="ml-0.5 size-6 fill-current" aria-hidden />
        </span>
      </span>
    </button>
  )
}
