import { useEffect, useRef } from 'react'
import { gsap, onScrollVelocity, reducedMotion } from '../lib/motion'

/** Giant outlined names drifting sideways; scroll speed and direction push it along. */
export function Marquee({ words }: { words: string[] }) {
  const track = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (reducedMotion()) return
    const el = track.current!
    let x = 0, dir = -1, boost = 0
    // measure once (and on resize), not every frame: reading scrollWidth in the ticker forced a layout per frame
    let half = el.scrollWidth / 2
    const ro = new ResizeObserver(() => { half = el.scrollWidth / 2 })
    ro.observe(el)
    const off = onScrollVelocity((v) => {
      if (Math.abs(v) > 0.2) dir = v > 0 ? -1 : 1
      boost = Math.min(30, Math.abs(v) * 1.4)
    })
    const tick = () => {
      if (!half) return
      x += dir * (0.6 + boost)
      boost *= 0.92
      if (x <= -half) x += half
      if (x > 0) x -= half
      el.style.transform = `translate3d(${x}px,0,0) skewX(${-dir * Math.min(boost, 12) * 0.6}deg)`
    }
    gsap.ticker.add(tick)
    return () => { gsap.ticker.remove(tick); off(); ro.disconnect() }
  }, [])
  const row = words.map((w, i) => <span key={i} className={i % 3 === 0 ? 'solid' : ''}>{w}<i aria-hidden="true">✦</i></span>)
  return (
    <div className="marquee" aria-hidden="true">
      <div className="marquee__track" ref={track}>{row}{row}</div>
    </div>
  )
}
