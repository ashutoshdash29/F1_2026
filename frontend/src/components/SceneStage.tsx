import { useEffect, useState } from 'react'
import { ScrollTrigger } from '../lib/motion'
import type { Manifest } from '../lib/types'

type Side = 'left' | 'right' | 'full'
type Shot = { id: string; side: Side }

const same = (a: Shot, b: Shot) => a.id === b.id && a.side === b.side

/**
 * Fixed, full-viewport photo layer behind the page.
 * Every <section data-scene="id" data-side="left|right|full"> claims the stage while it is
 * in the middle of the viewport: the sharp photo covers half the screen on that side and
 * dissolves into the background, with a blurred copy washing the rest of the page.
 *
 * Performance: only the active shot and the one fading out are mounted. Mounting every
 * scene (x4 layers, with blur filters and masks) kept ~90 full-screen images decoded and
 * composited behind every glass panel, which made scrolling stutter.
 */
export function SceneStage({ media, ready, season, heroScene = 'hero' }: { media: Manifest; ready: boolean; season?: number; heroScene?: string }) {
  // last item = active shot; the one before it (if any) is fading out
  const [shots, setShots] = useState<Shot[]>([{ id: heroScene, side: 'right' }])

  useEffect(() => {
    if (!ready) return
    const show = (s: Shot) => setShots((prev) =>
      same(prev[prev.length - 1], s) ? prev : [...prev.filter((p) => !same(p, s)).slice(-1), s])
    show({ id: heroScene, side: 'right' }) // a new season starts at the top, on its own hero
    const triggers = [...document.querySelectorAll<HTMLElement>('[data-scene]')].map((el) =>
      ScrollTrigger.create({
        trigger: el, start: 'top 55%', end: 'bottom 55%', refreshPriority: -1, // after the Moments pin adds its spacing
        onToggle: (s) => s.isActive && show({ id: el.dataset.scene!, side: (el.dataset.side as Side) || 'right' }),
      }),
    )
    return () => triggers.forEach((t) => t.kill())
  }, [ready, season, heroScene])

  const active = shots[shots.length - 1]
  const scene = (id: string) => media.scenes[id]
  const ambientIds = [...new Set(shots.map((s) => s.id))].filter(scene)

  return (
    <div className="stage" aria-hidden="true">
      <div className="stage__ambient">
        {ambientIds.map((id) => (
          <img key={id} src={`/${scene(id).src}`} alt="" className={id === active.id ? 'on' : ''} decoding="async" />
        ))}
      </div>
      {(['left', 'right', 'full'] as const).map((side) => (
        <div key={side} className={`stage__photo stage__photo--${side}`}>
          {shots.filter((s) => s.side === side && scene(s.id)).map(({ id }) => {
            const s = scene(id)
            const on = same({ id, side }, active)
            return (
              <div key={id} className="stage__shot">
                <img src={`/${s.src}`} alt="" style={{ objectPosition: s.focus }} className={on ? 'on' : ''} decoding="async" />
                {side !== 'full' && s.caption && (
                  <span className={`stage__tag ${on ? 'on' : ''}`}>{s.caption} <em>{s.place}</em></span>
                )}
              </div>
            )
          })}
        </div>
      ))}
      <div className="stage__veil" />
      <div className="stage__grain" />
    </div>
  )
}
