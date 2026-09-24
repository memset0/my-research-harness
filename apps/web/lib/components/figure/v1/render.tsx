'use client'

import { Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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
 * A video costs nothing until the reader asks for it: the thumbnail is the
 * poster image, or — without one — the first frame the browser reads through
 * small ranged metadata requests, and only once the thumbnail nears the
 * viewport. Clicking swaps in the real player, which is when the file loads.
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
  const [frameFailed, setFrameFailed] = useState(false)
  const thumbnail = useRef<HTMLButtonElement | null>(null)
  const near = useNearViewport(thumbnail, poster === null && !playing)

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
      ref={thumbnail}
      type="button"
      aria-label={`Play video: ${label}`}
      className="group relative mx-auto flex min-h-32 w-full max-w-full items-center justify-center overflow-hidden rounded-sm bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-figure-video="thumbnail"
      onClick={() => setPlaying(true)}
    >
      {poster ? (
        <img
          src={poster}
          alt=""
          loading="lazy"
          decoding="async"
          className="block h-auto max-w-full"
          onError={() => setFrameFailed(true)}
        />
      ) : near && !frameFailed ? (
        <video
          src={source}
          preload="metadata"
          muted
          playsInline
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none block h-auto max-w-full"
          onError={onError}
        />
      ) : null}
      <span className="absolute inset-0 flex items-center justify-center bg-black/10 transition-colors group-hover:bg-black/25">
        <span className="flex size-14 items-center justify-center rounded-full bg-background/90 text-foreground shadow-md">
          <Play className="ml-0.5 size-6 fill-current" aria-hidden />
        </span>
      </span>
    </button>
  )
}

/** True once `element` comes within 200px of the viewport (immediately without IntersectionObserver). */
function useNearViewport(element: React.RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [near, setNear] = useState(false)
  useEffect(() => {
    if (!enabled || near) return
    const target = element.current
    if (!target || typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true)
      },
      { rootMargin: '200px' },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [element, enabled, near])
  return near
}
