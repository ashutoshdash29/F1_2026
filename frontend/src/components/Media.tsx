import { useState, type CSSProperties } from 'react'
import { team } from '../lib/teams'
import type { Manifest } from '../lib/types'

/** The driver's photo for a season: era-correct kit when we have it, otherwise their latest photo. */
export function driverSrc(media: Manifest, id: string, season?: number) {
  const m = media.drivers[id]
  return (season != null && m?.bySeason?.[String(season)]) || m?.src
}

interface DriverPhotoProps {
  media: Manifest; id: string; first: string; last: string; teamId: string
  size?: number; className?: string; season?: number
}

/**
 * Official cutout headshot, nothing around it: the transparent PNG stands on the bottom of
 * its row. Falls back to plain initials if the image is missing.
 */
export function DriverPhoto({ media, id, first, last, teamId, size = 56, className = '', season }: DriverPhotoProps) {
  const [broken, setBroken] = useState(false)
  const src = driverSrc(media, id, season)
  const style = { '--team': team(teamId).color, '--size': `${size}px` } as CSSProperties
  return (
    <span className={`dphoto ${className}`} style={style}>
      {src && !broken ? (
        <img src={`/${src}`} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
      ) : (
        <span className="dphoto__initials">{first[0]}{last[0]}</span>
      )}
    </span>
  )
}

/** Constructor emblem (no wordmark, transparent) sitting straight on the glass. */
export function TeamLogo({ media, id, name, size = 'sm' }: { media: Manifest; id: string; name: string; size?: 'sm' | 'md' | 'lg' }) {
  const [broken, setBroken] = useState(false)
  const t = team(id)
  const src = media.teams[id]?.src
  return (
    <span className={`tlogo tlogo--${size}`} style={{ '--team': t.color } as CSSProperties} title={name}>
      {src && !broken ? (
        <img src={`/${src}`} alt={`${name} logo`} loading="lazy" decoding="async" onError={() => setBroken(true)} />
      ) : (
        <span className="tlogo__fallback">{t.short.slice(0, 3).toUpperCase()}</span>
      )}
    </span>
  )
}
